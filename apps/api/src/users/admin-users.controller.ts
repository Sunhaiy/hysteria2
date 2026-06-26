import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { hash } from 'bcryptjs';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import type { SessionPrincipal } from '../common/auth.types';
import {
  AdjustBalanceDto,
  CreateUserDto,
  UpdateUserDto,
} from '../contracts/http.dto';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import { KickService } from '../kick-service/kick-service.service';
import { PortalService } from '../portal/portal.service';

@Controller('api/admin/users')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminUsersController {
  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly kickService: KickService,
    private readonly portalService: PortalService,
  ) {}

  @Get()
  listUsers() {
    return this.store.getUsers();
  }

  @Post()
  async createUser(@Body() body: CreateUserDto) {
    const created = await this.store.createUser({
      email: body.email,
      displayName: body.displayName,
      passwordHash: await hash(body.password, 10),
      plainPassword: body.password,
      role: body.role ?? 'member',
      status: body.status ?? 'active',
      notes: body.notes,
      initialPlanId:
        (body.role ?? 'member') === 'member' ? body.initialPlanId : undefined,
      initialNodeId:
        (body.role ?? 'member') === 'member'
          ? body.initialNodeId
          : undefined,
    });

    return {
      ...created,
      provisionedAccess: created.provisionedSubscriptionId
        ? await this.portalService.getAccess(created.id)
        : null,
    };
  }

  @Patch(':id')
  async updateUser(@Param('id') id: string, @Body() body: UpdateUserDto) {
    return this.store.patchUser(id, {
      displayName: body.displayName,
      passwordHash: body.password ? await hash(body.password, 10) : undefined,
      plainPassword: body.password || undefined,
      role: body.role,
      status: body.status,
      notes: body.notes,
    });
  }

  @Get(':id/access')
  getUserAccess(@Param('id') id: string) {
    return this.portalService.getAccess(id);
  }

  @Get(':id/subscription')
  getUserSubscription(@Param('id') id: string) {
    return this.store.getUserSubscription(id);
  }

  @Get(':id/usage')
  getUserUsage(@Param('id') id: string) {
    return this.store.getUsageRollupsByUser(id);
  }

  @Get(':id/wallet')
  getUserWallet(@Param('id') id: string) {
    return this.store.getWallet(id);
  }

  @Patch(':id/balance')
  adjustUserBalance(@Param('id') id: string, @Body() body: AdjustBalanceDto) {
    return this.store.adjustUserBalance(id, body.balanceCents, body.note);
  }

  @Post(':id/kick')
  kickUser(
    @Param('id') id: string,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.kickService.kickUserEverywhere(id, `admin:${principal.email}`);
  }
}
