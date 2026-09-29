export interface HolidayConfig {
  inviteRewardCents?: number;
  tiers: { id: string; amountCents: number; giftCents: number }[];
  offers: {
    offerId: string;
    discountBasisPoints: number;
    name?: string;
    billingPeriod?: string;
  }[];
  prizes: { cents: number; count: number }[];
}
export interface HolidayCampaign {
  id: string;
  title: string;
  enabled: boolean;
  startsAt: string;
  endsAt: string;
  drawEndsAt: string;
  giftBudgetCents: number;
  reservedGiftCents: number;
  reservedDraws: number;
  revision: number;
  config: HolidayConfig;
  live: boolean;
  drawOpen: boolean;
  canEarnDraw: boolean;
  prizes: { cents: number; count: number; probability: number }[];
}
export interface HolidayOffer {
  offerId: string;
  name: string;
  billingPeriod: string;
  trafficBytes: string;
  originalPriceCents: number;
  priceCents: number;
}
export interface HolidayView {
  campaign: HolidayCampaign | null;
  offers: HolidayOffer[];
  drawAvailable: number;
  claimedTierIds: string[];
  drawRecords?: {
    id: string;
    source: string;
    prizeCents: number;
    drawnAt: string | null;
  }[];
  entries: {
    id: string;
    kind: string;
    tierId: string | null;
    orderId: string | null;
    attemptId: string | null;
    status: string;
    amountCents: number;
    giftCents: number;
    drawState: string;
    prizeCents: number;
    createdAt: string;
  }[];
}
export interface HolidayAdminView extends HolidayView {
  defaults: HolidayCampaign;
  stats: {
    externalReceiptsCents: number;
    topupPrincipalCents: number;
    giftCents: number;
    walletConsumptionCents: number;
    planSalesCents: number;
    prizeCents: number;
    refundedCents: number;
    inviteCashCents: number;
    inviteManualReview: {
      id: string;
      inviterId: string;
      inviteeId: string;
      sourceOrderId: string | null;
      amountCents: number;
      reviewReason: string | null;
    }[];
    manualReview: { id: string; orderId: string; reviewReason: string }[];
  };
}
export const holidayStatus: Record<string, string> = {
  RESERVED: "等待付款 / 核验",
  APPLIED: "已到账",
  CLOSED: "已关闭",
  REFUNDED: "已退款",
  REFUND_PENDING: "原路退款处理中",
};
