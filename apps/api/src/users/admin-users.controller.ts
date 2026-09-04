import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { hash } from 'bcryptjs';
import { AuthService } from '../auth/auth.service';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import type { SessionPrincipal } from '../common/auth.types';
import {
  AdjustBalanceDto,
  CreateUserDto,
  UpdateUserDto,
} from '../contracts/http.dto';
import { DeleteCustomerDto } from '../customer-admin/customer-admin.dto';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import {
  CustomerAdminService,
  type CustomerQuery,
} from '../customer-admin/customer-admin.service';
import { KickService } from '../kick-service/kick-service.service';
import { PortalService } from '../portal/portal.service';

@Controller('api/admin/users')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminUsersController {
  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly kickService: KickService,
    private readonly portalService: PortalService,
    private readonly authService: AuthService,
    private readonly customers: CustomerAdminService,
  ) {}

  @Get()
  listUsers(@Query() query: CustomerQuery) {
    return this.customers.listUsers(query);
  }

  @Post()
  async createUser(@Body() body: CreateUserDto) {
    if (body.role === 'admin') {
      throw new BadRequestException(
        'This installation keeps a single super administrator',
      );
    }
    const created = await this.store.createUser({
      email: body.email,
      displayName: body.displayName,
      passwordHash: await hash(body.password, 10),
      role: 'member',
      status: body.status ?? 'active',
      notes: body.notes,
      initialPlanId:
        (body.role ?? 'member') === 'member' ? body.initialPlanId : undefined,
      initialNodeId:
        (body.role ?? 'member') === 'member' ? body.initialNodeId : undefined,
    });

    return {
      ...created,
      provisionedAccess: created.provisionedSubscriptionId
        ? await this.portalService.getAccess(created.id)
        : null,
    };
  }

  @Patch(':id')
  async updateUser(
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    if (body.role === 'admin') {
      throw new BadRequestException(
        'This installation keeps a single super administrator',
      );
    }
    if (
      id === principal.sub &&
      (body.role === 'member' ||
        (body.status !== undefined && body.status !== 'active'))
    ) {
      throw new BadRequestException(
        'The super administrator cannot be demoted or disabled',
      );
    }
    return this.store.patchUser(id, {
      displayName: body.displayName,
      role: body.role,
      status: body.status,
      notes: body.notes,
    });
  }

  @Delete(':id')
  deleteUser(
    @Param('id') id: string,
    @Body() body: DeleteCustomerDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    if (id === principal.sub) {
      throw new BadRequestException(
        'The super administrator cannot delete its own account',
      );
    }
    return this.customers.deleteCustomer(
      id,
      body.confirmationEmail,
      principal.sub,
    );
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

  @Post(':id/password-reset')
  issuePasswordReset(
    @Param('id') id: string,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.authService.issuePasswordReset(id, principal.sub);
  }
}
