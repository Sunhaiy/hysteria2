"use client";

import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomerLink } from "@/components/customer-link";
import { CustomSelect } from "@/components/custom-select";
import { DataTable } from "@/components/data-table";
import { Drawer } from "@/components/drawer";
import { Panel } from "@/components/panel";
import { TicketThread } from "@/components/ticket-thread";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatDateTime } from "@/lib/format";
import type { PaginatedResponse } from "@/lib/types";
import {
  ticketCategoryName,
  ticketPriorityName,
  ticketStatusName,
  type SupportTicketDetail,
  type SupportTicketRecord,
  type TicketStatus,
} from "@/lib/ticket-types";

const emptyPage: PaginatedResponse<SupportTicketRecord> = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
};

export default function AdminTicketsPage() {
  const { token } = useAuth();
  const [data, setData] = useState(emptyPage);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [detail, setDetail] = useState<SupportTicketDetail | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      setLoading(true);
      try {
        const query = new URLSearchParams({
          page: String(page),
          pageSize: "20",
        });
        if (debouncedSearch) query.set("q", debouncedSearch);
        if (status !== "all") query.set("status", status);
        if (category !== "all") query.set("category", category);
        setData(
          await apiRequest(`/api/admin/tickets?${query}`, { token, signal }),
        );
        setError(null);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(cause instanceof ApiError ? cause.message : "工单加载失败。");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [category, debouncedSearch, page, status, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  async function openTicket(id: string) {
    if (!token) return;
    setBusy(true);
    try {
      setDetail(
        await apiRequest(`/api/admin/tickets/${id}?page=1&pageSize=100`, {
          token,
        }),
      );
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "工单详情加载失败。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (!token || !detail || !reply.trim()) return;
    setBusy(true);
    try {
      await apiRequest(`/api/admin/tickets/${detail.ticket.id}/messages`, {
        method: "POST",
        token,
        body: { body: reply },
      });
      setReply("");
      await Promise.all([openTicket(detail.ticket.id), load()]);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "回复失败。");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(nextStatus: TicketStatus) {
    if (!token || !detail) return;
    setBusy(true);
    try {
      await apiRequest(`/api/admin/tickets/${detail.ticket.id}`, {
        method: "PATCH",
        token,
        body: { status: nextStatus },
      });
      await Promise.all([openTicket(detail.ticket.id), load()]);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "状态更新失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConsoleShell
      title="工单中心"
      subtitle="处理会员接入、套餐与技术问题"
      scope="Support"
      navItems={adminNav}
      requireRole="admin"
      dataViewport
      toolbarMeta={<span className="badge info">{data.total} 个工单</span>}
    >
      {error ? <div className="feedback error">{error}</div> : null}
      <Panel
        className="admin-data-panel"
        title="工单队列"
        action={
          <div className="inline-form compact admin-compact-filters">
            <input
              className="control"
              placeholder="编号、主题或用户邮箱"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <CustomSelect
              value={status}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
              options={[
                { value: "all", label: "全部状态" },
                { value: "waiting_staff", label: "等待客服" },
                { value: "waiting_member", label: "等待用户" },
                { value: "closed", label: "已关闭" },
              ]}
            />
            <CustomSelect
              value={category}
              onChange={(value) => {
                setCategory(value);
                setPage(1);
              }}
              options={[
                { value: "all", label: "全部分类" },
                ...Object.entries(ticketCategoryName).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
            />
          </div>
        }
      >
        <DataTable
          loading={loading}
          emptyText="当前没有匹配工单"
          headers={[
            "编号",
            "用户",
            "主题",
            "分类",
            "优先级",
            "状态",
            "最近更新",
            "操作",
          ]}
          rows={data.items.map((ticket) => [
            <span className="mono" key={`${ticket.id}-number`}>
              #{ticket.number}
            </span>,
            <CustomerLink
              id={ticket.user.id}
              displayName={ticket.user.displayName}
              email={ticket.user.email}
              key={`${ticket.id}-user`}
            />,
            <span className="list" key={`${ticket.id}-subject`}>
              <strong>{ticket.subject}</strong>
              <small>{ticket.lastMessage?.body ?? "-"}</small>
            </span>,
            ticketCategoryName[ticket.category],
            <span
              className={`badge ${ticket.priority === "high" ? "warn" : "neutral"}`}
              key={`${ticket.id}-priority`}
            >
              {ticketPriorityName[ticket.priority]}
            </span>,
            <span
              className={`badge ${ticket.status === "closed" ? "neutral" : ticket.status === "waiting_staff" ? "warn" : "info"}`}
              key={`${ticket.id}-status`}
            >
              {ticketStatusName[ticket.status]}
            </span>,
            formatDateTime(ticket.lastMessageAt),
            <button
              className="ghost-button compact"
              type="button"
              key={`${ticket.id}-open`}
              onClick={() => void openTicket(ticket.id)}
            >
              处理
            </button>,
          ])}
          pagination={{
            page: data.page,
            pageSize: data.pageSize,
            total: data.total,
            totalPages: data.totalPages,
            onPageChange: setPage,
          }}
        />
      </Panel>
      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={
          detail
            ? `工单 #${detail.ticket.number} · ${detail.ticket.subject}`
            : "工单详情"
        }
        footer={
          detail ? (
            <div className="toolbar-actions">
              <button
                className="action-button"
                type="button"
                disabled={
                  busy || detail.ticket.status === "closed" || !reply.trim()
                }
                onClick={() => void sendReply()}
              >
                回复用户
              </button>
              {detail.ticket.status === "closed" ? (
                <button
                  className="ghost-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void changeStatus("waiting_staff")}
                >
                  重新打开
                </button>
              ) : (
                <button
                  className="ghost-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void changeStatus("closed")}
                >
                  关闭工单
                </button>
              )}
            </div>
          ) : undefined
        }
      >
        {detail ? (
          <div className="page-stack">
            <div className="toolbar-actions">
              <CustomerLink
                id={detail.ticket.user.id}
                displayName={detail.ticket.user.displayName}
                email={detail.ticket.user.email}
              />
              <span className="badge neutral">
                {ticketStatusName[detail.ticket.status]}
              </span>
            </div>
            <TicketThread messages={detail.messages.items} />
            {detail.ticket.status !== "closed" ? (
              <label className="field">
                <span className="fine-print">客服回复</span>
                <textarea
                  className="control"
                  rows={5}
                  maxLength={5000}
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                />
              </label>
            ) : (
              <div className="feedback info">
                此工单已关闭，可重新打开后继续处理。
              </div>
            )}
          </div>
        ) : null}
      </Drawer>
    </ConsoleShell>
  );
}
