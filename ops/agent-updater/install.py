#!/usr/bin/env python3
"""One-time, local enrollment. Does not restart the Agent or proxy cores."""
import hashlib
import base64
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import urlparse

def command(*args):
    return subprocess.check_output(args, text=True).strip()

def install(enrollment_file, updater_binary):
    if os.geteuid() != 0:
        raise RuntimeError('请以 root 运行一次安装器。')
    enrollment = json.loads(Path(enrollment_file).read_text())
    installation_id = enrollment['id']
    unit = enrollment['serviceUnit']
    if not re.fullmatch(r'[A-Za-z0-9_-]{43}', enrollment['token']):
        raise RuntimeError('更新器凭据无效，请重新取得登记配置。')
    key = enrollment['publicKey'].strip()
    try:
        if not key.startswith('-----BEGIN PUBLIC KEY-----') or not key.endswith('-----END PUBLIC KEY-----'):
            raise ValueError('invalid PEM')
        der = base64.b64decode(''.join(key.splitlines()[1:-1]), validate=True)
        if len(der) != 44 or der[:12] != bytes.fromhex('302a300506032b6570032100'):
            raise ValueError('invalid Ed25519 key')
    except ValueError:
        raise RuntimeError('登记配置必须包含有效的 Ed25519 公钥。')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', installation_id):
        raise RuntimeError('登记编号无效。')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9@_.-]{0,100}\.service', unit) or 'agent' not in unit:
        raise RuntimeError('只能登记独立 Agent 服务。')
    parsed = urlparse(enrollment['apiBaseUrl'])
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise RuntimeError('主站必须为 HTTPS 根地址。')
    actual_arch = {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(command('uname', '-m'))
    if actual_arch != enrollment['architecture']:
        raise RuntimeError('登记架构与服务器不一致。')
    header = Path(updater_binary).read_bytes()[:64]
    machine = 62 if actual_arch == 'amd64' else 183
    if len(header) < 64 or header[:6] != b'\x7fELF\x02\x01' or int.from_bytes(header[18:20], 'little') != machine:
        raise RuntimeError('更新器必须是与服务器架构一致的 Linux 可执行文件。')
    if command('systemctl', 'show', unit, '-p', 'User', '--value') not in ('', 'root'):
        raise RuntimeError('当前安装器仅支持 root 运行的 Agent，请勿修改现有服务用户。')
    pid = command('systemctl', 'show', unit, '-p', 'MainPID', '--value')
    if not pid.isdecimal() or int(pid) == 0:
        raise RuntimeError('请先确保目标 Agent 正在运行。')
    env = Path('/proc/' + pid + '/environ').read_bytes().split(b'\0')
    if not any(entry.startswith(b'XRAY_AGENT_SECRET=') for entry in env):
        raise RuntimeError('目标不是受支持的 Xray Agent。')
    args = Path('/proc/' + pid + '/cmdline').read_bytes().rstrip(b'\0').split(b'\0')
    if len(args) != 1:
        raise RuntimeError('当前 Agent 使用额外启动参数，请先人工确认兼容配置。')
    root = Path('/var/lib/suxin-agent-updater') / installation_id
    if root.exists():
        raise RuntimeError('更新器已安装或存在未完成安装目录，请勿覆盖其任务和回滚记录。')
    root.mkdir(parents=True, mode=0o700)
    (root / 'releases').mkdir(mode=0o700)
    binary = Path('/proc/' + pid + '/exe').read_bytes()
    digest = hashlib.sha256(binary).hexdigest()
    original = root / 'releases' / digest
    original.write_bytes(binary)
    original.chmod(0o755)
    current = root / 'agent-current'
    current.symlink_to(original)
    shutil.copy2(updater_binary, root / 'updater')
    (root / 'updater').chmod(0o755)
    enrollment.update(agentPath=str(current), stateDir=str(root))
    config_path = root / 'config.json'
    config_path.write_text(json.dumps(enrollment))
    config_path.chmod(0o600)
    dropin_dir = Path('/etc/systemd/system') / (unit + '.d')
    dropin_dir.mkdir(exist_ok=True)
    dropin = dropin_dir / 'zzzz-suxin-updater.conf'
    if dropin.exists():
        raise RuntimeError('已存在更新器启动配置，停止以避免覆盖。')
    (root / 'original-unit.txt').write_text(command('systemctl', 'cat', unit))
    (root / 'original-unit.txt').chmod(0o600)
    updater_unit = 'suxin-agent-updater-' + installation_id + '.service'
    unit_path = Path('/etc/systemd/system') / updater_unit
    if unit_path.exists():
        raise RuntimeError('更新器服务配置已存在，停止以避免覆盖。')
    try:
        dropin.write_text('[Service]\nExecStart=\nExecStart=' + str(current) + '\n')
        unit_path.write_text('[Unit]\nDescription=Suxin Agent update executor\nAfter=network-online.target\nWants=network-online.target\n[Service]\nType=simple\nUser=root\nUMask=0077\nExecStart=' + str(root / 'updater') + ' ' + str(config_path) + '\nRestart=always\nRestartSec=15\n[Install]\nWantedBy=multi-user.target\n')
        command('systemctl', 'daemon-reload')
        command('systemctl', 'enable', '--now', updater_unit)
        command('systemctl', 'is-active', updater_unit)
    except (OSError, subprocess.CalledProcessError):
        subprocess.run(['systemctl', 'disable', '--now', updater_unit], capture_output=True)
        dropin.unlink(missing_ok=True)
        command('systemctl', 'daemon-reload')
        raise RuntimeError('更新器启动失败，已恢复 Agent 启动配置；查看更新器日志后再处理。')
    print('更新器已登记运行。Agent 和代理核心均未重启。请在后台确认在线状态。')

if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('用法：sudo python3 install.py enrollment.json ./agent-updater-linux')
    try:
        install(sys.argv[1], sys.argv[2])
    except (RuntimeError, KeyError, ValueError, OSError, subprocess.CalledProcessError) as error:
        # Do not include configuration contents or subprocess output in diagnostics.
        raise SystemExit(str(error) if isinstance(error, RuntimeError) else '安装失败，请检查输入文件、服务名与权限。')
