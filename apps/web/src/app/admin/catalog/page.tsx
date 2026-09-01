"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomSelect } from "@/components/custom-select";
import { DataTable } from "@/components/data-table";
import { Drawer } from "@/components/drawer";
import { Icon } from "@/components/icon";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { PageSkeleton } from "@/components/skeleton";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatMoney } from "@/lib/format";

type Offer = {
  id?: string;
  slug: string;
  name: string;
  billingPeriod: "monthly" | "quarterly" | "yearly" | "one_time";
  intervalMonths: number | null;
  trafficBytes: number;
  priceCents: number;
  storeUrl?: string | null;
  active: boolean;
  isDefault: boolean;
  archivedAt?: string | null;
};
type OfferDraft = Offer;
type Product = {
  id: string;
  slug: string;
  kind: "plan" | "traffic_pack";
  status: "draft" | "active" | "archived";
  name: string;
  description?: string | null;
  storeUrl?: string | null;
  defaultTrafficMultiplier: number;
  accent: string;
  sortOrder: number;
  featured: boolean;
  purchaseLimitPerUser?: number | null;
  purchaseLimitKey?: string | null;
  requiresActivePlan: boolean;
  referralEligible: boolean;
  quotaCadence: string;
  access: {
    profileName?: string | null;
    speedUpMbps: number;
    speedDownMbps: number;
    deviceLimit: number;
    servers: Array<{
      id: string;
      name: string;
      nodes: Array<{
        id: string;
        label: string;
        protocol: "hysteria2" | "vless_reality";
        serviceable: boolean;
      }>;
    }>;
  };
  offers: Offer[];
};
type CatalogServer = {
  id: string;
  name: string;
  region?: string | null;
  nodes: Array<{
    id: string;
    label: string;
    protocol: "hysteria2" | "vless_reality";
    hostname: string;
    serviceable: boolean;
  }>;
};
type Catalog = { products: Product[]; servers: CatalogServer[] };
type ProductForm = {
  slug: string;
  kind: "plan" | "traffic_pack";
  status: "draft" | "active" | "archived";
  name: string;
  description: string;
  storeUrl: string;
  trafficGbInput: string;
  nodeIds: string[];
  deviceLimit: number;
  speedUpMbps: number;
  speedDownMbps: number;
  defaultTrafficMultiplier: number;
  sortOrder: number;
  featured: boolean;
  purchaseLimitPerUser: number;
  purchaseLimitKey: string;
  requiresActivePlan: boolean;
  referralEligible: boolean;
  offers: OfferDraft[];
};
const GB = 1024 ** 3;
const trafficBytesToGbInput = (trafficBytes: number) =>
  String(Math.round((trafficBytes / GB) * 100) / 100);
const trafficGbToBytes = (trafficGbInput: string) => {
  const trafficGb = Number(trafficGbInput);
  return Number.isFinite(trafficGb) && trafficGb > 0
    ? Math.round(trafficGb * GB)
    : 0;
};
const offerTemplate = (
  period: Offer["billingPeriod"],
  kind: ProductForm["kind"],
  index: number,
): OfferDraft => ({
  slug: `${kind === "plan" ? "plan" : "pack"}-${period}`,
  name:
    period === "monthly"
      ? "月付"
      : period === "quarterly"
        ? "季付"
        : period === "yearly"
          ? "年付"
          : "一次性",
  billingPeriod: period,
  intervalMonths:
    period === "monthly"
      ? 1
      : period === "quarterly"
        ? 3
        : period === "yearly"
          ? 12
          : null,
  trafficBytes: (kind === "plan" ? 200 : 50) * GB,
  priceCents: kind === "plan" ? [1800, 5000, 18000][index] : 3200,
  storeUrl: "",
  active: true,
  isDefault: index === 0,
});

const emptyForm = (kind: ProductForm["kind"] = "plan"): ProductForm => ({
  slug: "",
  kind,
  status: "draft",
  name: "",
  description: "",
  storeUrl: "",
  trafficGbInput: String(kind === "plan" ? 200 : 50),
  nodeIds: [],
  deviceLimit: 5,
  speedUpMbps: 20,
  speedDownMbps: 100,
  defaultTrafficMultiplier: 1,
  sortOrder: 0,
  offers: (kind === "plan"
    ? ["monthly", "quarterly", "yearly"]
    : ["one_time"]
  ).map((period, index) =>
    offerTemplate(period as Offer["billingPeriod"], kind, index),
  ),
  featured: false,
  purchaseLimitPerUser: 0,
  purchaseLimitKey: "",
  requiresActivePlan: false,
  referralEligible: kind === "plan",
});

export default function CatalogPage() {
  const { token } = useAuth();
  const [catalog, setCatalog] = useState<Catalog>({
    products: [],
    servers: [],
  });
  const [kindFilter, setKindFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(() => emptyForm());
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setCatalog(await apiRequest<Catalog>("/api/admin/catalog", { token }));
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "商品目录加载失败。",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const products = useMemo(
    () =>
      catalog.products.filter(
        (product) =>
          (!kindFilter || product.kind === kindFilter) &&
          (!statusFilter || product.status === statusFilter),
      ),
    [catalog.products, kindFilter, statusFilter],
  );

  function openProduct(product?: Product) {
    setEditing(product ?? null);
    const quotaOffer =
      product?.offers.find(
        (offer) => offer.billingPeriod === "monthly" && !offer.archivedAt,
      ) ?? product?.offers.find((offer) => !offer.archivedAt);
    const next = product
      ? {
          slug: product.slug,
          kind: product.kind,
          status: product.status,
          name: product.name,
          description: product.description ?? "",
          storeUrl: product.storeUrl ?? "",
          trafficGbInput: trafficBytesToGbInput(quotaOffer?.trafficBytes ?? 0),
          nodeIds: product.access.servers.flatMap((server) =>
            server.nodes.map((node) => node.id),
          ),
          deviceLimit: product.access.deviceLimit,
          speedUpMbps: product.access.speedUpMbps,
          speedDownMbps: product.access.speedDownMbps,
          defaultTrafficMultiplier: product.defaultTrafficMultiplier,
          sortOrder: product.sortOrder,
          featured: product.featured,
          purchaseLimitPerUser: product.purchaseLimitPerUser ?? 0,
          purchaseLimitKey: product.purchaseLimitKey ?? "",
          requiresActivePlan: product.requiresActivePlan,
          referralEligible: product.referralEligible,
          offers: product.offers.filter((offer) => !offer.archivedAt),
        }
      : emptyForm();
    setForm(next);
    setDrawerOpen(true);
    setError(null);
  }

  function switchKind(kind: ProductForm["kind"]) {
    if (editing) return;
    const next = emptyForm(kind);
    setForm((current) => ({
      ...next,
      name: current.name,
      slug: current.slug,
      description: current.description,
      storeUrl: current.storeUrl,
      nodeIds: current.nodeIds,
      deviceLimit: current.deviceLimit,
      speedUpMbps: current.speedUpMbps,
      speedDownMbps: current.speedDownMbps,
      defaultTrafficMultiplier: current.defaultTrafficMultiplier,
      status: current.status,
      sortOrder: current.sortOrder,
      featured: kind === "plan" ? current.featured : false,
      purchaseLimitPerUser: kind === "plan" ? current.purchaseLimitPerUser : 0,
      purchaseLimitKey: kind === "plan" ? current.purchaseLimitKey : "",
      requiresActivePlan: false,
      referralEligible: kind === "plan",
    }));
  }

  function updateOffer(
    period: Offer["billingPeriod"],
    patch: Partial<OfferDraft>,
  ) {
    setForm((current) => ({
      ...current,
      offers: current.offers.map((offer) =>
        offer.billingPeriod === period ? { ...offer, ...patch } : offer,
      ),
    }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    const trafficBytes = trafficGbToBytes(form.trafficGbInput);
    if (trafficBytes < 1) {
      setError(
        `${form.kind === "plan" ? "每月流量" : "流量包额度"}必须大于 0 GB。`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const offers = form.offers.map((offer) => ({
        id: offer.id,
        slug: offer.slug.trim(),
        name: offer.name.trim(),
        billingPeriod: offer.billingPeriod,
        trafficBytes: trafficGbToBytes(form.trafficGbInput),
        priceCents: offer.priceCents,
        storeUrl: offer.storeUrl?.trim() || undefined,
        active: offer.active,
        isDefault: offer.isDefault,
      }));
      await apiRequest(
        editing
          ? `/api/admin/catalog/products/${editing.id}`
          : "/api/admin/catalog/products",
        {
          method: editing ? "PUT" : "POST",
          token,
          body: {
            slug: form.slug.trim(),
            kind: form.kind,
            status: form.status,
            name: form.name.trim(),
            description: form.description.trim() || undefined,
            storeUrl: form.storeUrl.trim() || undefined,
            nodeIds: form.nodeIds,
            deviceLimit: form.deviceLimit,
            speedUpMbps: form.speedUpMbps,
            speedDownMbps: form.speedDownMbps,
            defaultTrafficMultiplier: form.defaultTrafficMultiplier,
            sortOrder: form.sortOrder,
            featured: form.featured,
            purchaseLimitPerUser:
              form.purchaseLimitPerUser > 0
                ? form.purchaseLimitPerUser
                : undefined,
            purchaseLimitKey:
              form.purchaseLimitPerUser > 0
                ? form.purchaseLimitKey.trim() || form.slug.trim()
                : undefined,
            requiresActivePlan:
              form.kind === "traffic_pack" ? false : form.requiresActivePlan,
            referralEligible: form.referralEligible,
            offers,
          },
        },
      );
      setDrawerOpen(false);
      setFeedback(editing ? "商品与全部规格已更新。" : "商品已创建。");
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "商品保存失败。");
    } finally {
      setBusy(false);
    }
  }

  const activeProducts = catalog.products.filter(
    (product) => product.status === "active",
  );
  const activeOffers = activeProducts
    .flatMap((product) => product.offers)
    .filter((offer) => offer.active && !offer.archivedAt).length;

  if (loading && catalog.products.length === 0 && !error) {
    return (
      <ConsoleShell
        title="商品中心"
        subtitle="套餐、流量包与可用节点"
        scope="Catalog"
        navItems={adminNav}
        requireRole="admin"
      >
        <PageSkeleton variant="table" />
      </ConsoleShell>
    );
  }

  return (
    <ConsoleShell
      title="商品中心"
      subtitle="套餐、流量包与可用节点"
      scope="Catalog"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={
        <span className="badge info">
          {catalog.products.length} 个商品 · {activeOffers} 个上架规格
        </span>
      }
      toolbarActions={
        <button
          className="action-button"
          type="button"
          onClick={() => openProduct()}
        >
          <Icon name="add" />
          新建商品
        </button>
      }
    >
      {error && !drawerOpen ? (
        <div className="feedback error">{error}</div>
      ) : null}
      {feedback ? <div className="feedback success">{feedback}</div> : null}
      <div className="page-stack">
        <div className="metric-grid">
          <MetricCard
            label="上架商品"
            value={String(activeProducts.length)}
            footnote="套餐与订阅附加包"
          />
          <MetricCard
            label="套餐"
            value={String(
              catalog.products.filter((product) => product.kind === "plan")
                .length,
            )}
            footnote="固定月 / 季 / 年规格"
          />
          <MetricCard
            label="流量包"
            value={String(
              catalog.products.filter(
                (product) => product.kind === "traffic_pack",
              ).length,
            )}
            footnote="一次购买，永久有效"
          />
          <MetricCard
            label="可用节点"
            value={String(
              catalog.servers
                .flatMap((server) => server.nodes)
                .filter((node) => node.serviceable).length,
            )}
            footnote="可直接分配给商品"
          />
        </div>
        <Panel
          title="统一商品列表"
          copy="套餐和流量包使用同一状态筛选与编辑流程。"
          action={
            <div className="inline-form compact">
              <CustomSelect
                value={kindFilter}
                onChange={setKindFilter}
                options={[
                  { value: "", label: "全部类型" },
                  { value: "plan", label: "套餐" },
                  { value: "traffic_pack", label: "流量包" },
                ]}
              />
              <CustomSelect
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "", label: "全部状态" },
                  { value: "active", label: "上架" },
                  { value: "draft", label: "草稿" },
                  { value: "archived", label: "归档" },
                ]}
              />
            </div>
          }
        >
          <DataTable
            headers={[
              "商品",
              "类型",
              "销售规格",
              "流量规则",
              "访问权益",
              "节点范围",
              "状态",
              "操作",
            ]}
            rows={products.map((product) => [
              <span className="list" key={product.id}>
                <strong>{product.name}</strong>
                <small className="mono">{product.slug}</small>
              </span>,
              product.kind === "plan" ? "套餐" : "流量包",
              <span className="list" key={`${product.id}-offers`}>
                {product.offers
                  .filter((offer) => offer.active && !offer.archivedAt)
                  .map((offer) => (
                    <small key={offer.id}>
                      {offer.name} {formatMoney(offer.priceCents)}
                    </small>
                  ))}
              </span>,
              product.kind === "plan"
                ? `每月重置 ${formatBytes(product.offers[0]?.trafficBytes ?? 0)}`
                : product.offers
                    .map(
                      (offer) =>
                        `${offer.name} ${formatBytes(offer.trafficBytes)}`,
                    )
                    .join(" · "),
              <span className="list" key={`${product.id}-rules`}>
                <span>{product.access.speedDownMbps} Mbps · 不限设备</span>
                {product.featured ? <small>前台推荐</small> : null}
                {product.purchaseLimitPerUser ? (
                  <small>每账号限购 {product.purchaseLimitPerUser} 次</small>
                ) : null}
                {product.requiresActivePlan ? <small>需有效套餐</small> : null}
              </span>,
              product.access.servers.map((server) => server.name).join(" · ") ||
                "未绑定",
              <span
                className={`badge ${product.status === "active" ? "success" : product.status === "draft" ? "warn" : "neutral"}`}
                key={`${product.id}-status`}
              >
                {product.status === "active"
                  ? "上架"
                  : product.status === "draft"
                    ? "草稿"
                    : "归档"}
              </span>,
              <button
                className="ghost-button compact"
                type="button"
                key={`${product.id}-edit`}
                onClick={() => openProduct(product)}
              >
                <Icon name="edit" />
                编辑
              </button>,
            ])}
          />
        </Panel>
      </div>
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? `编辑商品：${editing.name}` : "新建商品"}
        footer={
          <div className="toolbar-actions">
            <button
              className="action-button"
              type="submit"
              form="product-form"
              disabled={
                busy ||
                !form.name.trim() ||
                !form.slug.trim() ||
                form.nodeIds.length === 0
              }
            >
              保存商品
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => setDrawerOpen(false)}
            >
              取消
            </button>
          </div>
        }
      >
        {drawerOpen && error ? (
          <div className="feedback error">{error}</div>
        ) : null}
        <form id="product-form" className="form-grid" onSubmit={save}>
          <label className="field">
            <span className="fine-print">商品类型</span>
            <CustomSelect
              value={form.kind}
              onChange={(value) => switchKind(value as ProductForm["kind"])}
              disabled={Boolean(editing)}
              options={[
                { value: "plan", label: "套餐" },
                { value: "traffic_pack", label: "流量包" },
              ]}
            />
          </label>
          <label className="field">
            <span className="fine-print">名称</span>
            <input
              className="control"
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span className="fine-print">Slug</span>
            <input
              className="control mono"
              value={form.slug}
              onChange={(event) =>
                setForm((current) => ({ ...current, slug: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span className="fine-print">状态</span>
            <CustomSelect
              value={form.status}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  status: value as ProductForm["status"],
                }))
              }
              options={[
                { value: "draft", label: "草稿" },
                { value: "active", label: "上架" },
                { value: "archived", label: "归档" },
              ]}
            />
          </label>
          <div className="field form-grid-wide">
            <span className="fine-print">可用节点</span>
            <div className="catalog-node-selector">
              {catalog.servers.map((server) => (
                <section className="catalog-node-group" key={server.id}>
                  <strong>{server.name}</strong>
                  {server.nodes.map((node) => (
                    <label className="checkbox-row" key={node.id}>
                      <input
                        type="checkbox"
                        checked={form.nodeIds.includes(node.id)}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            nodeIds: event.target.checked
                              ? [...current.nodeIds, node.id]
                              : current.nodeIds.filter((id) => id !== node.id),
                          }))
                        }
                      />
                      <span>
                        {node.label} ·{" "}
                        {node.protocol === "vless_reality"
                          ? "VLESS + Reality"
                          : "Hysteria2"}
                      </span>
                      <span
                        className={`badge ${node.serviceable ? "success" : "neutral"}`}
                      >
                        {node.serviceable ? "可用" : "已停用"}
                      </span>
                    </label>
                  ))}
                </section>
              ))}
            </div>
          </div>
          <label className="field">
            <span className="fine-print">说明</span>
            <textarea
              className="control"
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </label>
          <label className="field">
            <span className="fine-print">默认店铺链接（兼容旧商品）</span>
            <input
              className="control"
              type="url"
              placeholder="销售周期未设置时使用"
              value={form.storeUrl}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  storeUrl: event.target.value,
                }))
              }
            />
          </label>
          <label className="field">
            <span className="fine-print">上行限速（Mbps）</span>
            <input
              className="control"
              type="number"
              min={0}
              step={1}
              value={form.speedUpMbps}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  speedUpMbps: Number(event.target.value),
                }))
              }
            />
          </label>
          <label className="field">
            <span className="fine-print">下行限速（Mbps）</span>
            <input
              className="control"
              type="number"
              min={0}
              step={1}
              value={form.speedDownMbps}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  speedDownMbps: Number(event.target.value),
                }))
              }
            />
          </label>
          <label className="field">
            <span className="fine-print">设备数量</span>
            <input className="control" value="不限设备" disabled />
          </label>
          <label className="field">
            <span className="fine-print">默认倍率</span>
            <input
              className="control"
              type="number"
              min={0.1}
              max={100}
              step={0.1}
              value={form.defaultTrafficMultiplier}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  defaultTrafficMultiplier: Number(event.target.value),
                }))
              }
            />
          </label>
          {form.kind === "plan" ? (
            <>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.featured}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      featured: event.target.checked,
                    }))
                  }
                />
                <span>在会员商城标记为推荐套餐</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.referralEligible}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      referralEligible: event.target.checked,
                    }))
                  }
                />
                <span>该套餐 CDK 可触发邀请奖励</span>
              </label>
              <label className="field">
                <span className="fine-print">每账号终身限购次数</span>
                <input
                  className="control"
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  value={form.purchaseLimitPerUser}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      purchaseLimitPerUser: Number(event.target.value),
                    }))
                  }
                />
                <small>填 0 表示不限购；Go 填 1。</small>
              </label>
              {form.purchaseLimitPerUser > 0 ? (
                <label className="field">
                  <span className="fine-print">限购规则标识</span>
                  <input
                    className="control mono"
                    value={form.purchaseLimitKey}
                    placeholder="trial-go"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        purchaseLimitKey: event.target.value,
                      }))
                    }
                  />
                  <small>新版商品沿用同一标识，历史购买仍计入限制。</small>
                </label>
              ) : null}
            </>
          ) : (
            <div className="feedback info form-grid-wide">
              流量包是永久有效的独立权益，用户无需先购买套餐即可使用所选节点。
            </div>
          )}
          <label className="field form-grid-wide">
            <span className="fine-print">
              {form.kind === "plan" ? "每月流量（GB）" : "流量包额度（GB）"}
            </span>
            <input
              className="control"
              type="number"
              min={0.01}
              step={0.01}
              value={form.trafficGbInput}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  trafficGbInput: event.target.value,
                }))
              }
            />
            <small>
              {form.kind === "plan"
                ? "月付、季付和年付共享这一份月度额度，每月按订阅起始日重置。"
                : "购买后一次性到账，永久有效。"}
            </small>
          </label>
          <div className="offer-editor-list form-grid-wide">
            <strong>销售规格</strong>
            {form.offers.map((offer) => (
              <div className="offer-editor-row" key={offer.billingPeriod}>
                <span className="badge info">{offer.name}</span>
                <label className="field">
                  <span className="fine-print">价格（元）</span>
                  <input
                    className="control"
                    type="number"
                    min={0}
                    step="0.01"
                    value={(offer.priceCents / 100).toString()}
                    onChange={(event) =>
                      updateOffer(offer.billingPeriod, {
                        priceCents: Math.round(
                          Number(event.target.value) * 100,
                        ),
                      })
                    }
                  />
                </label>
                <label className="field offer-editor-store">
                  <span className="fine-print">
                    {form.kind === "plan" ? "该周期店铺链接" : "店铺链接"}
                  </span>
                  <input
                    className="control"
                    type="url"
                    placeholder="https://store.example.com/offer"
                    value={offer.storeUrl ?? ""}
                    onChange={(event) =>
                      updateOffer(offer.billingPeriod, {
                        storeUrl: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
            ))}
          </div>
        </form>
      </Drawer>
    </ConsoleShell>
  );
}
