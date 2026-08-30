import {
  createEpaySignature,
  formatEpayAmount,
  parseEpayAmount,
  verifyEpaySignature,
} from './epay-signature';

describe('易支付 signatures', () => {
  const parameters = {
    pid: '1001',
    type: 'alipay',
    out_trade_no: 'EP1',
    notify_url: 'https://a.test/notify',
    return_url: 'https://a.test/return',
    name: 'Test',
    money: '12.30',
    sign_type: 'MD5',
  };

  it('sorts non-empty fields and creates the expected MD5 signature', () => {
    expect(createEpaySignature(parameters, 'merchant-secret')).toBe(
      'aee00f0acb9dbb7bcd77f3b9f5176039',
    );
  });

  it('rejects a modified signed field', () => {
    const sign = createEpaySignature(parameters, 'merchant-secret');
    expect(
      verifyEpaySignature({ ...parameters, sign }, 'merchant-secret'),
    ).toBe(true);
    expect(
      verifyEpaySignature(
        { ...parameters, money: '12.31', sign },
        'merchant-secret',
      ),
    ).toBe(false);
  });

  it('converts payment amounts without floating point arithmetic', () => {
    expect(formatEpayAmount(1230)).toBe('12.30');
    expect(parseEpayAmount('12.3')).toBe(1230);
    expect(parseEpayAmount('0.01')).toBe(1);
    expect(() => parseEpayAmount('1.001')).toThrow('Invalid 易支付 amount');
    expect(() => parseEpayAmount('1e2')).toThrow('Invalid 易支付 amount');
  });
});
