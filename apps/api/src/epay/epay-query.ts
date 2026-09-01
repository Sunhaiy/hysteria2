import {
  createEpaySignature,
  normalizeEpayParameters,
  parseEpayAmount,
  verifyEpaySignature,
  type EpayParameters,
} from './epay-signature';

export interface EpayQueryExpectation {
  merchantOrderNo: string;
  paymentType: string;
  amountCents: number;
}

export type EpayQueryOutcome =
  | { kind: 'paid'; gatewayTradeNo: string }
  | { kind: 'pending' }
  | { kind: 'closed' }
  | { kind: 'not_found' };

export function buildEpayQueryUrl(gatewayUrl: string) {
  const parsed = new URL(gatewayUrl);
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('Invalid 易支付 gateway URL');
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  const last = parts.at(-1)?.toLowerCase();
  if (last === 'submit' || last === 'submit.php') parts.pop();
  if (parts.at(-1)?.toLowerCase() !== 'query') parts.push('query');
  parsed.pathname = `/${parts.join('/')}`;
  parsed.search = '';
  parsed.hash = '';
  return parsed;
}

export function createEpayQueryParameters(
  merchantId: string,
  merchantOrderNo: string,
  merchantKey: string,
) {
  const parameters: EpayParameters = {
    pid: merchantId,
    out_trade_no: merchantOrderNo,
    sign_type: 'MD5',
  };
  parameters.sign = createEpaySignature(parameters, merchantKey);
  return parameters;
}

export function parseEpayQueryResponse(
  input: unknown,
  expected: EpayQueryExpectation,
  merchantKey: string,
): EpayQueryOutcome {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('易支付查单响应不是对象');
  }
  const parameters = normalizeEpayParameters(input as Record<string, unknown>);

  if (parameters.code === '-1') return { kind: 'not_found' };
  if (parameters.code !== '1') throw new Error('易支付查单返回未知状态');
  if (parameters.sign_type?.toUpperCase() !== 'MD5') {
    throw new Error('易支付查单响应签名类型不正确');
  }
  if (!verifyEpaySignature(parameters, merchantKey)) {
    throw new Error('易支付查单响应签名无效');
  }
  if (parameters.out_trade_no !== expected.merchantOrderNo) {
    throw new Error('易支付查单响应订单号不匹配');
  }
  if (parameters.type !== expected.paymentType) {
    throw new Error('易支付查单响应支付渠道不匹配');
  }
  if (
    !parameters.money ||
    parseEpayAmount(parameters.money) !== expected.amountCents
  ) {
    throw new Error('易支付查单响应金额不匹配');
  }

  if (
    parameters.status === '1' &&
    parameters.trade_status === 'TRADE_SUCCESS'
  ) {
    if (!parameters.trade_no) {
      throw new Error('易支付查单响应缺少平台订单号');
    }
    return { kind: 'paid', gatewayTradeNo: parameters.trade_no };
  }
  if (parameters.status === '0' && parameters.trade_status === 'PENDING') {
    return { kind: 'pending' };
  }
  if (parameters.status === '0' && parameters.trade_status === 'CLOSED') {
    return { kind: 'closed' };
  }
  throw new Error('易支付查单状态组合不正确');
}
