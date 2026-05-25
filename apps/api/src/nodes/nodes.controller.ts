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
import { CreateNodeDto, UpdateNodeDto } from '../contracts/http.dto';
import { ControlPlaneStoreService } from '../domain/control-plane.store';

@Controller('api/admin/nodes')
@UseGuards(JwtAuthGuard, AdminGuard)
export class NodesController {
  constructor(private readonly store: ControlPlaneStoreService) {}

  @Get()
  listNodes() {
    return this.store.getNodes();
  }

  @Post()
  createNode(@Body() body: CreateNodeDto) {
    return this.store.createNode(body);
  }

  @Patch(':id')
  updateNode(@Param('id') id: string, @Body() body: UpdateNodeDto) {
    return this.store.patchNode(id, body);
  }
}
