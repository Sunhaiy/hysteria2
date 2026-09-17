"use client";

import { useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { useAuth } from "@/components/auth-provider";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { DataTable } from "@/components/data-table";
import { apiRequest } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatMoney } from "@/lib/format";

type Statement = {
  fulfilledNetRevenueCents: number;
  refundCents: number;
  amortizedNodeCostCents: number;
  grossProfitCents: number;
  walletLiabilityCents: number;
  cdkEntitlementValueCents: number;
  nodeCosts: Array<{
    nodeId: string;
    nodeLabel: string;
    amortizedCents: number;
  }>;
};

export default function MonthlyStatementsPage() {
  const { token } = useAuth();
  const [month, setMonth] = useState(() =>
    new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 7),
  );
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!token || !/^\d{4}-\d{2}$/.test(month)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      setStatement(null);
      const [year, index] = month.split("-").map(Number);
      const from = `${month}-01`;
      const to = new Date(Date.UTC(year, index, 1)).toISOString().slice(0, 10);
      void apiRequest<Statement>(
        `/api/admin/finance/summary?${new URLSearchParams({ from, to })}`,
        { token, signal: controller.signal },
      )
        .then((result) => {
          if (!controller.signal.aborted) setStatement(result);
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setError("月度账单暂时无法加载，请稍后重试。");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [month, token]);
  const money = (value?: number) =>
    value === undefined ? "—" : formatMoney(value);
  return (
    <ConsoleShell
      navItems={adminNav}
      title="每月账单"
      scope="FINANCE"
      requireRole="admin"
      subtitle="按北京时间自然月查看经营收支，历史账单可随时回看。"
    >
      <label className="field">
        <span>账单月份</span>
        <input
          className="control"
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="metric-grid admin-data-metrics">
        <MetricCard
          label="线上净收入"
          value={money(statement?.fulfilledNetRevenueCents)}
          footnote="已履约线上订单金额，减去本月退款"
        />
        <MetricCard
          label="本月退款"
          value={money(statement?.refundCents)}
          footnote="按退款处理时间统计"
        />
        <MetricCard
          label="服务器分摊成本"
          value={money(statement?.amortizedNodeCostCents)}
          footnote="仅包含后台已登记的节点成本"
        />
        <MetricCard
          label="收入减节点成本"
          value={money(statement?.grossProfitCents)}
          footnote="未扣未登记成本、支付手续费与其他开支"
        />
      </div>
      <Panel title="成本明细">
        <DataTable
          loading={loading}
          emptyText="本月未登记节点成本，不能据此认定实际成本为零。"
          headers={["节点", "当月分摊"]}
          rows={(statement?.nodeCosts ?? []).map((item) => [
            item.nodeLabel,
            formatMoney(item.amortizedCents),
          ])}
        />
      </Panel>
      <Panel title="统计口径">
        <p>
          余额消费、管理员发放和 CDK 面值不重复计入线上收入。CDK 当月履约面值：
          {money(statement?.cdkEntitlementValueCents)}。
        </p>
        <p>
          用户当前余额合计：{money(statement?.walletLiabilityCents)}
          。这是当前负债余额，不是所选月份的期末余额。
        </p>
        <p>
          需要核对单笔记录时，请前往<a href="/admin/orders">订单中心</a>
          ；账单反映当前已记录数据，迟到支付与退款可能修订历史结果。
        </p>
      </Panel>
    </ConsoleShell>
  );
}
