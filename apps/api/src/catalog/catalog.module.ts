import { Module } from '@nestjs/common';
import {
  CatalogController,
  PortalCatalogController,
} from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  controllers: [CatalogController, PortalCatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
