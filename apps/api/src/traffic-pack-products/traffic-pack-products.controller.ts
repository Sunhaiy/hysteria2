import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import {
  CreateTrafficPackProductDto,
  UpdateTrafficPackProductDto,
} from '../contracts/http.dto';
import { ControlPlaneStoreService } from '../domain/control-plane.store';

@Controller('api/admin/traffic-pack-products')
@UseGuards(JwtAuthGuard, AdminGuard)
export class TrafficPackProductsController {
  constructor(private readonly store: ControlPlaneStoreService) {}

  @Get()
  listProducts() {
    return this.store.getTrafficPackProducts();
  }

  @Post()
  createProduct(@Body() body: CreateTrafficPackProductDto) {
    return this.store.createTrafficPackProduct(body);
  }

  @Patch(':id')
  updateProduct(
    @Param('id') id: string,
    @Body() body: UpdateTrafficPackProductDto,
  ) {
    return this.store.patchTrafficPackProduct(id, body);
  }

  @Delete(':id')
  archiveProduct(@Param('id') id: string) {
    return this.store.archiveTrafficPackProduct(id);
  }
}
