// Read-only against production; writes exclusively to a dedicated local audit schema.
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { HolidayService } = require('../dist/src/holiday/holiday.service');
const { MemberOnboardingService } = require('../dist/src/referrals/member-onboarding.service');
const { PaymentFulfillmentRejectedError } = require('../dist/src/commerce/payment-fulfillment.error');
const { holidayTransaction } = require('../dist/src/holiday/holiday-transaction');
async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.hostname !== '127.0.0.1' || url.port !== '5438' || url.pathname !== '/holiday_test' || url.searchParams.get('schema') !== 'holiday_audit_20260929') throw new Error('Dedicated local audit schema required');
  const db = new PrismaClient();
  try {
    const service = new HolidayService(db, {});
    const owner = await db.user.create({ data: { email: randomUUID() + '@audit.test', displayName: 'audit', passwordHash: 'not-loginable', role: 'ADMIN' } });
    const code = await db.referralCode.create({ data: { ownerId: owner.id, code: randomUUID().slice(0, 8).toUpperCase() } });
    const defaults = await service.defaults();
    const setup = { ...defaults, enabled: true, startsAt: new Date(Date.now() - 60000).toISOString(), config: { ...defaults.config, offers: [], prizes: [{ cents: 50, count: 5 }] } };
    await service.save(setup, owner.id);
    const onboarding = new MemberOnboardingService(db, { getReferralConfig: () => Promise.resolve({ enabled: true, inviteOnlyRegistration: false, inviterRewardBasisPoints: 0, inviteeRewardBytes: '0' }) });
    const register = () => onboarding.createEmailMember({ email: randomUUID() + '@audit.test', displayName: 'audit invite', passwordHash: 'not-loginable', inviteCode: code.code });
    await register();
    await service.draw(owner.id, randomUUID());
    const before = (await service.view()).campaign;
    await service.save({ ...setup, revision: before.revision }, owner.id);
    const after = (await service.view()).campaign;
    console.log(JSON.stringify({ probe: 'save_after_invite_draw', beforeStock: before.prizes[0].count, afterStock: after.prizes[0].count, paidEntries: await db.holidayEntry.count() }));
    const concurrent = await Promise.allSettled(Array.from({ length: 6 }, register));
    console.log(JSON.stringify({ probe: 'six_concurrent_invite_registrations', succeeded: concurrent.filter(r => r.status === 'fulfilled').length, failures: concurrent.filter(r => r.status === 'rejected').map(r => r.reason.code || r.reason.constructor.name) }));
    const buyer = await db.user.create({ data: { email: randomUUID() + '@audit.test', displayName: 'capacity audit', passwordHash: 'not-loginable', balanceCents: 2147481647 } });
    const view = await service.view(buyer.id);
    const entry = await holidayTransaction(db, tx => service.prepare(tx, buyer.id, { kind: 'TOPUP', tierId: '26', paymentType: 'alipay', revision: view.campaign.revision, expectedPriceCents: 2600, expectsDraw: view.campaign.canEarnDraw, immediateConfirmed: false }, randomUUID()));
    try {
      await holidayTransaction(db, tx => service.fulfill(tx, entry, { id: 'audit', expiresAt: new Date(Date.now() + 60000) }, 'audit-trade', new Date()));
      console.log(JSON.stringify({ probe: 'wallet_integer_capacity', result: 'fulfilled' }));
    } catch (error) {
      console.log(JSON.stringify({ probe: 'wallet_integer_capacity', code: error.code, compensable: error instanceof PaymentFulfillmentRejectedError }));
    }
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
