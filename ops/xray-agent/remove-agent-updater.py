#!/usr/bin/env python3
"""Remove idle updater services without running or restarting an Agent/core."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

STATE_ROOT = Path('/var/lib/suxin-agent-updater')
SYSTEM_UNITS = Path('/etc/systemd/system')
RUNTIME_UNITS = Path('/run/systemd/system')
OVERRIDE = '[Service]\nRestart=no\n'


def run(*args):
    result = subprocess.run(args, check=True, text=True, capture_output=True, timeout=30)
    return result.stdout.strip()


def property_value(command, unit, name):
    return command('systemctl', 'show', unit, '-p', name, '--value')


def stable_updater_state(command, unit):
    state = (
        property_value(command, unit, 'MainPID'),
        property_value(command, unit, 'ActiveState'),
        property_value(command, unit, 'SubState'),
    )
    pid, active, sub = state
    if not pid.isdecimal() or not (
        (int(pid) > 0 and (active, sub) == ('active', 'running'))
        or (pid == '0' and (active, sub) == ('inactive', 'dead'))
    ):
        raise RuntimeError(f'{unit}: updater is not in a stable active or inactive state')
    return state


def ensure_no_journal(folder):
    for name in ('job.json', 'job.json.tmp'):
        if (folder / name).exists() or (folder / name).is_symlink():
            raise RuntimeError(f'{folder.name}: unfinished update journal; retain it and finish/reconcile the job first')


def inventory(root, units, runtime, command):
    if not root.exists():
        return []
    if root.is_symlink() or not root.is_dir():
        raise RuntimeError('Updater state root must be a real directory')
    targets = []
    for folder in sorted(root.iterdir()):
        if not folder.is_dir():
            continue
        if folder.is_symlink() or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', folder.name):
            raise RuntimeError('Invalid updater state directory')
        ensure_no_journal(folder)
        unit = f'suxin-agent-updater-{folder.name}.service'
        unit_file = units / unit
        config_file = folder / 'config.json'
        if not config_file.exists():
            if unit_file.exists() or (folder / 'updater').exists():
                raise RuntimeError(f'{folder.name}: incomplete installation; config is missing')
            continue
        for file in (config_file, folder / 'updater', unit_file):
            if file.is_symlink() or (file.exists() and not file.is_file()):
                raise RuntimeError(f'{folder.name}: updater files must be regular files')
        if not unit_file.is_file():
            raise RuntimeError(f'{folder.name}: updater unit is missing; inspect any still-loaded process before cleanup')
        config = json.loads(config_file.read_text())
        agent_unit = config.get('serviceUnit', '')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9@_.-]{0,100}\.service', agent_unit) or 'agent' not in agent_unit or agent_unit.startswith('suxin-agent-updater-'):
            raise RuntimeError(f'{folder.name}: invalid Agent service name')
        current = folder / 'agent-current'
        if config.get('stateDir') != str(folder) or config.get('agentPath') != str(current):
            raise RuntimeError(f'{folder.name}: configuration does not match its state directory')
        if not current.is_symlink() or not current.resolve().is_file() or not current.resolve().is_relative_to((folder / 'releases').resolve()):
            raise RuntimeError(f'{folder.name}: Agent executable is missing or outside releases')
        override = runtime / (unit + '.d') / 'zzzz-retire-updater.conf'
        if override.exists() and override.read_text() != OVERRIDE:
            raise RuntimeError(f'{folder.name}: refusing to replace a different runtime override')
        agent_pid = property_value(command, agent_unit, 'MainPID')
        if not agent_pid.isdecimal() or int(agent_pid) <= 0:
            raise RuntimeError(f'{folder.name}: Agent must be running before retiring its updater')
        state = stable_updater_state(command, unit)
        targets.append(dict(folder=folder, unit=unit, unit_file=unit_file,
                            agent_unit=agent_unit, agent_pid=agent_pid,
                            pid=state[0], state=state, override=override))
    return targets


def verify_agents(targets, command):
    for item in targets:
        if property_value(command, item['agent_unit'], 'MainPID') != item['agent_pid']:
            raise RuntimeError(f"{item['folder'].name}: Agent PID changed; retain all remaining files and investigate")


def remove_updaters(root=STATE_ROOT, units=SYSTEM_UNITS, runtime=RUNTIME_UNITS, command=run):
    # Validate every installation before even freezing one updater.
    targets = inventory(root, units, runtime, command)
    frozen = []
    overrides = []
    stopped = set()
    completed = False
    try:
        for item in targets:
            if stable_updater_state(command, item['unit']) != item['state']:
                raise RuntimeError(f"{item['folder'].name}: updater changed after preflight; inspect it before retrying")
            if int(item['pid']) > 0:
                command('systemctl', 'freeze', item['unit'])
                frozen.append(item)
                if property_value(command, item['unit'], 'FreezerState') != 'frozen':
                    raise RuntimeError(f"{item['folder'].name}: updater did not freeze")
        # A job may arrive between initial inspection and freezing. A journal is
        # written before replacement; never delete it or force past this check.
        for item in targets:
            ensure_no_journal(item['folder'])
        verify_agents(targets, command)
        for item in targets:
            item['override'].parent.mkdir(parents=True, exist_ok=True)
            item['override'].write_text(OVERRIDE)
            overrides.append(item['override'])
        if overrides:
            command('systemctl', 'daemon-reload')
        for item in targets:
            if property_value(command, item['unit'], 'Restart') != 'no':
                raise RuntimeError(f"{item['folder'].name}: cannot disable updater restarts safely")
            if int(item['pid']) > 0:
                if property_value(command, item['unit'], 'FreezerState') != 'frozen':
                    raise RuntimeError(f"{item['folder'].name}: cannot safely stop a frozen updater")
            elif stable_updater_state(command, item['unit']) != item['state']:
                raise RuntimeError(f"{item['folder'].name}: inactive updater changed before stop; retain its files")
        # Kill only frozen, journal-free updater cgroups. Normal stopping can
        # thaw before SIGTERM and race with the next update job.
        for item in frozen:
            command('systemctl', 'kill', '--kill-who=all', '--signal=SIGKILL', item['unit'])
            stopped.add(item['unit'])
        for item in targets:
            if item['unit_file'].exists():
                # An already inactive service needs no stop signal. Revalidate
                # it instead of accidentally terminating a newly live updater.
                if item['unit'] in stopped:
                    command('systemctl', 'stop', item['unit'])
                elif stable_updater_state(command, item['unit']) != item['state']:
                    raise RuntimeError(f"{item['folder'].name}: inactive updater changed before cleanup")
                command('systemctl', 'disable', item['unit'])
                if stable_updater_state(command, item['unit']) != ('0', 'inactive', 'dead'):
                    raise RuntimeError(f"{item['folder'].name}: updater is still running; no files removed")
            ensure_no_journal(item['folder'])
        verify_agents(targets, command)
        # Deletions begin only after all targets are stopped and validated.
        for item in targets:
            for file in (item['unit_file'], item['folder'] / 'updater', item['folder'] / 'config.json'):
                file.unlink(missing_ok=True)
        completed = True
        return [{'installation': item['folder'].name, 'agentUnit': item['agent_unit'],
                 'agentPid': int(item['agent_pid']), 'updaterRemoved': True}
                for item in targets]
    finally:
        for file in overrides:
            file.unlink(missing_ok=True)
        if overrides or stopped:
            command('systemctl', 'daemon-reload')
        for item in frozen:
            if item['unit'] not in stopped:
                command('systemctl', 'thaw', item['unit'])
        if completed:
            verify_agents(targets, command)


def main():
    if len(sys.argv) != 1:
        raise RuntimeError('Usage: remove-agent-updater.sh (no FORCE or journal removal mode)')
    if os.geteuid() != 0:
        raise RuntimeError('Run as root')
    if os.environ.get('FORCE'):
        raise RuntimeError('FORCE is not supported; reconcile update journals first')
    result = remove_updaters()
    print(json.dumps({'updaters': result, 'agentExecutablesRetained': True}))


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        raise SystemExit(str(error))
    except (OSError, ValueError, subprocess.SubprocessError):
        # Command output and configuration may contain credentials; do not echo it.
        raise SystemExit('Updater removal failed; files and journals were retained where possible. Inspect local service state before retrying.')
