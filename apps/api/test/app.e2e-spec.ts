import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import type { NodeLifecycleStatus } from '@prisma/client';
import { AppModule } from './../src/app.module';
import { NodeRuntimeCommandService } from './../src/node-ops/node-runtime-command.service';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;
  let originalCoreState: {
    active: boolean;
    lifecycleStatus: NodeLifecycleStatus;
  } | null;

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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    const prisma = app.get(PrismaService);
    originalCoreState = await prisma.node.findUnique({
      where: { id: 'node_hk_core' },
      select: { active: true, lifecycleStatus: true },
    });
    if (!originalCoreState) throw new Error('E2E core node fixture is missing');
    await prisma.node.update({
      where: { id: 'node_hk_core' },
      data: { active: true, lifecycleStatus: 'ACTIVE' },
    });
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

  it('/integrations/hysteria/auth (POST) returns 200', async () => {
    const unique = Date.now();
    const adminAgent = request.agent(app.getHttpServer());
    const csrf = await login(adminAgent, 'ops@hysteria.local', 'admin123!');
    const created = await adminAgent
      .post('/api/admin/users')
      .set('X-CSRF-Token', csrf)
      .send({
        email: `auth.e2e.${unique}@example.com`,
        displayName: `Auth E2E ${unique}`,
        password: 'member123!',
        role: 'member',
        status: 'active',
        initialPlanId: 'plan_core',
        initialNodeId: 'node_hk_core',
      })
      .expect(201);
    const accessToken = (created.body as { primaryAccessToken?: string })
      .primaryAccessToken;
    if (!accessToken)
      throw new Error('E2E user did not receive an access token');

    await request(app.getHttpServer())
      .post('/integrations/hysteria/auth?nodeId=node_hk_core')
      .send({
        addr: '127.0.0.1:59620',
        auth: accessToken,
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
        expect(payload.subscription.planId).toBe('catalog_core');
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
      chargedCents: 3200,
    });
    await memberAgent
      .get('/api/portal/subscription')
      .expect(200)
      .expect(({ body }) => {
        const payload = body as {
          plan: { name: string };
          packs: Array<{ status: string }>;
        };
        expect(payload.plan.name).toContain('独立流量权益');
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
    await memberAgent
      .get('/api/portal/subscription')
      .expect(200)
      .expect(({ body }) => {
        expect((body as { plan: { name: string } }).plan.name).toBe('Core 200');
      });

    const entitlements = await adminAgent
      .get(`/api/admin/customers/${userId}/entitlements?pageSize=100`)
      .expect(200)
      .expect(({ body }) => {
        const customer = body as {
          items: Array<{
            kind: string;
            status: string;
            productName: string;
            startsAt: string;
            endsAt: string;
          }>;
        };
        const activePlans = customer.items.filter(
          (grant) => grant.kind === 'plan' && grant.status === 'active',
        );
        expect(activePlans).toHaveLength(2);
        const currentPlan = activePlans.find(
          (grant) => grant.productName === 'Core 200',
        );
        const scheduledPlan = activePlans.find(
          (grant) => grant.productName === 'Pro 500',
        );
        expect(currentPlan).toBeDefined();
        expect(scheduledPlan).toBeDefined();
        expect(scheduledPlan?.startsAt).toBe(currentPlan?.endsAt);
        expect(
          customer.items.some(
            (grant) =>
              grant.kind === 'traffic_pack' && grant.status === 'active',
          ),
        ).toBe(true);
      });
    expect(
      (entitlements.body as { total: number }).total,
    ).toBeGreaterThanOrEqual(3);
    await adminAgent
      .get(`/api/admin/customers/${userId}/finance?kind=orders&pageSize=100`)
      .expect(200)
      .expect(({ body }) => {
        expect((body as { items: unknown[] }).items).toHaveLength(3);
      });
  });

  it('uses wallet checkout for a plan, renewal, quota reset, and traffic pack', async () => {
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
        email: `wallet-commerce.e2e.${unique}@example.com`,
        displayName: `Wallet Commerce E2E ${unique}`,
        password: 'member123!',
        role: 'member',
        status: 'active',
      })
      .expect(201);
    const userId = (created.body as { id: string }).id;
    await adminAgent
      .post(`/api/admin/customers/${userId}/balance-adjustments`)
      .set('X-CSRF-Token', adminCsrf)
      .set('Idempotency-Key', `wallet-commerce-funding-${unique}`)
      .send({ deltaCents: 20_000, note: 'Wallet commerce E2E funding' })
      .expect(201);

    const memberAgent = request.agent(app.getHttpServer());
    const memberCsrf = await login(
      memberAgent,
      `wallet-commerce.e2e.${unique}@example.com`,
      'member123!',
    );
    const checkout = (
      offerId: string,
      key: string,
      purchaseAction: 'purchase' | 'plan_reset' = 'purchase',
    ) =>
      memberAgent
        .post('/api/portal/commerce/checkout')
        .set('X-CSRF-Token', memberCsrf)
        .set('Idempotency-Key', key)
        .send({ offerId, purchaseAction });

    await checkout('catalog_offer_core_monthly', `wallet-plan-${unique}`)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          kind: 'plan_offer',
          chargedCents: 1_800,
        });
      });
    const beforeRenewal = await memberAgent
      .get('/api/portal/subscription')
      .expect(200);

    const grants = await adminAgent
      .get(`/api/admin/customers/${userId}/entitlements?pageSize=100`)
      .expect(200);
    const planGrant = (
      grants.body as {
        items: Array<{
          kind: string;
          productName: string;
          buckets: Array<{ id: string; grantedBytes: number }>;
        }>;
      }
    ).items.find(
      (grant) => grant.kind === 'plan' && grant.productName === 'Core 200',
    );
    const bucket = planGrant?.buckets[0];
    expect(bucket).toBeDefined();
    const remainingBeforeReset = 1;
    await adminAgent
      .post(
        `/api/admin/customers/${userId}/quota-buckets/${bucket!.id}/adjustments`,
      )
      .set('X-CSRF-Token', adminCsrf)
      .send({
        remainingBytes: remainingBeforeReset,
        reason: 'Wallet reset E2E usage',
      })
      .expect(201);

    await memberAgent
      .post('/api/portal/commerce/quote')
      .set('X-CSRF-Token', memberCsrf)
      .send({
        offerId: 'catalog_offer_core_monthly',
        purchaseAction: 'plan_reset',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          purchaseMode: 'plan_reset',
          finalPriceCents: 1_260,
          sufficient: true,
        });
      });
    await checkout(
      'catalog_offer_core_monthly',
      `wallet-reset-${unique}`,
      'plan_reset',
    )
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          kind: 'plan_offer',
          chargedCents: 1_260,
        });
      });

    await checkout('catalog_offer_core_quarterly', `wallet-renewal-${unique}`)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          kind: 'plan_offer',
          chargedCents: 5_000,
        });
      });
    const afterRenewal = await memberAgent
      .get('/api/portal/subscription')
      .expect(200);
    expect(
      Date.parse(
        (afterRenewal.body as { subscription: { endsAt: string } }).subscription
          .endsAt,
      ),
    ).toBeGreaterThan(
      Date.parse(
        (beforeRenewal.body as { subscription: { endsAt: string } })
          .subscription.endsAt,
      ),
    );

    await checkout('catalog_offer_pack_quarterly', `wallet-pack-${unique}`)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          kind: 'traffic_pack',
          chargedCents: 3_200,
        });
      });
    const overview = await memberAgent
      .get('/api/portal/subscription')
      .expect(200);
    expect(
      (overview.body as { packs: Array<{ status: string }> }).packs,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'active' })]),
    );

    const wallet = await memberAgent.get('/api/portal/wallet').expect(200);
    expect((wallet.body as { balanceCents: number }).balanceCents).toBe(8_740);
    const updatedGrants = await adminAgent
      .get(`/api/admin/customers/${userId}/entitlements?pageSize=100`)
      .expect(200);
    const updatedPlan = (
      updatedGrants.body as {
        items: Array<{
          kind: string;
          productName: string;
          buckets: Array<{ id: string; remainingBytes: number }>;
        }>;
      }
    ).items.find(
      (grant) => grant.kind === 'plan' && grant.productName === 'Core 200',
    );
    expect(
      updatedPlan?.buckets.find((item) => item.id === bucket!.id),
    ).toMatchObject({
      remainingBytes: remainingBeforeReset + bucket!.grantedBytes,
    });
  });

  it('lets two logged-in members pay with wallet and complete a group buy', async () => {
    const unique = Date.now();
    const adminAgent = request.agent(app.getHttpServer());
    const adminCsrf = await login(
      adminAgent,
      'ops@hysteria.local',
      'admin123!',
    );
    const originalSettingsResponse = await adminAgent
      .get('/api/admin/group-buys/campaigns')
      .expect(200);
    const originalSettings = originalSettingsResponse.body as {
      discountPercent: number;
      bonusTrafficGiB: number;
      offers: Array<{
        offerId: string;
        productName: string;
        offerName: string;
        enabled: boolean;
      }>;
    };
    const targetOffer = originalSettings.offers.find(
      (offer) => offer.offerId === 'catalog_offer_core_monthly',
    );
    expect(targetOffer).toBeDefined();

    try {
      const configuredResponse = await adminAgent
        .put('/api/admin/group-buys/campaigns')
        .set('X-CSRF-Token', adminCsrf)
        .send({
          offerIds: [targetOffer!.offerId],
          discountPercent: 80,
          bonusTrafficGiB: 5,
        })
        .expect(200);
      const configured = configuredResponse.body as {
        offers: Array<{
          offerId: string;
          productName: string;
          offerName: string;
          originalPriceCents: number;
          priceCents: number;
          campaignId: string | null;
        }>;
      };
      const campaignOffer = configured.offers.find(
        (offer) => offer.offerId === targetOffer!.offerId,
      );
      expect(typeof campaignOffer?.campaignId).toBe('string');
      expect(campaignOffer?.priceCents).toBe(
        Math.round((campaignOffer?.originalPriceCents ?? 0) * 0.8),
      );
      const campaignId = campaignOffer?.campaignId;
      if (!campaignId) throw new Error('Group-buy campaign was not enabled');

      const initialBalanceCents = 10_000;
      const provisionMember = async (role: string) => {
        const email = `group-buy-${role}.${unique}@example.com`;
        const created = await adminAgent
          .post('/api/admin/users')
          .set('X-CSRF-Token', adminCsrf)
          .send({
            email,
            displayName: `Group Buy ${role} ${unique}`,
            password: 'member123!',
            role: 'member',
            status: 'active',
          })
          .expect(201);
        const userId = (created.body as { id: string }).id;
        await adminAgent
          .post(`/api/admin/customers/${userId}/balance-adjustments`)
          .set('X-CSRF-Token', adminCsrf)
          .set('Idempotency-Key', `group-buy-funding-${role}-${unique}`)
          .send({
            deltaCents: initialBalanceCents,
            note: 'Two-member group-buy E2E funding',
          })
          .expect(201);
        const agent = request.agent(app.getHttpServer());
        const csrf = await login(agent, email, 'member123!');
        return { agent, csrf, userId };
      };
      const creator = await provisionMember('creator');
      const joiner = await provisionMember('joiner');
      const members = [creator, joiner];

      await creator.agent
        .post('/api/portal/group-buys')
        .set('X-CSRF-Token', creator.csrf)
        .set('Idempotency-Key', `group-buy-invalid-activation-${unique}`)
        .send({
          campaignId,
          paymentType: 'balance',
          planActivation: 'replace_silently',
        })
        .expect(400);

      const creatorPayment = await creator.agent
        .post('/api/portal/group-buys')
        .set('X-CSRF-Token', creator.csrf)
        .set('Idempotency-Key', `group-buy-create-${unique}`)
        .send({ campaignId, paymentType: 'balance' })
        .expect(201);
      const creatorPaymentBody = creatorPayment.body as {
        status: string;
        paymentType: string;
        amountCents: number;
        orderId: unknown;
        planActivationMode: string | null;
        planEffectiveAt: string | null;
      };
      expect(creatorPaymentBody).toMatchObject({
        status: 'settled',
        paymentType: 'balance',
        amountCents: campaignOffer.originalPriceCents,
        planActivationMode: 'initial',
      });
      expect(typeof creatorPaymentBody.orderId).toBe('string');
      expect(
        Number.isNaN(Date.parse(creatorPaymentBody.planEffectiveAt!)),
      ).toBe(false);
      if (typeof creatorPaymentBody.orderId !== 'string') {
        throw new Error('Creator wallet payment did not return an order');
      }

      const creatorGroups = await creator.agent
        .get('/api/portal/group-buys?scope=mine&pageSize=30')
        .expect(200);
      const openGroup = (
        creatorGroups.body as {
          items: Array<{
            id: string;
            shareCode: string;
            status: string;
            productName: string;
            paidMembers: number;
            canCancel: boolean;
          }>;
        }
      ).items.find((group) => group.productName === campaignOffer.productName);
      expect(openGroup).toMatchObject({
        status: 'open',
        paidMembers: 1,
        canCancel: true,
      });
      if (!openGroup) throw new Error('Creator group was not listed');

      const sharedBeforeJoin = await joiner.agent
        .get(`/api/portal/group-buys/${openGroup.shareCode}`)
        .expect(200);
      expect(sharedBeforeJoin.body).toMatchObject({
        id: openGroup.id,
        shareCode: openGroup.shareCode,
        status: 'open',
        canJoin: true,
        canCancel: false,
      });
      await joiner.agent
        .post(`/api/portal/group-buys/${openGroup.id}/cancel`)
        .set('X-CSRF-Token', joiner.csrf)
        .expect(403);

      const creatorBeforeCompletion = await adminAgent
        .get(`/api/admin/customers/${creator.userId}/entitlements?pageSize=100`)
        .expect(200);
      const creatorInitialGrants = (
        creatorBeforeCompletion.body as {
          items: Array<{ kind: string; productId: string; status: string }>;
        }
      ).items;
      expect(
        creatorInitialGrants.some(
          (grant) =>
            grant.kind === 'plan' &&
            grant.status === 'active' &&
            grant.productId !== 'system_group_buy_traffic_bonus',
        ),
      ).toBe(true);
      expect(
        creatorInitialGrants.some(
          (grant) => grant.productId === 'system_group_buy_traffic_bonus',
        ),
      ).toBe(false);

      const joinerPayment = await joiner.agent
        .post(`/api/portal/group-buys/${openGroup.id}/join`)
        .set('X-CSRF-Token', joiner.csrf)
        .set('Idempotency-Key', `group-buy-join-${unique}`)
        .send({ paymentType: 'balance' })
        .expect(201);
      const joinerPaymentBody = joinerPayment.body as {
        status: string;
        paymentType: string;
        amountCents: number;
        orderId: unknown;
        planActivationMode: string | null;
        planEffectiveAt: string | null;
      };
      expect(joinerPaymentBody).toMatchObject({
        status: 'settled',
        paymentType: 'balance',
        amountCents: campaignOffer.originalPriceCents,
        planActivationMode: 'initial',
      });
      expect(typeof joinerPaymentBody.orderId).toBe('string');
      expect(Number.isNaN(Date.parse(joinerPaymentBody.planEffectiveAt!))).toBe(
        false,
      );
      if (typeof joinerPaymentBody.orderId !== 'string') {
        throw new Error('Joiner wallet payment did not return an order');
      }

      for (const member of members) {
        const completed = await member.agent
          .get(`/api/portal/group-buys/${openGroup.id}`)
          .expect(200);
        const completedBody = completed.body as {
          status: string;
          paidMembers: number;
          requiredMembers: number;
          members: Array<{ status: string }>;
        };
        expect(completedBody).toMatchObject({
          status: 'succeeded',
          paidMembers: 2,
          requiredMembers: 2,
        });
        expect(completedBody.members).toHaveLength(2);
        expect(
          completedBody.members.every((item) => item.status === 'fulfilled'),
        ).toBe(true);

        const wallet = await member.agent.get('/api/portal/wallet').expect(200);
        expect((wallet.body as { balanceCents: number }).balanceCents).toBe(
          initialBalanceCents - campaignOffer.priceCents,
        );

        const grantsResponse = await adminAgent
          .get(
            `/api/admin/customers/${member.userId}/entitlements?pageSize=100`,
          )
          .expect(200);
        const grants = (
          grantsResponse.body as {
            items: Array<{
              kind: string;
              productId: string;
              productName: string;
              status: string;
              buckets: Array<{ grantedBytes: number }>;
            }>;
          }
        ).items;
        expect(
          grants.some(
            (grant) =>
              grant.kind === 'plan' &&
              grant.productName === campaignOffer.productName &&
              grant.status === 'active',
          ),
        ).toBe(true);
        expect(
          grants.find(
            (grant) => grant.productId === 'system_group_buy_traffic_bonus',
          ),
        ).toMatchObject({
          kind: 'traffic_pack',
          status: 'active',
          buckets: [expect.objectContaining({ grantedBytes: 5 * 1024 ** 3 })],
        });
      }

      for (const orderId of [
        creatorPaymentBody.orderId,
        joinerPaymentBody.orderId,
      ]) {
        const order = await adminAgent
          .get(`/api/admin/orders/${orderId}`)
          .expect(200);
        expect(order.body).toMatchObject({
          source: 'wallet',
          fulfillmentStatus: 'applied',
          entitlementGrant: { status: 'active' },
          payments: [
            expect.objectContaining({
              source: 'wallet',
              status: 'settled',
              amountCents: campaignOffer.originalPriceCents,
            }),
          ],
        });
      }

      await creator.agent
        .post(`/api/portal/group-buys/${openGroup.id}/cancel`)
        .set('X-CSRF-Token', creator.csrf)
        .expect(409);

      const cancelCreator = await provisionMember('cancel-creator');
      const cancelViewer = await provisionMember('cancel-viewer');
      await cancelCreator.agent
        .post('/api/portal/group-buys')
        .set('X-CSRF-Token', cancelCreator.csrf)
        .set('Idempotency-Key', `group-buy-cancel-create-${unique}`)
        .send({ campaignId, paymentType: 'balance' })
        .expect(201);
      const cancelCreatorGroups = await cancelCreator.agent
        .get('/api/portal/group-buys?scope=mine&pageSize=30')
        .expect(200);
      const cancelableGroup = (
        cancelCreatorGroups.body as {
          items: Array<{
            id: string;
            shareCode: string;
            status: string;
            canCancel: boolean;
          }>;
        }
      ).items.find((group) => group.status === 'open');
      expect(cancelableGroup).toMatchObject({
        status: 'open',
        canCancel: true,
      });
      if (!cancelableGroup) throw new Error('Cancelable group was not listed');

      await cancelViewer.agent
        .get(`/api/portal/group-buys/${cancelableGroup.shareCode}`)
        .expect(200)
        .expect(({ body }) => {
          expect(body).toMatchObject({
            id: cancelableGroup.id,
            status: 'open',
            canJoin: true,
          });
        });
      await cancelViewer.agent
        .post(`/api/portal/group-buys/${cancelableGroup.id}/cancel`)
        .set('X-CSRF-Token', cancelViewer.csrf)
        .expect(403);

      await cancelCreator.agent
        .post(`/api/portal/group-buys/${cancelableGroup.id}/cancel`)
        .set('X-CSRF-Token', cancelCreator.csrf)
        .expect(201)
        .expect(({ body }) => {
          expect(body).toMatchObject({
            id: cancelableGroup.id,
            status: 'canceled',
            canJoin: false,
            canCancel: false,
          });
        });
      await cancelCreator.agent
        .get('/api/portal/group-buys?scope=mine&pageSize=30')
        .expect(200)
        .expect(({ body }) => {
          expect(
            (
              body as {
                items: Array<{ id: string }>;
              }
            ).items,
          ).not.toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: cancelableGroup.id }),
            ]),
          );
        });
      await cancelViewer.agent
        .post(`/api/portal/group-buys/${cancelableGroup.id}/join`)
        .set('X-CSRF-Token', cancelViewer.csrf)
        .set('Idempotency-Key', `group-buy-canceled-join-${unique}`)
        .send({ paymentType: 'balance' })
        .expect(400);

      const canceledCreatorWallet = await cancelCreator.agent
        .get('/api/portal/wallet')
        .expect(200);
      expect(
        (canceledCreatorWallet.body as { balanceCents: number }).balanceCents,
      ).toBe(initialBalanceCents - campaignOffer.originalPriceCents);
      const canceledCreatorGrants = await adminAgent
        .get(
          `/api/admin/customers/${cancelCreator.userId}/entitlements?pageSize=100`,
        )
        .expect(200);
      const retainedGrants = (
        canceledCreatorGrants.body as {
          items: Array<{ kind: string; productId: string; status: string }>;
        }
      ).items;
      expect(
        retainedGrants.some(
          (grant) => grant.kind === 'plan' && grant.status === 'active',
        ),
      ).toBe(true);
      expect(
        retainedGrants.some(
          (grant) => grant.productId === 'system_group_buy_traffic_bonus',
        ),
      ).toBe(false);
    } finally {
      await adminAgent
        .put('/api/admin/group-buys/campaigns')
        .set('X-CSRF-Token', adminCsrf)
        .send({
          offerIds: originalSettings.offers
            .filter((offer) => offer.enabled)
            .map((offer) => offer.offerId),
          discountPercent: originalSettings.discountPercent,
          bonusTrafficGiB: originalSettings.bonusTrafficGiB,
        })
        .expect(200);
    }
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

  it('queues and executes an idempotent node runtime stop command', async () => {
    const adminAgent = request.agent(app.getHttpServer());
    const csrf = await login(adminAgent, 'ops@hysteria.local', 'admin123!');
    await adminAgent
      .patch('/api/admin/nodes/node_hk_core')
      .set('X-CSRF-Token', csrf)
      .send({
        controlApiBaseUrl: 'mock://runtime-agent',
        controlApiSecret: 'runtime-secret',
      })
      .expect(200);

    const idempotencyKey = `runtime-stop-${Date.now()}`;
    const queued = await adminAgent
      .post('/api/admin/node-ops/nodes/node_hk_core/runtime-commands')
      .set('X-CSRF-Token', csrf)
      .send({ action: 'stop', idempotencyKey })
      .expect(202);
    expect(queued.body).toMatchObject({
      nodeId: 'node_hk_core',
      action: 'stop',
      status: 'queued',
    });

    const runtime = app.get(NodeRuntimeCommandService);
    await expect(runtime.processNext()).resolves.toMatchObject({
      id: (queued.body as { id: string }).id,
      status: 'succeeded',
      resultState: 'inactive',
    });

    await adminAgent
      .get(
        `/api/admin/node-ops/nodes/node_hk_core/runtime-commands/${(queued.body as { id: string }).id}`,
      )
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: 'succeeded',
          resultState: 'inactive',
        });
      });
    const replay = await adminAgent
      .post('/api/admin/node-ops/nodes/node_hk_core/runtime-commands')
      .set('X-CSRF-Token', csrf)
      .send({ action: 'stop', idempotencyKey })
      .expect(202);
    expect((replay.body as { id: string }).id).toBe(
      (queued.body as { id: string }).id,
    );

    await adminAgent
      .get('/api/admin/node-ops')
      .expect(200)
      .expect(({ body }) => {
        const node = (
          body as { nodes: Array<{ id: string; runtimeState: string }> }
        ).nodes.find((item) => item.id === 'node_hk_core');
        expect(node?.runtimeState).toBe('inactive');
      });

    await adminAgent
      .patch('/api/admin/nodes/node_hk_core')
      .set('X-CSRF-Token', csrf)
      .send({ controlApiBaseUrl: '' })
      .expect(200);
  });

  afterEach(async () => {
    if (app) {
      if (originalCoreState) {
        await app.get(PrismaService).node.update({
          where: { id: 'node_hk_core' },
          data: originalCoreState,
        });
      }
      await app.close();
    }
  });
});
