import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tar from 'tar';
import { BackupService } from './backup.service';
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION } from './backup.types';

const sha256 = (value: Buffer) =>
  createHash('sha256').update(value).digest('hex');

describe('BackupService archive validation', () => {
  let root: string;
  let previousBackupDirectory: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'hysteria2-backup-test-'));
    previousBackupDirectory = process.env.BACKUP_DIR;
    process.env.BACKUP_DIR = join(root, 'managed');
  });

  afterEach(async () => {
    if (previousBackupDirectory === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = previousBackupDirectory;
    await rm(root, { recursive: true, force: true });
  });

  async function archive(checksum = sha256(Buffer.from('asset'))) {
    const source = join(root, 'source');
    const database = Buffer.from('postgres custom dump');
    const asset = Buffer.from('asset');
    await mkdir(join(source, 'files', 'tutorial-images'), { recursive: true });
    await mkdir(join(source, 'files', 'tutorial-assets'), { recursive: true });
    await writeFile(join(source, 'database.dump'), database);
    await writeFile(
      join(source, 'files', 'tutorial-images', 'one.webp'),
      asset,
    );
    await writeFile(
      join(source, 'manifest.json'),
      JSON.stringify({
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        createdAt: '2026-09-01T03:00:00.000Z',
        appVersion: 'test',
        source: 'manual',
        database: {
          path: 'database.dump',
          size: database.length,
          sha256: sha256(database),
          format: 'postgres-custom',
        },
        files: [
          {
            path: 'files/tutorial-images/one.webp',
            size: asset.length,
            sha256: checksum,
          },
        ],
      }),
    );
    const path = join(root, `fixture-${checksum.slice(0, 4)}.h2backup`);
    await tar.c({ cwd: source, file: path, gzip: true }, [
      'manifest.json',
      'database.dump',
      'files',
    ]);
    return path;
  }

  it('validates and imports a complete archive without restoring it', async () => {
    const service = new BackupService();
    const path = await archive();
    const validated = await service.validateArchive(path);
    expect(validated.manifest.files).toHaveLength(1);
    await rm(validated.extractedDirectory, { recursive: true, force: true });

    const imported = await service.importArchive({
      path,
      originalname: 'site.h2backup',
    } as Express.Multer.File);
    expect(imported.source).toBe('imported');
    expect((await service.listBackups()).map((item) => item.id)).toContain(
      imported.id,
    );
    expect(
      await readFile(join(process.env.BACKUP_DIR!, imported.filename)),
    ).toBeTruthy();
  });

  it('rejects an archive when any payload checksum is changed', async () => {
    const service = new BackupService();
    await expect(
      service.validateArchive(await archive('b'.repeat(64))),
    ).rejects.toThrow('备份文件校验失败');
  });
});
