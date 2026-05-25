import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CreatePlanDto, UpdatePlanDto } from '../contracts/http.dto';
import { ControlPlaneStoreService } from '../domain/control-plane.store';

@Controller('api/admin/plans')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PlansController {
  constructor(private readonly store: ControlPlaneStoreService) {}

  @Get()
  listPlans() {
    return this.store.getPlans();
  }

  @Post()
  createPlan(@Body() body: CreatePlanDto) {
    return this.store.createPlan(body);
  }

  @Patch(':id')
  updatePlan(@Param('id') id: string, @Body() body: UpdatePlanDto) {
    return this.store.patchPlan(id, body);
  }
}
