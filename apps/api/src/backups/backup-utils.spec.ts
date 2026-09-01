import {
  isSafeArchivePath,
  localDateKey,
  scheduledBackupsToDelete,
  shouldCreateDailyBackup,
} from './backup-utils';
import type { BackupMetadata } from './backup.types';

function backup(
  id: string,
  createdAt: string,
  source: BackupMetadata['source'] = 'scheduled',
): BackupMetadata {
  return {
    id,
    filename: `${id}.h2backup`,
    createdAt,
    source,
    size: 10,
    sha256: 'a'.repeat(64),
    appVersion: 'test',
  };
}

describe('backup utilities', () => {
  it('rejects archive traversal, absolute paths, backslashes, and links outside known roots', () => {
    expect(isSafeArchivePath('manifest.json')).toBe(true);
    expect(isSafeArchivePath('files/tutorial-images/one.webp')).toBe(true);
    expect(isSafeArchivePath('../database.dump')).toBe(false);
    expect(isSafeArchivePath('/etc/passwd')).toBe(false);
    expect(isSafeArchivePath('files\\tutorial-assets\\client.exe')).toBe(false);
    expect(isSafeArchivePath('files/other/secret')).toBe(false);
  });

  it('retains only the newest configured scheduled backups', () => {
    const records = [
      backup('one', '2026-08-28T00:00:00.000Z'),
      backup('two', '2026-08-29T00:00:00.000Z'),
      backup('three', '2026-08-30T00:00:00.000Z'),
      backup('four', '2026-08-31T00:00:00.000Z'),
      backup('manual', '2026-08-01T00:00:00.000Z', 'manual'),
    ];
    expect(scheduledBackupsToDelete(records, 3).map((item) => item.id)).toEqual(
      ['one'],
    );
  });

  it('runs once per Shanghai calendar day after the configured hour', () => {
    const now = new Date('2026-09-01T20:30:00.000Z');
    expect(localDateKey(now, 'Asia/Shanghai')).toBe('2026-09-02');
    expect(
      shouldCreateDailyBackup({
        now,
        timeZone: 'Asia/Shanghai',
        hour: 3,
        backups: [],
      }),
    ).toBe(true);
    expect(
      shouldCreateDailyBackup({
        now,
        timeZone: 'Asia/Shanghai',
        hour: 3,
        backups: [backup('today', '2026-09-01T19:10:00.000Z')],
      }),
    ).toBe(false);
  });
});
