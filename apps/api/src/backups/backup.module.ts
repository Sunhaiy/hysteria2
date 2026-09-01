import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { MaintenanceGuard } from './maintenance.guard';

@Global()
@Module({
  controllers: [BackupController],
  providers: [
    BackupService,
    { provide: APP_GUARD, useClass: MaintenanceGuard },
  ],
  exports: [BackupService],
})
export class BackupModule {}
