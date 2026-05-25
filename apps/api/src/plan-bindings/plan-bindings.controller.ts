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
import {
  CreatePlanBindingDto,
  UpdatePlanBindingDto,
} from '../contracts/http.dto';
import { ControlPlaneStoreService } from '../domain/control-plane.store';

@Controller('api/admin/plan-bindings')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PlanBindingsController {
  constructor(private readonly store: ControlPlaneStoreService) {}

  @Get()
  listPlanBindings() {
    return this.store.getPlanBindings();
  }

  @Post()
  createPlanBinding(@Body() body: CreatePlanBindingDto) {
    return this.store.createPlanBinding(body);
  }

  @Patch(':id')
  updatePlanBinding(
    @Param('id') id: string,
    @Body() body: UpdatePlanBindingDto,
  ) {
    return this.store.patchPlanBinding(id, body);
  }
}
