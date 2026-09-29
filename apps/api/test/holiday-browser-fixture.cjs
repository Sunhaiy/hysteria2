// Local-only manual browser fixture. Never accepts a remote or production database.
const {PrismaClient}=require('@prisma/client');
const {hash}=require('bcryptjs');
const {HolidayService}=require('../dist/src/holiday/holiday.service');
async function main(){
  const url=new URL(process.env.DATABASE_URL||'');
  if(url.hostname!=='127.0.0.1'||url.pathname!=='/holiday_test')throw new Error('Requires isolated holiday_test');
  const db=new PrismaClient();
  try {
    await db.holidayEntry.deleteMany();await db.holidayCampaign.deleteMany();
    const passwordHash=await hash('HolidayLocal!2026',10);
    for(const [email,role] of [['holiday-admin@example.test','ADMIN'],['holiday-member@example.test','MEMBER']]){
      await db.user.upsert({where:{email},create:{email,displayName:'节日活动本地验收',role,passwordHash,balanceCents:50000},update:{passwordHash}});
    }
    const service=new HolidayService(db,{});
    const defaults=await service.defaults();
    // Deduplicate fixtures created by separate isolated test runs.
    const seen=new Set();defaults.config.offers=defaults.config.offers.filter(o=>{const key=o.name+o.billingPeriod;if(seen.has(key))return false;seen.add(key);return true;});
    const admin=await db.user.findUniqueOrThrow({where:{email:'holiday-admin@example.test'}});
    await service.save({...defaults,enabled:true,startsAt:new Date(Date.now()-60000).toISOString()},admin.id);
    console.log('Local browser fixture ready. Accounts: holiday-admin@example.test / holiday-member@example.test');
  }finally{await db.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
