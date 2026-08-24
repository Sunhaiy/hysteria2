import { Module } from '@nestjs/common';
import { CustomerAdminModule } from '../customer-admin/customer-admin.module';
import { SubscriptionsController } from './subscriptions.controller';

@Module({
  imports: [CustomerAdminModule],
  controllers: [SubscriptionsController],
})
export class SubscriptionsModule {}
