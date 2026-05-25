import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly memory = new Map<string, string>();
  private redis: Redis | null = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      })
    : null;

  constructor() {
    if (this.redis) {
      void this.redis.connect().catch(() => {
        this.redis?.disconnect();
        this.redis = null;
      });
    }
  }

  async get(key: string) {
    if (this.redis?.status === 'ready') {
      return this.redis.get(key);
    }
    return this.memory.get(key) ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number) {
    if (this.redis?.status === 'ready') {
      if (ttlSeconds) {
        await this.redis.set(key, value, 'EX', ttlSeconds);
        return;
      }
      await this.redis.set(key, value);
      return;
    }

    this.memory.set(key, value);
    if (ttlSeconds) {
      setTimeout(() => this.memory.delete(key), ttlSeconds * 1000).unref();
    }
  }

  async del(key: string) {
    if (this.redis?.status === 'ready') {
      await this.redis.del(key);
      return;
    }
    this.memory.delete(key);
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}
