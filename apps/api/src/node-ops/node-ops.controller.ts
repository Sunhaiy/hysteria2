import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { SessionPrincipal } from '../common/auth.types';
import { AdminGuard } from '../common/admin.guard';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import {
  SaveNodePoolDto,
  SaveNodeServerDto,
  RequestNodeRuntimeCommandDto,
  UpdateNodeOperationsDto,
} from './node-ops.dto';
import { NodeOpsService } from './node-ops.service';
import { NodeRuntimeCommandService } from './node-runtime-command.service';

@Controller('api/admin/node-ops')
@UseGuards(JwtAuthGuard, AdminGuard)
export class NodeOpsController {
  constructor(
    private readonly nodes: NodeOpsService,
    private readonly runtime: NodeRuntimeCommandService,
  ) {}

  @Get()
  overview() {
    return this.nodes.overview();
  }

  @Post('servers')
  createServer(@Body() body: SaveNodeServerDto) {
    return this.nodes.createServer(body);
  }

  @Put('servers/:id')
  updateServer(@Param('id') id: string, @Body() body: SaveNodeServerDto) {
    return this.nodes.updateServer(id, body);
  }

  @Delete('servers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteServer(@Param('id') id: string) {
    return this.nodes.deleteServer(id);
  }

  @Post('pools')
  createPool(@Body() body: SaveNodePoolDto) {
    return this.nodes.createPool(body);
  }

  @Put('pools/:id')
  updatePool(@Param('id') id: string, @Body() body: SaveNodePoolDto) {
    return this.nodes.updatePool(id, body);
  }

  @Patch('nodes/:id')
  updateNode(@Param('id') id: string, @Body() body: UpdateNodeOperationsDto) {
    return this.nodes.updateNode(id, body);
  }

  @Post('nodes/:id/runtime-commands')
  @HttpCode(HttpStatus.ACCEPTED)
  requestRuntimeCommand(
    @Param('id') id: string,
    @Body() body: RequestNodeRuntimeCommandDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.runtime.request(id, body, principal.sub);
  }

  @Get('nodes/:nodeId/runtime-commands/:commandId')
  getRuntimeCommand(
    @Param('nodeId') nodeId: string,
    @Param('commandId') commandId: string,
  ) {
    return this.runtime.get(nodeId, commandId);
  }
}
