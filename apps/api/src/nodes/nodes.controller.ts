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
import { NodeControlService } from '../domain/node-control.service';
import { NodeSyncRequestService } from '../usage-sync/node-sync-request.service';

@Controller('api/admin/nodes')
@UseGuards(JwtAuthGuard, AdminGuard)
export class NodesController {
  constructor(
    private readonly nodes: NodeControlService,
    private readonly syncRequests: NodeSyncRequestService,
  ) {}

  @Get()
  listNodes() {
    return this.nodes.getNodes();
  }

  @Post()
  createNode(@Body() body: CreateNodeDto) {
    return this.nodes.createNode(body);
  }

  @Patch(':id')
  updateNode(@Param('id') id: string, @Body() body: UpdateNodeDto) {
    return this.nodes.patchNode(id, body);
  }

  @Post(':id/sync')
  @HttpCode(202)
  syncNode(@Param('id') id: string) {
    return this.syncRequests.request(id);
  }

  @Delete(':id')
  @HttpCode(204)
  deleteNode(@Param('id') id: string) {
    return this.nodes.deleteNode(id);
  }
}
