import {
  buildEpayRefundUrl,
  createEpayRefundParameters,
  parseEpayRefundResponse,
} from './epay-refund';

describe('易支付 refund protocol', () => {
  it('builds the documented URL and prefers the gateway trade number', () => {
    expect(
      buildEpayRefundUrl(
        'https://ai.haiy.space/api/v1/payment-proxy/submit.php',
      ).toString(),
    ).toBe('https://ai.haiy.space/api/v1/payment-proxy/refund');
    expect(
      createEpayRefundParameters({
        merchantId: '1001',
        merchantKey: 'secret',
        gatewayTradeNo: 'gateway-1',
        merchantOrderNo: 'merchant-1',
        amountCents: 1290,
      }).toString(),
    ).toBe('pid=1001&key=secret&money=12.90&trade_no=gateway-1');
  });

  it('falls back to the merchant order number and parses known results', () => {
    expect(
      createEpayRefundParameters({
        merchantId: '1001',
        merchantKey: 'secret',
        merchantOrderNo: 'merchant-1',
        amountCents: 990,
      }).get('out_trade_no'),
    ).toBe('merchant-1');
    expect(parseEpayRefundResponse({ code: 1, msg: '退款成功' })).toEqual({
      kind: 'accepted',
      message: '退款成功',
    });
    expect(parseEpayRefundResponse({ code: -1, msg: '余额不足' })).toEqual({
      kind: 'rejected',
      message: '余额不足',
    });
  });

  it('rejects malformed and unknown responses', () => {
    expect(() => parseEpayRefundResponse(null)).toThrow();
    expect(() => parseEpayRefundResponse({ code: 0 })).toThrow();
  });
});
