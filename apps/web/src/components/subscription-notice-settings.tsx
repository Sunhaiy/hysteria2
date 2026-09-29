"use client";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
export function SubscriptionNoticeSettings({
  token,
}: {
  token: string | null;
}) {
  const [config, setConfig] = useState<{
    enabled: boolean;
    names: string[];
  } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void apiRequest<{ enabled: boolean; names: string[] }>(
      "/api/admin/settings/subscription-notices",
      { token, signal: controller.signal },
    )
      .then(setConfig)
      .catch((e) => {
        if (!controller.signal.aborted)
          setMessage(e instanceof Error ? e.message : "加载失败");
      });
    return () => controller.abort();
  }, [token]);
  return (
    <section className="holiday-card">
      <h2>Clash 到期提示节点</h2>
      <p>
        仅套餐已到期且没有其他有效权益时展示。提示节点不能连接，续费并刷新订阅后恢复真实节点；不会替换仍有效的套餐或流量包。
      </p>
      {config && (
        <>
          <label>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) =>
                setConfig({ ...config, enabled: e.target.checked })
              }
            />{" "}
            开启到期提示
          </label>
          <label className="field">
            提示数量（1–10）
            <input
              className="control"
              type="number"
              min={1}
              max={10}
              value={config.names.length}
              onChange={(e) => {
                const count = Math.min(10, Math.max(1, Number(e.target.value)));
                setConfig({
                  ...config,
                  names: Array.from(
                    { length: count },
                    (_, i) => config.names[i] ?? `请前往网站续费 ${i + 1}`,
                  ),
                });
              }}
            />
          </label>
          {config.names.map((name, i) => (
            <label className="field" key={i}>
              提示 {i + 1}
              <input
                className="control"
                maxLength={80}
                value={name}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    names: config.names.map((n, j) =>
                      i === j ? e.target.value : n,
                    ),
                  })
                }
              />
            </label>
          ))}
          <button
            className="action-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setConfig(
                  await apiRequest("/api/admin/settings/subscription-notices", {
                    token,
                    method: "POST",
                    body: config,
                  }),
                );
                setMessage("已保存，客户端下次更新订阅时生效。");
              } catch (e) {
                setMessage(e instanceof Error ? e.message : "保存失败");
              } finally {
                setBusy(false);
              }
            }}
          >
            保存到期提示
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
