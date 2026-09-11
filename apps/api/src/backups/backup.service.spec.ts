import { createHash } from 'node:crypto';
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tar from 'tar';
import { Test } from '@nestjs/testing';
import { BackupService } from './backup.service';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  CURRENT_DATABASE_SCHEMA_VERSION,
} from './backup.types';

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
    await mkdir(join(source, 'files', 'seo-images'), { recursive: true });
    await mkdir(join(source, 'files', 'announcement-images'), {
      recursive: true,
    });
    await writeFile(join(source, 'database.dump'), database);
    await writeFile(
      join(source, 'files', 'tutorial-images', 'one.webp'),
      asset,
    );
    await writeFile(join(source, 'files', 'seo-images', 'cover.webp'), asset);
    await writeFile(
      join(source, 'files', 'announcement-images', 'notice.webp'),
      asset,
    );
    await writeFile(
      join(source, 'manifest.json'),
      JSON.stringify({
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        createdAt: '2026-09-01T03:00:00.000Z',
        appVersion: 'test',
        databaseSchemaVersion: CURRENT_DATABASE_SCHEMA_VERSION,
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
          {
            path: 'files/seo-images/cover.webp',
            size: asset.length,
            sha256: sha256(asset),
          },
          {
            path: 'files/announcement-images/notice.webp',
            size: asset.length,
            sha256: sha256(asset),
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

  it('uses the production recovery implementation when no test adapter is registered', async () => {
    const module = await Test.createTestingModule({
      providers: [BackupService],
    }).compile();

    expect(module.get(BackupService)).toBeInstanceOf(BackupService);
    await module.close();
  });

  it('validates and imports a complete archive without restoring it', async () => {
    const service = new BackupService();
    const path = await archive();
    const validated = await service.validateArchive(path);
    expect(validated.manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'files/tutorial-images/one.webp' }),
        expect.objectContaining({ path: 'files/seo-images/cover.webp' }),
        expect.objectContaining({
          path: 'files/announcement-images/notice.webp',
        }),
      ]),
    );
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

  it('does not contend with an active backup when no restore is queued', async () => {
    const backupDirectory = process.env.BACKUP_DIR!;
    await mkdir(backupDirectory, { recursive: true });
    await writeFile(join(backupDirectory, '.backup.lock'), 'busy');

    const service = new BackupService();
    await expect(service.processPendingRestore()).resolves.toBeNull();
  });

  it('does not clean another process active backup workspace on startup', async () => {
    const managed = process.env.BACKUP_DIR!;
    const activeWork = join(managed, '.work', 'active-backup');
    await mkdir(activeWork, { recursive: true });
    await writeFile(join(activeWork, 'database.dump'), 'in progress');
    await writeFile(join(managed, '.backup.lock'), 'another process');

    const service = new BackupService();
    await expect(service.recoverInterruptedRestore()).resolves.toBeNull();
    await expect(
      readFile(join(activeWork, 'database.dump'), 'utf8'),
    ).resolves.toBe('in progress');
  });

  it('does not create a second scheduled backup for the same local day', async () => {
    const managed = process.env.BACKUP_DIR!;
    await mkdir(managed, { recursive: true });
    const metadata = {
      id: 'scheduled-test',
      filename: 'scheduled-test.h2backup',
      createdAt: '2026-09-07T03:00:00.000Z',
      source: 'scheduled' as const,
      size: 1,
      sha256: 'a'.repeat(64),
      appVersion: 'test',
    };
    await writeFile(
      join(managed, `${metadata.id}.meta.json`),
      JSON.stringify(metadata),
    );
    const service = new BackupService();

    await expect(
      service.runDailyBackupIfDue(new Date('2026-09-07T04:00:00.000Z')),
    ).resolves.toBeNull();
  });

  it('rolls a caught restore failure back before leaving maintenance mode', async () => {
    const managed = process.env.BACKUP_DIR!;
    await mkdir(managed, { recursive: true });
    await writeFile(
      join(managed, '.restore-request.json'),
      JSON.stringify({
        backupId: 'target-backup',
        requestedById: 'admin-1',
        requestedAt: '2026-09-07T01:00:00.000Z',
        status: 'queued',
      }),
    );
    const restoreBackup = jest.fn().mockImplementation(async () => {
      await writeFile(
        join(managed, '.restore-maintenance.json'),
        JSON.stringify({
          backupId: 'target-backup',
          safetyBackupId: 'safety-backup',
          startedAt: '2026-09-07T01:01:00.000Z',
          phase: 'prepared',
        }),
      );
      throw new Error('pg_restore stopped after replacing the database');
    });
    const restoreSafetyBackup = jest.fn().mockResolvedValue(undefined);
    const service = new BackupService({ restoreBackup, restoreSafetyBackup });

    await expect(service.processPendingRestore()).resolves.toMatchObject({
      backupId: 'target-backup',
      status: 'failed',
    });
    expect(restoreSafetyBackup).toHaveBeenCalledWith('safety-backup');
    await expect(
      access(join(managed, '.restore-maintenance.json')),
    ).rejects.toThrow();
  });

  it('keeps maintenance mode when a caught restore failure cannot roll back', async () => {
    const managed = process.env.BACKUP_DIR!;
    await mkdir(managed, { recursive: true });
    await writeFile(
      join(managed, '.restore-request.json'),
      JSON.stringify({
        backupId: 'target-backup',
        requestedById: 'admin-1',
        requestedAt: '2026-09-07T01:00:00.000Z',
        status: 'queued',
      }),
    );
    const restoreBackup = jest.fn().mockImplementation(async () => {
      await writeFile(
        join(managed, '.restore-maintenance.json'),
        JSON.stringify({
          backupId: 'target-backup',
          safetyBackupId: 'safety-backup',
          startedAt: '2026-09-07T01:01:00.000Z',
          phase: 'prepared',
        }),
      );
      throw new Error('pg_restore stopped after replacing the database');
    });
    const restoreSafetyBackup = jest
      .fn()
      .mockRejectedValue(new Error('safety restore failed'));
    const service = new BackupService({ restoreBackup, restoreSafetyBackup });

    await expect(service.processPendingRestore()).rejects.toThrow(
      '维护模式已保留',
    );
    await expect(
      access(join(managed, '.restore-maintenance.json')),
    ).resolves.toBeUndefined();
    await expect(
      readFile(join(managed, '.restore-request.json'), 'utf8'),
    ).resolves.toContain('自动回滚保护备份失败');
  });

  it('rolls an interrupted restore back before leaving maintenance mode', async () => {
    const managed = process.env.BACKUP_DIR!;
    await mkdir(managed, { recursive: true });
    await writeFile(
      join(managed, '.restore-request.json'),
      JSON.stringify({
        backupId: 'target-backup',
        requestedById: 'admin-1',
        requestedAt: '2026-09-07T01:00:00.000Z',
        startedAt: '2026-09-07T01:01:00.000Z',
        status: 'running',
      }),
    );
    await writeFile(
      join(managed, '.restore-maintenance.json'),
      JSON.stringify({
        backupId: 'target-backup',
        safetyBackupId: 'safety-backup',
        startedAt: '2026-09-07T01:01:00.000Z',
      }),
    );
    const restoreSafetyBackup = jest.fn().mockResolvedValue(undefined);
    const service = new BackupService({
      restoreBackup: jest.fn().mockResolvedValue(undefined),
      restoreSafetyBackup,
    });

    const recovered = await service.recoverInterruptedRestore();
    expect(recovered).toMatchObject({
      backupId: 'target-backup',
      status: 'failed',
    });
    expect(recovered?.error).toContain('保护备份');
    expect(restoreSafetyBackup).toHaveBeenCalledWith('safety-backup');
    await expect(
      access(join(managed, '.restore-maintenance.json')),
    ).rejects.toThrow();
  });

  it('finalizes an already completed restore without rolling it back', async () => {
    const managed = process.env.BACKUP_DIR!;
    await mkdir(managed, { recursive: true });
    await writeFile(
      join(managed, '.restore-request.json'),
      JSON.stringify({
        backupId: 'target-backup',
        requestedById: 'admin-1',
        requestedAt: '2026-09-07T01:00:00.000Z',
        startedAt: '2026-09-07T01:01:00.000Z',
        status: 'running',
      }),
    );
    await writeFile(
      join(managed, '.restore-maintenance.json'),
      JSON.stringify({
        backupId: 'target-backup',
        safetyBackupId: 'safety-backup',
        startedAt: '2026-09-07T01:01:00.000Z',
        phase: 'completed',
      }),
    );
    const restoreSafetyBackup = jest.fn().mockResolvedValue(undefined);
    const service = new BackupService({
      restoreBackup: jest.fn().mockResolvedValue(undefined),
      restoreSafetyBackup,
    });

    await expect(service.recoverInterruptedRestore()).resolves.toMatchObject({
      backupId: 'target-backup',
      status: 'succeeded',
    });
    expect(restoreSafetyBackup).not.toHaveBeenCalled();
    await expect(
      access(join(managed, '.restore-maintenance.json')),
    ).rejects.toThrow();
  });

  it('does not clean a completed restore while another backup holds the lock', async () => {
    const managed = process.env.BACKUP_DIR!;
    const activeWork = join(managed, '.work', 'active-backup');
    await mkdir(activeWork, { recursive: true });
    await writeFile(join(activeWork, 'database.dump'), 'in progress');
    await writeFile(
      join(managed, '.restore-request.json'),
      JSON.stringify({
        backupId: 'target-backup',
        requestedById: 'admin-1',
        requestedAt: '2026-09-07T01:00:00.000Z',
        startedAt: '2026-09-07T01:01:00.000Z',
        status: 'running',
      }),
    );
    await writeFile(
      join(managed, '.restore-maintenance.json'),
      JSON.stringify({
        backupId: 'target-backup',
        safetyBackupId: 'safety-backup',
        startedAt: '2026-09-07T01:01:00.000Z',
        phase: 'completed',
      }),
    );
    await writeFile(join(managed, '.backup.lock'), 'another process');

    const service = new BackupService();
    await expect(service.recoverInterruptedRestore()).rejects.toThrow(
      '另一个备份或恢复任务正在执行',
    );
    await expect(
      readFile(join(activeWork, 'database.dump'), 'utf8'),
    ).resolves.toBe('in progress');
    await expect(
      access(join(managed, '.restore-maintenance.json')),
    ).resolves.toBeUndefined();
  });
});
