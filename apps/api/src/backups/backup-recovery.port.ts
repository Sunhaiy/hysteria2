export const BACKUP_RECOVERY_PORT = Symbol('BACKUP_RECOVERY_PORT');

export interface BackupRecoveryPort {
  restoreBackup(backupId: string): Promise<void>;
  restoreSafetyBackup(backupId: string): Promise<void>;
}
