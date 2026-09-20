import { SeoAiAdapter } from './seo-ai.adapter';
import { readSeoSource } from './seo-source-reader';

jest.mock('./seo-source-reader', () => ({ readSeoSource: jest.fn() }));
const settings = {
  get: (key: string) =>
    Promise.resolve(
      (
        {
          'seo.aiBaseUrl': 'https://upstream.example/v1',
          'seo.textModel': 'configured-model',
        } as Record<string, string>
      )[key],
    ),
  getSecret: () => Promise.resolve('private-key'),
};

describe('SEO upstream research capability', () => {
  afterEach(() => jest.restoreAllMocks());
  it('does not accept model prose or fabricated citation text as tool use', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ output_text: 'I searched https://example.com' }),
        ),
      );
    expect((await new SeoAiAdapter(settings as never).research()).status).toBe(
      'unsupported',
    );
  });
  it('requires an actual completed search plus a readable public source', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'web_search_call',
              status: 'completed',
              action: { sources: [{ url: 'https://example.com/guide' }] },
            },
          ],
        }),
      ),
    );
    jest.mocked(readSeoSource).mockResolvedValue({
      id: 's',
      url: 'https://example.com/guide',
      title: '文档',
      content: '实际文档内容',
      accessedAt: new Date().toISOString(),
      applicableVersion: null,
    });
    const result = await new SeoAiAdapter(settings as never).research('排障');
    expect(result.status).toBe('supported');
    expect(result.sources).toHaveLength(1);
    expect(fetchMock.mock.calls[0][1]?.body).toContain('configured-model');
    expect(JSON.stringify(result)).not.toContain('private-key');
  });
  it('does not report support when search URLs cannot be verified', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'web_search_call',
              status: 'completed',
              action: { sources: [{ url: 'https://127.0.0.1' }] },
            },
          ],
        }),
      ),
    );
    jest.mocked(readSeoSource).mockRejectedValue(new Error('blocked'));
    expect((await new SeoAiAdapter(settings as never).research()).status).toBe(
      'error',
    );
  });
  it.each([401, 429, 500])(
    'classifies HTTP %i as temporary failure rather than unsupported',
    async (status) => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('upstream rejected', { status }));
      expect(
        (await new SeoAiAdapter(settings as never).research()).status,
      ).toBe('error');
    },
  );
  it('classifies explicit unsupported-tool responses', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response('web_search is unsupported', { status: 400 }),
      );
    expect((await new SeoAiAdapter(settings as never).research()).status).toBe(
      'unsupported',
    );
  });
  it('handles upstream timeout without leaking credentials', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('timeout private-key'));
    const result = await new SeoAiAdapter(settings as never).research();
    expect(result.status).toBe('error');
    expect(JSON.stringify(result)).not.toContain('private-key');
  });
});
