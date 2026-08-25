import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
} from '@prisma/client';
import { pageResponse, parsePage, type PageQuery } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateSupportTicketDto,
  UpdateSupportTicketDto,
} from './tickets.dto';

export interface SupportTicketQuery extends PageQuery {
  q?: string;
  status?: string;
  category?: string;
}

const ticketInclude = {
  user: { select: { id: true, email: true, displayName: true } },
  messages: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    include: {
      author: { select: { id: true, displayName: true, role: true } },
    },
  },
  _count: { select: { messages: true } },
} satisfies Prisma.SupportTicketInclude;

type TicketSummary = Prisma.SupportTicketGetPayload<{
  include: typeof ticketInclude;
}>;

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  listMember(userId: string, query: SupportTicketQuery) {
    return this.list({ userId }, query);
  }

  listAdmin(query: SupportTicketQuery) {
    return this.list({}, query);
  }

  async detailMember(userId: string, id: string, query: PageQuery) {
    return this.detail(id, query, userId);
  }

  async detailAdmin(id: string, query: PageQuery) {
    return this.detail(id, query);
  }

  async create(userId: string, input: CreateSupportTicketDto) {
    const now = new Date();
    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        subject: input.subject.trim(),
        category: this.category(input.category),
        priority: this.priority(input.priority ?? 'normal'),
        status: SupportTicketStatus.WAITING_STAFF,
        lastMessageAt: now,
        messages: {
          create: {
            authorId: userId,
            body: input.message.trim(),
            createdAt: now,
          },
        },
      },
      include: ticketInclude,
    });
    return this.presentTicket(ticket);
  }

  replyMember(userId: string, id: string, body: string) {
    return this.reply(id, userId, body, false, userId);
  }

  replyAdmin(actorId: string, id: string, body: string) {
    return this.reply(id, actorId, body, true);
  }

  async updateStatus(
    actorId: string,
    id: string,
    input: UpdateSupportTicketDto,
  ) {
    const existing = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('工单不存在');
    const status = this.status(input.status);
    const ticket = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.supportTicket.update({
        where: { id },
        data: {
          status,
          closedAt: status === SupportTicketStatus.CLOSED ? new Date() : null,
        },
        include: ticketInclude,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'SUPPORT_TICKET_STATUS_CHANGED',
          targetType: 'SupportTicket',
          targetId: id,
          metadata: { before: existing.status, after: status },
        },
      });
      return updated;
    });
    return this.presentTicket(ticket);
  }

  private async list(
    scope: Prisma.SupportTicketWhereInput,
    query: SupportTicketQuery,
  ) {
    const { page, pageSize, skip } = parsePage(query);
    const status = this.optionalStatus(query.status);
    const category = this.optionalCategory(query.category);
    const q = query.q?.trim();
    const where: Prisma.SupportTicketWhereInput = {
      ...scope,
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
      ...(q
        ? {
            OR: [
              { subject: { contains: q, mode: 'insensitive' } },
              { user: { email: { contains: q, mode: 'insensitive' } } },
              ...(/^\d+$/.test(q) ? [{ number: Number(q) }] : []),
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        include: ticketInclude,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return pageResponse(
      items.map((ticket) => this.presentTicket(ticket)),
      total,
      page,
      pageSize,
    );
  }

  private async detail(id: string, query: PageQuery, userId?: string) {
    const { page, pageSize, skip } = parsePage(query, { defaultPageSize: 50 });
    const where = { id, ...(userId ? { userId } : {}) };
    const ticket = await this.prisma.supportTicket.findFirst({
      where,
      include: ticketInclude,
    });
    if (!ticket) throw new NotFoundException('工单不存在');
    const [messages, total] = await Promise.all([
      this.prisma.supportTicketMessage.findMany({
        where: { ticketId: id },
        include: {
          author: {
            select: { id: true, displayName: true, email: true, role: true },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.supportTicketMessage.count({ where: { ticketId: id } }),
    ]);
    return {
      ticket: this.presentTicket(ticket),
      messages: pageResponse(
        messages.map((message) => ({
          id: message.id,
          body: message.body,
          createdAt: message.createdAt.toISOString(),
          author: {
            id: message.author.id,
            displayName: message.author.displayName,
            email: message.author.email,
            role: message.author.role.toLowerCase(),
          },
        })),
        total,
        page,
        pageSize,
      ),
    };
  }

  private async reply(
    id: string,
    authorId: string,
    rawBody: string,
    staff: boolean,
    ownerId?: string,
  ) {
    const body = rawBody.trim();
    if (!body) throw new BadRequestException('回复内容不能为空');
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, ...(ownerId ? { userId: ownerId } : {}) },
      select: { id: true, status: true },
    });
    if (!ticket) throw new NotFoundException('工单不存在');
    if (ticket.status === SupportTicketStatus.CLOSED) {
      throw new BadRequestException('已关闭的工单不能继续回复');
    }
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.supportTicketMessage.create({
        data: { ticketId: id, authorId, body, createdAt: now },
        include: {
          author: {
            select: { id: true, displayName: true, email: true, role: true },
          },
        },
      });
      await tx.supportTicket.update({
        where: { id },
        data: {
          lastMessageAt: now,
          status: staff
            ? SupportTicketStatus.WAITING_MEMBER
            : SupportTicketStatus.WAITING_STAFF,
        },
      });
      if (staff) {
        await tx.auditLog.create({
          data: {
            actorId: authorId,
            action: 'SUPPORT_TICKET_REPLIED',
            targetType: 'SupportTicket',
            targetId: id,
          },
        });
      }
      return {
        id: message.id,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
        author: {
          id: message.author.id,
          displayName: message.author.displayName,
          email: message.author.email,
          role: message.author.role.toLowerCase(),
        },
      };
    });
  }

  private presentTicket(ticket: TicketSummary) {
    const lastMessage = ticket.messages[0];
    return {
      id: ticket.id,
      number: ticket.number,
      subject: ticket.subject,
      category: ticket.category.toLowerCase(),
      priority: ticket.priority.toLowerCase(),
      status: ticket.status.toLowerCase(),
      lastMessageAt: ticket.lastMessageAt.toISOString(),
      closedAt: ticket.closedAt?.toISOString() ?? null,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      messageCount: ticket._count.messages,
      lastMessage: lastMessage
        ? {
            body: lastMessage.body,
            createdAt: lastMessage.createdAt.toISOString(),
            authorRole: lastMessage.author.role.toLowerCase(),
          }
        : null,
      user: ticket.user,
    };
  }

  private category(value: string) {
    return this.optionalCategory(value) ?? SupportTicketCategory.OTHER;
  }

  private optionalCategory(value?: string) {
    const normalized = value?.trim().toUpperCase();
    return Object.values(SupportTicketCategory).includes(
      normalized as SupportTicketCategory,
    )
      ? (normalized as SupportTicketCategory)
      : undefined;
  }

  private priority(value: string) {
    const normalized = value.trim().toUpperCase();
    return Object.values(SupportTicketPriority).includes(
      normalized as SupportTicketPriority,
    )
      ? (normalized as SupportTicketPriority)
      : SupportTicketPriority.NORMAL;
  }

  private status(value: string) {
    const status = this.optionalStatus(value);
    if (!status) throw new BadRequestException('未知工单状态');
    return status;
  }

  private optionalStatus(value?: string) {
    const normalized = value?.trim().toUpperCase();
    return Object.values(SupportTicketStatus).includes(
      normalized as SupportTicketStatus,
    )
      ? (normalized as SupportTicketStatus)
      : undefined;
  }
}
