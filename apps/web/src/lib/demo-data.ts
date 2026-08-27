const gb = 1024 * 1024 * 1024;

export const adminNav = [
  { href: "/admin", label: "仪表盘", icon: "space_dashboard", meta: "09" },
  { href: "/admin/users", label: "用户", icon: "group", meta: "128" },
  { href: "/admin/plans", label: "套餐", icon: "stacks", meta: "02" },
  { href: "/admin/subscriptions", label: "订阅", icon: "subscription", meta: "118" },
  { href: "/admin/nodes", label: "节点", icon: "hub", meta: "03" },
  { href: "/admin/orders", label: "人工订单", icon: "receipt_long", meta: "16" },
  { href: "/admin/usage", label: "用量日志", icon: "monitoring", meta: "24h" },
  { href: "/admin/sessions", label: "会话控制", icon: "shield_person", meta: "07" },
];

export const portalNav = [
  { href: "/portal", label: "总览", icon: "account_circle", meta: "01" },
  { href: "/portal/access", label: "接入信息", icon: "qr_code_2", meta: "CLASH" },
  { href: "/portal/usage", label: "流量使用", icon: "network_node", meta: "48%" },
  { href: "/portal/orders", label: "续期记录", icon: "payments", meta: "03" },
];

export const adminMetrics = [
  { label: "活跃订阅", value: "118", footnote: "过去 24h 新增 6" },
  { label: "活跃连接", value: "276", footnote: "Core 档位占 64%" },
  { label: "当月入账", value: "¥42,680", footnote: "人工订单 16 笔" },
  { label: "节点利用率", value: "72%", footnote: "HK-01 Core 峰值 84%" },
];

export const adminUsers = [
  {
    id: "usr_lin",
    name: "Lin",
    email: "lin@example.com",
    plan: "Core 200",
    status: "正常",
    statusTone: "success",
    expiresAt: "2026-06-11T23:55:00.000Z",
    trafficRemaining: 149 * gb,
    devices: "2 / 3",
    tokenPreview: "hy2_li...mary",
  },
  {
    id: "usr_zhou",
    name: "Zhou",
    email: "zhou@example.com",
    plan: "Pro 500",
    status: "暂停",
    statusTone: "warn",
    expiresAt: "2026-06-03T23:55:00.000Z",
    trafficRemaining: 485 * gb,
    devices: "1 / 5",
    tokenPreview: "hy2_zh...mary",
  },
  {
    id: "usr_liu",
    name: "Liu",
    email: "liu@example.com",
    plan: "Core 200",
    status: "封禁",
    statusTone: "danger",
    expiresAt: "2026-05-28T23:55:00.000Z",
    trafficRemaining: 0.4 * gb,
    devices: "0 / 3",
    tokenPreview: "hy2_li...d8f0",
  },
];

export const adminPlans = [
  {
    name: "Core 200",
    slug: "core-200",
    speed: "20 / 120 Mbps",
    traffic: "200 GB + 15 GB bonus",
    devices: 3,
    price: "¥18.00",
    accent: "green",
    nodeGroup: "Core Tier",
  },
  {
    name: "Pro 500",
    slug: "pro-500",
    speed: "40 / 240 Mbps",
    traffic: "500 GB",
    devices: 5,
    price: "¥32.00",
    accent: "teal",
    nodeGroup: "Pro Tier",
  },
];

export const adminSubscriptions = [
  {
    user: "Lin",
    plan: "Core 200",
    nodeGroup: "Core Tier",
    status: "active",
    startsAt: "2026-05-12T23:55:00.000Z",
    endsAt: "2026-06-11T23:55:00.000Z",
    remaining: 149 * gb,
  },
  {
    user: "Zhou",
    plan: "Pro 500",
    nodeGroup: "Pro Tier",
    status: "paused",
    startsAt: "2026-05-04T23:55:00.000Z",
    endsAt: "2026-06-03T23:55:00.000Z",
    remaining: 485 * gb,
  },
];

export const adminNodes = [
  {
    label: "HK-01 Core :4431",
    group: "Core Tier",
    speed: "20 / 120 Mbps",
    onlineUsers: 76,
    authUrl: "/integrations/hysteria/auth?nodeId=node_hk_core",
    apiBase: "mock://hk-core",
  },
  {
    label: "SG-01 Core :4432",
    group: "Core Tier",
    speed: "20 / 120 Mbps",
    onlineUsers: 44,
    authUrl: "/integrations/hysteria/auth?nodeId=node_sg_core",
    apiBase: "mock://sg-core",
  },
  {
    label: "HK-02 Pro :5443",
    group: "Pro Tier",
    speed: "40 / 240 Mbps",
    onlineUsers: 31,
    authUrl: "/integrations/hysteria/auth?nodeId=node_hk_pro",
    apiBase: "mock://hk-pro",
  },
];

export const adminOrders = [
  {
    user: "Lin",
    kind: "traffic_pack",
    amount: "¥9.00",
    note: "May booster",
    processedAt: "2026-05-15T11:30:00.000Z",
  },
  {
    user: "Zhou",
    kind: "renewal",
    amount: "¥32.00",
    note: "Manual extension pending resume",
    processedAt: "2026-05-09T09:20:00.000Z",
  },
];

export const adminUsage = [
  {
    bucket: "05-22 23:55",
    user: "Lin",
    node: "HK-01 Core",
    tx: 0.12 * gb,
    rx: 0.48 * gb,
  },
  {
    bucket: "05-22 23:50",
    user: "Lin",
    node: "HK-01 Core",
    tx: 0.09 * gb,
    rx: 0.34 * gb,
  },
];

export const adminSessions = [
  {
    state: "ESTAB",
    auth: "usr_lin",
    node: "HK-01 Core",
    reqAddr: "example.com:443",
    tx: 3_937,
    rx: 4_441,
    lastActive: "1.8s",
  },
  {
    state: "ESTAB",
    auth: "usr_lin",
    node: "SG-01 Core",
    reqAddr: "github.com:443",
    tx: 1_812,
    rx: 8_302,
    lastActive: "620ms",
  },
];

export const authRules = [
  { method: "GET", route: "/api/admin/users", note: "运维列表" },
  { method: "POST", route: "/api/admin/orders/manual-credit", note: "人工入账" },
  { method: "POST", route: "/integrations/hysteria/auth", note: "Hysteria HTTP 鉴权" },
  { method: "GET", route: "/api/portal/access", note: "用户接入信息" },
];

export const portalOverview = {
  userName: "Lin",
  planName: "Core 200",
  expiresAt: "2026-06-11T23:55:00.000Z",
  onlineDevices: 2,
  deviceLimit: 3,
  totalQuota: 265 * gb,
  remainingQuota: 149 * gb,
  boosterRemaining: 34 * gb,
  nodeLabel: "HK-01 Core :4431",
};

export const portalUsage = [
  { day: "05-22", total: 1.42 * gb, upload: 0.31 * gb, download: 1.11 * gb },
  { day: "05-21", total: 3.18 * gb, upload: 0.77 * gb, download: 2.41 * gb },
  { day: "05-20", total: 2.44 * gb, upload: 0.56 * gb, download: 1.88 * gb },
];

export const portalAccess = {
  token: "hy2_live_lin_primary",
  uri: "hysteria2://hy2_live_lin_primary@hk-01.example.net:4431/?sni=edge.example.net&obfs=salamander&obfs-password=salty-core&pinSHA256=AA%3A11%3A22%3A33%3A44%3A55",
  nodeLabel: "HK-01 Core :4431",
  expiresAt: "2026-06-11T23:55:00.000Z",
  trafficRemaining: 149 * gb,
  configSnippet: `server: hk-01.example.net:4431
auth: hy2_live_lin_primary
tls:
  sni: edge.example.net
  pinSHA256: AA:11:22:33:44:55
bandwidth:
  up: 20 mbps
  down: 120 mbps
socks5:
  listen: 127.0.0.1:1080
http:
  listen: 127.0.0.1:8080`,
};

export const portalOrderHistory = [
  { kind: "traffic_pack", amount: "¥9.00", createdAt: "2026-05-15T11:30:00.000Z", note: "May booster" },
  { kind: "renewal", amount: "¥18.00", createdAt: "2026-05-01T08:10:00.000Z", note: "Core 200 monthly" },
  { kind: "traffic_pack", amount: "¥6.00", createdAt: "2026-04-18T14:04:00.000Z", note: "Emergency top-up" },
];
