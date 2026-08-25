export interface NavItem {
  href: string;
  label: string;
  icon: string;
  meta: string;
}

export const adminNav: NavItem[] = [
  { href: "/admin", label: "总览", icon: "space_dashboard", meta: "OPS" },
  { href: "/admin/customers", label: "客户", icon: "group", meta: "CRM" },
  { href: "/admin/catalog", label: "商品中心", icon: "stacks", meta: "SKU" },
  {
    href: "/admin/redemption-codes",
    label: "CDK",
    icon: "redeem",
    meta: "CODE",
  },
  { href: "/admin/finance", label: "财务中心", icon: "payments", meta: "FIN" },
  {
    href: "/admin/operations",
    label: "运营中心",
    icon: "monitoring",
    meta: "OPS",
  },
  { href: "/admin/nodes", label: "服务器节点", icon: "hub", meta: "NODE" },
  { href: "/admin/tutorials", label: "教程管理", icon: "book", meta: "DOC" },
  { href: "/admin/tickets", label: "工单", icon: "mail", meta: "SUP" },
  { href: "/admin/audit", label: "审计", icon: "shield", meta: "AUDIT" },
  { href: "/admin/settings", label: "设置", icon: "settings", meta: "CONF" },
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
