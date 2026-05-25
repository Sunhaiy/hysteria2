import { Module } from '@nestjs/common';
import { HysteriaAuthController } from './hysteria-auth.controller';
import { HysteriaAuthService } from './hysteria-auth.service';

@Module({
  controllers: [HysteriaAuthController],
  providers: [HysteriaAuthService],
})
export class HysteriaAuthModule {}
