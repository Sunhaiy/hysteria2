export class PaymentFulfillmentRejectedError extends Error {
  constructor(
    readonly reasonCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentFulfillmentRejectedError';
  }
}

export function isPaymentFulfillmentRejectedError(
  error: unknown,
): error is PaymentFulfillmentRejectedError {
  return (
    error instanceof PaymentFulfillmentRejectedError ||
    (typeof error === 'object' &&
      error !== null &&
      'reasonCode' in error &&
      typeof error.reasonCode === 'string' &&
      'name' in error &&
      error.name === 'PaymentFulfillmentRejectedError')
  );
}
