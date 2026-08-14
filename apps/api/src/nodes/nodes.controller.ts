import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CreateNodeDto, UpdateNodeDto } from '../contracts/http.dto';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import { UsageSyncService } from '../usage-sync/usage-sync.service';

@Controller('api/admin/nodes')
@UseGuards(JwtAuthGuard, AdminGuard)
export class NodesController {
  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly usageSync: UsageSyncService,
  ) {}

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

  @Post(':id/sync')
  syncNode(@Param('id') id: string) {
    return this.usageSync.syncNode(id);
  }

  @Delete(':id')
  @HttpCode(204)
  deleteNode(@Param('id') id: string) {
    return this.store.deleteNode(id);
  }
}
