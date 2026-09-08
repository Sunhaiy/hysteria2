export interface EpayCredentialSnapshot {
  gatewayUrlSnapshot: string | null;
  merchantIdSnapshot: string | null;
  merchantKeyCiphertext: string | null;
}

export interface EpayCredentials {
  gatewayUrl: string;
  merchantId: string;
  merchantKey: string;
}

export class EpayCredentialSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EpayCredentialSnapshotError';
  }
}

export function readEpayCredentialSnapshot(
  snapshot: EpayCredentialSnapshot,
  decrypt: (ciphertext: string) => string | undefined,
  subject = '易支付订单',
): EpayCredentials {
  if (
    !snapshot.gatewayUrlSnapshot ||
    !snapshot.merchantIdSnapshot ||
    !snapshot.merchantKeyCiphertext
  ) {
    throw new EpayCredentialSnapshotError(
      `${subject}缺少完整的不可变凭据快照，必须人工处理`,
    );
  }

  let merchantKey: string | undefined;
  try {
    merchantKey = decrypt(snapshot.merchantKeyCiphertext);
  } catch {
    throw new EpayCredentialSnapshotError(
      `${subject}的密钥快照无法解密，必须人工处理`,
    );
  }
  if (!merchantKey) {
    throw new EpayCredentialSnapshotError(
      `${subject}的密钥快照为空，必须人工处理`,
    );
  }

  return {
    gatewayUrl: snapshot.gatewayUrlSnapshot,
    merchantId: snapshot.merchantIdSnapshot,
    merchantKey,
  };
}
