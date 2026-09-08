export const BACKUP_FORMAT = 'hysteria2-control-plane-backup';
export const BACKUP_FORMAT_VERSION = 2;
export const CURRENT_DATABASE_SCHEMA_VERSION =
  '20260907210000_business_integrity';
export const RESTORE_CONFIRMATION = 'RESTORE';

export type BackupSource = 'scheduled' | 'manual' | 'imported' | 'pre_restore';

export type RestoreStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface BackupManifestFile {
  path: string;
  size: number;
  sha256: string;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  createdAt: string;
  appVersion: string;
  databaseSchemaVersion: typeof CURRENT_DATABASE_SCHEMA_VERSION;
  source: BackupSource;
  database: BackupManifestFile & { format: 'postgres-custom' };
  files: BackupManifestFile[];
}

export interface BackupMetadata {
  id: string;
  filename: string;
  createdAt: string;
  source: BackupSource;
  size: number;
  sha256: string;
  appVersion: string;
}

export interface RestoreRequest {
  backupId: string;
  requestedById: string;
  requestedAt: string;
  status: RestoreStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}
