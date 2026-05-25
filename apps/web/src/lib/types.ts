export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "member";
  status: "active" | "suspended" | "banned";
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  primaryAccessTokenPreview?: string | null;
  primaryAccessTokenLastUsedAt?: string | null;
  primaryAccessToken?: string;
}

export interface SessionPayload {
  user: SessionUser;
  role: "admin" | "member";
  scope: "admin" | "portal";
}

export interface LoginResponse {
  accessToken: string;
  principal: {
    sub: string;
    role: "admin" | "member";
    email: string;
    displayName: string;
    jti: string;
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

export interface NodeGroupRecord {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  active: boolean;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
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
  boundNodeGroups: string[];
  bindings: Array<{
    id: string;
    nodeGroupId: string;
    nodeGroupName: string;
    priority: number;
  }>;
}

export interface PlanBindingRecord {
  id: string;
  planId: string;
  planName: string;
  nodeGroupId: string;
  nodeGroupName: string;
  priority: number;
  createdAt: string;
}

export interface NodeRecord {
  id: string;
  nodeGroupId: string;
  groupName: string;
  label: string;
  hostname: string;
  port: number;
  obfsPassword?: string | null;
  sni?: string | null;
  pinSHA256?: string | null;
  allowInsecureTls: boolean;
  trafficApiBaseUrl: string;
  trafficApiSecret: string;
  active: boolean;
  speedUpMbps: number;
  speedDownMbps: number;
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
  nodeGroupId: string;
  nodeGroupName: string;
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
  status: "pending" | "applied" | "void";
  kind: "renewal" | "traffic_pack" | "manual_credit";
  amountCents: number;
  durationDays?: number | null;
  trafficBytes?: number | null;
  note?: string | null;
  createdAt: string;
  processedAt?: string | null;
}

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
  plan: Omit<PlanRecord, "boundNodeGroups" | "bindings">;
  nodeLabel?: string | null;
  remainingBytes: number;
  online: number;
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

export interface PortalUsageResponse {
  subscriptionId: string;
  consumedBytes: number;
  baseRemainingBytes: number;
  packRemainingBytes: number;
  totalRemainingBytes: number;
  recent: Array<{
    id: string;
    userId: string;
    subscriptionId: string;
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
  configSnippet: string;
  nodeLabel: string;
  expiresAt: string;
  trafficRemaining: number;
}
