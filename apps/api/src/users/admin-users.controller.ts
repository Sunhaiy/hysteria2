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
import { CreateUserDto, UpdateUserDto } from '../contracts/http.dto';
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
      role: body.role ?? 'member',
      status: body.status ?? 'active',
      notes: body.notes,
      initialPlanId:
        (body.role ?? 'member') === 'member' ? body.initialPlanId : undefined,
      initialNodeGroupId:
        (body.role ?? 'member') === 'member'
          ? body.initialNodeGroupId
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
      role: body.role,
      status: body.status,
      notes: body.notes,
    });
  }

  @Get(':id/access')
  getUserAccess(@Param('id') id: string) {
    return this.portalService.getAccess(id);
  }

  @Post(':id/kick')
  kickUser(
    @Param('id') id: string,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.kickService.kickUserEverywhere(id, `admin:${principal.email}`);
  }
}
