import type { PortalUsageResponse } from "@/lib/types";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function shanghaiDateKey(date: Date) {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

function shiftDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export function buildSevenDayUsage(
  recent: PortalUsageResponse["recent"],
  now = new Date(),
) {
  const totals = new Map<string, { txBytes: number; rxBytes: number }>();
  recent.forEach((item) => {
    const key = shanghaiDateKey(new Date(item.bucketStart));
    const current = totals.get(key) ?? { txBytes: 0, rxBytes: 0 };
    totals.set(key, {
      txBytes: current.txBytes + item.txBytes,
      rxBytes: current.rxBytes + item.rxBytes,
    });
  });

  const today = shanghaiDateKey(now);
  return Array.from({ length: 7 }, (_, index) => {
    const key = shiftDateKey(today, index - 6);
    return {
      key,
      label: key.slice(5).replace("-", "/"),
      txBytes: totals.get(key)?.txBytes ?? 0,
      rxBytes: totals.get(key)?.rxBytes ?? 0,
    };
  });
}
