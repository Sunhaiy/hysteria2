import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import {
  CreateSubscriptionDto,
  UpdateSubscriptionDto,
} from '../contracts/http.dto';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import {
  CustomerAdminService,
  type SubscriptionQuery,
} from '../customer-admin/customer-admin.service';

@Controller('api/admin/subscriptions')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SubscriptionsController {
  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly customers: CustomerAdminService,
  ) {}

  @Get()
  listSubscriptions(@Query() query: SubscriptionQuery) {
    return this.customers.listSubscriptions(query);
  }

  @Post()
  createSubscription(@Body() body: CreateSubscriptionDto) {
    return this.store.createSubscription(body);
  }

  @Patch(':id')
  updateSubscription(
    @Param('id') id: string,
    @Body() body: UpdateSubscriptionDto,
  ) {
    return this.store.patchSubscription(id, body);
  }
}
