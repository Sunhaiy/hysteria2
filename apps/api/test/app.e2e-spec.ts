import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/api/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect(({ body }) => {
        const payload = body as { ok: boolean; state: { nodes: number } };
        expect(payload.ok).toBe(true);
        expect(payload.state.nodes).toBeGreaterThan(0);
      });
  });

  it('/integrations/hysteria/auth (POST) returns 200', () => {
    return request(app.getHttpServer())
      .post('/integrations/hysteria/auth?nodeId=node_hk_core')
      .send({
        addr: '127.0.0.1:59620',
        auth: 'hy2_live_lin_primary',
        tx: 0,
      })
      .expect(200)
      .expect(({ body }) => {
        const payload = body as { ok: boolean; id: string };
        expect(payload.ok).toBe(true);
        expect(typeof payload.id).toBe('string');
      });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });
});
