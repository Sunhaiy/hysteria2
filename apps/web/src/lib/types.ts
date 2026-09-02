export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "member";
  status: "active" | "suspended" | "banned";
  notes?: string | null;
  balanceCents?: number;
  createdAt: string;
  updatedAt: string;
  primaryAccessTokenPreview?: string | null;
  primaryAccessTokenLastUsedAt?: string | null;
  primaryAccessToken?: string;
  trafficMultiplier?: number;
  remainingBytes?: number;
  activePlanNames?: string[];
  activeTrafficPackCount?: number;
  quotaState?: "available" | "low" | "exhausted";
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SessionPayload {
  user: SessionUser;
  role: "admin" | "member";
  scope: "admin" | "portal";
}

export interface LoginResponse {
  principal: {
    sub: string;
    role: "admin" | "member";
    email: string;
    displayName: string;
    jti: string;
    sessionVersion: number;
  };
  user: SessionUser;
}

export type AdminUser = SessionUser;

export type AdminUserAccessResponse = PortalAccessResponse;

export interface AdminCreateUserResponse extends AdminUser {
  primaryAccessToken?: string;
  provisionedSubscriptionId?: string | null;
  provisionedAccess?: PortalAccessResponse | null;
}

export interface PlanRecord {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  active: boolean;
  trafficBytes: number;
  durationDays: number;
  speedUpMbps: number;
  speedDownMbps: number;
  deviceLimit: number;
  priceCents: number;
  accent: string;
  createdAt: string;
  updatedAt: string;
  boundNodes: string[];
  bindings: Array<{
    id: string;
    nodeId: string;
    nodeLabel: string;
    priority: number;
  }>;
}

export interface TrafficPackProductRecord {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  active: boolean;
  trafficBytes: number;
  validityDays?: number | null;
  accessProfileId?: string | null;
  accessProfileName?: string | null;
  priceCents: number;
  accent: string;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccessProfileRecord {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  active: boolean;
  speedUpMbps: number;
  speedDownMbps: number;
  deviceLimit: number;
  nodes: Array<{
    bindingId: string;
    nodeId: string;
    nodeLabel: string;
    active: boolean;
    priority: number;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface PlanOfferRecord {
  id: string;
  planId: string;
  slug: string;
  name: string;
  active: boolean;
  isDefault: boolean;
  billingPeriod: "monthly" | "quarterly" | "yearly" | "one_time" | "legacy";
  intervalMonths?: number | null;
  legacyDurationDays?: number | null;
  priceCents: number;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogResponse {
  plans: Array<{
    id: string;
    slug: string;
    name: string;
    description?: string | null;
    active: boolean;
    monthlyTrafficBytes: number;
    accent: string;
    accessProfileId?: string | null;
    accessProfile?: AccessProfileRecord | null;
    offers: PlanOfferRecord[];
    createdAt: string;
    updatedAt: string;
  }>;
  trafficPacks: Array<
    TrafficPackProductRecord & {
      accessProfileName?: string | null;
    }
  >;
  accessProfiles: AccessProfileRecord[];
}

export interface DestinationTelemetryStatus {
  enabled: boolean;
  nodes: Array<{
    id: string;
    label: string;
    protocol: "hysteria2" | "vless_reality";
    enabled: boolean;
    version?: string | null;
    lastAt?: string | null;
    error?: string | null;
    ready: boolean;
  }>;
}

export interface DestinationVisitRecord {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  nodeId: string;
  nodeLabel: string;
  protocol: "hysteria2" | "vless_reality";
  bucketStart: string;
  target: string;
  targetType: "domain" | "ip";
  port: number;
  transport: "tcp" | "udp";
  connectionCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface DestinationVisitResponse {
  enabled: boolean;
  status: DestinationTelemetryStatus;
  items: DestinationVisitRecord[];
  nextCursor: string | null;
  total: number;
}

export type AdminPermissionName =
  | "destination_audit.read"
  | "admin_permissions.manage";

export interface AdminPermissionRecord {
  userId: string;
  email: string;
  displayName: string;
  permissions: AdminPermissionName[];
}

export interface PlanBindingRecord {
  id: string;
  planId: string;
  planName: string;
  nodeId: string;
  nodeLabel: string;
  priority: number;
  createdAt: string;
}

export interface NodeRecord {
  id: string;
  serverId?: string | null;
  protocol: "hysteria2" | "vless_reality";
  label: string;
  hostname: string;
  port: number;
  portHoppingEnabled?: boolean;
  portHoppingStart?: number | null;
  portHoppingEnd?: number | null;
  portHoppingIntervalSeconds?: number;
  obfsPassword?: string | null;
  sni?: string | null;
  pinSHA256?: string | null;
  allowInsecureTls: boolean;
  realityPublicKey?: string | null;
  realityShortId?: string | null;
  realityFingerprint?: string | null;
  realitySpiderX?: string | null;
  vlessFlow?: string | null;
  trafficApiBaseUrl: string;
  trafficApiSecretSet?: boolean;
  active: boolean;
  speedUpMbps: number;
  speedDownMbps: number;
  monitoringStatus: "online" | "stale" | "error" | "unknown" | "disabled";
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
  concurrentUsers: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionRecord {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  planId: string;
  planName: string;
  planOfferId?: string | null;
  offerName?: string | null;
  billingPeriod?: "monthly" | "quarterly" | "yearly" | "one_time" | "legacy";
  nodeId: string;
  nodeLabel: string;
  status: "active" | "expired" | "paused" | "canceled";
  startsAt: string;
  endsAt: string;
  includedTrafficBytes: number;
  bonusTrafficBytes: number;
  consumedTrafficBytes: number;
  speedUpMbpsSnapshot: number;
  speedDownMbpsSnapshot: number;
  deviceLimitSnapshot: number;
  trafficRemainingBytes: number;
  trafficMultiplier?: number;
  quotaState?: "available" | "low" | "exhausted";
  currentCycle?: {
    id: string;
    startsAt: string;
    endsAt: string;
    overageBytes: number;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManualOrderRecord {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  processedById?: string | null;
  processedByEmail?: string | null;
  planId?: string | null;
  planName?: string | null;
  trafficPackProductId?: string | null;
  trafficPackProductName?: string | null;
  status: "pending" | "applied" | "void";
  kind: "renewal" | "traffic_pack" | "manual_credit";
  source?: "legacy" | "admin" | "wallet" | "cdk" | "payment";
  amountCents: number;
  basePriceCents?: number | null;
  discountCents?: number;
  currency?: string;
  productSlugSnapshot?: string | null;
  productNameSnapshot?: string | null;
  durationDays?: number | null;
  validityDays?: number | null;
  trafficBytes?: number | null;
  entitlementExpiresAt?: string | null;
  idempotencyKey?: string | null;
  note?: string | null;
  createdAt: string;
  processedAt?: string | null;
}

export interface RedemptionCodeRecord {
  id: string;
  code: string;
  label: string;
  kind: "plan" | "traffic_pack" | "balance" | "discount";
  status: "active" | "redeemed" | "void" | "expired";
  planId?: string | null;
  planName?: string | null;
  catalogOfferId?: string | null;
  catalogOfferName?: string | null;
  planMode?: "renew" | "replace";
  trafficPackProductId?: string | null;
  trafficPackProductName?: string | null;
  trafficBytes?: number | null;
  amountCents: number;
  discountPercent?: number | null;
  discountCents?: number | null;
  maxUses: number;
  usedCount: number;
  note?: string | null;
  expiresAt?: string | null;
  createdById?: string | null;
  createdByEmail?: string | null;
  redeemedById?: string | null;
  redeemedByEmail?: string | null;
  redeemedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RedemptionUseRecord {
  id: string;
  userId: string;
  userEmail?: string | null;
  userDisplayName?: string | null;
  orderId?: string | null;
  redeemedAt: string;
}

export interface WalletResponse {
  balanceCents: number;
  transactions: Array<{
    id: string;
    amountCents: number;
    kind: string;
    note?: string | null;
    createdAt: string;
  }>;
}

type PurchaseQuoteBase = {
  productId: string;
  productName: string;
  basePriceCents: number;
  discountCents: number;
  discountLabel?: string | null;
  finalPriceCents: number;
  balanceCents: number;
  sufficient: boolean;
};

export type PurchaseQuote =
  | (PurchaseQuoteBase & { kind: "plan" })
  | (PurchaseQuoteBase & { kind: "plan_offer" })
  | (PurchaseQuoteBase & { kind: "traffic_pack" });

export interface UsageRollupRecord {
  id: string;
  userId: string;
  userEmail: string;
  subscriptionId: string;
  nodeId: string;
  nodeLabel: string;
  bucketStart: string;
  txBytes: number;
  rxBytes: number;
  source: string;
  createdAt: string;
}

export interface UsageSummaryResponse {
  totals: {
    txBytes: number;
    rxBytes: number;
    totalBytes: number;
    recordCount: number;
    last24HoursBytes: number;
    last7DaysBytes: number;
  };
  daily: Array<{
    date: string;
    txBytes: number;
    rxBytes: number;
    totalBytes: number;
  }>;
  nodes: Array<{
    nodeId: string;
    nodeLabel: string;
    active: boolean;
    txBytes: number;
    rxBytes: number;
    totalBytes: number;
    recordCount: number;
    lastSeenAt?: string | null;
  }>;
  users: Array<{
    userId: string;
    userEmail: string;
    userDisplayName: string;
    txBytes: number;
    rxBytes: number;
    totalBytes: number;
    recordCount: number;
    lastSeenAt?: string | null;
  }>;
}

export interface SessionRecord {
  userId: string;
  userEmail: string;
  nodeId: string;
  nodeLabel: string;
  concurrentClients: number;
  capturedAt: string;
}

export interface AuthEventRecord {
  id: string;
  userId?: string | null;
  userEmail?: string | null;
  accessTokenId?: string | null;
  tokenPreview?: string | null;
  nodeId?: string | null;
  nodeLabel?: string | null;
  granted: boolean;
  reason: string;
  remoteAddr?: string | null;
  requestedTxBps?: number | null;
  submittedTokenPreview?: string | null;
  createdAt: string;
}

export interface PortalOverviewResponse {
  user: SessionUser;
  subscription: SubscriptionRecord;
  plan: Omit<PlanRecord, "boundNodes" | "bindings">;
  nodeLabel?: string | null;
  remainingBytes: number;
  balanceCents?: number;
  online: number;
  alerts: Array<{
    id: "traffic_80" | "traffic_95" | "traffic_100" | "subscription_expiry";
    kind: "traffic" | "expiry";
    severity: "warning" | "critical";
    title: string;
    message: string;
    actionHref: "/portal/plans";
  }>;
  packs: Array<{
    id: string;
    label: string;
    totalBytes: number;
    remainingBytes: number;
    status: "active" | "exhausted" | "expired";
    expiresAt?: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
}

export interface ReportingSummaryResponse {
  generatedAt: string;
  commerce: {
    walletRevenueCents: number;
    cdkEntitlementValueCents: number;
    appliedOrders: number;
    pendingOrders: number;
    voidOrders: number;
    completionRatePercent: number;
    discountCents: number;
    byKind: {
      plan: { orders: number; valueCents: number };
      trafficPack: { orders: number; valueCents: number };
    };
    refunds: { available: false };
    payments: { available: false };
  };
  nodes: {
    total: number;
    active: number;
    healthy: number;
    stale: number;
    error: number;
    availabilityPercent: number;
    maxSyncDelaySeconds?: number | null;
    pendingUsageBatches: number;
  };
}

export interface PortalUsageResponse {
  subscriptionId: string | null;
  consumedBytes: number;
  baseRemainingBytes: number;
  packRemainingBytes: number;
  totalRemainingBytes: number;
  recent: Array<{
    id: string;
    userId: string;
    subscriptionId: string | null;
    nodeId: string;
    nodeLabel: string;
    bucketStart: string;
    txBytes: number;
    rxBytes: number;
    source: string;
    createdAt: string;
  }>;
}

export interface PortalAccessResponse {
  token: string;
  uri: string;
  qrCode: string;
  subscriptionUrl: string;
  subscriptionQrCode: string;
  mihomoSubscriptionUrl: string;
  mihomoSubscriptionQrCode: string;
  configSnippet: string;
  nodeLabel: string;
  protocol: "hysteria2" | "vless_reality";
  expiresAt: string;
  trafficRemaining: number;
  subscriptionPath: string;
  mihomoSubscriptionPath: string;
  subscriptionStatus: "active";
  nodes: Array<{
    id: string;
    label: string;
    protocol: "hysteria2" | "vless_reality";
    uri: string;
  }>;
}

export interface PortalRedeemResponse {
  code: RedemptionCodeRecord;
  order: ManualOrderRecord | null;
  balanceCents?: number;
  overview: PortalOverviewResponse | null;
  access: PortalAccessResponse | null;
}
