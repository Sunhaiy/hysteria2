export type UserRole = 'admin' | 'member';
export type UserStatus = 'active' | 'suspended' | 'banned';
export type SubscriptionStatus = 'active' | 'expired' | 'paused' | 'canceled';
export type TrafficPackStatus = 'active' | 'exhausted' | 'expired';
export type ManualOrderStatus = 'pending' | 'applied' | 'void';
export type ManualOrderKind = 'renewal' | 'traffic_pack' | 'manual_credit';

export interface User {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  plainPassword?: string;
  role: UserRole;
  status: UserStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccessToken {
  id: string;
  userId: string;
  label: string;
  token: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string;
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
}

export interface Node {
  id: string;
  label: string;
  hostname: string;
  port: number;
  obfsPassword?: string;
  sni?: string;
  pinSHA256?: string;
  allowInsecureTls: boolean;
  trafficApiBaseUrl: string;
  trafficApiSecret: string;
  active: boolean;
  speedUpMbps: number;
  speedDownMbps: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlanBinding {
  id: string;
  planId: string;
  nodeId: string;
  priority: number;
  createdAt: string;
}

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  nodeId: string;
  status: SubscriptionStatus;
  startsAt: string;
  endsAt: string;
  includedTrafficBytes: number;
  bonusTrafficBytes: number;
  consumedTrafficBytes: number;
  speedUpMbpsSnapshot: number;
  speedDownMbpsSnapshot: number;
  deviceLimitSnapshot: number;
  createdAt: string;
  updatedAt: string;
}

export interface TrafficPack {
  id: string;
  userId: string;
  subscriptionId: string;
  label: string;
  totalBytes: number;
  remainingBytes: number;
  status: TrafficPackStatus;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManualOrder {
  id: string;
  userId: string;
  processedById?: string;
  status: ManualOrderStatus;
  kind: ManualOrderKind;
  amountCents: number;
  durationDays?: number;
  trafficBytes?: number;
  note?: string;
  createdAt: string;
  processedAt?: string;
}

export interface AuthEvent {
  id: string;
  userId?: string;
  accessTokenId?: string;
  nodeId?: string;
  granted: boolean;
  reason: string;
  remoteAddr?: string;
  requestedTxBps?: number;
  submittedTokenPreview?: string;
  createdAt: string;
}

export interface UsageRollup {
  id: string;
  userId: string;
  subscriptionId: string;
  nodeId: string;
  bucketStart: string;
  txBytes: number;
  rxBytes: number;
  source: 'seed' | 'sync';
  createdAt: string;
}

export interface OnlineSnapshot {
  id: string;
  userId: string;
  nodeId: string;
  concurrentClients: number;
  capturedAt: string;
}

export interface ControlPlaneState {
  users: User[];
  accessTokens: AccessToken[];
  plans: Plan[];
  nodes: Node[];
  planBindings: PlanBinding[];
  subscriptions: Subscription[];
  trafficPacks: TrafficPack[];
  manualOrders: ManualOrder[];
  authEvents: AuthEvent[];
  usageRollups: UsageRollup[];
  onlineSnapshots: OnlineSnapshot[];
}
