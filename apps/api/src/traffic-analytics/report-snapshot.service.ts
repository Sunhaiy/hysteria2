import { Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';

export const reportRefreshMs = 30 * 60_000;
type Snapshot<T> = {
  data: T | null;
  generatedAt: string | null;
  status: 'ready' | 'pending';
  stale: boolean;
  refreshError?: string;
};

/** Reporting only. Never use these snapshots for billing or access decisions. */
@Injectable()
export class ReportSnapshotService {
  private readonly running = new Map<string, Promise<unknown>>();
  constructor(private readonly cache: CacheService) {}

  async read<T>(key: string): Promise<Snapshot<T>> {
    const saved = await this.cache.get(`report:v1:${key}`);
    const failed = await this.cache.get(`report:retry:${key}`);
    if (!saved)
      return {
        data: null,
        generatedAt: null,
        status: 'pending',
        stale: true,
        ...(failed
          ? { refreshError: '统计生成暂时失败，后台稍后自动重试。' }
          : {}),
      };
    const snapshot = JSON.parse(saved) as Snapshot<T>;
    return {
      ...snapshot,
      stale: Date.now() - Date.parse(snapshot.generatedAt!) >= reportRefreshMs,
      ...(failed
        ? { refreshError: '统计更新暂时失败，正在展示上次成功结果。' }
        : {}),
    };
  }

  async refresh<T>(
    key: string,
    query: () => Promise<T>,
    force = false,
  ): Promise<unknown> {
    const active = this.running.get(key);
    if (active) return active;
    const operation = (async () => {
      const saved = await this.read<T>(key);
      if (!force && !saved.stale) return saved;
      if (!force && (await this.cache.get(`report:retry:${key}`))) return saved;
      let data: T;
      try {
        data = await query();
      } catch (error) {
        await this.cache.set(`report:retry:${key}`, 'failed', 5 * 60);
        throw error;
      }
      const snapshot: Snapshot<T> = {
        data,
        generatedAt: new Date().toISOString(),
        status: 'ready',
        stale: false,
      };
      // Keep the last successful result through refresh failures and deploys.
      await this.cache.set(`report:v1:${key}`, JSON.stringify(snapshot));
      return snapshot;
    })().finally(() => this.running.delete(key));
    this.running.set(key, operation);
    return operation;
  }
}
