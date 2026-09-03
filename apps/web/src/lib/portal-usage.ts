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
  const totals = new Map<
    string,
    { billedTxBytes: number; billedRxBytes: number; accountedBytes: number }
  >();
  recent.forEach((item) => {
    const key = shanghaiDateKey(new Date(item.bucketStart));
    const current = totals.get(key) ?? {
      billedTxBytes: 0,
      billedRxBytes: 0,
      accountedBytes: 0,
    };
    const physicalBytes = item.txBytes + item.rxBytes;
    const accountedBytes = item.accountedBytes ?? physicalBytes;
    const billedTxBytes =
      physicalBytes > 0
        ? Math.floor((accountedBytes * item.txBytes) / physicalBytes)
        : 0;
    const billedRxBytes = accountedBytes - billedTxBytes;
    totals.set(key, {
      billedTxBytes: current.billedTxBytes + billedTxBytes,
      billedRxBytes: current.billedRxBytes + billedRxBytes,
      accountedBytes: current.accountedBytes + accountedBytes,
    });
  });

  const today = shanghaiDateKey(now);
  return Array.from({ length: 7 }, (_, index) => {
    const key = shiftDateKey(today, index - 6);
    return {
      key,
      label: key.slice(5).replace("-", "/"),
      billedTxBytes: totals.get(key)?.billedTxBytes ?? 0,
      billedRxBytes: totals.get(key)?.billedRxBytes ?? 0,
      accountedBytes: totals.get(key)?.accountedBytes ?? 0,
    };
  });
}

export function buildNodeUsage(recent: PortalUsageResponse["recent"]) {
  const totals = new Map<
    string,
    { label: string; physicalBytes: number; accountedBytes: number }
  >();
  recent.forEach((item) => {
    const current = totals.get(item.nodeId) ?? {
      label: item.nodeLabel,
      physicalBytes: 0,
      accountedBytes: 0,
    };
    totals.set(item.nodeId, {
      label: item.nodeLabel,
      physicalBytes: current.physicalBytes + item.txBytes + item.rxBytes,
      accountedBytes:
        current.accountedBytes +
        (item.accountedBytes ?? item.txBytes + item.rxBytes),
    });
  });

  return [...totals.values()]
    .sort((a, b) => b.accountedBytes - a.accountedBytes)
    .slice(0, 5);
}
