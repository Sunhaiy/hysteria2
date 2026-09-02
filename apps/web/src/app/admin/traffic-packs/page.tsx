"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomSelect } from "@/components/custom-select";
import { DataTable } from "@/components/data-table";
import { Drawer } from "@/components/drawer";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatMoney } from "@/lib/format";
import type {
  AccessProfileRecord,
  CatalogResponse,
  TrafficPackProductRecord,
} from "@/lib/types";
import { slugifyValue } from "@/lib/ui";

const GB = 1024 * 1024 * 1024;

type ProductForm = {
  slug: string;
  name: string;
  description: string;
  active: boolean;
  trafficBytes: number;
  validityDays: number;
  accessProfileId: string;
  priceCents: number;
};

function emptyForm(accessProfileId = ""): ProductForm {
  return {
    slug: "",
    name: "",
    description: "",
    active: true,
    trafficBytes: 100 * GB,
    validityDays: 30,
    accessProfileId,
    priceCents: 1000,
  };
}

function fromRecord(product: TrafficPackProductRecord): ProductForm {
  return {
    slug: product.slug,
    name: product.name,
    description: product.description ?? "",
    active: product.active,
    trafficBytes: product.trafficBytes,
    validityDays: product.validityDays ?? 30,
    accessProfileId: product.accessProfileId ?? "",
    priceCents: product.priceCents,
  };
}

export default function AdminTrafficPacksPage() {
  const { token } = useAuth();
  const [products, setProducts] = useState<TrafficPackProductRecord[]>([]);
  const [accessProfiles, setAccessProfiles] = useState<AccessProfileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingProduct, setEditingProduct] =
    useState<TrafficPackProductRecord | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const catalog = await apiRequest<CatalogResponse>("/api/admin/catalog", {
        token,
      });
      setProducts(catalog.trafficPacks);
      setAccessProfiles(catalog.accessProfiles);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "流量包商品加载失败。",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const originalForm = useMemo(
    () =>
      editingProduct
        ? fromRecord(editingProduct)
        : emptyForm(accessProfiles.find((profile) => profile.active)?.id),
    [accessProfiles, editingProduct],
  );
  const isDirty =
    drawerOpen && JSON.stringify(form) !== JSON.stringify(originalForm);

  function set<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreate() {
    setEditingProduct(null);
    setForm(emptyForm(accessProfiles.find((profile) => profile.active)?.id));
    setError(null);
    setDrawerOpen(true);
  }

  function openEdit(product: TrafficPackProductRecord) {
    setEditingProduct(product);
    setForm(fromRecord(product));
    setError(null);
    setDrawerOpen(true);
  }

  function requestClose() {
    if (isDirty && !window.confirm("有未保存的修改，确定关闭吗？")) return;
    setDrawerOpen(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    setError(null);
    setFeedback(null);
    const body = {
      ...form,
      slug: form.slug.trim(),
      name: form.name.trim(),
      description: form.description.trim(),
    };

    try {
      if (editingProduct) {
        await apiRequest(
          `/api/admin/traffic-pack-products/${editingProduct.id}`,
          {
            method: "PATCH",
            token,
            body,
          },
        );
      } else {
        await apiRequest("/api/admin/traffic-pack-products", {
          method: "POST",
          token,
          body,
        });
      }
      setDrawerOpen(false);
      setFeedback(editingProduct ? "流量包商品已更新。" : "流量包商品已创建。");
      await load();
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "流量包商品保存失败。",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(product: TrafficPackProductRecord) {
    if (!token || product.archivedAt) return;
    if (!window.confirm(`归档“${product.name}”？历史订单和 CDK 记录会保留。`)) {
      return;
    }
    setError(null);
    setFeedback(null);
    try {
      await apiRequest(`/api/admin/traffic-pack-products/${product.id}`, {
        method: "DELETE",
        token,
      });
      setFeedback("流量包商品已归档。");
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "归档流量包商品失败。");
    }
  }

  const submitDisabled =
    saving ||
    !form.slug.trim() ||
    !form.name.trim() ||
    !form.accessProfileId ||
    form.trafficBytes < 1 ||
    form.priceCents < 0 ||
    form.validityDays < 1;

  return (
    <ConsoleShell
      title="流量包商品"
      subtitle="上架额外流量商品，会员可在有效套餐上直接叠加购买。"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      dataViewport
      toolbarMeta={
        <span className="badge info">
          {loading ? "加载中..." : `${products.length} 个商品`}
        </span>
      }
      toolbarActions={
        <>
          <button className="action-button" type="button" onClick={openCreate}>
            新建流量包
          </button>
          <button
            className="toolbar-button"
            type="button"
            onClick={() => void load()}
          >
            刷新
          </button>
        </>
      }
    >
      {feedback ? <div className="feedback success">{feedback}</div> : null}
      {!drawerOpen && error ? (
        <div className="feedback error">{error}</div>
      ) : null}

      <Panel
        className="admin-data-panel"
        title="商品列表"
        copy="流量包不会改变会员当前套餐的节点、速率或订阅周期。"
      >
        {loading && products.length === 0 ? (
          <div className="skeleton-rows">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="skeleton skeleton-row" />
            ))}
          </div>
        ) : null}

        {products.length > 0 ? (
          <DataTable
            headers={["商品", "访问策略", "流量", "有效期", "价格", "状态", "操作"]}
            rows={products.map((product) => [
              <button
                key={product.id}
                type="button"
                className="link-button"
                onClick={() => !product.archivedAt && openEdit(product)}
                disabled={Boolean(product.archivedAt)}
              >
                <span className="admin-plan-name">
                  <i aria-hidden="true" />
                  {product.name}
                </span>
                <span className="muted">{product.slug}</span>
              </button>,
              product.accessProfileName ?? "未配置",
              formatBytes(product.trafficBytes),
              `${product.validityDays ?? 0} 天`,
              formatMoney(product.priceCents),
              <span
                key={`${product.id}-status`}
                className={`badge ${product.archivedAt ? "neutral" : product.active ? "success" : "neutral"}`}
              >
                {product.archivedAt ? "已归档" : product.active ? "已上架" : "已下架"}
              </span>,
              product.archivedAt ? (
                <span key={`${product.id}-archived`} className="muted">
                  已保留历史记录
                </span>
              ) : (
                <button
                  key={`${product.id}-archive`}
                  className="ghost-button compact"
                  type="button"
                  onClick={() => void handleArchive(product)}
                >
                  归档
                </button>
              ),
            ])}
          />
        ) : !loading ? (
          <div className="empty-state">
            <div className="empty-state-title">还没有流量包商品</div>
            <button
              className="action-button"
              type="button"
              onClick={openCreate}
            >
              创建第一个流量包
            </button>
          </div>
        ) : null}
      </Panel>

      <Drawer
        open={drawerOpen}
        onClose={requestClose}
        title={editingProduct ? `编辑：${editingProduct.name}` : "新建流量包"}
        subtitle="购买后立即叠加到会员当前有效订阅"
        isDirty={isDirty}
        footer={
          <div className="toolbar-actions">
            <button
              className="action-button"
              type="submit"
              form="traffic-pack-form"
              disabled={submitDisabled}
            >
              {saving ? "保存中..." : editingProduct ? "保存商品" : "创建商品"}
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={requestClose}
            >
              取消
            </button>
          </div>
        }
      >
        {error ? <div className="feedback error">{error}</div> : null}
        <form
          id="traffic-pack-form"
          className="form-grid"
          onSubmit={handleSubmit}
        >
          <div className="two-col">
            <label className="field">
              <span className="fine-print">商品名称</span>
              <input
                className="control"
                value={form.name}
                placeholder="如：100 GB 加油包"
                onChange={(event) => {
                  const name = event.target.value;
                  setForm((current) => ({
                    ...current,
                    name,
                    slug:
                      !editingProduct &&
                      (!current.slug ||
                        current.slug === slugifyValue(current.name))
                        ? slugifyValue(name)
                        : current.slug,
                  }));
                }}
                required
              />
            </label>
            <label className="field">
              <span className="fine-print">Slug</span>
              <input
                className="control"
                value={form.slug}
                placeholder="traffic-100g"
                onChange={(event) =>
                  set("slug", slugifyValue(event.target.value))
                }
                required
              />
            </label>
          </div>

          <div className="two-col">
            <label className="field">
              <span className="fine-print">流量（GB）</span>
              <input
                className="control"
                type="number"
                min="1"
                step="1"
                value={Math.round((form.trafficBytes / GB) * 100) / 100}
                onChange={(event) =>
                  set(
                    "trafficBytes",
                    Math.round(Number(event.target.value) * GB),
                  )
                }
                required
              />
              <span className="field-hint">
                {formatBytes(form.trafficBytes)}
              </span>
            </label>
            <label className="field">
              <span className="fine-print">价格（元）</span>
              <input
                className="control"
                type="number"
                min="0"
                step="0.01"
                value={form.priceCents / 100}
                onChange={(event) =>
                  set(
                    "priceCents",
                    Math.round(Number(event.target.value) * 100),
                  )
                }
                required
              />
              <span className="field-hint">{formatMoney(form.priceCents)}</span>
            </label>
          </div>

          <div className="two-col">
            <label className="field">
              <span className="fine-print">访问策略</span>
              <CustomSelect
                value={form.accessProfileId}
                onChange={(value) => set("accessProfileId", value)}
                options={[
                  { value: "", label: "选择访问策略..." },
                  ...accessProfiles.map((profile) => ({
                    value: profile.id,
                    label: `${profile.name}${profile.active ? "" : "（已停用）"}`,
                  })),
                ]}
              />
              <span className="field-hint">决定流量包可用于哪些节点和速率策略。</span>
            </label>
            <label className="field">
              <span className="fine-print">有效期（天）</span>
              <input
                className="control"
                type="number"
                min="1"
                value={form.validityDays}
                onChange={(event) => set("validityDays", Number(event.target.value))}
                required
              />
              <span className="field-hint">实际到期时间不会超过会员当前订阅到期时间。</span>
            </label>
          </div>

          <label className="field">
            <span className="fine-print">商品描述</span>
            <textarea
              className="control textarea"
              value={form.description}
              placeholder="展示给会员的商品说明"
              onChange={(event) => set("description", event.target.value)}
            />
          </label>

          <label className="field checkbox-row">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => set("active", event.target.checked)}
            />
            <span>上架销售</span>
          </label>
        </form>
      </Drawer>
    </ConsoleShell>
  );
}
