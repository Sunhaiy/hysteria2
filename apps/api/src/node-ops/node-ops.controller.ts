import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import {
  SaveNodePoolDto,
  SaveNodeServerDto,
  UpdateNodeOperationsDto,
} from './node-ops.dto';
import { NodeOpsService } from './node-ops.service';

@Controller('api/admin/node-ops')
@UseGuards(JwtAuthGuard, AdminGuard)
export class NodeOpsController {
  constructor(private readonly nodes: NodeOpsService) {}

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
}
