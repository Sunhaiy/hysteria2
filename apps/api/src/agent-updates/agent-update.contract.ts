import { BadRequestException } from '@nestjs/common';

export const agentArtifactLimit = 64 * 1024 * 1024;
export const terminalUpdateStates = [
  'SUCCEEDED',
  'ROLLED_BACK',
  'FAILED',
  'CANCELED',
];
export const updateStates = [
  'QUEUED',
  'DOWNLOADING',
  'VERIFYING',
  'INSTALLING',
  'CHECKING',
  'ROLLING_BACK',
  ...terminalUpdateStates,
];

export function validateAgentArtifact(binary: Buffer, architecture: string) {
  const machine =
    architecture === 'amd64' ? 62 : architecture === 'arm64' ? 183 : -1;
  if (
    binary.length < 64 ||
    binary.length > agentArtifactLimit ||
    binary.subarray(0, 4).toString('hex') !== '7f454c46' ||
    binary[4] !== 2 ||
    binary[5] !== 1 ||
    binary.readUInt16LE(18) !== machine
  ) {
    throw new BadRequestException(
      '请上传与所选架构一致的 Linux 64 位 Agent 可执行文件。',
    );
  }
}

export function canReportUpdate(from: string, to: string) {
  if (from === to) return true;
  if (terminalUpdateStates.includes(from)) return false;
  if (to === 'ROLLING_BACK') return ['INSTALLING', 'CHECKING'].includes(from);
  if (['FAILED', 'ROLLED_BACK'].includes(to)) return true;
  return (
    (
      {
        DOWNLOADING: 'VERIFYING',
        VERIFYING: 'INSTALLING',
        INSTALLING: 'CHECKING',
        CHECKING: 'SUCCEEDED',
      } as Record<string, string>
    )[from] === to
  );
}

export function releaseManifest(release: {
  id: string;
  version: string;
  architecture: string;
  sha256: string;
  size: number;
}) {
  // Canonical bytes are signed as-is. Updaters verify these bytes before parsing.
  return JSON.stringify({
    format: 1,
    id: release.id,
    version: release.version,
    architecture: release.architecture,
    sha256: release.sha256,
    size: release.size,
    component: 'xray-agent',
  });
}
