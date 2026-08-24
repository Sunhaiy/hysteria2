import { Module } from '@nestjs/common';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { HysteriaAuthController } from './hysteria-auth.controller';
import { HysteriaAuthService } from './hysteria-auth.service';

@Module({
  imports: [EntitlementModule],
  controllers: [HysteriaAuthController],
  providers: [HysteriaAuthService],
})
export class HysteriaAuthModule {}
