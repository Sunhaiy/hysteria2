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
import { CreateNodeGroupDto, UpdateNodeGroupDto } from '../contracts/http.dto';
import { ControlPlaneStoreService } from '../domain/control-plane.store';

@Controller('api/admin/node-groups')
@UseGuards(JwtAuthGuard, AdminGuard)
export class NodeGroupsController {
  constructor(private readonly store: ControlPlaneStoreService) {}

  @Get()
  listNodeGroups() {
    return this.store.getNodeGroups();
  }

  @Post()
  createNodeGroup(@Body() body: CreateNodeGroupDto) {
    return this.store.createNodeGroup(body);
  }

  @Patch(':id')
  updateNodeGroup(@Param('id') id: string, @Body() body: UpdateNodeGroupDto) {
    return this.store.patchNodeGroup(id, body);
  }
}
