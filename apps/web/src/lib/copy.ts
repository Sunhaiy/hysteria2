export interface NavItem {
  href: string;
  label: string;
  icon: string;
  meta: string;
}

export const adminNav: NavItem[] = [
  { href: "/admin", label: "仪表盘", icon: "space_dashboard", meta: "OPS" },
  { href: "/admin/users", label: "用户", icon: "group", meta: "USER" },
  { href: "/admin/plans", label: "套餐", icon: "stacks", meta: "PLAN" },
  { href: "/admin/subscriptions", label: "订阅", icon: "subscription", meta: "SUB" },
  { href: "/admin/nodes", label: "节点", icon: "hub", meta: "NODE" },
  { href: "/admin/redemption-codes", label: "兑换码", icon: "redeem", meta: "CDK" },
  { href: "/admin/orders", label: "人工订单", icon: "receipt_long", meta: "BILL" },
  { href: "/admin/usage", label: "用量日志", icon: "monitoring", meta: "STAT" },
  { href: "/admin/sessions", label: "会话控制", icon: "shield_person", meta: "LIVE" },
  { href: "/admin/settings", label: "系统设置", icon: "settings", meta: "CONF" },
];

export const portalNav: NavItem[] = [
  { href: "/portal", label: "总览", icon: "account_circle", meta: "HOME" },
  { href: "/portal/plans", label: "套餐选择", icon: "stacks", meta: "PLAN" },
  { href: "/portal/redeem", label: "兑换中心", icon: "redeem", meta: "CDK" },
  { href: "/portal/access", label: "接入信息", icon: "qr_code_2", meta: "HY2" },
  { href: "/portal/tutorial", label: "使用教程", icon: "book", meta: "GUIDE" },
  { href: "/portal/usage", label: "流量使用", icon: "network_node", meta: "FLOW" },
  { href: "/portal/orders", label: "订单记录", icon: "payments", meta: "BILL" },
];

export const homeCopy = {
  title: "Hysteria 2 多用户控制台",
  description:
    "面向运维的高密度工具界面，覆盖套餐、节点、订阅、流量与 Hysteria 2 接入信息。",
  adminHint: "本地开发 seed 管理员：ops@hysteria.local / admin123!",
  memberHint: "本地开发 seed 会员：lin@example.com / member123!",
};
