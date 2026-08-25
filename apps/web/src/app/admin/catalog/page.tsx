"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomSelect } from "@/components/custom-select";
import { DataTable } from "@/components/data-table";
import { Drawer } from "@/components/drawer";
import { Icon } from "@/components/icon";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatMoney } from "@/lib/format";

type Offer = {
  id?: string;
  slug: string;
  name: string;
  billingPeriod: "monthly" | "quarterly" | "yearly";
  intervalMonths: number;
  trafficBytes: number;
  priceCents: number;
  storeUrl?: string | null;
  active: boolean;
  isDefault: boolean;
  archivedAt?: string | null;
};
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
  accessProfileId: string;
  quotaCadence: string;
  access: {
    profileName?: string | null;
    speedUpMbps: number;
    speedDownMbps: number;
    deviceLimit: number;
    servers: Array<{
      id: string;
      name: string;
      nodes: Array<{ id: string; label: string; serviceable: boolean }>;
    }>;
  };
  offers: Offer[];
};
type Profile = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  speedUpMbps: number;
  speedDownMbps: number;
  deviceLimit: number;
  nodes: Array<{ nodeLabel: string; active: boolean }>;
};
type Catalog = { products: Product[]; accessProfiles: Profile[] };
type ProductForm = {
  slug: string;
  kind: "plan" | "traffic_pack";
  status: "draft" | "active" | "archived";
  name: string;
  description: string;
  storeUrl: string;
  accessProfileId: string;
  speedUpMbps: number;
  speedDownMbps: number;
  defaultTrafficMultiplier: number;
  accent: string;
  sortOrder: number;
  offers: Offer[];
};
type View = "products" | "access";

const offerTemplate = (
  period: Offer["billingPeriod"],
  kind: ProductForm["kind"],
  index: number,
): Offer => ({
  slug: `${kind === "plan" ? "plan" : "pack"}-${period}`,
  name:
    period === "monthly" ? "月付" : period === "quarterly" ? "季付" : "年付",
  billingPeriod: period,
  intervalMonths: period === "monthly" ? 1 : period === "quarterly" ? 3 : 12,
  trafficBytes:
    (kind === "plan" ? 200 : period === "quarterly" ? 50 : 200) * 1024 ** 3,
  priceCents: kind === "plan" ? [1800, 5000, 18000][index] : [900, 3000][index],
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
  accessProfileId: "",
  speedUpMbps: 20,
  speedDownMbps: 100,
  defaultTrafficMultiplier: 1,
  accent: kind === "plan" ? "green" : "teal",
  sortOrder: 0,
  offers: (kind === "plan"
    ? ["monthly", "quarterly", "yearly"]
    : ["quarterly", "yearly"]
  ).map((period, index) =>
    offerTemplate(period as Offer["billingPeriod"], kind, index),
  ),
});

export default function CatalogPage() {
  const { token } = useAuth();
  const [catalog, setCatalog] = useState<Catalog>({
    products: [],
    accessProfiles: [],
  });
  const [view, setView] = useState<View>("products");
  const [kindFilter, setKindFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(() => emptyForm());
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setCatalog(await apiRequest<Catalog>("/api/admin/catalog", { token }));
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "商品目录加载失败。",
      );
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
    const next = product
      ? {
          slug: product.slug,
          kind: product.kind,
          status: product.status,
          name: product.name,
          description: product.description ?? "",
          storeUrl: product.storeUrl ?? "",
          accessProfileId: product.accessProfileId,
          speedUpMbps: product.access.speedUpMbps,
          speedDownMbps: product.access.speedDownMbps,
          defaultTrafficMultiplier: product.defaultTrafficMultiplier,
          accent: product.accent,
          sortOrder: product.sortOrder,
          offers: product.offers
            .filter((offer) => !offer.archivedAt)
            .map((offer) => ({ ...offer })),
        }
      : {
          ...emptyForm(),
          accessProfileId:
            catalog.accessProfiles.find((profile) => profile.active)?.id ?? "",
        };
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
      accessProfileId: current.accessProfileId,
      speedUpMbps: current.speedUpMbps,
      speedDownMbps: current.speedDownMbps,
      defaultTrafficMultiplier: current.defaultTrafficMultiplier,
      status: current.status,
      sortOrder: current.sortOrder,
    }));
  }

  function updateOffer(period: Offer["billingPeriod"], patch: Partial<Offer>) {
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
    setBusy(true);
    setError(null);
    try {
      const offers = form.offers.map((offer) => ({
        id: offer.id,
        slug: offer.slug.trim(),
        name: offer.name.trim(),
        billingPeriod: offer.billingPeriod,
        trafficBytes: offer.trafficBytes,
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
            accessProfileId: form.accessProfileId,
            speedUpMbps: form.speedUpMbps,
            speedDownMbps: form.speedDownMbps,
            defaultTrafficMultiplier: form.defaultTrafficMultiplier,
            accent: form.accent,
            sortOrder: form.sortOrder,
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

  return (
    <ConsoleShell
      title="商品中心"
      subtitle="套餐、流量包与访问策略"
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
            footnote="套餐与独立流量包"
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
            footnote="独立接入，3 / 12 个月"
          />
          <MetricCard
            label="访问策略"
            value={String(catalog.accessProfiles.length)}
            footnote="绑定节点资源池"
          />
        </div>
        <div className="segmented-control">
          <button
            type="button"
            className={view === "products" ? "active" : ""}
            onClick={() => setView("products")}
          >
            商品与规格
          </button>
          <button
            type="button"
            className={view === "access" ? "active" : ""}
            onClick={() => setView("access")}
          >
            访问策略
          </button>
        </div>
        {view === "products" ? (
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
                `${product.access.speedDownMbps} Mbps · ${product.access.deviceLimit} 台`,
                product.access.servers
                  .map((server) => server.name)
                  .join(" · ") || "未绑定",
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
        ) : (
          <Panel
            title="访问策略"
            copy="速率和设备数由权益快照保存，节点访问通过资源池计算。"
          >
            <DataTable
              headers={["策略", "速率", "设备", "兼容节点", "状态"]}
              rows={catalog.accessProfiles.map((profile) => [
                <span className="list" key={profile.id}>
                  <strong>{profile.name}</strong>
                  <small className="mono">{profile.slug}</small>
                </span>,
                `${profile.speedUpMbps} / ${profile.speedDownMbps} Mbps`,
                `${profile.deviceLimit} 台`,
                profile.nodes.map((node) => node.nodeLabel).join(" · ") ||
                  "由资源池提供",
                <span
                  className={`badge ${profile.active ? "success" : "neutral"}`}
                  key={`${profile.id}-status`}
                >
                  {profile.active ? "启用" : "停用"}
                </span>,
              ])}
            />
          </Panel>
        )}
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
                !form.accessProfileId
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
          <label className="field">
            <span className="fine-print">访问策略</span>
            <CustomSelect
              value={form.accessProfileId}
              onChange={(value) =>
                setForm((current) => ({ ...current, accessProfileId: value }))
              }
              options={catalog.accessProfiles.map((profile) => ({
                value: profile.id,
                label: profile.name,
              }))}
            />
          </label>
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
          <div className="offer-editor-list">
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
                <label className="field">
                  <span className="fine-print">额度（GB）</span>
                  <input
                    className="control"
                    type="number"
                    min={1}
                    value={Math.round(offer.trafficBytes / 1024 ** 3)}
                    onChange={(event) =>
                      updateOffer(offer.billingPeriod, {
                        trafficBytes: Math.round(
                          Number(event.target.value) * 1024 ** 3,
                        ),
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span className="fine-print">该周期店铺链接</span>
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
