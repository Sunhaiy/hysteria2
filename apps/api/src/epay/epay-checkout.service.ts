import { Injectable, Logger } from '@nestjs/common';
import { parse } from 'node-html-parser';

const PROXY_HOST = 'ai.haiy.space';
const PROXY_PATH_PREFIX = '/api/v1/payment-proxy/';
const RESPONSE_LIMIT_BYTES = 128 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

export interface EpayGatewaySubmission {
  url: string;
  method: 'GET' | 'POST';
  fields: Record<string, string>;
}

@Injectable()
export class EpayCheckoutService {
  private readonly logger = new Logger(EpayCheckoutService.name);

  async prepare(
    submission: EpayGatewaySubmission,
  ): Promise<EpayGatewaySubmission> {
    if (!this.supportsDirectCheckout(submission)) return submission;

    try {
      const paymentType = submission.fields.type;
      const cashier = await fetch(submission.url, {
        method: 'POST',
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(submission.fields),
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!cashier.ok) {
        throw new Error(`proxy submit returned HTTP ${cashier.status}`);
      }

      const cashierUrl = new URL(cashier.url || submission.url);
      const submitUrl = new URL(submission.url);
      if (cashierUrl.origin !== submitUrl.origin) {
        throw new Error('proxy submit redirected to an unexpected origin');
      }
      const html = await this.readLimitedBody(cashier);
      const root = parse(html);
      const checkoutForm = root.querySelectorAll('form').find((form) => {
        if ((form.getAttribute('method') ?? 'get').toLowerCase() !== 'post') {
          return false;
        }
        return form
          .querySelectorAll('input[name="channel"]')
          .some((input) => input.getAttribute('value') === paymentType);
      });
      const actionValue = checkoutForm?.getAttribute('action');
      if (!actionValue) throw new Error('proxy checkout form is missing');

      const checkoutUrl = new URL(actionValue, cashierUrl);
      if (
        checkoutUrl.protocol !== 'https:' ||
        checkoutUrl.origin !== cashierUrl.origin
      ) {
        throw new Error('proxy checkout form action is invalid');
      }
      const channelResponse = await fetch(checkoutUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ channel: paymentType }),
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (channelResponse.status !== 303) {
        throw new Error(
          `proxy channel confirmation returned HTTP ${channelResponse.status}`,
        );
      }
      const location = channelResponse.headers.get('location');
      if (!location) throw new Error('proxy channel redirect is missing');
      const paymentUrl = new URL(location, checkoutUrl);
      if (paymentUrl.protocol !== 'https:') {
        throw new Error('proxy payment redirect is not HTTPS');
      }

      return { url: paymentUrl.toString(), method: 'GET', fields: {} };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Direct 易支付 checkout unavailable: ${message}`);
      return submission;
    }
  }

  private supportsDirectCheckout(submission: EpayGatewaySubmission) {
    if (submission.method !== 'POST') return false;
    if (!['alipay', 'wxpay'].includes(submission.fields.type)) return false;
    try {
      const url = new URL(submission.url);
      return (
        url.protocol === 'https:' &&
        url.hostname === PROXY_HOST &&
        url.pathname.startsWith(PROXY_PATH_PREFIX)
      );
    } catch {
      return false;
    }
  }

  private async readLimitedBody(response: Response) {
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > RESPONSE_LIMIT_BYTES) {
      throw new Error('proxy checkout response is too large');
    }
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > RESPONSE_LIMIT_BYTES) {
      throw new Error('proxy checkout response is too large');
    }
    return body;
  }
}
