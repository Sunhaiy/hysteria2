import { generateKeyPairSync } from 'node:crypto';
import { SeoSearchAdapter } from './seo-search.adapter';

function fetchUrl(input: string | URL | Request) {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.toString() : input.url;
}

function fetchBody(init?: RequestInit) {
  const body = init?.body;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new Error('Expected a string or URLSearchParams request body');
}

describe('SeoSearchAdapter', () => {
  const originalWebPublicUrl = process.env.WEB_PUBLIC_URL;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalWebPublicUrl === undefined) delete process.env.WEB_PUBLIC_URL;
    else process.env.WEB_PUBLIC_URL = originalWebPublicUrl;
  });

  it('submits the public URL with its IndexNow key location', async () => {
    process.env.WEB_PUBLIC_URL = 'https://guide.example.com';
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 202 }));
    const adapter = new SeoSearchAdapter({
      get: jest.fn((key: string) =>
        Promise.resolve(
          key === 'seo.indexNowEnabled' ? 'true' : 'index-key-1234',
        ),
      ),
    } as never);

    await expect(
      adapter.submitIndexNow('https://guide.example.com/blog/client-guide'),
    ).resolves.toEqual({ status: 202 });

    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe('https://api.indexnow.org/indexnow');
    expect(JSON.parse(fetchBody(request[1]))).toEqual({
      host: 'guide.example.com',
      key: 'index-key-1234',
      keyLocation: 'https://guide.example.com/api/seo/indexnow-key',
      urlList: ['https://guide.example.com/blog/client-guide'],
    });
  });

  it('signs Google JWT credentials and paginates Search Console rows', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const credential = JSON.stringify({
      client_email: 'seo@example.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      token_uri: 'https://oauth.example.test/token',
    });
    const firstBatch = Array.from({ length: 25_000 }, (_, index) => ({
      keys: ['2026-09-09', `https://example.com/blog/guide-${index}`, '教程'],
      clicks: 1,
      impressions: 10,
      ctr: 0.1,
      position: 3,
    }));
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation((url) => {
      if (fetchUrl(url).includes('/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'google-token' }), {
            status: 200,
          }),
        );
      }
      const page = fetchMock.mock.calls.filter(([requestUrl]) =>
        fetchUrl(requestUrl).includes('/searchAnalytics/query'),
      ).length;
      return Promise.resolve(
        new Response(JSON.stringify({ rows: page === 1 ? firstBatch : [] }), {
          status: 200,
        }),
      );
    });
    const adapter = new SeoSearchAdapter({
      get: jest.fn((key: string) =>
        Promise.resolve(
          key === 'seo.googleEnabled' ? 'true' : 'sc-domain:example.com',
        ),
      ),
      getSecret: jest.fn().mockResolvedValue(credential),
    } as never);

    const rows = await adapter.fetchGoogleMetrics('2026-06-12', '2026-09-09');

    expect(rows).toHaveLength(25_000);
    const tokenRequest = fetchMock.mock.calls[0];
    const tokenBody = new URLSearchParams(fetchBody(tokenRequest[1]));
    const assertion = tokenBody.get('assertion');
    expect(assertion).toBeTruthy();
    const claims = JSON.parse(
      Buffer.from(assertion!.split('.')[1], 'base64url').toString('utf8'),
    ) as { iss: string; aud: string; scope: string };
    expect(claims).toMatchObject({
      iss: 'seo@example.iam.gserviceaccount.com',
      aud: 'https://oauth.example.test/token',
    });
    expect(claims.scope).toContain('webmasters');
    const searchRequests = fetchMock.mock.calls.filter(([url]) =>
      fetchUrl(url).includes('/searchAnalytics/query'),
    );
    expect(searchRequests).toHaveLength(2);
    expect(JSON.parse(fetchBody(searchRequests[1][1]))).toMatchObject({
      startRow: 25_000,
      rowLimit: 25_000,
    });
  });

  it('reports invalid Google credentials without exposing the secret', async () => {
    const adapter = new SeoSearchAdapter({
      get: jest.fn((key: string) =>
        Promise.resolve(
          key === 'seo.googleEnabled' ? 'true' : 'sc-domain:example.com',
        ),
      ),
      getSecret: jest.fn().mockResolvedValue('{not-json'),
    } as never);

    await expect(
      adapter.fetchGoogleMetrics('2026-09-01', '2026-09-09'),
    ).rejects.toThrow('Google 服务账号 JSON 无效');
  });

  it('submits the public sitemap through Search Console', async () => {
    process.env.WEB_PUBLIC_URL = 'https://guide.example.com';
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const credential = JSON.stringify({
      client_email: 'seo@example.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      token_uri: 'https://oauth.example.test/token',
    });
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation((url) =>
      Promise.resolve(
        fetchUrl(url).includes('/token')
          ? new Response(JSON.stringify({ access_token: 'google-token' }), {
              status: 200,
            })
          : new Response(null, { status: 204 }),
      ),
    );
    const adapter = new SeoSearchAdapter({
      get: jest.fn((key: string) =>
        Promise.resolve(
          key === 'seo.googleEnabled' ? 'true' : 'sc-domain:example.com',
        ),
      ),
      getSecret: jest.fn().mockResolvedValue(credential),
    } as never);

    await expect(adapter.submitGoogleSitemap()).resolves.toEqual({
      status: 204,
      sitemap: 'https://guide.example.com/sitemap.xml',
    });
    expect(fetchMock.mock.calls[1]).toEqual([
      'https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/sitemaps/https%3A%2F%2Fguide.example.com%2Fsitemap.xml',
      expect.objectContaining({
        method: 'PUT',
        headers: { Authorization: 'Bearer google-token' },
      }),
    ]);
  });
});
