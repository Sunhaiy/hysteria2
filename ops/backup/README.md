# Full-site backups

The control plane creates a PostgreSQL custom dump plus tutorial images and
client installers in one checksummed `.h2backup` archive. The sync worker runs
the daily schedule; the API only handles explicit administrator actions.

Production must store backups outside immutable release directories:

```env
BACKUP_DIR=/opt/hysteria2-control-plane/shared/backups
BACKUP_RETENTION_COUNT=3
BACKUP_DAILY_HOUR=3
BACKUP_TIME_ZONE=Asia/Shanghai
BACKUP_RESTORE_ENABLED=true
BACKUP_MAINTENANCE_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/postgres
```

`pg_dump`, `pg_restore`, and `psql` must be installed for both the API and sync
worker service users. The maintenance database user needs permission to create
and drop a temporary validation database. A restore is rejected until the
archive path list, manifest, sizes, and SHA-256 values pass validation. The
worker then restores the dump into a temporary database, creates a fresh
pre-restore backup, enters maintenance mode, and applies the production restore
as one PostgreSQL transaction.

Only scheduled backups are automatically rotated. Manual, imported, and
pre-restore archives remain until an administrator deletes them.
