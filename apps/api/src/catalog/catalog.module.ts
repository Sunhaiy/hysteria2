import { Module } from '@nestjs/common';
import {
  CatalogController,
  PortalCatalogController,
  PublicCatalogController,
} from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  controllers: [
    CatalogController,
    PublicCatalogController,
    PortalCatalogController,
  ],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
