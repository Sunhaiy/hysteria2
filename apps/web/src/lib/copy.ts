export interface NavItem {
  href: string;
  label: string;
  icon: string;
  meta: string;
  group?: string;
}

export const adminNav: NavItem[] = [
  {
    href: "/admin",
    label: "总览",
    icon: "space_dashboard",
    meta: "OPS",
    group: "概览",
  },
  {
    href: "/admin/customers",
    label: "客户",
    icon: "group",
    meta: "CRM",
    group: "客户与支持",
  },
  {
    href: "/admin/tickets",
    label: "工单",
    icon: "mail",
    meta: "SUP",
    group: "客户与支持",
  },
  {
    href: "/admin/tutorials",
    label: "教程管理",
    icon: "book",
    meta: "DOC",
    group: "客户与支持",
  },
  {
    href: "/admin/referrals",
    label: "拉新管理",
    icon: "group_add",
    meta: "GROW",
    group: "客户与支持",
  },
  {
    href: "/admin/catalog",
    label: "商品中心",
    icon: "stacks",
    meta: "SKU",
    group: "商品与财务",
  },
  {
    href: "/admin/orders",
    label: "订单中心",
    icon: "receipt_long",
    meta: "ORDER",
    group: "商品与财务",
  },
  {
    href: "/admin/redemption-codes",
    label: "CDK",
    icon: "redeem",
    meta: "CODE",
    group: "商品与财务",
  },
  {
    href: "/admin/operations",
    label: "运营中心",
    icon: "monitoring",
    meta: "OPS",
    group: "节点运营",
  },
  {
    href: "/admin/nodes",
    label: "服务器节点",
    icon: "hub",
    meta: "NODE",
    group: "节点运营",
  },
  {
    href: "/admin/audit",
    label: "审计",
    icon: "shield",
    meta: "AUDIT",
    group: "系统",
  },
  {
    href: "/admin/backups",
    label: "数据备份",
    icon: "database",
    meta: "BACKUP",
    group: "系统",
  },
  {
    href: "/admin/settings",
    label: "设置",
    icon: "settings",
    meta: "CONF",
    group: "系统",
  },
];

export const portalNav: NavItem[] = [
  { href: "/portal", label: "总览", icon: "account_circle", meta: "HOME" },
  {
    href: "/portal/plans",
    label: "套餐与流量包",
    icon: "stacks",
    meta: "SHOP",
  },
  { href: "/portal/redeem", label: "兑换中心", icon: "redeem", meta: "CDK" },
  {
    href: "/portal/access",
    label: "接入信息",
    icon: "qr_code_2",
    meta: "CLASH",
  },
  { href: "/portal/tutorial", label: "使用教程", icon: "book", meta: "GUIDE" },
  { href: "/portal/tickets", label: "我的工单", icon: "mail", meta: "HELP" },
  {
    href: "/portal/referrals",
    label: "邀请奖励",
    icon: "group_add",
    meta: "INVITE",
  },
  {
    href: "/portal/usage",
    label: "流量使用",
    icon: "network_node",
    meta: "FLOW",
  },
  { href: "/portal/orders", label: "订单记录", icon: "payments", meta: "BILL" },
];

export const homeCopy = {
  title: "Hysteria 2 多用户控制台",
  description:
    "面向运维的高密度工具界面，覆盖套餐、节点、订阅、流量与 Hysteria 2 / VLESS 接入信息。",
  adminHint: "本地开发 seed 管理员：ops@hysteria.local / admin123!",
  memberHint: "本地开发 seed 会员：lin@example.com / member123!",
};
