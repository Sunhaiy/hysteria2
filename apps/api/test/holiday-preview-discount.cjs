// Refresh the local preview configuration without deleting participation history.
const { PrismaClient } = require('@prisma/client');
const { HolidayService } = require('../dist/src/holiday/holiday.service');
async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/holiday_test') throw new Error('Requires isolated holiday_test');
  const db = new PrismaClient();
  try {
    const service = new HolidayService(db, {});
    const defaults = await service.defaults();
    const current = await db.holidayCampaign.findUniqueOrThrow({ where: { id: defaults.id } });
    const seen = new Set();
    const offers = defaults.config.offers.filter((offer) => {
      const key = offer.name + offer.billingPeriod;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'holiday-admin@example.test' } });
    await service.save({ ...defaults, revision: current.revision, enabled: true,
      startsAt: new Date(Date.now() - 60000).toISOString(),
      config: { ...current.config, offers },
    }, admin.id);
    console.log('Local campaign refreshed to 80%; existing order snapshots preserved.');
  } finally { await db.$disconnect(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
