"use client";

import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { apiRequest } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { Panel } from "./panel";
import { EChart } from "./echart";
import { DataTable } from "./data-table";

type Day = {
  actualMultiplier: number | null;
  minMultiplier: number | null;
  maxMultiplier: number | null;
  date: string;
  physicalBytes: number;
  accountedBytes: number;
  txBytes: number;
  rxBytes: number;
};
export function CustomerTrafficChart({
  userId,
  token,
}: {
  userId: string;
  token: string | null;
}) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<Day[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      const to = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const from = new Date(
        Date.parse(`${to}T00:00:00Z`) + (1 - days) * 86400000,
      )
        .toISOString()
        .slice(0, 10);
      void apiRequest<{ items: Day[] }>(
        `/api/admin/customers/${userId}/traffic/daily?from=${from}&to=${to}`,
        { token, signal: controller.signal },
      )
        .then((result) => {
          if (!controller.signal.aborted) setData(result.items);
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setError(e instanceof Error ? e.message : "流量趋势加载失败");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [userId, token, days, retry]);
  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => formatBytes(Number(value)),
      },
      legend: { data: ["实际传输量", "倍率后计费量"], top: 0 },
      grid: { left: 76, right: 24, top: 48, bottom: 32 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: data.map((d) => d.date),
      },
      yAxis: {
        type: "value",
        axisLabel: { formatter: (n: number) => formatBytes(n) },
      },
      series: [
        {
          name: "实际传输量",
          type: "line",
          showSymbol: false,
          data: data.map((d) => d.physicalBytes),
        },
        {
          name: "倍率后计费量",
          type: "line",
          showSymbol: false,
          data: data.map((d) => d.accountedBytes),
        },
      ],
    }),
    [data],
  );
  return (
    <Panel
      className="customer-traffic-panel"
      title="流量趋势"
      copy="按北京时间汇总；实际传输量与倍率后计费量分别展示。"
      action={
        <div className="segmented-control compact" aria-label="流量日期范围">
          {([7, 30, 90] as const).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={days === n}
              className={days === n ? "active" : ""}
              onClick={() => setDays(n)}
            >
              {n} 天
            </button>
          ))}
        </div>
      }
    >
      {loading ? (
        <div className="empty-state" role="status">
          正在加载流量…
        </div>
      ) : error ? (
        <div className="feedback error">
          {error}
          <button
            className="ghost-button"
            onClick={() => setRetry((v) => v + 1)}
          >
            重试
          </button>
        </div>
      ) : data.some((d) => d.physicalBytes > 0 || d.accountedBytes > 0) ? (
        <>
          <EChart
            option={option}
            height={320}
            ariaLabel="实际传输量与倍率后计费量趋势"
          />
          <details>
            <summary>查看每日明细</summary>
            <DataTable
              headers={[
                "日期（北京时间）",
                "上传",
                "下载",
                "实际传输量",
                "倍率后计费量",
                "实际倍率",
              ]}
              rows={[...data]
                .reverse()
                .map((d) => [
                  d.date,
                  formatBytes(d.txBytes),
                  formatBytes(d.rxBytes),
                  formatBytes(d.physicalBytes),
                  formatBytes(d.accountedBytes),
                  d.actualMultiplier == null
                    ? "—"
                    : d.minMultiplier === d.maxMultiplier
                      ? `${d.actualMultiplier}×`
                      : `${d.actualMultiplier}×（${d.minMultiplier}–${d.maxMultiplier}×）`,
                ])}
            />
          </details>
        </>
      ) : (
        <div className="empty-state">近 {days} 天暂无流量记录</div>
      )}
    </Panel>
  );
}
