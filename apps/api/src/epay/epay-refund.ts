export type EpayRefundResponse =
  | { kind: 'accepted'; message: string }
  | { kind: 'rejected'; message: string };

export function buildEpayRefundUrl(gatewayUrl: string) {
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
  if (last === 'submit' || last === 'submit.php' || last === 'query') {
    parts.pop();
  }
  if (parts.at(-1)?.toLowerCase() !== 'refund') parts.push('refund');
  parsed.pathname = `/${parts.join('/')}`;
  parsed.search = '';
  parsed.hash = '';
  return parsed;
}

export function createEpayRefundParameters(input: {
  merchantId: string;
  merchantKey: string;
  gatewayTradeNo?: string | null;
  merchantOrderNo: string;
  amountCents: number;
}) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('易支付退款金额无效');
  }
  const parameters = new URLSearchParams({
    pid: input.merchantId,
    key: input.merchantKey,
    money: (input.amountCents / 100).toFixed(2),
  });
  if (input.gatewayTradeNo) {
    parameters.set('trade_no', input.gatewayTradeNo);
  } else {
    parameters.set('out_trade_no', input.merchantOrderNo);
  }
  return parameters;
}

export function parseEpayRefundResponse(input: unknown): EpayRefundResponse {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('易支付退款响应不是对象');
  }
  const record = input as Record<string, unknown>;
  const code =
    typeof record.code === 'string' || typeof record.code === 'number'
      ? String(record.code)
      : '';
  const message =
    typeof record.msg === 'string' && record.msg.trim()
      ? record.msg.trim().slice(0, 500)
      : code === '1'
        ? '退款请求已受理'
        : '网关拒绝退款';
  if (code === '1') return { kind: 'accepted', message };
  if (code === '-1') return { kind: 'rejected', message };
  throw new Error('易支付退款返回未知状态');
}
