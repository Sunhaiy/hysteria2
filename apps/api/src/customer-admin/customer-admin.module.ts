import { Module } from '@nestjs/common';
import { CustomerAdminService } from './customer-admin.service';
import { CustomerAdminController } from './customer-admin.controller';
import { CommerceModule } from '../commerce/commerce.module';
import { KickServiceModule } from '../kick-service/kick-service.module';
import { CustomerTrafficService } from './customer-traffic.service';
import { EntitlementModule } from '../entitlement/entitlement.module';

@Module({
  imports: [CommerceModule, KickServiceModule, EntitlementModule],
  controllers: [CustomerAdminController],
  providers: [CustomerAdminService, CustomerTrafficService],
  exports: [CustomerAdminService],
})
export class CustomerAdminModule {}
