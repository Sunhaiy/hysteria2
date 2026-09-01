import { createEpaySignature, type EpayParameters } from './epay-signature';
import {
  buildEpayQueryUrl,
  createEpayQueryParameters,
  parseEpayQueryResponse,
} from './epay-query';

describe('易支付 active query protocol', () => {
  const merchantKey = 'merchant-secret';
  const expected = {
    merchantOrderNo: 'EP202609010001',
    paymentType: 'alipay',
    amountCents: 1290,
  };

  function response(overrides: EpayParameters = {}) {
    const parameters: EpayParameters = {
      code: '1',
      msg: 'success',
      status: '1',
      trade_status: 'TRADE_SUCCESS',
      trade_no: 'gateway-1',
      out_trade_no: expected.merchantOrderNo,
      type: expected.paymentType,
      money: '12.90',
      sign_type: 'MD5',
      ...overrides,
    };
    return {
      ...parameters,
      sign: createEpaySignature(parameters, merchantKey),
    };
  }

  it('builds the documented query URL and exact request signature', () => {
    expect(
      buildEpayQueryUrl(
        'https://ai.haiy.space/api/v1/payment-proxy/submit.php',
      ).toString(),
    ).toBe('https://ai.haiy.space/api/v1/payment-proxy/query');
    expect(
      buildEpayQueryUrl(
        'https://ai.haiy.space/api/v1/payment-proxy',
      ).toString(),
    ).toBe('https://ai.haiy.space/api/v1/payment-proxy/query');
    expect(
      createEpayQueryParameters('1001', expected.merchantOrderNo, merchantKey),
    ).toEqual({
      pid: '1001',
      out_trade_no: expected.merchantOrderNo,
      sign_type: 'MD5',
      sign: 'c26acd52dcb42a1cf5f9f5dbfd2c8a10',
    });
  });

  it('accepts signed paid, pending, closed, and not-found outcomes', () => {
    expect(parseEpayQueryResponse(response(), expected, merchantKey)).toEqual({
      kind: 'paid',
      gatewayTradeNo: 'gateway-1',
    });
    expect(
      parseEpayQueryResponse(
        response({ status: '0', trade_status: 'PENDING', trade_no: '' }),
        expected,
        merchantKey,
      ),
    ).toEqual({ kind: 'pending' });
    expect(
      parseEpayQueryResponse(
        response({ status: '0', trade_status: 'CLOSED', trade_no: '' }),
        expected,
        merchantKey,
      ),
    ).toEqual({ kind: 'closed' });
    expect(
      parseEpayQueryResponse(
        { code: -1, msg: 'not found' },
        expected,
        merchantKey,
      ),
    ).toEqual({ kind: 'not_found' });
  });

  it.each([
    ['signature', () => ({ ...response(), sign: '0'.repeat(32) })],
    ['order number', () => response({ out_trade_no: 'EP_OTHER' })],
    ['amount', () => response({ money: '12.91' })],
    ['channel', () => response({ type: 'wxpay' })],
    ['status pair', () => response({ status: '1', trade_status: 'PENDING' })],
  ])('rejects a tampered or invalid %s', (_name, createPayload) => {
    expect(() =>
      parseEpayQueryResponse(createPayload(), expected, merchantKey),
    ).toThrow();
  });
});
