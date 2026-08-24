import { Injectable, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

@Injectable()
export class SecretCipherService implements OnModuleInit {
  private key: Buffer | null = null;

  onModuleInit() {
    const encoded = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
    if (encoded) {
      const key = Buffer.from(encoded, 'base64');
      if (key.length !== 32) {
        throw new Error('SETTINGS_ENCRYPTION_KEY must be 32 bytes in base64');
      }
      this.key = key;
    }
    if (process.env.NODE_ENV === 'production' && !this.key) {
      throw new Error('SETTINGS_ENCRYPTION_KEY is required in production');
    }
  }

  get enabled() {
    return this.key !== null;
  }

  encrypt(value: string) {
    if (!value || value.startsWith(PREFIX) || !this.key) return value;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return [
      PREFIX.slice(0, -1),
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':');
  }

  decrypt(value: string | null | undefined) {
    if (!value || !value.startsWith(PREFIX)) return value ?? undefined;
    if (!this.key) throw new Error('Encrypted secret cannot be decrypted');
    const [, , ivValue, tagValue, encryptedValue] = value.split(':');
    if (!ivValue || !tagValue || !encryptedValue) {
      throw new Error('Encrypted secret has an invalid format');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivValue, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
