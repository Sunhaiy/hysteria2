import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { Server } from 'node:http';
import {
  AdminAgentUpdatesController,
  AgentUpdaterController,
} from './agent-updates.controller';
import { AgentUpdatesService } from './agent-updates.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { ControlPlaneStoreService } from '../domain/control-plane.store';

describe('Agent update HTTP authorization and validation', () => {
  let app: INestApplication<Server>;
  const updates = {
    overview: jest.fn().mockResolvedValue({ releases: [] }),
    enroll: jest.fn().mockResolvedValue({ id: 'enrolled' }),
    authenticate: jest.fn().mockRejectedValue(new Error('not machine')),
    poll: jest.fn(),
  };
  const grant = jest.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminAgentUpdatesController, AgentUpdaterController],
      providers: [
        { provide: AgentUpdatesService, useValue: updates },
        {
          provide: JwtService,
          useValue: {
            verify: (token: string) => ({
              sub: token,
              role: token === 'admin' ? 'admin' : 'user',
              jti: token,
              sessionVersion: 1,
            }),
          },
        },
        {
          provide: CacheService,
          useValue: { get: () => Promise.resolve('live'), del: jest.fn() },
        },
        {
          provide: ControlPlaneStoreService,
          useValue: {
            getSessionIdentity: (id: string) =>
              Promise.resolve({
                role: id === 'admin' ? 'admin' : 'user',
                status: 'active',
                sessionVersion: 1,
              }),
          },
        },
        {
          provide: PrismaService,
          useValue: { adminPermissionGrant: { findUnique: grant } },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => grant.mockResolvedValue({ id: 'grant' }));
  afterAll(() => app.close());
  it('rejects anonymous and member sessions', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/agent-updates')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/admin/agent-updates')
      .set('Authorization', 'Bearer member')
      .expect(403);
  });
  it('requires the dedicated administrator permission', async () => {
    grant.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get('/api/admin/agent-updates')
      .set('Authorization', 'Bearer admin')
      .expect(403);
    expect(grant).toHaveBeenCalledWith({
      where: {
        userId_permission: {
          userId: 'admin',
          permission: 'AGENT_UPDATES_MANAGE',
        },
      },
      select: { id: true },
    });
  });
  it('allows permitted admins and rejects malformed service names', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/agent-updates')
      .set('Authorization', 'Bearer admin')
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/admin/agent-updates/installations')
      .set('Authorization', 'Bearer admin')
      .send({
        serverId: 'a',
        serviceUnit: 'xray.service',
        architecture: 'amd64',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/admin/agent-updates/installations')
      .set('Authorization', 'Bearer admin')
      .send({
        serverId: 'a',
        serviceUnit: 'xray-agent.service',
        architecture: 'amd64',
      })
      .expect(201);
  });
  it('requires CSRF for cookie-authenticated mutations', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/agent-updates/installations')
      .set('Cookie', 'hysteria2-session=admin')
      .send({
        serverId: 'a',
        serviceUnit: 'xray-agent.service',
        architecture: 'amd64',
      })
      .expect(401);
  });
  it('rejects empty and duplicate rollout targets and injected extra fields', async () => {
    for (const ids of [[], ['a', 'a']])
      await request(app.getHttpServer())
        .post('/api/admin/agent-updates/rollouts')
        .set('Authorization', 'Bearer admin')
        .send({
          releaseId: 'r',
          installationIds: ids,
          idempotencyKey: 'a'.repeat(16),
        })
        .expect(400);
    await request(app.getHttpServer())
      .post('/api/admin/agent-updates/installations')
      .set('Authorization', 'Bearer admin')
      .send({
        serverId: 'a',
        serviceUnit: 'xray-agent.service',
        architecture: 'amd64',
        shellCommand: 'arbitrary',
      })
      .expect(400);
  });
});
