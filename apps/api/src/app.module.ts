import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { CacheModule } from './cache/cache.module';
import { DomainModule } from './domain/domain.module';
import { HealthModule } from './health/health.module';
import { HysteriaAuthModule } from './hysteria-auth/hysteria-auth.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { KickServiceModule } from './kick-service/kick-service.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { NodesModule } from './nodes/nodes.module';
import { NodeGroupsModule } from './node-groups/node-groups.module';
import { OrdersModule } from './orders/orders.module';
import { PlanBindingsModule } from './plan-bindings/plan-bindings.module';
import { PlansModule } from './plans/plans.module';
import { PortalModule } from './portal/portal.module';
import { PrismaModule } from './prisma/prisma.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { UsageSyncModule } from './usage-sync/usage-sync.module';
import { AdminUsersModule } from './users/admin-users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        join(process.cwd(), '.env'),
        join(process.cwd(), '../.env'),
        join(process.cwd(), '../../.env'),
      ],
    }),
    ScheduleModule.forRoot(),
    CacheModule,
    DomainModule,
    PrismaModule,
    IntegrationsModule,
    AuthModule,
    HealthModule,
    MonitoringModule,
    AdminUsersModule,
    PlansModule,
    NodeGroupsModule,
    PlanBindingsModule,
    SubscriptionsModule,
    NodesModule,
    OrdersModule,
    PortalModule,
    HysteriaAuthModule,
    KickServiceModule,
    UsageSyncModule,
  ],
})
export class AppModule {}
