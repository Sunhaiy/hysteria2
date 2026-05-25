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
import {
  CreateSubscriptionDto,
  UpdateSubscriptionDto,
} from '../contracts/http.dto';
import { ControlPlaneStoreService } from '../domain/control-plane.store';

@Controller('api/admin/subscriptions')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SubscriptionsController {
  constructor(private readonly store: ControlPlaneStoreService) {}

  @Get()
  listSubscriptions() {
    return this.store.getSubscriptions();
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
