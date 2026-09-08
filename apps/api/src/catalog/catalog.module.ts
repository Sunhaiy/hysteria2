import { Module } from '@nestjs/common';
import {
  CatalogController,
  PortalCatalogController,
  PublicCatalogController,
} from './catalog.controller';
import { CatalogService } from './catalog.service';
import { EntitlementModule } from '../entitlement/entitlement.module';

@Module({
  imports: [EntitlementModule],
  controllers: [
    CatalogController,
    PublicCatalogController,
    PortalCatalogController,
  ],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
