import { isAbsolute, posix } from 'node:path';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  CURRENT_DATABASE_SCHEMA_VERSION,
  type BackupManifest,
  type BackupManifestFile,
  type BackupMetadata,
} from './backup.types';

const sha256Pattern = /^[a-f0-9]{64}$/;

export function isSafeArchivePath(value: string) {
  if (!value || value.includes('\\') || isAbsolute(value)) return false;
  const normalized = posix.normalize(value);
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/') ||
    normalized !== value.replace(/^\.\//, '')
  ) {
    return false;
  }
  return (
    normalized === 'manifest.json' ||
    normalized === 'database.dump' ||
    normalized === 'files' ||
    normalized === 'files/tutorial-images' ||
    normalized.startsWith('files/tutorial-images/') ||
    normalized === 'files/tutorial-assets' ||
    normalized.startsWith('files/tutorial-assets/') ||
    normalized === 'files/seo-images' ||
    normalized.startsWith('files/seo-images/') ||
    normalized === 'files/announcement-images' ||
    normalized.startsWith('files/announcement-images/')
  );
}

function isManifestFile(value: unknown): value is BackupManifestFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Record<string, unknown>;
  return (
    typeof file.path === 'string' &&
    isSafeArchivePath(file.path) &&
    file.path !== 'manifest.json' &&
    typeof file.size === 'number' &&
    Number.isSafeInteger(file.size) &&
    file.size >= 0 &&
    typeof file.sha256 === 'string' &&
    sha256Pattern.test(file.sha256)
  );
}

export function parseBackupManifest(value: unknown): BackupManifest {
  if (!value || typeof value !== 'object') {
    throw new Error('备份清单不存在或格式错误。');
  }
  const manifest = value as Record<string, unknown>;
  const database = manifest.database as Record<string, unknown> | undefined;
  if (
    manifest.format !== BACKUP_FORMAT ||
    manifest.formatVersion !== BACKUP_FORMAT_VERSION ||
    typeof manifest.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    typeof manifest.appVersion !== 'string' ||
    manifest.databaseSchemaVersion !== CURRENT_DATABASE_SCHEMA_VERSION ||
    !['scheduled', 'manual', 'imported', 'pre_restore'].includes(
      String(manifest.source),
    ) ||
    !isManifestFile(database) ||
    database.path !== 'database.dump' ||
    database.format !== 'postgres-custom' ||
    !Array.isArray(manifest.files) ||
    !manifest.files.every(isManifestFile)
  ) {
    if (manifest.databaseSchemaVersion !== CURRENT_DATABASE_SCHEMA_VERSION) {
      throw new Error('备份数据库结构版本与当前系统不兼容。');
    }
    throw new Error('备份清单版本或字段无效。');
  }
  const paths = [
    (manifest.database as BackupManifestFile).path,
    ...manifest.files.map((file) => file.path),
  ];
  if (new Set(paths).size !== paths.length) {
    throw new Error('备份清单包含重复文件。');
  }
  return manifest as unknown as BackupManifest;
}

export function databaseCompatibilitySql() {
  return `SELECT CASE WHEN
    to_regclass('public."User"') IS NOT NULL
    AND to_regclass('public."Setting"') IS NOT NULL
    AND to_regclass('public."WalletLedgerEntry"') IS NOT NULL
    AND to_regclass('public."EntitlementGrant"') IS NOT NULL
    AND to_regclass('public."GroupBuy"') IS NOT NULL
    AND to_regclass('public."DailyCheckIn"') IS NOT NULL
    AND to_regclass('public."SeoArticle"') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "_prisma_migrations"
      WHERE "migration_name" = '${CURRENT_DATABASE_SCHEMA_VERSION}'
        AND "finished_at" IS NOT NULL
        AND "rolled_back_at" IS NULL
    )
  THEN 1 ELSE 0 END`;
}

export function scheduledBackupsToDelete(
  backups: BackupMetadata[],
  retentionCount: number,
) {
  return backups
    .filter((backup) => backup.source === 'scheduled')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(Math.max(1, retentionCount));
}

export function localDateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function localHour(date: Date, timeZone: string) {
  const value = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return Number.parseInt(value, 10);
}

export function shouldCreateDailyBackup(input: {
  now: Date;
  timeZone: string;
  hour: number;
  backups: BackupMetadata[];
}) {
  if (localHour(input.now, input.timeZone) < input.hour) return false;
  const today = localDateKey(input.now, input.timeZone);
  return !input.backups.some(
    (backup) =>
      backup.source === 'scheduled' &&
      localDateKey(new Date(backup.createdAt), input.timeZone) === today,
  );
}
