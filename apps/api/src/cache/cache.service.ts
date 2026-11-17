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

  async get(key: string, requireRedis = false) {
    if (this.redis?.status === 'ready') {
      return this.redis.get(key);
    }
    this.assertMemoryFallbackAllowed(requireRedis);
    return this.memory.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    ttlSeconds?: number,
    requireRedis = false,
  ) {
    if (this.redis?.status === 'ready') {
      if (ttlSeconds) {
        await this.redis.set(key, value, 'EX', ttlSeconds);
        return;
      }
      await this.redis.set(key, value);
      return;
    }

    this.assertMemoryFallbackAllowed(requireRedis);
    this.memory.set(key, value);
    if (ttlSeconds) {
      setTimeout(() => this.memory.delete(key), ttlSeconds * 1000).unref();
    }
  }

  async del(key: string, requireRedis = false) {
    if (this.redis?.status === 'ready') {
      await this.redis.del(key);
      return;
    }
    this.assertMemoryFallbackAllowed(requireRedis);
    this.memory.delete(key);
  }

  async addMember(key: string, value: string, requireRedis = false) {
    if (this.redis?.status === 'ready') {
      await this.redis.sadd(key, value);
      return;
    }
    this.assertMemoryFallbackAllowed(requireRedis);
    const members = new Set<string>(
      JSON.parse(this.memory.get(key) ?? '[]') as string[],
    );
    members.add(value);
    this.memory.set(key, JSON.stringify([...members]));
  }

  async members(key: string, requireRedis = false): Promise<string[]> {
    if (this.redis?.status === 'ready') return this.redis.smembers(key);
    this.assertMemoryFallbackAllowed(requireRedis);
    return JSON.parse(this.memory.get(key) ?? '[]') as string[];
  }

  async removeMember(key: string, value: string, requireRedis = false) {
    if (this.redis?.status === 'ready') {
      await this.redis.srem(key, value);
      return;
    }
    this.assertMemoryFallbackAllowed(requireRedis);
    const members = new Set<string>(await this.members(key));
    members.delete(value);
    this.memory.set(key, JSON.stringify([...members]));
  }

  private assertMemoryFallbackAllowed(requireRedis: boolean) {
    if (requireRedis) throw new Error('Shared Redis is unavailable');
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}
