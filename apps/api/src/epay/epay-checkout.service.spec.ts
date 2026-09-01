import { EpayCheckoutService } from './epay-checkout.service';

describe('EpayCheckoutService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('skips the proxy channel picker after the caller selected wxpay', async () => {
    const cashier = new Response(
      [
        '<form action="/api/v1/payment-proxy/checkout/session-token/pay" method="post">',
        '<input type="radio" name="channel" checked value="wxpay">',
        '<input type="radio" name="channel" value="alipay">',
        '</form>',
      ].join(''),
      {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      },
    );
    Object.defineProperty(cashier, 'url', {
      value: 'https://ai.haiy.space/pay/session-token',
    });
    const redirect = new Response(null, {
      status: 303,
      headers: {
        location: 'https://api.payqixiang.cn/submit.php?payment-session=signed',
      },
    });
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(cashier)
      .mockResolvedValueOnce(redirect);
    global.fetch = fetchMock;

    const result = await new EpayCheckoutService().prepare({
      url: 'https://ai.haiy.space/api/v1/payment-proxy/submit',
      method: 'POST',
      fields: {
        pid: 'merchant',
        type: 'wxpay',
        out_trade_no: 'order-1',
        sign: 'signed',
        sign_type: 'MD5',
      },
    });

    expect(result).toEqual({
      url: 'https://api.payqixiang.cn/submit.php?payment-session=signed',
      method: 'GET',
      fields: {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      redirect: 'follow',
    });
    const submitBody = fetchMock.mock.calls[0]?.[1]?.body;
    if (!(submitBody instanceof URLSearchParams)) {
      throw new Error('Expected a URL-encoded proxy submission');
    }
    expect(submitBody.get('type')).toBe('wxpay');
    const checkoutTarget = fetchMock.mock.calls[1]?.[0];
    if (!(checkoutTarget instanceof URL)) {
      throw new Error('Expected a URL checkout target');
    }
    expect(checkoutTarget.toString()).toBe(
      'https://ai.haiy.space/api/v1/payment-proxy/checkout/session-token/pay',
    );
    const checkoutBody = fetchMock.mock.calls[1]?.[1]?.body;
    if (!(checkoutBody instanceof URLSearchParams)) {
      throw new Error('Expected a URL-encoded channel confirmation');
    }
    expect(checkoutBody.get('channel')).toBe('wxpay');
  });

  it('falls back to the original signed form when the proxy page changes', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response('<html><body>unexpected checkout</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      );
    global.fetch = fetchMock;
    const submission = {
      url: 'https://ai.haiy.space/api/v1/payment-proxy/submit',
      method: 'POST' as const,
      fields: { type: 'alipay', sign: 'signed' },
    };

    await expect(
      new EpayCheckoutService().prepare(submission),
    ).resolves.toEqual(submission);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not make server-side requests to unrecognized gateways', async () => {
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >();
    global.fetch = fetchMock;
    const submission = {
      url: 'https://pay.example.com/submit.php',
      method: 'POST' as const,
      fields: { type: 'wxpay', sign: 'signed' },
    };

    await expect(
      new EpayCheckoutService().prepare(submission),
    ).resolves.toEqual(submission);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
