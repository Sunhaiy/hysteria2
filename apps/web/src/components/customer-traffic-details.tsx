"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { PaginatedResponse } from "@/lib/types";
import { DataTable } from "./data-table";
import { Panel } from "./panel";

type TrafficRecord = {
  id: string;
  nodeLabel: string;
  nodeAddress: string;
  bucketStart: string;
  physicalBytes: number;
  accountedBytes: number;
  txBytes: number;
  rxBytes: number;
  multiplier: number | null;
  overageBytes: number;
};
const clock = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function CustomerTrafficDetails({
  userId,
  token,
}: {
  userId: string;
  token: string | null;
}) {
  const [date, setDate] = useState("");
  const [sort, setSort] = useState("latest");
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<PaginatedResponse<TrafficRecord> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      setResult(null);
      const query = new URLSearchParams({
        page: String(page),
        pageSize: "20",
        sort,
      });
      if (date) query.set("date", date);
      void apiRequest<PaginatedResponse<TrafficRecord>>(
        `/api/admin/customers/${userId}/traffic?${query}`,
        { token, signal: controller.signal },
      )
        .then((data) => {
          if (!controller.signal.aborted) setResult(data);
        })
        .catch((cause) => {
          if (!controller.signal.aborted)
            setError(
              cause instanceof Error ? cause.message : "使用明细加载失败",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [userId, token, date, sort, page, retry]);

  return (
    <Panel title="使用明细" copy="按采集批次核对实际传输与计费流量">
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "end",
          marginBottom: 16,
        }}
      >
        <label className="field">
          日期（北京时间）
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="field">
          排序
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
          >
            <option value="latest">最新采集</option>
            <option value="largest">计费流量从大到小</option>
          </select>
        </label>
        {date ? (
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setDate("");
              setPage(1);
            }}
          >
            全部日期
          </button>
        ) : null}
        <button
          type="button"
          className="ghost-button"
          disabled={loading}
          onClick={() => setRetry((v) => v + 1)}
        >
          刷新
        </button>
      </div>
      <p className="muted" style={{ marginBottom: 16 }}>
        时间为采集时间，并非下载开始时间；单条记录可能累计一段时间的用量。这里不记录具体访问的网站或文件。
        {result ? ` 共 ${result.total} 条记录。` : ""}
      </p>
      <DataTable
        headers={[
          "采集时间 · 北京时间",
          "节点",
          "实际传输",
          "计费倍率",
          "计费流量",
        ]}
        rows={(result?.items ?? []).map((row) => [
          clock.format(new Date(row.bucketStart)),
          <div key="node">
            {row.nodeLabel}
            <div className="muted">{row.nodeAddress}</div>
          </div>,
          <div key="raw">
            {formatBytes(row.physicalBytes)}
            <div className="muted">
              上传 {formatBytes(row.txBytes)} / 下载 {formatBytes(row.rxBytes)}
            </div>
          </div>,
          row.multiplier == null ? "历史记录未保存" : `${row.multiplier}×`,
          <div key="billed">
            {formatBytes(row.accountedBytes)}
            {row.overageBytes > 0 ? (
              <div className="muted">
                超额度 {formatBytes(row.overageBytes)}
              </div>
            ) : null}
          </div>,
        ])}
        loading={loading}
        error={error}
        onRetry={() => setRetry((v) => v + 1)}
        emptyText={date ? "这一天没有使用记录" : "暂无使用记录"}
        pagination={result ? { ...result, onPageChange: setPage } : undefined}
      />
    </Panel>
  );
}
