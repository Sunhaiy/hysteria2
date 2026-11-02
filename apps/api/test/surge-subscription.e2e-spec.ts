import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { PortalService } from '../src/portal/portal.service';
import { SubscriptionFeedController } from '../src/portal/subscription-feed.controller';

describe('Surge subscription HTTP contract', () => {
  let app: INestApplication<Server>;
  let service: PortalService;
  const credential = {
    token: 'surge-test-identity',
    userId: 'user-1',
    vlessUuid: 'uuid',
    revokedAt: null as Date | null,
  };
  const hy2 = {
    id: 'allowed-hy2',
    label: '美国 HY2',
    icon: '🇺🇸',
    protocol: 'HYSTERIA2',
    hostname: '203.0.113.1',
    port: 443,
    sni: 'example.test',
    obfsPassword: null,
    pinSHA256: null,
    allowInsecureTls: false,
  };
  const vless = {
    ...hy2,
    id: 'allowed-vless',
    label: '美国 VLESS',
    protocol: 'VLESS_REALITY',
  };
  const access = {
    allowed: true,
    nodes: [hy2, vless],
    grants: [{ endsAt: '2026-12-01T00:00:00.000Z' }],
    remainingBytes: 1024,
    consumedBytes: 256,
  };
  const resolveAccess = jest.fn();
  const findUnique = jest.fn();
  const findFirst = jest.fn();
  const findMany = jest.fn();
  const getAccessBundle = jest.fn().mockRejectedValue(new NotFoundException());

  beforeAll(async () => {
    service = new PortalService(
      { getAccessBundle } as never,
      {
        getSiteInfo: jest.fn().mockResolvedValue({ name: '素心 Network' }),
      } as never,
      {} as never,
      { resolveAccess } as never,
      { accessToken: { findUnique, findFirst }, node: { findMany } } as never,
    );
    const module = await Test.createTestingModule({
      controllers: [SubscriptionFeedController],
      providers: [{ provide: PortalService, useValue: service }],
    }).compile();
    app = module.createNestApplication<INestApplication<Server>>();
    app.setGlobalPrefix('api');
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue(credential);
    findFirst.mockResolvedValue(credential);
    findMany.mockResolvedValue([hy2, vless]);
    resolveAccess.mockResolvedValue(access);
  });
  afterAll(async () => {
    await app.close();
  });

  it('serves only entitled HY2 nodes with correct quota headers and a self-updating URL', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/subscribe/${credential.token}/surge?profile=2`)
      .expect(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['x-subscription-node-count']).toBe('1');
    expect(response.headers['subscription-userinfo']).toBe(
      'upload=0; download=256; total=1280; expire=1796083200',
    );
    expect(response.text).toContain(
      `/subscribe/${credential.token}/surge?profile=2 interval=43200 strict=false`,
    );
    expect(response.text).toContain(`password=${credential.token}`);
    expect(response.text).not.toContain('美国 VLESS');
    expect(resolveAccess).toHaveBeenCalledWith('user-1');
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ['allowed-hy2', 'allowed-vless'] }, retiredAt: null },
    });
    const portal = await service.getAccess('user-1');
    expect(portal.surgeNodeCount).toBe(1);
    expect(portal.surgeSubscriptionUrl).toContain(
      `/subscribe/${credential.token}/surge?profile=2`,
    );
  });

  it.each([null, { ...credential, revokedAt: new Date() }])(
    'rejects missing/revoked tokens before resolving access',
    async (token) => {
      findUnique.mockResolvedValue(token);
      await request(app.getHttpServer())
        .get(`/api/subscribe/${credential.token}/surge`)
        .expect(404);
      expect(resolveAccess).not.toHaveBeenCalled();
    },
  );

  it('rejects expired or exhausted access instead of emitting nodes', async () => {
    resolveAccess.mockResolvedValue({ ...access, allowed: false, nodes: [] });
    const response = await request(app.getHttpServer())
      .get(`/api/subscribe/${credential.token}/surge`)
      .expect(404);
    expect(response.text).not.toContain('password=');
  });

  it('reports a lack of compatible nodes without silently converting protocols', async () => {
    findMany.mockResolvedValue([vless]);
    const response = await request(app.getHttpServer())
      .get(`/api/subscribe/${credential.token}/surge`)
      .expect(404);
    expect(response.text).toContain('当前套餐暂无兼容 Surge 的 Hysteria2 节点');
  });

  it('rechecks access on refresh and keeps temporary failures as errors', async () => {
    await request(app.getHttpServer())
      .get(`/api/subscribe/${credential.token}/surge`)
      .expect(200);
    findMany.mockResolvedValue([
      { ...hy2, label: '新 HY2', hostname: '203.0.113.2' },
    ]);
    const updated = await request(app.getHttpServer())
      .get(`/api/subscribe/${credential.token}/surge`)
      .expect(200);
    expect(updated.text).toContain('203.0.113.2');
    expect(updated.text).not.toContain('203.0.113.1');
    resolveAccess.mockRejectedValueOnce(
      new Error('temporary database failure'),
    );
    await expect(
      service.getSurgeSubscription(credential.token),
    ).rejects.toThrow('temporary database failure');
  });
});
