export function statusTone(status: string) {
  switch (status) {
    case "active":
    case "applied":
    case "redeemed":
    case "success":
      return "success";
    case "paused":
    case "pending":
    case "suspended":
      return "warn";
    case "banned":
    case "canceled":
    case "expired":
    case "void":
      return "danger";
    default:
      return "info";
  }
}

export function humanizeOrderKind(kind: string) {
  switch (kind) {
    case "renewal":
      return "套餐 / 续期";
    case "traffic_pack":
      return "流量包";
    case "manual_credit":
      return "人工入账";
    default:
      return kind;
  }
}

export function humanizeRedemptionKind(kind: string) {
  switch (kind) {
    case "plan":
      return "套餐开通";
    case "traffic_pack":
      return "流量包";
    default:
      return kind;
  }
}

export function humanizeRedemptionStatus(status: string) {
  switch (status) {
    case "active":
      return "可兑换";
    case "redeemed":
      return "已兑换";
    case "void":
      return "已作废";
    case "expired":
      return "已过期";
    default:
      return status;
  }
}

function formatLocalDateTime(date: Date) {
  const timezoneOffset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

export function toDateTimeLocal(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return formatLocalDateTime(date);
}

export function fromDateTimeLocal(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

export function shiftDateTimeLocal(value: string, days: number) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  date.setDate(date.getDate() + days);
  return formatLocalDateTime(date);
}

export function humanizeSubscriptionStatus(status: string) {
  switch (status) {
    case "active":
      return "生效";
    case "paused":
      return "暂停";
    case "canceled":
      return "已取消";
    case "expired":
      return "已过期";
    default:
      return status;
  }
}

export function slugifyValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
