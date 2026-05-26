import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/api/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect(({ body }) => {
        const payload = body as { ok: boolean; state: { nodes: number } };
        expect(payload.ok).toBe(true);
        expect(payload.state.nodes).toBeGreaterThan(0);
      });
  });

  it('/integrations/hysteria/auth (POST) returns 200', () => {
    return request(app.getHttpServer())
      .post('/integrations/hysteria/auth?nodeId=node_hk_core')
      .send({
        addr: '127.0.0.1:59620',
        auth: 'hy2_live_lin_primary',
        tx: 0,
      })
      .expect(200)
      .expect(({ body }) => {
        const payload = body as { ok: boolean; id: string };
        expect(payload.ok).toBe(true);
        expect(typeof payload.id).toBe('string');
      });
  });

  it('allows a member to redeem a plan code and receive access', async () => {
    const unique = Date.now();

    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'ops@hysteria.local',
        password: 'admin123!',
      })
      .expect(201);

    const adminToken = (adminLogin.body as { accessToken: string }).accessToken;

    const createdUser = await request(app.getHttpServer())
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: `redeem.e2e.${unique}@example.com`,
        displayName: `Redeem E2E ${unique}`,
        password: 'member123!',
        role: 'member',
        status: 'active',
      })
      .expect(201);

    expect(
      (createdUser.body as { provisionedSubscriptionId?: string | null })
        .provisionedSubscriptionId ?? null,
    ).toBeNull();

    const createdCode = await request(app.getHttpServer())
      .post('/api/admin/redemption-codes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        label: `E2E Core ${unique}`,
        kind: 'plan',
        planId: 'plan_core',
        amountCents: 1800,
      })
      .expect(201);

    const codeValue = (createdCode.body as { code: string }).code;
    expect(codeValue.startsWith('HY2-')).toBe(true);

    const memberLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: `redeem.e2e.${unique}@example.com`,
        password: 'member123!',
      })
      .expect(201);

    const memberToken = (memberLogin.body as { accessToken: string })
      .accessToken;

    const redeem = await request(app.getHttpServer())
      .post('/api/portal/redeem')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        code: codeValue,
      })
      .expect(201);

    const redeemPayload = redeem.body as {
      code: { status: string };
      overview: { subscription: { planId: string } };
      access: { token: string; uri: string };
    };

    expect(redeemPayload.code.status).toBe('redeemed');
    expect(redeemPayload.overview.subscription.planId).toBe('plan_core');
    expect(typeof redeemPayload.access.token).toBe('string');
    expect(redeemPayload.access.uri.startsWith('hysteria2://')).toBe(true);

    await request(app.getHttpServer())
      .get('/api/portal/subscription')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200)
      .expect(({ body }) => {
        const payload = body as { subscription: { planId: string } };
        expect(payload.subscription.planId).toBe('plan_core');
      });
  });

  it('allows a member to request a plan order and admin to apply it later', async () => {
    const unique = Date.now();

    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'ops@hysteria.local',
        password: 'admin123!',
      })
      .expect(201);

    const adminToken = (adminLogin.body as { accessToken: string }).accessToken;

    const createdUser = await request(app.getHttpServer())
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: `plans.e2e.${unique}@example.com`,
        displayName: `Plans E2E ${unique}`,
        password: 'member123!',
        role: 'member',
        status: 'active',
      })
      .expect(201);

    expect(
      (createdUser.body as { provisionedSubscriptionId?: string | null })
        .provisionedSubscriptionId ?? null,
    ).toBeNull();

    const memberLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: `plans.e2e.${unique}@example.com`,
        password: 'member123!',
      })
      .expect(201);

    const memberToken = (memberLogin.body as { accessToken: string })
      .accessToken;

    await request(app.getHttpServer())
      .get('/api/portal/plans')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200)
      .expect(({ body }) => {
        const payload = body as Array<{ id: string; active: boolean }>;
        expect(payload.some((plan) => plan.id === 'plan_core')).toBe(true);
        expect(payload.every((plan) => plan.active)).toBe(true);
      });

    const requestedOrder = await request(app.getHttpServer())
      .post('/api/portal/orders/request')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        planId: 'plan_core',
        note: 'Need a manual payment order',
      })
      .expect(201);

    const pendingOrder = requestedOrder.body as {
      id: string;
      status: string;
      planId: string;
    };

    expect(pendingOrder.status).toBe('pending');
    expect(pendingOrder.planId).toBe('plan_core');

    await request(app.getHttpServer())
      .get('/api/portal/subscription')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/admin/orders/${pendingOrder.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        status: 'applied',
      })
      .expect(200)
      .expect(({ body }) => {
        const payload = body as { status: string; planId: string };
        expect(payload.status).toBe('applied');
        expect(payload.planId).toBe('plan_core');
      });

    await request(app.getHttpServer())
      .get('/api/portal/subscription')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200)
      .expect(({ body }) => {
        const payload = body as { subscription: { planId: string } };
        expect(payload.subscription.planId).toBe('plan_core');
      });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });
});
