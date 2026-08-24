export function formatBytes(bytes: number) {
  const gb = 1024 * 1024 * 1024;
  const tb = gb * 1024;
  if (bytes >= tb) {
    return `${(bytes / tb).toFixed(2)} TB`;
  }
  return `${(bytes / gb).toFixed(1)} GB`;
}

export function formatTrafficLimit(bytes: number) {
  return bytes >= Number.MAX_SAFE_INTEGER ? "无限流量" : formatBytes(bytes);
}

export function formatSpeedLimit(mbps: number) {
  return mbps <= 0 ? "不限速" : `${mbps} Mbps`;
}

export function formatMoney(cents: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatPercent(value: number, total: number) {
  if (!total) {
    return "0%";
  }
  return `${Math.round((value / total) * 100)}%`;
}
