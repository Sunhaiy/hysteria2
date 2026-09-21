"use client";

import { useState } from "react";
import { Drawer } from "@/components/drawer";
import { apiRequest } from "@/lib/api";
import { customerDateTime as formatDateTime } from "@/lib/customer-display";

export function PlanValidityButton({
  userId,
  grant,
  token,
  onComplete,
}: {
  userId: string;
  grant: { id: string; endsAt: string; productName: string };
  token: string | null;
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [endsAt, setEndsAt] = useState("");
  const reason = "后台调整套餐有效期";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        className="ghost-button compact"
        type="button"
        onClick={() => {
          setEndsAt(
            new Date(new Date(grant.endsAt).getTime() + 8 * 3600000)
              .toISOString()
              .slice(0, 16),
          );
          setError("");
          setOpen(true);
        }}
      >
        调整有效期
      </button>
      <Drawer
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title="调整套餐有效期"
        subtitle={grant.productName}
      >
        <form
          className="list"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            if (
              !window.confirm(
                `确认将套餐到期时间调整为 ${endsAt.replace("T", " ")}（北京时间）？已用流量不会清零。`,
              )
            )
              return;
            setBusy(true);
            setError("");
            try {
              await apiRequest(
                `/api/admin/customers/${userId}/entitlements/${grant.id}/validity`,
                {
                  token,
                  method: "PATCH",
                  body: {
                    endsAt: new Date(`${endsAt}:00+08:00`).toISOString(),
                    expectedEndsAt: grant.endsAt,
                    reason: reason.trim(),
                  },
                },
              );
              setOpen(false);
              onComplete();
            } catch (cause) {
              setError(
                cause instanceof Error ? cause.message : "有效期调整失败",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>当前到期时间：{formatDateTime(grant.endsAt)}</p>
          <p>
            调整后：
            {endsAt ? formatDateTime(`${endsAt}:00+08:00`) : "请选择时间"}
          </p>
          <label className="field">
            <span>新的到期时间（北京时间）</span>
            <input
              type="datetime-local"
              className="control"
              required
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </label>
          <p className="muted">
            仅调整有效期，不清空已用流量、不改变月度重置锚点。不能与已预约套餐重叠。
          </p>
          {error && <p role="alert">{error}</p>}
          <button className="action-button" disabled={busy}>
            {busy ? "保存中…" : "保存有效期"}
          </button>
        </form>
      </Drawer>
    </>
  );
}
