import { createHash, timingSafeEqual } from 'node:crypto';

export type EpayParameters = Record<string, string>;

export function normalizeEpayParameters(
  input: Record<string, unknown>,
): EpayParameters {
  const normalized: EpayParameters = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    switch (typeof value) {
      case 'string':
        normalized[key] = value;
        break;
      case 'number':
      case 'boolean':
      case 'bigint':
        normalized[key] = value.toString();
        break;
      default:
        throw new Error(`Invalid 易支付 parameter: ${key}`);
    }
  }
  return normalized;
}

export function createEpaySignature(
  parameters: EpayParameters,
  merchantKey: string,
) {
  const payload = Object.entries(parameters)
    .filter(
      ([key, value]) => key !== 'sign' && key !== 'sign_type' && value !== '',
    )
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return createHash('md5').update(`${payload}${merchantKey}`).digest('hex');
}

export function verifyEpaySignature(
  parameters: EpayParameters,
  merchantKey: string,
) {
  const received = parameters.sign?.toLowerCase();
  if (!received || !/^[a-f0-9]{32}$/.test(received)) return false;
  const expected = createEpaySignature(parameters, merchantKey);
  return timingSafeEqual(
    Buffer.from(received, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}

export function formatEpayAmount(amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new Error('Invalid amount in cents');
  }
  return `${Math.floor(amountCents / 100)}.${String(amountCents % 100).padStart(2, '0')}`;
}

export function parseEpayAmount(value: string) {
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value)) {
    throw new Error('Invalid 易支付 amount');
  }
  const [yuan, fraction = ''] = value.split('.');
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('Invalid 易支付 amount');
  return cents;
}
