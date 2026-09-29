"use client";
import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { useAuth } from "@/components/auth-provider";
import { apiRequest } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatMoney } from "@/lib/format";
import type { HolidayAdminView, HolidayCampaign } from "@/lib/holiday";
const timeValue = (s: string) =>
  new Date(new Date(s).getTime() + 8 * 3600000).toISOString().slice(0, 16);
export default function AdminHoliday() {
  const { token } = useAuth();
  const [data, setData] = useState<HolidayAdminView | null>(null),
    [form, setForm] = useState<HolidayCampaign | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!token) return;
    try {
      const d = await apiRequest<HolidayAdminView>("/api/admin/holiday", {
        token,
      });
      setData(d);
      setForm(d.campaign ?? d.defaults);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "加载失败");
    }
  }, [token]);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void apiRequest<HolidayAdminView>("/api/admin/holiday", {
      token,
      signal: controller.signal,
    })
      .then((d) => {
        setData(d);
        setForm(d.campaign ?? d.defaults);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setMessage(e instanceof Error ? e.message : "加载失败");
      });
    return () => controller.abort();
  }, [token]);
  async function save() {
    if (!form || busy) return;
    setBusy(true);
    try {
      await apiRequest("/api/admin/holiday", {
        token,
        method: "POST",
        body: form,
      });
      setMessage("活动配置已保存；在途订单使用原快照。");
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ConsoleShell
      title="中秋·国庆活动管理"
      subtitle="独立活动报价，不修改普通商城与拼团"
      scope="Admin"
      navItems={adminNav}
      requireRole="admin"
    >
      <div className="holiday-page">
        {message && (
          <p role="status" className="holiday-notice">
            {message}
          </p>
        )}
        {!form ? (
          <p>正在加载…</p>
        ) : (
          <>
            <section className="holiday-card">
              <h2>活动设置</h2>
              <label className="field">
                好友首次充值邀请奖励（元，0表示关闭现金奖励）
                <input
                  className="control"
                  type="number"
                  min="0"
                  max="1000"
                  step="0.01"
                  value={(form.config.inviteRewardCents ?? 500) / 100}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      config: {
                        ...form.config,
                        inviteRewardCents: Math.round(
                          Number(e.target.value) * 100,
                        ),
                      },
                    })
                  }
                />
              </label>
              <p>
                仅活动期间新邀请的好友首次外部充值触发，每位好友一次。已有参与后金额锁定，退款会追回奖励。
              </p>
              <label className="field">
                标题
                <input
                  className="control"
                  maxLength={80}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) =>
                    setForm({ ...form, enabled: e.target.checked })
                  }
                />{" "}
                开启活动购买与抽奖
              </label>
              <div className="holiday-grid">
                {(["startsAt", "endsAt", "drawEndsAt"] as const).map((k, i) => (
                  <label className="field" key={k}>
                    {["开始时间", "购买截止", "抽奖截止"][i]}（北京时间）
                    <input
                      className="control"
                      type="datetime-local"
                      value={timeValue(form[k])}
                      onChange={(e) => {
                        if (e.target.value)
                          setForm({
                            ...form,
                            [k]: new Date(
                              `${e.target.value}:00+08:00`,
                            ).toISOString(),
                          });
                      }}
                    />
                  </label>
                ))}
              </div>
              <label className="field">
                充值赠额总预算（元）
                <input
                  className="control"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.giftBudgetCents / 100}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      giftBudgetCents: Math.round(Number(e.target.value) * 100),
                    })
                  }
                />
              </label>
              <p>
                已承诺赠额 {formatMoney(form.reservedGiftCents ?? 0)}
                ；每人每档一次，余额永久有效。
              </p>
            </section>
            <section className="holiday-card">
              <h2>充值档位</h2>
              <p>已有参与记录后不可重设档位和奖池。</p>
              {form.config.tiers.map((t, i) => (
                <div className="holiday-grid" key={t.id}>
                  <label className="field">
                    充值金额（元）
                    <input
                      className="control"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={t.amountCents / 100}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          config: {
                            ...form.config,
                            tiers: form.config.tiers.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    amountCents: Math.round(
                                      Number(e.target.value) * 100,
                                    ),
                                  }
                                : x,
                            ),
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    赠额（元）
                    <input
                      className="control"
                      type="number"
                      min="0"
                      step="0.01"
                      value={t.giftCents / 100}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          config: {
                            ...form.config,
                            tiers: form.config.tiers.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    giftCents: Math.round(
                                      Number(e.target.value) * 100,
                                    ),
                                  }
                                : x,
                            ),
                          },
                        })
                      }
                    />
                  </label>
                </div>
              ))}
            </section>
            <section className="holiday-card">
              <h2>参与套餐与折扣</h2>
              <p>8折填写80%，仅本活动入口生效。</p>
              {data?.defaults.config.offers.map((o) => {
                const active = form.config.offers.find(
                    (x) => x.offerId === o.offerId,
                  ),
                  detail = data.offers.find((x) => x.offerId === o.offerId);
                return (
                  <div className="holiday-record" key={o.offerId}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!!active}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            config: {
                              ...form.config,
                              offers: e.target.checked
                                ? [...form.config.offers, o]
                                : form.config.offers.filter(
                                    (x) => x.offerId !== o.offerId,
                                  ),
                            },
                          })
                        }
                      />
                      {detail
                        ? `${detail.name} · ${detail.billingPeriod === "YEARLY" ? "年付" : "季付"}`
                        : `${o.name ?? o.offerId} · ${o.billingPeriod === "YEARLY" ? "年付" : "季付"}`}
                    </label>
                    {active && (
                      <label>
                        实付比例 %{" "}
                        <input
                          className="control"
                          type="number"
                          min="1"
                          max="100"
                          value={active.discountBasisPoints / 100}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              config: {
                                ...form.config,
                                offers: form.config.offers.map((x) =>
                                  x.offerId === o.offerId
                                    ? {
                                        ...x,
                                        discountBasisPoints: Math.round(
                                          Number(e.target.value) * 100,
                                        ),
                                      }
                                    : x,
                                ),
                              },
                            })
                          }
                        />
                      </label>
                    )}
                  </div>
                );
              })}
            </section>
            <section className="holiday-card">
              <h2>抽奖奖池</h2>
              <p>
                每笔完成的活动订单赠三次；邀请注册赠一次，好友首次充值后累计三次。名额受全站库存限制，奖池总额不得超过200元。
              </p>
              {form.config.prizes.map((p, i) => (
                <div className="holiday-grid" key={i}>
                  <label className="field">
                    奖金额（元；0为谢谢参与）
                    <input
                      className="control"
                      type="number"
                      min="0"
                      step="0.01"
                      value={p.cents / 100}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          config: {
                            ...form.config,
                            prizes: form.config.prizes.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    cents: Math.round(
                                      Number(e.target.value) * 100,
                                    ),
                                  }
                                : x,
                            ),
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    初始数量
                    <input
                      className="control"
                      type="number"
                      min="0"
                      step="1"
                      value={p.count}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          config: {
                            ...form.config,
                            prizes: form.config.prizes.map((x, j) =>
                              j === i
                                ? { ...x, count: Number(e.target.value) }
                                : x,
                            ),
                          },
                        })
                      }
                    />
                  </label>
                </div>
              ))}
              <p>
                合计 {form.config.prizes.reduce((n, p) => n + p.count, 0)}{" "}
                个名额，奖池{" "}
                {formatMoney(
                  form.config.prizes.reduce((n, p) => n + p.count * p.cents, 0),
                )}
              </p>
            </section>
            <button
              className="action-button"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "保存中…" : "保存活动配置"}
            </button>
            {data && (
              <section className="holiday-card">
                <h2>活动统计</h2>
                <div className="holiday-grid">
                  {(
                    [
                      ["外部实收", "externalReceiptsCents"],
                      ["充值本金", "topupPrincipalCents"],
                      ["充值赠额", "giftCents"],
                      ["余额消费", "walletConsumptionCents"],
                      ["套餐销售", "planSalesCents"],
                      ["抽奖奖金", "prizeCents"],
                      ["邀请返现净额", "inviteCashCents"],
                      ["已退本金/货款", "refundedCents"],
                    ] as const
                  ).map(([label, k]) => (
                    <div key={k}>
                      <p>{label}</p>
                      <strong>{formatMoney(data.stats[k])}</strong>
                    </div>
                  ))}
                </div>
                <p>充值本金与套餐销售分开统计；余额消费不重复计入外部实收。</p>
                <h3>需要人工核验的退款</h3>
                {data.stats.inviteManualReview?.map((r) => (
                  <p key={r.id}>
                    邀请人 {r.inviterId} · 订单 {r.sourceOrderId} ·{" "}
                    {formatMoney(r.amountCents)}：{r.reviewReason}
                  </p>
                ))}
                {data.stats.manualReview.length ? (
                  data.stats.manualReview.map((r) => (
                    <p key={r.id}>
                      {r.orderId}：{r.reviewReason}
                    </p>
                  ))
                ) : (
                  <p>暂无异常。</p>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </ConsoleShell>
  );
}
