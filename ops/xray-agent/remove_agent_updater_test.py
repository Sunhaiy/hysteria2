import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('retire_updater', Path(__file__).with_name('remove-agent-updater.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RemovalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='updater-removal-test-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'state'
        self.units = self.base / 'units'
        self.runtime = self.base / 'runtime'
        for directory in (self.root, self.units, self.runtime):
            directory.mkdir()
        self.commands = []
        self.pids = {}
        self.states = {}
        self.frozen = set()
        self.on_freeze = lambda unit: None
        self.fail_stop = False
        self.before_command = lambda args: None

    def add(self, name):
        folder = self.root / name
        (folder / 'releases').mkdir(parents=True)
        binary = folder / 'releases' / 'current-binary'
        binary.write_bytes(b'agent executable')
        current = folder / 'agent-current'
        try:
            current.symlink_to(binary)
        except OSError:
            self.skipTest('Filesystem must support symlinks')
        agent = f'test-{name}-agent.service'
        (folder / 'config.json').write_text(json.dumps({
            'serviceUnit': agent, 'stateDir': str(folder), 'agentPath': str(current),
            'token': 'secret-must-not-be-printed',
        }))
        (folder / 'updater').write_bytes(b'updater executable')
        unit = f'suxin-agent-updater-{name}.service'
        (self.units / unit).write_text('[Service]\nRestart=always\n')
        self.pids[agent] = '101'
        self.pids[unit] = '201'
        self.states[unit] = ('active', 'running')
        return folder, unit, agent

    def command(self, *args):
        self.commands.append(args)
        self.before_command(args)
        action = args[1]
        if action == 'show':
            unit, prop = args[2], args[4]
            if prop == 'MainPID':
                return self.pids[unit]
            if prop == 'ActiveState':
                return self.states[unit][0]
            if prop == 'SubState':
                return self.states[unit][1]
            if prop == 'FreezerState':
                return 'frozen' if unit in self.frozen else 'running'
            if prop == 'Restart':
                override = self.runtime / (unit + '.d') / 'zzzz-retire-updater.conf'
                return 'no' if override.exists() else 'always'
        if action == 'freeze':
            self.frozen.add(args[2])
            self.on_freeze(args[2])
        if action == 'thaw':
            self.frozen.remove(args[2])
        if action == 'kill':
            self.assertIn(args[-1], self.frozen)
            self.pids[args[-1]] = '0'
        if action == 'stop' and self.fail_stop:
            raise subprocess.CalledProcessError(1, args)
        if action == 'stop':
            self.states[args[2]] = ('inactive', 'dead')
        return ''

    def remove(self):
        return module.remove_updaters(self.root, self.units, self.runtime, self.command)

    def test_removes_only_updater_and_preserves_agent_executable(self):
        folder, unit, agent = self.add('one')
        result = self.remove()
        self.assertTrue(result[0]['updaterRemoved'])
        self.assertFalse((folder / 'updater').exists())
        self.assertFalse((folder / 'config.json').exists())
        self.assertFalse((self.units / unit).exists())
        self.assertEqual((folder / 'agent-current').read_bytes(), b'agent executable')
        self.assertEqual(self.pids[agent], '101')
        self.assertFalse(any(command[1] == 'restart' for command in self.commands))
        self.assertEqual(self.remove(), [])

    def test_validates_all_installations_before_first_mutation(self):
        first, _, _ = self.add('a')
        second, _, _ = self.add('b')
        (second / 'job.json').write_text('{"phase":"INSTALLING"}')
        with self.assertRaisesRegex(RuntimeError, 'unfinished update journal'):
            self.remove()
        self.assertTrue((first / 'updater').exists())
        self.assertTrue((second / 'job.json').exists())
        self.assertTrue(all(command[1] == 'show' for command in self.commands))

    def test_journal_appearing_during_freeze_is_preserved_and_updater_thawed(self):
        folder, unit, _ = self.add('one')
        self.on_freeze = lambda _: (folder / 'job.json.tmp').write_text('in-progress')
        with self.assertRaisesRegex(RuntimeError, 'unfinished update journal'):
            self.remove()
        self.assertTrue((folder / 'job.json.tmp').exists())
        self.assertTrue((folder / 'config.json').exists())
        self.assertNotIn(unit, self.frozen)
        self.assertFalse(any(command[1] == 'kill' for command in self.commands))

    def test_stop_failure_keeps_every_updater_file(self):
        folder, unit, _ = self.add('one')
        self.fail_stop = True
        with self.assertRaises(subprocess.CalledProcessError):
            self.remove()
        self.assertTrue((folder / 'config.json').exists())
        self.assertTrue((folder / 'updater').exists())
        self.assertTrue((self.units / unit).exists())

    def test_agent_change_blocks_deletion(self):
        folder, _, agent = self.add('one')
        self.on_freeze = lambda _: self.pids.update({agent: '102'})
        with self.assertRaisesRegex(RuntimeError, 'Agent PID changed'):
            self.remove()
        self.assertTrue((folder / 'updater').exists())

    def test_missing_unit_does_not_assume_a_loaded_updater_has_stopped(self):
        folder, unit, _ = self.add('one')
        (self.units / unit).unlink()
        with self.assertRaisesRegex(RuntimeError, 'unit is missing'):
            self.remove()
        self.assertTrue((folder / 'config.json').exists())
        self.assertTrue((folder / 'updater').exists())

    def test_pid_zero_with_pending_automatic_restart_is_not_treated_as_stopped(self):
        folder, unit, _ = self.add('one')
        self.pids[unit] = '0'
        for state in [('activating', 'auto-restart'), ('failed', 'failed'), ('deactivating', 'stop')]:
            with self.subTest(state=state):
                self.states[unit] = state
                with self.assertRaisesRegex(RuntimeError, 'stable'):
                    self.remove()
        self.assertTrue((folder / 'config.json').exists())
        self.assertFalse(any(command[1] in ('stop', 'kill') for command in self.commands))

    def test_inactive_updater_becoming_live_after_runtime_reload_is_not_stopped(self):
        folder, unit, _ = self.add('one')
        self.pids[unit] = '0'
        self.states[unit] = ('inactive', 'dead')
        def transition(args):
            if args == ('systemctl', 'daemon-reload'):
                self.pids[unit] = '202'
                self.states[unit] = ('active', 'running')
        self.before_command = transition
        with self.assertRaisesRegex(RuntimeError, 'changed'):
            self.remove()
        self.assertTrue((folder / 'config.json').exists())
        self.assertFalse(any(command[1] in ('stop', 'kill') for command in self.commands))

    def test_stably_inactive_updater_is_removed_without_stop_or_kill(self):
        folder, unit, agent = self.add('one')
        self.pids[unit] = '0'
        self.states[unit] = ('inactive', 'dead')
        self.assertTrue(self.remove()[0]['updaterRemoved'])
        self.assertFalse((folder / 'config.json').exists())
        self.assertEqual(self.pids[agent], '101')
        self.assertFalse(any(command[1] in ('stop', 'kill') for command in self.commands))

    def test_inactive_updater_becoming_live_is_not_stopped_unfrozen(self):
        folder, unit, _ = self.add('one')
        self.pids[unit] = '0'
        self.states[unit] = ('inactive', 'dead')
        reads = 0
        def transition(args):
            nonlocal reads
            if args == ('systemctl', 'show', unit, '-p', 'MainPID', '--value'):
                reads += 1
                if reads == 2:
                    self.pids[unit] = '202'
                    self.states[unit] = ('active', 'running')
        self.before_command = transition
        with self.assertRaisesRegex(RuntimeError, 'changed'):
            self.remove()
        self.assertTrue((folder / 'config.json').exists())
        self.assertFalse(any(command[1] in ('stop', 'kill') for command in self.commands))


if __name__ == '__main__':
    unittest.main()
