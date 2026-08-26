"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomSelect } from "@/components/custom-select";
import { DataTable } from "@/components/data-table";
import { Drawer } from "@/components/drawer";
import { Icon } from "@/components/icon";
import { Panel } from "@/components/panel";
import { TicketThread } from "@/components/ticket-thread";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatDateTime } from "@/lib/format";
import type { PaginatedResponse } from "@/lib/types";
import {
  ticketCategoryName,
  ticketPriorityName,
  ticketStatusName,
  type SupportTicketDetail,
  type SupportTicketRecord,
  type TicketCategory,
  type TicketPriority,
} from "@/lib/ticket-types";

const emptyPage: PaginatedResponse<SupportTicketRecord> = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
};

type PublishedAnnouncement = {
  title: string;
  content: string;
  version: string;
};

export default function PortalTicketsPage() {
  const { token } = useAuth();
  const [data, setData] = useState(emptyPage);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [detail, setDetail] = useState<SupportTicketDetail | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<TicketCategory>("access");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [announcement, setAnnouncement] =
    useState<PublishedAnnouncement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      setLoading(true);
      try {
        const query = new URLSearchParams({
          page: String(page),
          pageSize: "20",
        });
        if (status !== "all") query.set("status", status);
        setData(
          await apiRequest(`/api/portal/tickets?${query}`, { token, signal }),
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
    [page, status, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void apiRequest<{ announcement: PublishedAnnouncement | null }>(
      "/api/portal/announcement/current",
      { token, signal: controller.signal },
    )
      .then((response) => setAnnouncement(response.announcement))
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setAnnouncement(null);
        }
      });
    return () => controller.abort();
  }, [token]);

  async function openTicket(id: string) {
    if (!token) return;
    setBusy(true);
    try {
      setDetail(
        await apiRequest(`/api/portal/tickets/${id}?page=1&pageSize=100`, {
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

  async function createTicket(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    try {
      await apiRequest("/api/portal/tickets", {
        method: "POST",
        token,
        body: { subject, category, priority, message },
      });
      setCreateOpen(false);
      setSubject("");
      setMessage("");
      setPriority("normal");
      setFeedback("工单已提交，客服回复后状态会自动更新。");
      setPage(1);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "工单提交失败。");
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (!token || !detail || !reply.trim()) return;
    setBusy(true);
    try {
      await apiRequest(`/api/portal/tickets/${detail.ticket.id}/messages`, {
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

  return (
    <ConsoleShell
      title="我的工单"
      subtitle="与客服处理接入、套餐和技术问题"
      scope="Support"
      navItems={portalNav}
      requireRole="member"
      toolbarMeta={<span className="badge info">{data.total} 个工单</span>}
      toolbarActions={
        <button
          className="action-button"
          type="button"
          onClick={() => setCreateOpen(true)}
        >
          <Icon name="add" />
          新建工单
        </button>
      }
    >
      {announcement ? (
        <aside
          className="ticket-announcement"
          aria-labelledby="ticket-announcement-title"
        >
          <span className="ticket-announcement-icon">
            <Icon name="warning" />
          </span>
          <div>
            <span className="fine-print">服务公告</span>
            <h2 id="ticket-announcement-title">{announcement.title}</h2>
            <p>{announcement.content}</p>
          </div>
        </aside>
      ) : null}
      {error ? <div className="feedback error">{error}</div> : null}
      {feedback ? <div className="feedback success">{feedback}</div> : null}
      <Panel
        title="工单记录"
        allowOverflow
        action={
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
        }
      >
        <DataTable
          loading={loading}
          emptyText="还没有工单"
          headers={[
            "编号",
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
            <span className="list" key={`${ticket.id}-subject`}>
              <strong>{ticket.subject}</strong>
              <small>{ticket.lastMessage?.body ?? "-"}</small>
            </span>,
            ticketCategoryName[ticket.category],
            ticketPriorityName[ticket.priority],
            <span
              className={`badge ${ticket.status === "closed" ? "neutral" : ticket.status === "waiting_member" ? "info" : "warn"}`}
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
              查看
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
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建工单"
        footer={
          <div className="toolbar-actions">
            <button
              className="action-button"
              type="submit"
              form="create-ticket"
              disabled={busy || !subject.trim() || !message.trim()}
            >
              提交
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => setCreateOpen(false)}
            >
              取消
            </button>
          </div>
        }
      >
        <form id="create-ticket" className="form-grid" onSubmit={createTicket}>
          <label className="field">
            <span className="fine-print">主题</span>
            <input
              className="control"
              maxLength={160}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="fine-print">分类</span>
            <CustomSelect
              value={category}
              onChange={(value) => setCategory(value as TicketCategory)}
              options={Object.entries(ticketCategoryName).map(
                ([value, label]) => ({ value, label }),
              )}
            />
          </label>
          <label className="field">
            <span className="fine-print">优先级</span>
            <CustomSelect
              value={priority}
              onChange={(value) => setPriority(value as TicketPriority)}
              options={Object.entries(ticketPriorityName).map(
                ([value, label]) => ({ value, label }),
              )}
            />
          </label>
          <label className="field">
            <span className="fine-print">问题描述</span>
            <textarea
              className="control"
              rows={8}
              maxLength={5000}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
        </form>
      </Drawer>
      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={
          detail
            ? `工单 #${detail.ticket.number} · ${detail.ticket.subject}`
            : "工单详情"
        }
        footer={
          detail?.ticket.status !== "closed" ? (
            <div className="toolbar-actions">
              <button
                className="action-button"
                type="button"
                disabled={busy || !reply.trim()}
                onClick={() => void sendReply()}
              >
                发送回复
              </button>
            </div>
          ) : undefined
        }
      >
        {detail ? (
          <div className="page-stack">
            <div className="toolbar-actions">
              <span className="badge info">
                {ticketCategoryName[detail.ticket.category]}
              </span>
              <span className="badge neutral">
                {ticketStatusName[detail.ticket.status]}
              </span>
            </div>
            <TicketThread messages={detail.messages.items} />
            {detail.ticket.status !== "closed" ? (
              <label className="field">
                <span className="fine-print">回复</span>
                <textarea
                  className="control"
                  rows={5}
                  maxLength={5000}
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                />
              </label>
            ) : (
              <div className="feedback info">此工单已关闭。</div>
            )}
          </div>
        ) : null}
      </Drawer>
    </ConsoleShell>
  );
}
