import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import type { SessionPrincipal } from '../common/auth.types';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import {
  CreateAccessProfileDto,
  CreatePlanOfferDto,
  UpdateAccessProfileDto,
  UpdatePlanOfferDto,
  SaveCatalogProductDto,
} from './catalog.dto';
import { CatalogService } from './catalog.service';

@Controller('api/admin/catalog')
@UseGuards(JwtAuthGuard, AdminGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  getCatalog() {
    return this.catalog.getAdminCatalog();
  }

  @Post('products')
  createProduct(
    @Body() body: SaveCatalogProductDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.catalog.createProduct(body, principal.sub);
  }

  @Put('products/:id')
  updateProduct(
    @Param('id') id: string,
    @Body() body: SaveCatalogProductDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.catalog.updateProduct(id, body, principal.sub);
  }

  @Get('access-profiles')
  listAccessProfiles() {
    return this.catalog.listAccessProfiles();
  }

  @Post('access-profiles')
  createAccessProfile(@Body() body: CreateAccessProfileDto) {
    return this.catalog.createAccessProfile(body);
  }

  @Patch('access-profiles/:id')
  updateAccessProfile(
    @Param('id') id: string,
    @Body() body: UpdateAccessProfileDto,
  ) {
    return this.catalog.updateAccessProfile(id, body);
  }

  @Post('offers')
  createOffer(@Body() body: CreatePlanOfferDto) {
    return this.catalog.createOffer(body);
  }

  @Patch('offers/:id')
  updateOffer(@Param('id') id: string, @Body() body: UpdatePlanOfferDto) {
    return this.catalog.updateOffer(id, body);
  }

  @Delete('offers/:id')
  archiveOffer(@Param('id') id: string) {
    return this.catalog.archiveOffer(id);
  }
}

@Controller('api/catalog')
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  getCatalog() {
    return this.catalog.getPublicCatalog();
  }
}

@Controller('api/portal/catalog')
@UseGuards(JwtAuthGuard)
export class PortalCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  getCatalog(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.catalog.getPortalCatalog(principal.sub);
  }
}
