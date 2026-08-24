import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DomainModule } from './domain/domain.module';
import { PrismaModule } from './prisma/prisma.module';
import { SecurityModule } from './security/security.module';
import { UsageSyncModule } from './usage-sync/usage-sync.module';

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
    PrismaModule,
    SecurityModule,
    DomainModule,
    UsageSyncModule,
  ],
})
export class SyncWorkerModule {}
