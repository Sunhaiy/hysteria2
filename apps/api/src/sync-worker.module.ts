import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BackupModule } from './backups/backup.module';
import { CacheModule } from './cache/cache.module';
import { DomainModule } from './domain/domain.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { SecurityModule } from './security/security.module';
import { SettingsModule } from './settings/settings.module';
import { UsageSyncModule } from './usage-sync/usage-sync.module';
import { OperationsModule } from './operations/operations.module';
import { NodeOpsModule } from './node-ops/node-ops.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        join(process.cwd(), '.env'),
        join(process.cwd(), '../.env'),
        join(process.cwd(), '../../.env'),
      ],
    }),
    BackupModule,
    CacheModule,
    PrismaModule,
    SecurityModule,
    SettingsModule,
    MailModule,
    DomainModule,
    AuthModule,
    UsageSyncModule,
    OperationsModule,
    NodeOpsModule,
  ],
})
export class SyncWorkerModule {}
