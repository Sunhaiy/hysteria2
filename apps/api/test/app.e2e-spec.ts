import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  async function login(
    agent: ReturnType<typeof request.agent>,
    email: string,
    password: string,
  ) {
    const response = await agent
      .post('/api/auth/login')
      .send({ email, password })
      .expect(201);
    expect(response.body).not.toHaveProperty('accessToken');
    const headers = response.headers as unknown as Record<string, unknown>;
    const setCookies = headers['set-cookie'];
    const cookies = Array.isArray(setCookies)
      ? setCookies.filter((value): value is string => typeof value === 'string')
      : typeof setCookies === 'string'
        ? [setCookies]
        : [];
    const csrfCookie = cookies.find((value) =>
      value.startsWith('hysteria2-csrf='),
    );
    const csrf = csrfCookie?.split(';')[0]?.split('=').slice(1).join('=');
    if (!csrf) throw new Error('Login did not set a CSRF cookie');
    return decodeURIComponent(csrf);
  }

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
        const payload = body as {
          ok: boolean;
          checks: { database: { ok: boolean }; redis: { ok: boolean } };
        };
        expect(payload.ok).toBe(true);
        expect(payload.checks.database.ok).toBe(true);
        expect(payload.checks.redis.ok).toBe(true);
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

    const adminAgent = request.agent(app.getHttpServer());
    const adminCsrf = await login(
      adminAgent,
      'ops@hysteria.local',
      'admin123!',
    );

    const createdUser = await adminAgent
      .post('/api/admin/users')
      .set('X-CSRF-Token', adminCsrf)
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

    const createdCode = await adminAgent
      .post('/api/admin/redemption-codes')
      .set('X-CSRF-Token', adminCsrf)
      .send({
        label: `E2E Core ${unique}`,
        kind: 'plan',
        planId: 'plan_core',
        amountCents: 1800,
      })
      .expect(201);

    const codeValue = (createdCode.body as Array<{ code: string }>)[0]?.code;
    expect(typeof codeValue).toBe('string');
    if (!codeValue) throw new Error('Redemption code was not created');
    expect(codeValue.startsWith('HY2-')).toBe(true);

    const memberAgent = request.agent(app.getHttpServer());
    const memberCsrf = await login(
      memberAgent,
      `redeem.e2e.${unique}@example.com`,
      'member123!',
    );

    const redeem = await memberAgent
      .post('/api/portal/commerce/redeem')
      .set('X-CSRF-Token', memberCsrf)
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

    await memberAgent
      .get('/api/portal/subscription')
      .expect(200)
      .expect(({ body }) => {
        const payload = body as {
          subscription: { planId: string };
          alerts: unknown[];
        };
        expect(payload.subscription.planId).toBe('plan_core');
        expect(Array.isArray(payload.alerts)).toBe(true);
      });
  });

  it('allows a member to request a plan order and admin to apply it later', async () => {
    const unique = Date.now();

    const adminAgent = request.agent(app.getHttpServer());
    const adminCsrf = await login(
      adminAgent,
      'ops@hysteria.local',
      'admin123!',
    );

    const createdUser = await adminAgent
      .post('/api/admin/users')
      .set('X-CSRF-Token', adminCsrf)
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

    const memberAgent = request.agent(app.getHttpServer());
    const memberCsrf = await login(
      memberAgent,
      `plans.e2e.${unique}@example.com`,
      'member123!',
    );

    await memberAgent
      .get('/api/portal/plans')
      .expect(200)
      .expect(({ body }) => {
        const payload = body as Array<{ id: string; active: boolean }>;
        expect(payload.some((plan) => plan.id === 'plan_core')).toBe(true);
        expect(payload.every((plan) => plan.active)).toBe(true);
      });

    const requestedOrder = await memberAgent
      .post('/api/portal/orders/request')
      .set('X-CSRF-Token', memberCsrf)
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

    await memberAgent.get('/api/portal/subscription').expect(404);

    await adminAgent
      .patch(`/api/admin/orders/${pendingOrder.id}`)
      .set('X-CSRF-Token', adminCsrf)
      .send({
        status: 'applied',
      })
      .expect(200)
      .expect(({ body }) => {
        const payload = body as { status: string; planId: string };
        expect(payload.status).toBe('applied');
        expect(payload.planId).toBe('plan_core');
      });

    await memberAgent
      .get('/api/portal/subscription')
      .expect(200)
      .expect(({ body }) => {
        const payload = body as { subscription: { planId: string } };
        expect(payload.subscription.planId).toBe('plan_core');
      });
  });

  it('charges one order when the same checkout key is submitted concurrently', async () => {
    const unique = Date.now();
    const adminAgent = request.agent(app.getHttpServer());
    const adminCsrf = await login(
      adminAgent,
      'ops@hysteria.local',
      'admin123!',
    );
    const created = await adminAgent
      .post('/api/admin/users')
      .set('X-CSRF-Token', adminCsrf)
      .send({
        email: `checkout.e2e.${unique}@example.com`,
        displayName: `Checkout E2E ${unique}`,
        password: 'member123!',
        role: 'member',
        status: 'active',
      })
      .expect(201);
    const userId = (created.body as { id: string }).id;
    await adminAgent
      .patch(`/api/admin/users/${userId}/balance`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ balanceCents: 5000, note: 'E2E checkout balance' })
      .expect(200);

    const memberAgent = request.agent(app.getHttpServer());
    const memberCsrf = await login(
      memberAgent,
      `checkout.e2e.${unique}@example.com`,
      'member123!',
    );
    const idempotencyKey = `checkout-${unique}`;
    const checkout = () =>
      memberAgent
        .post('/api/portal/commerce/checkout')
        .set('X-CSRF-Token', memberCsrf)
        .set('Idempotency-Key', idempotencyKey)
        .send({ kind: 'plan', productId: 'plan_core' });

    const [first, second] = await Promise.all([checkout(), checkout()]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstResult = first.body as { orderId: string; replayed: boolean };
    const secondResult = second.body as { orderId: string; replayed: boolean };
    expect(secondResult.orderId).toBe(firstResult.orderId);
    expect([firstResult.replayed, secondResult.replayed].sort()).toEqual([
      false,
      true,
    ]);

    const wallet = await memberAgent.get('/api/portal/wallet').expect(200);
    expect((wallet.body as { balanceCents: number }).balanceCents).toBe(3200);
    const orders = await memberAgent.get('/api/portal/orders').expect(200);
    const matching = (orders.body as Array<{ idempotencyKey?: string }>).filter(
      (order) => order.idempotencyKey === idempotencyKey,
    );
    expect(matching).toHaveLength(1);
  });

  it('supports standalone packs, immediate plan switching, and offer idempotency', async () => {
    const unique = Date.now();
    const adminAgent = request.agent(app.getHttpServer());
    const adminCsrf = await login(
      adminAgent,
      'ops@hysteria.local',
      'admin123!',
    );
    const created = await adminAgent
      .post('/api/admin/users')
      .set('X-CSRF-Token', adminCsrf)
      .send({
        email: `v2-commerce.e2e.${unique}@example.com`,
        displayName: `V2 Commerce E2E ${unique}`,
        password: 'member123!',
        role: 'member',
        status: 'active',
      })
      .expect(201);
    const userId = (created.body as { id: string }).id;
    await adminAgent
      .post(`/api/admin/customers/${userId}/balance-adjustments`)
      .set('X-CSRF-Token', adminCsrf)
      .set('Idempotency-Key', `v2-balance-${unique}`)
      .send({ deltaCents: 50000, note: 'V2 commerce integration balance' })
      .expect(201);

    const memberAgent = request.agent(app.getHttpServer());
    const memberCsrf = await login(
      memberAgent,
      `v2-commerce.e2e.${unique}@example.com`,
      'member123!',
    );
    const checkout = (offerId: string, key: string) =>
      memberAgent
        .post('/api/portal/commerce/checkout')
        .set('X-CSRF-Token', memberCsrf)
        .set('Idempotency-Key', key)
        .send({ offerId });

    const pack = await checkout(
      'catalog_offer_pack_quarterly',
      `v2-pack-${unique}`,
    ).expect(201);
    expect(pack.body).toMatchObject({
      replayed: false,
      kind: 'traffic_pack',
      chargedCents: 900,
    });
    await memberAgent
      .get('/api/portal/subscription')
      .expect(200)
      .expect(({ body }) => {
        const payload = body as {
          plan: { name: string };
          packs: Array<{ status: string }>;
        };
        expect(payload.plan.name).toContain('灵活流量包');
        expect(payload.packs).toHaveLength(1);
        expect(payload.packs[0]?.status).toBe('active');
      });

    await adminAgent
      .patch('/api/admin/node-ops/nodes/node_hk_pro')
      .set('X-CSRF-Token', adminCsrf)
      .send({ lifecycleStatus: 'active' })
      .expect(200);
    await checkout('catalog_offer_core_monthly', `v2-core-${unique}`).expect(
      201,
    );
    const switchKey = `v2-switch-${unique}`;
    const switched = await checkout(
      'catalog_offer_pro_quarterly',
      switchKey,
    ).expect(201);
    expect(switched.body).toMatchObject({
      replayed: false,
      kind: 'plan_offer',
      chargedCents: 8900,
    });
    const replay = await checkout(
      'catalog_offer_pro_quarterly',
      switchKey,
    ).expect(201);
    expect(replay.body).toMatchObject({
      orderId: (switched.body as { orderId: string }).orderId,
      replayed: true,
    });

    await adminAgent
      .get(`/api/admin/customers/${userId}`)
      .expect(200)
      .expect(({ body }) => {
        const customer = body as {
          grants: Array<{
            kind: string;
            status: string;
            productName: string;
          }>;
          orders: Array<{ id: string }>;
        };
        const activePlans = customer.grants.filter(
          (grant) => grant.kind === 'plan' && grant.status === 'active',
        );
        expect(activePlans).toHaveLength(1);
        expect(activePlans[0]?.productName).toBe('Pro 500');
        expect(
          customer.grants.some(
            (grant) =>
              grant.kind === 'plan' &&
              grant.productName === 'Core 200' &&
              grant.status === 'canceled',
          ),
        ).toBe(true);
        expect(
          customer.grants.some(
            (grant) =>
              grant.kind === 'traffic_pack' && grant.status === 'active',
          ),
        ).toBe(true);
        expect(customer.orders).toHaveLength(3);
      });
  });

  it('allows admins to read reporting and export order terms', async () => {
    const adminAgent = request.agent(app.getHttpServer());
    await login(adminAgent, 'ops@hysteria.local', 'admin123!');

    await adminAgent
      .get('/api/admin/reporting/summary')
      .expect(200)
      .expect(({ body }) => {
        const payload = body as {
          commerce: {
            walletRevenueCents: number;
            refunds: { available: boolean };
          };
          nodes: { pendingUsageBatches: number };
        };
        expect(typeof payload.commerce.walletRevenueCents).toBe('number');
        expect(payload.commerce.refunds.available).toBe(false);
        expect(typeof payload.nodes.pendingUsageBatches).toBe('number');
      });

    await adminAgent
      .get('/api/admin/reporting/orders.csv')
      .expect('Content-Type', /text\/csv/)
      .expect('Content-Disposition', /attachment; filename="orders-/)
      .expect(200)
      .expect(({ text }) => {
        expect(text).toContain('订单 ID');
        expect(text).not.toContain('trafficApiSecret');
        expect(text).not.toContain('passwordHash');
      });

    await adminAgent
      .get('/api/admin/nodes')
      .expect(200)
      .expect(({ body }) => {
        const nodes = body as Array<Record<string, unknown>>;
        expect(nodes.length).toBeGreaterThan(0);
        expect(nodes.every((node) => !('trafficApiSecret' in node))).toBe(true);
        expect(nodes.every((node) => node.trafficApiSecretSet === true)).toBe(
          true,
        );
      });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });
});
