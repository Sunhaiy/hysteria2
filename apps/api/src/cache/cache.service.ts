import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly memory = new Map<string, string>();
  private redis: Redis | null = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      })
    : null;

  async onModuleInit() {
    const production = process.env.NODE_ENV === 'production';
    if (!this.redis) {
      if (production) {
        throw new Error('REDIS_URL is required in production');
      }
      return;
    }
    try {
      await this.redis.connect();
      await this.redis.ping();
    } catch (error) {
      this.redis.disconnect();
      this.redis = null;
      if (production) throw error;
    }
  }

  async health() {
    if (!this.redis) {
      return { ok: process.env.NODE_ENV !== 'production', adapter: 'memory' };
    }
    try {
      return { ok: (await this.redis.ping()) === 'PONG', adapter: 'redis' };
    } catch {
      return { ok: false, adapter: 'redis' };
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
