import type { PaginatedResponse } from "./types";

export type TicketCategory = "access" | "billing" | "technical" | "other";
export type TicketPriority = "low" | "normal" | "high";
export type TicketStatus = "waiting_staff" | "waiting_member" | "closed";

export interface SupportTicketRecord {
  id: string;
  number: number;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  lastMessageAt: string;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage?: {
    body: string;
    createdAt: string;
    authorRole: "admin" | "member";
  } | null;
  user: { id: string; email: string; displayName: string };
}

export interface SupportTicketMessage {
  id: string;
  body: string;
  createdAt: string;
  author: {
    id: string;
    displayName: string;
    email: string;
    role: "admin" | "member";
  };
}

export interface SupportTicketDetail {
  ticket: SupportTicketRecord;
  messages: PaginatedResponse<SupportTicketMessage>;
}

export const ticketCategoryName: Record<TicketCategory, string> = {
  access: "接入问题",
  billing: "套餐与账单",
  technical: "技术故障",
  other: "其他",
};

export const ticketStatusName: Record<TicketStatus, string> = {
  waiting_staff: "等待客服",
  waiting_member: "等待用户",
  closed: "已关闭",
};

export const ticketPriorityName: Record<TicketPriority, string> = {
  low: "低",
  normal: "普通",
  high: "高",
};
