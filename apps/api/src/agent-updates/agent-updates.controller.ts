import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminPermission } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';
import { AdminPermissionGuard } from '../common/admin-permission.guard';
import { RequireAdminPermission } from '../common/admin-permission.decorator';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import type { SessionPrincipal } from '../common/auth.types';
import { AgentUpdatesService } from './agent-updates.service';
import {
  AgentHeartbeatDto,
  AgentUpdateReportDto,
  CreateAgentRolloutDto,
  EnrollAgentDto,
  UploadAgentReleaseDto,
} from './agent-updates.dto';
import { agentArtifactLimit } from './agent-update.contract';

@Controller('api/admin/agent-updates')
@UseGuards(JwtAuthGuard, AdminGuard, AdminPermissionGuard)
@RequireAdminPermission(AdminPermission.AGENT_UPDATES_MANAGE)
export class AdminAgentUpdatesController {
  constructor(private readonly updates: AgentUpdatesService) {}
  @Get() overview() {
    return this.updates.overview();
  }

  @Post('releases')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: agentArtifactLimit, files: 1 },
    }),
  )
  upload(
    @Body() input: UploadAgentReleaseDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentPrincipal() actor: SessionPrincipal,
  ) {
    if (!file?.buffer)
      throw new BadRequestException('请选择 Agent 可执行文件。');
    return this.updates.upload(input, file.buffer, actor.sub);
  }

  @Post('installations') enroll(
    @Body() input: EnrollAgentDto,
    @CurrentPrincipal() actor: SessionPrincipal,
  ) {
    return this.updates.enroll(input, actor.sub);
  }
  @Post('rollouts') rollout(
    @Body() input: CreateAgentRolloutDto,
    @CurrentPrincipal() actor: SessionPrincipal,
  ) {
    return this.updates.createRollout(input, actor.sub);
  }
  @Post('rollouts/:id/cancel') cancel(
    @Param('id') id: string,
    @CurrentPrincipal() actor: SessionPrincipal,
  ) {
    return this.updates.cancelRollout(id, actor.sub);
  }
}

@Controller('api/agent-updater')
export class AgentUpdaterController {
  constructor(private readonly updates: AgentUpdatesService) {}
  @Post('poll') async poll(
    @Headers('authorization') authorization: string | undefined,
    @Body() input: AgentHeartbeatDto,
  ) {
    const installation = await this.updates.authenticate(authorization);
    return this.updates.poll(installation.id, input);
  }
  @Post('jobs/:id/report') async report(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() input: AgentUpdateReportDto,
  ) {
    const installation = await this.updates.authenticate(authorization);
    return this.updates.report(installation.id, id, input);
  }
  @Get('jobs/:id/artifact') async artifact(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const installation = await this.updates.authenticate(authorization);
    const release = await this.updates.artifact(installation.id, id);
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Length', release.size);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('ETag', `"${release.sha256}"`);
    response.send(Buffer.from(release.binary));
  }
}
