import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { CacheModule } from './cache/cache.module';
import { CatalogModule } from './catalog/catalog.module';
import { CommerceModule } from './commerce/commerce.module';
import { DomainModule } from './domain/domain.module';
import { DestinationTelemetryModule } from './destination-telemetry/destination-telemetry.module';
import { EntitlementModule } from './entitlement/entitlement.module';
import { HealthModule } from './health/health.module';
import { FinanceModule } from './finance/finance.module';
import { HysteriaAuthModule } from './hysteria-auth/hysteria-auth.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { KickServiceModule } from './kick-service/kick-service.module';
import { MailModule } from './mail/mail.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { NodesModule } from './nodes/nodes.module';
import { NodeOpsModule } from './node-ops/node-ops.module';
import { OAuthModule } from './oauth/oauth.module';
import { OrdersModule } from './orders/orders.module';
import { OperationsModule } from './operations/operations.module';
import { PlanBindingsModule } from './plan-bindings/plan-bindings.module';
import { PlansModule } from './plans/plans.module';
import { PortalModule } from './portal/portal.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedemptionCodesModule } from './redemption-codes/redemption-codes.module';
import { ReportingModule } from './reporting/reporting.module';
import { SecurityModule } from './security/security.module';
import { SettingsModule } from './settings/settings.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { TrafficPackProductsModule } from './traffic-pack-products/traffic-pack-products.module';
import { TrafficAnalyticsModule } from './traffic-analytics/traffic-analytics.module';
import { UsageSyncModule } from './usage-sync/usage-sync.module';
import { AdminUsersModule } from './users/admin-users.module';
import { TutorialsModule } from './tutorials/tutorials.module';
import { TicketsModule } from './tickets/tickets.module';

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
    CatalogModule,
    PrismaModule,
    SecurityModule,
    SettingsModule,
    MailModule,
    DomainModule,
    DestinationTelemetryModule,
    EntitlementModule,
    CommerceModule,
    IntegrationsModule,
    AuthModule,
    AuditModule,
    OAuthModule,
    HealthModule,
    FinanceModule,
    MonitoringModule,
    AdminUsersModule,
    PlansModule,
    PlanBindingsModule,
    SubscriptionsModule,
    TrafficPackProductsModule,
    TrafficAnalyticsModule,
    NodesModule,
    NodeOpsModule,
    OrdersModule,
    OperationsModule,
    RedemptionCodesModule,
    ReportingModule,
    PortalModule,
    HysteriaAuthModule,
    KickServiceModule,
    UsageSyncModule,
    TutorialsModule,
    TicketsModule,
  ],
})
export class AppModule {}
