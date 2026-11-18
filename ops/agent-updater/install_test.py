"""Bootstrap contract tests; all Linux filesystem and systemctl access is isolated."""
import importlib.util
import json
import base64
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('agent_install', Path(__file__).with_name('install.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class BootstrapTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.calls = []
        self.fail_start = False
        self.user = 'root'
        self.arch = 'amd64'
        self.unit = 'xray-agent.service'
        self.config = self.root / 'enrollment.json'
        self.config.write_text(json.dumps(dict(id='test1', serviceUnit=self.unit,
            architecture='amd64', apiBaseUrl='https://control.invalid', token='a'*43,
            publicKey='-----BEGIN PUBLIC KEY-----\n'+base64.b64encode(bytes.fromhex('302a300506032b6570032100')+b'a'*32).decode()+'\n-----END PUBLIC KEY-----')))
        self.binary = self.root / 'updater-linux'
        header = bytearray(80)
        header[:6] = b'\x7fELF\x02\x01'
        header[18:20] = (62).to_bytes(2, 'little')
        self.binary.write_bytes(header)
        proc = self.root / 'proc' / '42'
        proc.mkdir(parents=True)
        (proc / 'environ').write_bytes(b'XRAY_AGENT_SECRET=local-fixture\0')
        (proc / 'cmdline').write_bytes(b'/usr/local/bin/xray-agent\0')
        (proc / 'exe').write_bytes(b'old-agent-binary')
        (self.root / 'etc/systemd/system').mkdir(parents=True)
        self.patches = [patch.object(installer, 'Path', self.mapped_path),
            patch.object(installer.os, 'geteuid', return_value=0, create=True),
            patch.object(installer, 'command', self.command),
            patch.object(installer.subprocess, 'run'),
            patch.object(Path, 'symlink_to', lambda path, target: path.write_text(str(target)))]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def mapped_path(self, value):
        value = str(value)
        if value.startswith(('/proc/', '/var/lib/', '/etc/systemd/')):
            return self.root / value.lstrip('/')
        return Path(value)

    def command(self, *args):
        self.calls.append(args)
        if args == ('uname', '-m'):
            return 'x86_64'
        if 'MainPID' in args:
            return '42'
        if 'User' in args:
            return self.user
        if 'cat' in args:
            return '[Service]\nExecStart=/usr/local/bin/xray-agent\n'
        if self.fail_start and 'enable' in args:
            raise subprocess.CalledProcessError(1, args)
        return 'active'

    def test_bootstrap_preserves_running_services_and_original_binary(self):
        installer.install(str(self.config), str(self.binary))
        managed = self.root / 'var/lib/suxin-agent-updater/test1'
        self.assertEqual(len(list((managed / 'releases').iterdir())), 1)
        self.assertEqual(next((managed / 'releases').iterdir()).read_bytes(), b'old-agent-binary')
        self.assertTrue((managed / 'config.json').exists())
        self.assertFalse(any('restart' in args for args in self.calls))
        self.assertIn(('systemctl', 'enable', '--now', 'suxin-agent-updater-test1.service'), self.calls)

    def test_start_failure_removes_agent_override(self):
        self.fail_start = True
        with self.assertRaisesRegex(RuntimeError, '启动失败'):
            installer.install(str(self.config), str(self.binary))
        self.assertFalse((self.root / 'etc/systemd/system/xray-agent.service.d/zzzz-suxin-updater.conf').exists())
        self.assertFalse(any('restart' in args for args in self.calls))

    def test_wrong_architecture_binary_is_rejected_before_install(self):
        self.binary.write_bytes(b'not a Linux binary')
        with self.assertRaisesRegex(RuntimeError, 'Linux'):
            installer.install(str(self.config), str(self.binary))
        self.assertFalse((self.root / 'var/lib/suxin-agent-updater/test1').exists())

    def test_non_root_agent_rejected_without_changing_user(self):
        self.user = 'agent'
        with self.assertRaisesRegex(RuntimeError, 'root'):
            installer.install(str(self.config), str(self.binary))
        self.assertFalse((self.root / 'var/lib/suxin-agent-updater/test1').exists())


if __name__ == '__main__':
    unittest.main()
