// Local preview only: preserve all orders, participation and reserved budget.
const { PrismaClient } = require('@prisma/client');
const { HolidayService } = require('../dist/src/holiday/holiday.service');
async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.hostname !== '127.0.0.1' || url.port !== '5438' || url.pathname !== '/holiday_test') throw new Error('Requires isolated holiday_test on port 5438');
  const db = new PrismaClient();
  try {
    const defaults = await new HolidayService(db, {}).defaults();
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'holiday-admin@example.test' } });
    await db.$transaction(async tx => {
      const before = await tx.holidayCampaign.findUniqueOrThrow({ where: { id: defaults.id } });
      const after = await tx.holidayCampaign.update({
        where: { id: defaults.id, revision: before.revision },
        data: { config: { ...before.config, tiers: defaults.config.tiers }, revision: { increment: 1 } },
      });
      await tx.auditLog.create({ data: { actorId: admin.id, action: 'HOLIDAY_LOCAL_PREVIEW_TIERS_UPDATED', targetType: 'HolidayCampaign', targetId: before.id, metadata: { before: before.config, after: after.config } } });
    });
    console.log('Local preview tiers updated; existing payment snapshots and balances preserved.');
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
