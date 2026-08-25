import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SupportTicketStatus, UserRole } from '@prisma/client';
import { TicketsService } from './tickets.service';

describe('TicketsService', () => {
  const now = new Date('2026-08-25T00:00:00.000Z');
  const summary = {
    id: 'ticket_1',
    number: 42,
    userId: 'member_1',
    subject: '无法更新订阅',
    category: 'ACCESS',
    priority: 'NORMAL',
    status: 'WAITING_STAFF',
    lastMessageAt: now,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    user: {
      id: 'member_1',
      email: 'member@example.com',
      displayName: 'Member',
    },
    messages: [
      {
        id: 'message_1',
        body: '客户端提示失败',
        createdAt: now,
        author: {
          id: 'member_1',
          displayName: 'Member',
          role: UserRole.MEMBER,
        },
      },
    ],
    _count: { messages: 1 },
  };

  function makeService() {
    const tx = {
      supportTicket: {
        create: jest.fn().mockResolvedValue(summary),
        findMany: jest.fn().mockResolvedValue([summary]),
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue(summary),
        findUnique: jest.fn().mockResolvedValue({
          id: summary.id,
          status: SupportTicketStatus.WAITING_STAFF,
        }),
        update: jest.fn().mockResolvedValue(summary),
      },
      supportTicketMessage: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({
          id: 'message_2',
          body: '已处理',
          createdAt: now,
          author: {
            id: 'admin_1',
            displayName: 'Admin',
            email: 'admin@example.com',
            role: UserRole.ADMIN,
          },
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };
    return { service: new TicketsService(prisma as never), prisma };
  }

  it('creates a member ticket and its first message atomically', async () => {
    const { service, prisma } = makeService();
    const result = await service.create('member_1', {
      subject: '  无法更新订阅  ',
      category: 'access',
      priority: 'normal',
      message: '  客户端提示失败  ',
    });
    const [createCall] = prisma.supportTicket.create.mock
      .calls[0] as unknown as [
      {
        data: {
          userId: string;
          subject: string;
          messages: { create: { authorId: string; body: string } };
        };
      },
    ];
    expect(createCall.data.userId).toBe('member_1');
    expect(createCall.data.subject).toBe('无法更新订阅');
    expect(createCall.data.messages.create).toMatchObject({
      authorId: 'member_1',
      body: '客户端提示失败',
    });
    expect(result).toMatchObject({ number: 42, status: 'waiting_staff' });
  });

  it('does not expose another member ticket', async () => {
    const { service, prisma } = makeService();
    prisma.supportTicket.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.detailMember('member_2', 'ticket_1', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('moves an admin reply to waiting_member and records an audit event', async () => {
    const { service, prisma } = makeService();
    await service.replyAdmin('admin_1', 'ticket_1', '已处理');
    const [updateCall] = prisma.supportTicket.update.mock
      .calls[0] as unknown as [
      { where: { id: string }; data: { status: SupportTicketStatus } },
    ];
    expect(updateCall).toMatchObject({
      where: { id: 'ticket_1' },
      data: { status: SupportTicketStatus.WAITING_MEMBER },
    });
    const [auditCall] = prisma.auditLog.create.mock.calls[0] as unknown as [
      { data: { action: string } },
    ];
    expect(auditCall.data.action).toBe('SUPPORT_TICKET_REPLIED');
  });

  it('rejects replies after a ticket is closed', async () => {
    const { service, prisma } = makeService();
    prisma.supportTicket.findFirst.mockResolvedValueOnce({
      ...summary,
      status: SupportTicketStatus.CLOSED,
    });
    await expect(
      service.replyMember('member_1', 'ticket_1', '还有问题'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
