import { Module } from '@nestjs/common';
import { CommerceService } from './commerce.service';
import { EntitlementModule } from '../entitlement/entitlement.module';

@Module({
  imports: [EntitlementModule],
  providers: [CommerceService],
  exports: [CommerceService],
})
export class CommerceModule {}
