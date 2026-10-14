// Run against an isolated local schema after prisma db push and API build.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const url=new URL(process.env.DATABASE_URL||'');
assert(['127.0.0.1','localhost'].includes(url.hostname)&&url.searchParams.get('schema')==='upgrade_test','Only isolated local upgrade_test schema is allowed');
const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();
const {CommerceService}=require('../dist/src/commerce/commerce.service');
const {EntitlementService}=require('../dist/src/entitlement/entitlement.service');
const {SecretCipherService}=require('../dist/src/security/secret-cipher.service');
const {PaymentAttemptLifecycleService}=require('../dist/src/payments/payment-attempt-lifecycle.service');
const {EpayService}=require('../dist/src/epay/epay.service');
const {FinanceService}=require('../dist/src/finance/finance.service');
process.env.SETTINGS_ENCRYPTION_KEY=Buffer.alloc(32,9).toString('base64');
const cipher=new SecretCipherService();cipher.onModuleInit();const entitlements=new EntitlementService(db),lifecycle=new PaymentAttemptLifecycleService();
const commerce=new CommerceService(db,{},entitlements,undefined,lifecycle,cipher);
const settings={getEpayConfig:async()=>({checkoutMode:'epay',configured:true,gatewayUrl:'https://example.invalid',merchantId:'test',merchantKey:'isolated-test-key'})};
const epay=new EpayService(db,settings,commerce,cipher,undefined,undefined,lifecycle);
const suffix=randomUUID(),GiB=1024n**3n;
const now=new Date(),startsAt=new Date(Date.UTC(now.getUTCFullYear(),0,1)),endsAt=new Date(Date.UTC(now.getUTCFullYear()+1,0,1));
const cycleStart=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)),cycleEnd=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1));
async function setup(){
 const node=await db.node.findFirst({where:{hostname:'127.0.0.1',port:9}})??await db.node.create({data:{label:'upgrade-fixture-'+suffix,hostname:'127.0.0.1',port:9,trafficApiBaseUrl:'http://127.0.0.1:9',trafficApiSecret:'fixture',speedUpMbps:100,speedDownMbps:100}});
 const result=[];
 for(const [name,traffic,price] of [['Boost',150n,15000],['Plus',250n,24000],['Prime',500n,40000]]){
  const profile=await db.accessProfile.create({data:{slug:name+suffix,name,speedUpMbps:100,speedDownMbps:100,deviceLimit:5,nodeBindings:{create:{nodeId:node.id}}}});
  const plan=await db.plan.create({data:{slug:name+suffix,name,trafficBytes:traffic*GiB,durationDays:365,speedUpMbps:100,speedDownMbps:100,deviceLimit:5,priceCents:price,accessProfileId:profile.id}});
  const product=await db.catalogProduct.create({data:{slug:name+suffix,name,kind:'PLAN',series:'STANDARD',status:'ACTIVE',quotaCadence:'MONTHLY_RESET',legacyPlanId:plan.id,accessProfileId:profile.id}});
  const offer=await db.catalogOffer.create({data:{productId:product.id,slug:name+suffix,name:'年付',billingPeriod:'YEARLY',intervalMonths:12,priceCents:price,trafficBytes:traffic*GiB}});
  result.push({node,profile,plan,product,offer});
 }
 return result;
}
async function member(source){
 const user=await db.user.create({data:{email:randomUUID()+'@upgrade.invalid',displayName:'Local upgrade fixture',passwordHash:'not-a-real-login',balanceCents:100000}});
 const account=await db.accessAccount.create({data:{userId:user.id}});
 const sub=await db.subscription.create({data:{userId:user.id,planId:source.plan.id,nodeId:source.node.id,accessAccountId:account.id,startsAt,endsAt,includedTrafficBytes:150n*GiB,consumedTrafficBytes:80n*GiB,speedUpMbpsSnapshot:100,speedDownMbpsSnapshot:100,deviceLimitSnapshot:5}});
 const grant=await db.entitlementGrant.create({data:{userId:user.id,accessAccountId:account.id,productId:source.product.id,offerId:source.offer.id,legacySubscriptionId:sub.id,kind:'PLAN',startsAt,endsAt,accessProfileId:source.profile.id,speedUpMbpsSnapshot:100,speedDownMbpsSnapshot:100,deviceLimitSnapshot:5,quotaCadenceSnapshot:'MONTHLY_RESET',resetAnchorAt:startsAt,trafficBytesSnapshot:150n*GiB,priceCentsSnapshot:15000}});
 const bucket=await db.quotaBucket.create({data:{grantId:grant.id,kind:'PLAN_CYCLE',startsAt:cycleStart,endsAt:cycleEnd,grantedBytes:170n*GiB,consumedBytes:80n*GiB}});
 await db.subscriptionCycle.create({data:{subscriptionId:sub.id,startsAt:cycleStart,endsAt:cycleEnd,grantedBytes:150n*GiB,consumedBytes:80n*GiB,adjustmentBytes:20n*GiB}});
 const order=await db.manualOrder.create({data:{userId:user.id,kind:'RENEWAL',source:'PAYMENT',status:'APPLIED',amountCents:10000,catalogOfferId:source.offer.id,planId:source.plan.id,entitlementGrantId:grant.id,billingPeriodSnapshot:'YEARLY',intervalMonthsSnapshot:12,entitlementExpiresAt:endsAt,processedAt:startsAt,note:'PLAN_ACTIVATION:initial'}});
 return {user,sub,grant,bucket,order};
}
async function verify(m,target,payable,wallet){
 const g=await db.entitlementGrant.findUniqueOrThrow({where:{id:m.grant.id}});assert.equal(g.productId,target.product.id);assert.equal(g.endsAt.toISOString(),endsAt.toISOString());assert.equal(g.startsAt.toISOString(),startsAt.toISOString());
 const b=await db.quotaBucket.findUniqueOrThrow({where:{id:m.bucket.id}});assert.equal(b.consumedBytes,80n*GiB);assert.equal(b.grantedBytes,270n*GiB);
 const u=await db.user.findUniqueOrThrow({where:{id:m.user.id}});assert.equal(u.balanceCents,100000-(wallet?payable:0));
 assert.equal(await db.entitlementGrant.count({where:{userId:m.user.id,kind:'PLAN',status:'ACTIVE'}}),1);
 const cycle=await db.subscriptionCycle.findFirstOrThrow({where:{subscriptionId:m.sub.id}});assert.equal(cycle.consumedBytes,80n*GiB);assert.equal(cycle.grantedBytes+cycle.adjustmentBytes,270n*GiB);
}
(async()=>{
 const [source,target,higher]=await setup();
 const m=await member(source),q=await commerce.quoteCheckout(m.user.id,{offerId:target.offer.id,purchaseAction:'plan_upgrade'}),input={offerId:target.offer.id,purchaseAction:'plan_upgrade',upgradeQuoteToken:q.upgradeQuoteToken};
 const results=await Promise.all([commerce.checkout(m.user.id,input,'same-key'),commerce.checkout(m.user.id,input,'same-key')]);assert.equal(results[0].orderId,results[1].orderId);await verify(m,target,q.finalPriceCents,true);
 assert.equal(await db.walletLedgerEntry.count({where:{userId:m.user.id,kind:'PURCHASE'}}),1);
 await assert.rejects(commerce.checkout(m.user.id,input,'different-key'),/变化/);
 const next=await commerce.quoteCheckout(m.user.id,{offerId:higher.offer.id,purchaseAction:'plan_upgrade'});assert(next.finalPriceCents>0);assert(next.upgradeQuote.creditCents>=q.upgradeQuote.targetRemainingCents-1);
 console.log('PASS real PostgreSQL wallet concurrency, idempotency, used quota and repeat-upgrade valuation');
 await assert.rejects(new FinanceService(db).createRefund(m.order.id,{amountCents:100,method:'wallet',reason:'local-test'},m.user.id),/合并人工/);
 await assert.rejects(new FinanceService(db).createRefund(results[0].orderId,{amountCents:100,method:'wallet',reason:'local-test'},m.user.id),/合并人工/);
 const racing=await member(source),rq=await commerce.quoteCheckout(racing.user.id,{offerId:target.offer.id,purchaseAction:'plan_upgrade'}),ri={offerId:target.offer.id,purchaseAction:'plan_upgrade',upgradeQuoteToken:rq.upgradeQuoteToken};
 const race=await Promise.allSettled([commerce.checkout(racing.user.id,ri,'race-1'),commerce.checkout(racing.user.id,ri,'race-2')]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);await verify(racing,target,rq.finalPriceCents,true);
 const poor=await member(source);await db.user.update({where:{id:poor.user.id},data:{balanceCents:0}});const pq=await commerce.quoteCheckout(poor.user.id,{offerId:target.offer.id,purchaseAction:'plan_upgrade'});
 await assert.rejects(commerce.checkout(poor.user.id,{offerId:target.offer.id,purchaseAction:'plan_upgrade',upgradeQuoteToken:pq.upgradeQuoteToken},'poor'),/balance/i);
 assert.equal(await db.manualOrder.count({where:{userId:poor.user.id}}),1);assert.equal((await db.quotaBucket.findUniqueOrThrow({where:{id:poor.bucket.id}})).grantedBytes,170n*GiB);
 console.log('PASS competing orders charge once, insufficient balance rolls back, linked refunds require review');
 for(const channel of ['alipay','wxpay']){
  const m=await member(source),q=await commerce.quoteCheckout(m.user.id,{offerId:target.offer.id,purchaseAction:'plan_upgrade'});
  const payment=await epay.createPayment(m.user.id,target.offer.id,'epay-key',undefined,channel,'plan_upgrade',undefined,q.upgradeQuoteToken);
  const attempt=await db.epayPaymentAttempt.findUniqueOrThrow({where:{id:payment.id}});
  const callback={merchantOrderNo:attempt.merchantOrderNo,gatewayTradeNo:randomUUID(),amountCents:attempt.amountCents,paymentType:channel,paidAt:new Date()};
  await epay.settleVerifiedPayment(callback);await epay.settleVerifiedPayment(callback);await verify(m,target,q.finalPriceCents,false);
  const settled=await db.epayPaymentAttempt.findUniqueOrThrow({where:{id:attempt.id}});assert.equal(settled.fulfillmentStatus,'APPLIED');
  assert.equal((await epay.createPayment(m.user.id,target.offer.id,'epay-key',undefined,channel,'plan_upgrade',undefined,q.upgradeQuoteToken)).id,payment.id);
  await assert.rejects(epay.createPayment(m.user.id,target.offer.id,'epay-key',undefined,channel==='wxpay'?'alipay':'wxpay','plan_upgrade',undefined,q.upgradeQuoteToken));
  console.log('PASS '+channel+' order creation, verified settlement, callback replay and immutable selection');
 }
 const c=await member(source),cq=await commerce.quoteCheckout(c.user.id,{offerId:target.offer.id,purchaseAction:'plan_upgrade'});
 const cp=await epay.createPayment(c.user.id,target.offer.id,'conflict',undefined,'alipay','plan_upgrade',undefined,cq.upgradeQuoteToken);
 const ca=await db.epayPaymentAttempt.findUniqueOrThrow({where:{id:cp.id}});
 await db.entitlementGrant.update({where:{id:c.grant.id},data:{endsAt:new Date(+endsAt+86400000)}});
 await epay.settleVerifiedPayment({merchantOrderNo:ca.merchantOrderNo,gatewayTradeNo:randomUUID(),amountCents:ca.amountCents,paymentType:'alipay',paidAt:new Date()});
 const rejected=await db.epayPaymentAttempt.findUniqueOrThrow({where:{id:ca.id}});assert.equal(rejected.fulfillmentStatus,'REFUND_PENDING');assert.equal(rejected.orderId,null);
 console.log('PASS changed entitlement after payment creation enters compensation, without upgrade order');
 const late=await member(source),lq=await commerce.quoteCheckout(late.user.id,{offerId:target.offer.id,purchaseAction:'plan_upgrade'}),lp=await epay.createPayment(late.user.id,target.offer.id,'late',undefined,'wxpay','plan_upgrade',undefined,lq.upgradeQuoteToken),la=await db.epayPaymentAttempt.findUniqueOrThrow({where:{id:lp.id}});
 await epay.settleVerifiedPayment({merchantOrderNo:la.merchantOrderNo,gatewayTradeNo:randomUUID(),amountCents:la.amountCents,paymentType:'wxpay',paidAt:new Date(new Date(lq.upgradeQuote.expiresAt).getTime()+1000)});
 assert.equal((await db.epayPaymentAttempt.findUniqueOrThrow({where:{id:la.id}})).fulfillmentStatus,'REFUND_PENDING');
 console.log('PASS late payment cannot reuse expired upgrade quote');
 console.log('ALL LOCAL DATABASE CHECKS PASSED');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect());
