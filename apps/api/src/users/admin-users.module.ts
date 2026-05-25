import { Module } from '@nestjs/common';
import { KickServiceModule } from '../kick-service/kick-service.module';
import { PortalModule } from '../portal/portal.module';
import { AdminUsersController } from './admin-users.controller';

@Module({
  imports: [KickServiceModule, PortalModule],
  controllers: [AdminUsersController],
})
export class AdminUsersModule {}
