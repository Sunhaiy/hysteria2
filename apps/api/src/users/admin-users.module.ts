import { Module } from '@nestjs/common';
import { KickServiceModule } from '../kick-service/kick-service.module';
import { CustomerAdminModule } from '../customer-admin/customer-admin.module';
import { PortalModule } from '../portal/portal.module';
import { AdminUsersController } from './admin-users.controller';

@Module({
  imports: [KickServiceModule, PortalModule, CustomerAdminModule],
  controllers: [AdminUsersController],
})
export class AdminUsersModule {}
