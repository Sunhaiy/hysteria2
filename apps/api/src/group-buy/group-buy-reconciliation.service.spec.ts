import {
  createEpaySignature,
  type EpayParameters,
} from '../epay/epay-signature';
import { ACCOUNT_DELETION_REFUND_REASON } from './group-buy-account-cleanup';
import { GroupBuyReconciliationService } from './group-buy-reconciliation.service';

describe('GroupBuyReconciliationService', () => {
  const merchantKey = 'merchant-secret';
  const payment = {
    id: 'payment-1',
    status: 'SETTLED',
    gatewayUrlSnapshot: 'https://ai.haiy.space/api/v1/payment-proxy/submit.php',
    merchantIdSnapshot: '1001',
    merchantKeyCiphertext: 'encrypted',
    merchantOrderNo: 'EPG-1',
    gatewayTradeNo: 'gateway-1',
    paymentType: 'alipay',
    amountCents: 1290,
  };

  function queryResponse(status: 'paid' | 'refunded') {
    const parameters: EpayParameters = {
      code: '1',
      msg: 'success',
      status: status === 'paid' ? '1' : '2',
      trade_status: status === 'paid' ? 'TRADE_SUCCESS' : 'TRADE_REFUNDED',
      trade_no: payment.gatewayTradeNo,
      out_trade_no: payment.merchantOrderNo,
      type: payment.paymentType,
      money: '12.90',
      sign_type: 'MD5',
    };
    return {
      ...parameters,
      sign: createEpaySignature(parameters, merchantKey),
    };
  }

  function response(payload: unknown) {
    const body = JSON.stringify(payload);
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(body.length) }),
      text: () => Promise.resolve(body),
    } as Response);
  }

  function setup(status = 'PENDING') {
    const attempt = {
      id: 'refund-1',
      paymentAttemptId: payment.id,
      groupBuyMemberId: 'member-1',
      status,
      amountCents: 1290,
      fallbackAllowedAt: null,
      paymentAttempt: { ...payment },
      groupBuyMember: {
        id: 'member-1',
        groupId: 'group-1',
        orderId: null,
        group: { id: 'group-1' },
      },
    };
    const tx = {
      epayRefundAttempt: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...attempt, ...data }),
          ),
        findUnique: jest.fn().mockResolvedValue(attempt),
      },
      epayPaymentAttempt: {
        update: jest.fn().mockResolvedValue({}),
      },
      groupBuyMember: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'member-1',
          groupId: 'group-1',
          orderId: null,
          status: 'REFUND_PENDING',
        }),
        update: jest
          .fn()
          .mockResolvedValue({ id: 'member-1', groupId: 'group-1' }),
      },
      groupBuy: { updateMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      epayRefundAttempt: {
        findUnique: jest.fn().mockResolvedValue(attempt),
        updateMany: tx.epayRefundAttempt.updateMany,
        update: tx.epayRefundAttempt.update,
      },
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const groupBuys = {
      expireDueGroups: jest.fn().mockResolvedValue(0),
      fallbackFulfillMember: jest
        .fn()
        .mockResolvedValue({ orderId: 'order-1' }),
      refreshRefundingGroupStatus: jest.fn(),
    };
    const service = new GroupBuyReconciliationService(
      prisma as never,
      groupBuys as never,
      { decrypt: jest.fn().mockReturnValue(merchantKey) } as never,
    );
    return { service, prisma, tx, groupBuys };
  }

  afterEach(() => jest.restoreAllMocks());

  it('confirms an accepted refund only after signed query reports refunded', async () => {
    const { service, tx, groupBuys } = setup();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(() => response(queryResponse('paid')))
      .mockImplementationOnce((_url, init) => {
        expect(init?.method).toBe('POST');
        expect(typeof init?.body).toBe('string');
        const body = typeof init?.body === 'string' ? init.body : '';
        expect(body).toContain('key=merchant-secret');
        expect(body).toContain('trade_no=gateway-1');
        return response({ code: 1, msg: '退款成功' });
      })
      .mockImplementationOnce(() => response(queryResponse('refunded')));

    await expect(service.retryRefundAttempt('refund-1')).resolves.toEqual({
      refundAttemptId: 'refund-1',
      outcome: 'refunded',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const confirmedWrites = tx.epayRefundAttempt.update.mock
      .calls as unknown as Array<[{ data: Record<string, unknown> }]>;
    expect(
      confirmedWrites.some(([input]) => input.data.status === 'CONFIRMED'),
    ).toBe(true);
    expect(groupBuys.fallbackFulfillMember).not.toHaveBeenCalled();
  });

  it('falls back without bonus only after an explicit gateway rejection', async () => {
    const { service, groupBuys, tx } = setup();
    jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(() => response(queryResponse('paid')))
      .mockImplementationOnce(() =>
        response({ code: -1, msg: '余额不足，无法退款' }),
      );

    await expect(service.retryRefundAttempt('refund-1')).resolves.toEqual({
      refundAttemptId: 'refund-1',
      outcome: 'fallbackFulfilled',
    });
    expect(groupBuys.fallbackFulfillMember).toHaveBeenCalledWith('member-1');
    const fallbackWrites = tx.epayRefundAttempt.update.mock
      .calls as unknown as Array<[{ data: Record<string, unknown> }]>;
    const fallbackWrite = fallbackWrites.find(
      ([input]) => input.data.fallbackAllowedAt instanceof Date,
    );
    expect(fallbackWrite).toBeDefined();
  });

  it('never grants fallback service to an account deleted during a legacy group refund', async () => {
    const { service, prisma, groupBuys, tx } = setup();
    const stored = (await prisma.epayRefundAttempt.findUnique({
      where: { id: 'refund-1' },
    })) as unknown as { reasonCode: string | null };
    stored.reasonCode = ACCOUNT_DELETION_REFUND_REASON;
    jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(() => response(queryResponse('paid')))
      .mockImplementationOnce(() =>
        response({ code: -1, msg: '余额不足，无法退款' }),
      );

    await expect(service.retryRefundAttempt('refund-1')).resolves.toEqual({
      refundAttemptId: 'refund-1',
      outcome: 'exceptions',
    });
    expect(groupBuys.fallbackFulfillMember).not.toHaveBeenCalled();
    expect(tx.epayPaymentAttempt.update).toHaveBeenCalledWith({
      where: { id: payment.id },
      data: { fulfillmentStatus: 'MANUAL_REVIEW' },
    });
  });

  it('keeps an exception and never fulfills when query state is ambiguous', async () => {
    const { service, groupBuys, tx } = setup();
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(service.retryRefundAttempt('refund-1')).resolves.toEqual({
      refundAttemptId: 'refund-1',
      outcome: 'exceptions',
    });
    expect(groupBuys.fallbackFulfillMember).not.toHaveBeenCalled();
    expect(tx.groupBuyMember.update).toHaveBeenCalledWith({
      where: { id: 'member-1' },
      data: { status: 'EXCEPTION' },
    });
  });

  it('never resubmits a refund that was already submitted', async () => {
    const { service, tx } = setup('SUBMITTED');
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => response(queryResponse('paid')));

    await expect(service.retryRefundAttempt('refund-1')).resolves.toEqual({
      refundAttemptId: 'refund-1',
      outcome: 'exceptions',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(false);
    const submittedWrites = tx.epayRefundAttempt.update.mock
      .calls as unknown as Array<[{ data: Record<string, unknown> }]>;
    expect(
      submittedWrites.some(([input]) => input.data.status === 'FAILED'),
    ).toBe(false);
  });

  it('allows only the worker that atomically claims a refund to submit it', async () => {
    const { service, tx } = setup();
    tx.epayRefundAttempt.updateMany.mockResolvedValue({ count: 0 });
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => response(queryResponse('paid')));

    await expect(service.retryRefundAttempt('refund-1')).resolves.toEqual({
      refundAttemptId: 'refund-1',
      outcome: 'exceptions',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(false);
  });

  it('never falls back to current merchant credentials for an old payment', async () => {
    const { service, prisma } = setup();
    const stored = (await prisma.epayRefundAttempt.findUnique({
      where: { id: 'refund-1' },
    })) as unknown as {
      paymentAttempt: {
        gatewayUrlSnapshot: string | null;
        merchantIdSnapshot: string | null;
        merchantKeyCiphertext: string | null;
      };
    } | null;
    if (!stored) throw new Error('missing fixture');
    stored.paymentAttempt.gatewayUrlSnapshot = null;
    stored.paymentAttempt.merchantIdSnapshot = null;
    stored.paymentAttempt.merchantKeyCiphertext = null;
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(service.retryRefundAttempt('refund-1')).resolves.toEqual({
      refundAttemptId: 'refund-1',
      outcome: 'exceptions',
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('confirms a generic paid-fulfillment compensation without group mutations', async () => {
    const { service, prisma, tx, groupBuys } = setup();
    const stored = (await prisma.epayRefundAttempt.findUnique({
      where: { id: 'refund-1' },
    })) as unknown as {
      groupBuyMemberId: string | null;
      groupBuyMember: object | null;
      reasonCode: string | null;
    };
    stored.groupBuyMemberId = null;
    stored.groupBuyMember = null;
    stored.reasonCode = 'ENTITLEMENT_NO_LONGER_AVAILABLE';
    jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(() => response(queryResponse('paid')))
      .mockImplementationOnce(() => response({ code: 1, msg: '退款成功' }))
      .mockImplementationOnce(() => response(queryResponse('refunded')));

    await expect(service.retryRefundAttempt('refund-1')).resolves.toEqual({
      refundAttemptId: 'refund-1',
      outcome: 'refunded',
    });

    expect(groupBuys.fallbackFulfillMember).not.toHaveBeenCalled();
    expect(tx.epayPaymentAttempt.update).toHaveBeenCalledWith({
      where: { id: payment.id },
      data: { fulfillmentStatus: 'REFUNDED' },
    });
    const [auditWrite] = tx.auditLog.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(auditWrite.data).toMatchObject({
      action: 'epay.compensation_refund_confirmed',
      targetId: payment.id,
      metadata: { reasonCode: 'ENTITLEMENT_NO_LONGER_AVAILABLE' },
    });
  });
});
