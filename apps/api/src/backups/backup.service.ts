import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import {
  access,
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import * as tar from 'tar';
import {
  isSafeArchivePath,
  parseBackupManifest,
  scheduledBackupsToDelete,
  shouldCreateDailyBackup,
} from './backup-utils';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupManifest,
  type BackupManifestFile,
  type BackupMetadata,
  type BackupSource,
  type RestoreRequest,
} from './backup.types';

const ARCHIVE_EXTENSION = '.h2backup';
const METADATA_EXTENSION = '.meta.json';
const RESTORE_REQUEST_FILE = '.restore-request.json';
const MAINTENANCE_FILE = '.restore-maintenance.json';
const LOCK_FILE = '.backup.lock';
const allowedEntryTypes = new Set(['File', 'Directory']);

export function backupRootDirectory() {
  return resolve(
    process.env.BACKUP_DIR || join(process.cwd(), 'storage', 'backups'),
  );
}

function tutorialImageDirectory() {
  return resolve(
    process.env.TUTORIAL_IMAGE_DIR ||
      join(process.cwd(), 'storage', 'tutorial-images'),
  );
}

function tutorialAssetDirectory() {
  return resolve(
    process.env.TUTORIAL_ASSET_DIR ||
      join(process.cwd(), 'storage', 'tutorial-assets'),
  );
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function timestamp(date = new Date()) {
  return date
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace('T', '-')
    .replace(/\.\d{3}Z$/, 'z');
}

function cleanError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    2000,
  );
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  async overview() {
    const items = await this.listBackups();
    return {
      items,
      retentionCount: this.retentionCount(),
      dailyHour: this.dailyHour(),
      timeZone: this.timeZone(),
      restoreEnabled: process.env.BACKUP_RESTORE_ENABLED !== 'false',
      maintenance: this.isMaintenanceMode(),
    };
  }

  async listBackups() {
    const root = backupRootDirectory();
    await mkdir(root, { recursive: true });
    const names = await readdir(root);
    const restore = await this.readRestoreRequest();
    const results = await Promise.all(
      names
        .filter((name) => name.endsWith(METADATA_EXTENSION))
        .map(async (name) => {
          try {
            const metadata = JSON.parse(
              await readFile(join(root, name), 'utf8'),
            ) as BackupMetadata;
            await access(this.archivePath(metadata.id));
            return {
              ...metadata,
              restore:
                restore?.backupId === metadata.id
                  ? {
                      status: restore.status,
                      requestedAt: restore.requestedAt,
                      completedAt: restore.completedAt ?? null,
                      error: restore.error ?? null,
                    }
                  : null,
            };
          } catch (error) {
            this.logger.warn(
              `Ignored invalid backup metadata ${name}: ${cleanError(error)}`,
            );
            return null;
          }
        }),
    );
    return results
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createBackup(source: BackupSource) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new BadRequestException(
        'DATABASE_URL 未配置，无法创建数据库备份。',
      );
    }
    return this.withLock(async () => {
      const id = `hysteria2-${source.replaceAll('_', '-')}-${timestamp()}-${randomUUID().slice(0, 8)}`;
      const root = backupRootDirectory();
      const work = join(root, '.work', id);
      const archive = this.archivePath(id);
      const temporaryArchive = `${archive}.partial`;
      await mkdir(join(work, 'files', 'tutorial-images'), { recursive: true });
      await mkdir(join(work, 'files', 'tutorial-assets'), { recursive: true });

      try {
        await this.copySiteFiles(work);
        await this.executeCommand(
          process.env.PG_DUMP_BINARY || 'pg_dump',
          [
            '--format=custom',
            '--no-owner',
            '--no-privileges',
            `--file=${join(work, 'database.dump')}`,
            databaseUrl,
          ],
          this.commandTimeoutMs(),
        );
        // A second pass keeps files created or replaced while pg_dump was
        // running. Extra unreferenced files are harmless; missing referenced
        // assets would make a restore incomplete.
        await this.copySiteFiles(work);

        const database = await this.manifestFile(work, 'database.dump');
        const files = await this.manifestFiles(work, join(work, 'files'));
        const manifest: BackupManifest = {
          format: BACKUP_FORMAT,
          formatVersion: BACKUP_FORMAT_VERSION,
          createdAt: new Date().toISOString(),
          appVersion:
            process.env.RELEASE_VERSION ||
            process.env.GIT_COMMIT ||
            process.env.npm_package_version ||
            'unknown',
          source,
          database: { ...database, format: 'postgres-custom' },
          files,
        };
        await writeFile(
          join(work, 'manifest.json'),
          `${JSON.stringify(manifest, null, 2)}\n`,
          'utf8',
        );
        await tar.c(
          {
            cwd: work,
            file: temporaryArchive,
            gzip: true,
            portable: true,
            strict: true,
          },
          ['manifest.json', 'database.dump', 'files'],
        );
        await rename(temporaryArchive, archive);
        const archiveStat = await stat(archive);
        const metadata: BackupMetadata = {
          id,
          filename: `${id}${ARCHIVE_EXTENSION}`,
          createdAt: manifest.createdAt,
          source,
          size: archiveStat.size,
          sha256: await this.sha256(archive),
          appVersion: manifest.appVersion,
        };
        await this.writeJsonAtomic(this.metadataPath(id), metadata);
        if (source === 'scheduled') await this.applyRetention();
        return metadata;
      } catch (error) {
        await rm(temporaryArchive, { force: true }).catch(() => undefined);
        await rm(archive, { force: true }).catch(() => undefined);
        throw error;
      } finally {
        await rm(work, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  }

  async importArchive(file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('请选择 .h2backup 备份文件。');
    try {
      if (!file.originalname.toLowerCase().endsWith(ARCHIVE_EXTENSION)) {
        throw new BadRequestException('仅支持 .h2backup 整站备份文件。');
      }
      return await this.withLock(async () => {
        const validation = await this.validateArchive(file.path);
        try {
          const id = `hysteria2-imported-${timestamp()}-${randomUUID().slice(0, 8)}`;
          const target = this.archivePath(id);
          await rename(file.path, target);
          const archiveStat = await stat(target);
          const metadata: BackupMetadata = {
            id,
            filename: `${id}${ARCHIVE_EXTENSION}`,
            createdAt: validation.manifest.createdAt,
            source: 'imported',
            size: archiveStat.size,
            sha256: await this.sha256(target),
            appVersion: validation.manifest.appVersion,
          };
          await this.writeJsonAtomic(this.metadataPath(id), metadata);
          return metadata;
        } finally {
          await rm(validation.extractedDirectory, {
            recursive: true,
            force: true,
          });
        }
      });
    } catch (error) {
      await rm(file.path, { force: true }).catch(() => undefined);
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      throw new BadRequestException(`备份校验失败：${cleanError(error)}`);
    }
  }

  async resolveDownload(id: string) {
    const metadata = await this.readMetadata(id);
    return { ...metadata, path: this.archivePath(id) };
  }

  async deleteBackup(id: string) {
    this.assertBackupId(id);
    const restore = await this.readRestoreRequest();
    if (
      restore?.backupId === id &&
      (restore.status === 'queued' || restore.status === 'running')
    ) {
      throw new ConflictException('该备份正在等待或执行恢复，暂时不能删除。');
    }
    await this.readMetadata(id);
    await Promise.all([
      rm(this.archivePath(id), { force: true }),
      rm(this.metadataPath(id), { force: true }),
    ]);
  }

  async requestRestore(id: string, requestedById: string) {
    if (process.env.BACKUP_RESTORE_ENABLED === 'false') {
      throw new BadRequestException(
        '服务器已关闭在线恢复，请在维护窗口启用后重试。',
      );
    }
    return this.withLock(async () => {
      await this.readMetadata(id);
      const existing = await this.readRestoreRequest();
      if (existing && ['queued', 'running'].includes(existing.status)) {
        throw new ConflictException('已有恢复任务正在等待或执行。');
      }
      const validation = await this.validateArchive(this.archivePath(id));
      try {
        const request: RestoreRequest = {
          backupId: id,
          requestedById,
          requestedAt: new Date().toISOString(),
          status: 'queued',
        };
        await this.writeJsonAtomic(this.restoreRequestPath(), request);
        return request;
      } finally {
        await rm(validation.extractedDirectory, {
          recursive: true,
          force: true,
        });
      }
    });
  }

  async processPendingRestore() {
    const pending = await this.readRestoreRequest();
    if (!pending || pending.status !== 'queued') return null;

    const running = await this.withLock(async () => {
      const request = await this.readRestoreRequest();
      if (!request || request.status !== 'queued') return null;
      const claimed: RestoreRequest = {
        ...request,
        status: 'running',
        startedAt: new Date().toISOString(),
        error: undefined,
      };
      await this.writeJsonAtomic(this.restoreRequestPath(), claimed);
      return claimed;
    });
    if (!running) return null;
    try {
      await this.restoreBackup(running.backupId);
      const succeeded: RestoreRequest = {
        ...running,
        status: 'succeeded',
        completedAt: new Date().toISOString(),
      };
      await this.writeJsonAtomic(this.restoreRequestPath(), succeeded);
      return succeeded;
    } catch (error) {
      const failed: RestoreRequest = {
        ...running,
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: cleanError(error),
      };
      await this.writeJsonAtomic(this.restoreRequestPath(), failed);
      this.logger.error(`Restore ${running.backupId} failed: ${failed.error}`);
      return failed;
    } finally {
      await rm(this.maintenancePath(), { force: true }).catch(() => undefined);
    }
  }

  async recoverInterruptedRestore() {
    const request = await this.readRestoreRequest();
    if (request?.status !== 'running' && !this.isMaintenanceMode()) return null;
    const failed: RestoreRequest | null = request
      ? {
          ...request,
          status: 'failed',
          completedAt: new Date().toISOString(),
          error: '恢复 worker 曾中断，未自动重试；请核对保护备份后重新提交。',
        }
      : null;
    if (failed) await this.writeJsonAtomic(this.restoreRequestPath(), failed);
    await rm(this.maintenancePath(), { force: true });
    return failed;
  }

  async runDailyBackupIfDue(now = new Date()) {
    const backups = await this.listMetadata();
    if (
      !shouldCreateDailyBackup({
        now,
        timeZone: this.timeZone(),
        hour: this.dailyHour(),
        backups,
      })
    ) {
      return null;
    }
    return this.createBackup('scheduled');
  }

  isMaintenanceMode() {
    return existsSync(this.maintenancePath());
  }

  async validateArchive(archive: string) {
    const work = join(
      backupRootDirectory(),
      '.work',
      `validate-${randomUUID()}`,
    );
    await mkdir(work, { recursive: true });
    try {
      let unpackedBytes = 0;
      const maxUnpackedBytes = positiveInteger(
        process.env.BACKUP_UNPACKED_MAX_BYTES,
        32 * 1024 ** 3,
      );
      await tar.t({
        file: archive,
        strict: true,
        onentry: (entry) => {
          const entryPath = entry.path.replace(/\/$/, '');
          if (
            !isSafeArchivePath(entryPath) ||
            !allowedEntryTypes.has(entry.type)
          ) {
            throw new Error(`备份包含不安全的归档条目：${entry.path}`);
          }
          unpackedBytes += entry.size;
          if (unpackedBytes > maxUnpackedBytes) {
            throw new Error('备份解压后的总大小超过服务器限制。');
          }
        },
      });
      await tar.x({
        cwd: work,
        file: archive,
        strict: true,
        preservePaths: false,
      });
      const manifest = parseBackupManifest(
        JSON.parse(await readFile(join(work, 'manifest.json'), 'utf8')),
      );
      const expected = [manifest.database, ...manifest.files];
      const actual = await this.manifestFiles(
        work,
        work,
        new Set(['manifest.json']),
      );
      if (actual.length !== expected.length) {
        throw new Error('备份文件数量与清单不一致。');
      }
      const actualByPath = new Map(actual.map((file) => [file.path, file]));
      for (const file of expected) {
        const found = actualByPath.get(file.path);
        if (
          !found ||
          found.size !== file.size ||
          found.sha256 !== file.sha256
        ) {
          throw new Error(`备份文件校验失败：${file.path}`);
        }
      }
      return { manifest, extractedDirectory: work };
    } catch (error) {
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async restoreBackup(id: string) {
    const archive = this.archivePath(id);
    const validation = await this.validateArchive(archive);
    const work = validation.extractedDirectory;
    try {
      await this.validateDatabaseDump(join(work, 'database.dump'));
      const safetyBackup = await this.createBackup('pre_restore');
      await this.writeJsonAtomic(this.maintenancePath(), {
        backupId: id,
        safetyBackupId: safetyBackup.id,
        startedAt: new Date().toISOString(),
      });
      await new Promise((resolvePromise) =>
        setTimeout(
          resolvePromise,
          positiveInteger(process.env.BACKUP_RESTORE_GRACE_MS, 5000),
        ),
      );
      await this.withLock(async () => {
        const rollbackRoot = join(work, '.rollback-assets');
        const swaps = [
          {
            staged: join(work, 'files', 'tutorial-images'),
            live: tutorialImageDirectory(),
            rollback: join(rollbackRoot, 'tutorial-images'),
          },
          {
            staged: join(work, 'files', 'tutorial-assets'),
            live: tutorialAssetDirectory(),
            rollback: join(rollbackRoot, 'tutorial-assets'),
          },
        ];
        await mkdir(rollbackRoot, { recursive: true });
        try {
          for (const swap of swaps) {
            await mkdir(dirname(swap.live), { recursive: true });
            if (await this.pathExists(swap.live)) {
              await rename(swap.live, swap.rollback);
            }
            await rename(swap.staged, swap.live);
          }
          await this.restoreDatabase(join(work, 'database.dump'));
        } catch (error) {
          for (const swap of swaps.reverse()) {
            await rm(swap.live, { recursive: true, force: true }).catch(
              () => undefined,
            );
            if (await this.pathExists(swap.rollback)) {
              await rename(swap.rollback, swap.live).catch(() => undefined);
            }
          }
          throw error;
        }
        await rm(rollbackRoot, { recursive: true, force: true });
      });
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async validateDatabaseDump(dump: string) {
    const maintenanceUrl = this.maintenanceDatabaseUrl();
    const databaseName = `hysteria2_restore_check_${randomUUID().replaceAll('-', '')}`;
    const quotedName = `"${databaseName}"`;
    let created = false;
    try {
      await this.executeCommand(
        process.env.PSQL_BINARY || 'psql',
        [
          maintenanceUrl,
          '-v',
          'ON_ERROR_STOP=1',
          '-c',
          `CREATE DATABASE ${quotedName}`,
        ],
        this.commandTimeoutMs(),
      );
      created = true;
      const restoreUrl = new URL(maintenanceUrl);
      restoreUrl.pathname = `/${databaseName}`;
      await this.executeCommand(
        process.env.PG_RESTORE_BINARY || 'pg_restore',
        [
          '--no-owner',
          '--no-privileges',
          `--dbname=${restoreUrl.toString()}`,
          dump,
        ],
        this.commandTimeoutMs(),
      );
      const result = await this.executeCommand(
        process.env.PSQL_BINARY || 'psql',
        [
          restoreUrl.toString(),
          '-v',
          'ON_ERROR_STOP=1',
          '-tAc',
          `SELECT CASE WHEN to_regclass('public."User"') IS NOT NULL AND to_regclass('public."Setting"') IS NOT NULL THEN 1 ELSE 0 END`,
        ],
        this.commandTimeoutMs(),
      );
      if (result.stdout.trim() !== '1') {
        throw new Error('隔离恢复库缺少关键业务表。');
      }
    } finally {
      if (created) {
        await this.executeCommand(
          process.env.PSQL_BINARY || 'psql',
          [
            maintenanceUrl,
            '-v',
            'ON_ERROR_STOP=1',
            '-c',
            `DROP DATABASE ${quotedName} WITH (FORCE)`,
          ],
          this.commandTimeoutMs(),
        ).catch((error) =>
          this.logger.error(
            `Failed to drop restore-check database: ${cleanError(error)}`,
          ),
        );
      }
    }
  }

  private async restoreDatabase(dump: string) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    await this.executeCommand(
      process.env.PG_RESTORE_BINARY || 'pg_restore',
      [
        '--clean',
        '--if-exists',
        '--single-transaction',
        '--no-owner',
        '--no-privileges',
        `--dbname=${process.env.DATABASE_URL}`,
        dump,
      ],
      this.commandTimeoutMs(),
    );
  }

  private maintenanceDatabaseUrl() {
    if (process.env.BACKUP_MAINTENANCE_DATABASE_URL) {
      return process.env.BACKUP_MAINTENANCE_DATABASE_URL;
    }
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = '/postgres';
    return url.toString();
  }

  private async applyRetention() {
    const backups = await this.listMetadata();
    for (const backup of scheduledBackupsToDelete(
      backups,
      this.retentionCount(),
    )) {
      await Promise.all([
        rm(this.archivePath(backup.id), { force: true }),
        rm(this.metadataPath(backup.id), { force: true }),
      ]);
    }
  }

  private async listMetadata() {
    const root = backupRootDirectory();
    await mkdir(root, { recursive: true });
    const names = await readdir(root);
    const results = await Promise.all(
      names
        .filter((name) => name.endsWith(METADATA_EXTENSION))
        .map(async (name) => {
          try {
            return JSON.parse(
              await readFile(join(root, name), 'utf8'),
            ) as BackupMetadata;
          } catch {
            return null;
          }
        }),
    );
    return results.filter(
      (item): item is BackupMetadata => item !== null && Boolean(item.id),
    );
  }

  private async readMetadata(id: string) {
    this.assertBackupId(id);
    try {
      const metadata = JSON.parse(
        await readFile(this.metadataPath(id), 'utf8'),
      ) as BackupMetadata;
      await access(this.archivePath(id));
      return metadata;
    } catch {
      throw new NotFoundException('备份不存在。');
    }
  }

  private async readRestoreRequest() {
    try {
      return JSON.parse(
        await readFile(this.restoreRequestPath(), 'utf8'),
      ) as RestoreRequest;
    } catch {
      return null;
    }
  }

  private assertBackupId(id: string) {
    if (!/^[a-z0-9-]{1,120}$/.test(id)) {
      throw new BadRequestException('无效的备份编号。');
    }
  }

  private archivePath(id: string) {
    this.assertBackupId(id);
    return join(backupRootDirectory(), `${id}${ARCHIVE_EXTENSION}`);
  }

  private metadataPath(id: string) {
    this.assertBackupId(id);
    return join(backupRootDirectory(), `${id}${METADATA_EXTENSION}`);
  }

  private restoreRequestPath() {
    return join(backupRootDirectory(), RESTORE_REQUEST_FILE);
  }

  private maintenancePath() {
    return join(backupRootDirectory(), MAINTENANCE_FILE);
  }

  private retentionCount() {
    return positiveInteger(process.env.BACKUP_RETENTION_COUNT, 3);
  }

  private dailyHour() {
    const hour = Number.parseInt(process.env.BACKUP_DAILY_HOUR ?? '', 10);
    return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : 3;
  }

  private timeZone() {
    const configured = process.env.BACKUP_TIME_ZONE || 'Asia/Shanghai';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: configured });
      return configured;
    } catch {
      return 'Asia/Shanghai';
    }
  }

  private commandTimeoutMs() {
    return positiveInteger(process.env.BACKUP_COMMAND_TIMEOUT_MS, 30 * 60_000);
  }

  private async withLock<T>(operation: () => Promise<T>) {
    const root = backupRootDirectory();
    await mkdir(root, { recursive: true });
    let handle;
    try {
      handle = await open(join(root, LOCK_FILE), 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const lockPath = join(root, LOCK_FILE);
        const lockStat = await stat(lockPath).catch(() => null);
        if (
          lockStat &&
          Date.now() - lockStat.mtimeMs > this.commandTimeoutMs() + 60_000
        ) {
          await rm(lockPath, { force: true });
          handle = await open(lockPath, 'wx');
        } else {
          throw new ConflictException('另一个备份或恢复任务正在执行。');
        }
      } else {
        throw error;
      }
    }
    try {
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
      return await operation();
    } finally {
      await handle.close().catch(() => undefined);
      await rm(join(root, LOCK_FILE), { force: true }).catch(() => undefined);
    }
  }

  private async copyDirectoryIfPresent(source: string, target: string) {
    if (!(await this.pathExists(source))) return;
    await cp(source, target, {
      recursive: true,
      force: true,
      dereference: false,
      filter: async (entry) => {
        const entryStat = await lstat(entry);
        if (entryStat.isSymbolicLink()) {
          throw new Error(`不允许把符号链接写入备份：${entry}`);
        }
        return true;
      },
    });
  }

  private async copySiteFiles(work: string) {
    await this.copyDirectoryIfPresent(
      tutorialImageDirectory(),
      join(work, 'files', 'tutorial-images'),
    );
    await this.copyDirectoryIfPresent(
      tutorialAssetDirectory(),
      join(work, 'files', 'tutorial-assets'),
    );
  }

  private async manifestFiles(
    root: string,
    directory: string,
    excluded = new Set<string>(),
  ) {
    const results: BackupManifestFile[] = [];
    const walk = async (current: string) => {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const path = join(current, entry.name);
        if (entry.isSymbolicLink()) throw new Error('备份中不能包含符号链接。');
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile()) {
          const archivePath = relative(root, path).split(sep).join('/');
          if (!excluded.has(archivePath)) {
            results.push(await this.manifestFile(root, archivePath));
          }
        }
      }
    };
    await walk(directory);
    return results.sort((left, right) => left.path.localeCompare(right.path));
  }

  private async manifestFile(root: string, archivePath: string) {
    const path = resolve(root, ...archivePath.split('/'));
    const rootPrefix = `${resolve(root)}${sep}`;
    if (!path.startsWith(rootPrefix)) throw new Error('Invalid manifest path');
    const fileStat = await stat(path);
    return {
      path: archivePath,
      size: fileStat.size,
      sha256: await this.sha256(path),
    };
  }

  private async sha256(path: string) {
    return new Promise<string>((resolvePromise, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(path);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolvePromise(hash.digest('hex')));
    });
  }

  private async pathExists(path: string) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async writeJsonAtomic(path: string, value: unknown) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporary, path);
  }

  private executeCommand(binary: string, args: string[], timeoutMs: number) {
    return new Promise<{ stdout: string; stderr: string }>(
      (resolvePromise, reject) => {
        const child = spawn(binary, args, {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        const append = (current: string, chunk: Buffer) =>
          `${current}${chunk.toString('utf8')}`.slice(-64 * 1024);
        child.stdout.on('data', (chunk: Buffer) => {
          stdout = append(stdout, chunk);
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr = append(stderr, chunk);
        });
        const timeout = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`${binary} 执行超过 ${timeoutMs}ms。`));
        }, timeoutMs);
        child.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once('close', (code) => {
          clearTimeout(timeout);
          if (code === 0) resolvePromise({ stdout, stderr });
          else
            reject(new Error(`${binary} 退出码 ${code}：${stderr || stdout}`));
        });
      },
    );
  }
}
