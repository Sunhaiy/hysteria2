export function customerDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "日期异常";
  if (date.getUTCFullYear() >= 9999) return "永久有效";
  return `${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date)}（北京时间）`;
}
