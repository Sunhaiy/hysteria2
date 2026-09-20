import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import {
  isPublicSourceAddress,
  publicSourceUrl,
  readSeoSource,
} from './seo-source-reader';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
jest.mock('node:https', () => ({ request: jest.fn() }));

describe('SEO public source boundary', () => {
  beforeEach(() => jest.resetAllMocks());
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '100.64.1.1',
    '192.168.1.1',
    '::1',
    '::ffff:127.0.0.1',
    'fe80::1',
    'fc00::1',
    '2002:7f00:1::',
    '2001:db8::1',
  ])('rejects nonpublic address %s', (address) => {
    expect(isPublicSourceAddress(address)).toBe(false);
  });
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
    'allows global address %s',
    (address) => {
      expect(isPublicSourceAddress(address)).toBe(true);
    },
  );
  it.each([
    'file:///etc/passwd',
    'http://user:pass@example.com/',
    'http://example.com:8080',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => publicSourceUrl(url)).toThrow();
  });

  function respond(
    status: number,
    body: string,
    headers: Record<string, string> = {},
  ) {
    jest.mocked(request).mockImplementationOnce((...args: unknown[]) => {
      const callback = args[2] as (response: PassThrough) => void;
      const response = Object.assign(new PassThrough(), {
        statusCode: status,
        headers: { 'content-type': 'text/html', ...headers },
      });
      const req = Object.assign(new EventEmitter(), {
        end: () => {
          callback(response);
          response.end(body);
        },
      });
      return req as ReturnType<typeof request>;
    });
  }
  it('rejects DNS responses containing even one private address', async () => {
    jest.mocked(lookup).mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ] as never);
    await expect(readSeoSource('https://example.com')).rejects.toThrow(
      '公开互联网',
    );
    expect(request).not.toHaveBeenCalled();
  });
  it('revalidates redirect destinations and never connects to loopback', async () => {
    jest
      .mocked(lookup)
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as never)
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as never);
    respond(302, '', { location: 'https://127.0.0.1/private' });
    await expect(readSeoSource('https://example.com')).rejects.toThrow(
      '公开互联网',
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('pins the checked address and removes executable HTML from source snapshots', async () => {
    jest
      .mocked(lookup)
      .mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
    respond(
      200,
      `<title>Official guide</title><script>stealSecret()</script><main>${'核对客户端版本，然后依照公开文档操作。'.repeat(8)}</main>`,
    );
    const source = await readSeoSource('https://example.com/guide');
    expect(source.content).not.toContain('stealSecret');
    expect(source.title).toBe('Official guide');
    const options = jest.mocked(request).mock.calls[0][1] as {
      lookup: (
        host: string,
        options: object,
        callback: (...args: unknown[]) => void,
      ) => void;
    };
    const callback = jest.fn();
    options.lookup('rebinding.example', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
  });
  it('bounds downloaded bytes even without a content-length header', async () => {
    jest
      .mocked(lookup)
      .mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
    respond(200, 'x'.repeat(2 * 1024 * 1024 + 1));
    await expect(readSeoSource('https://example.com')).rejects.toThrow('2 MB');
  });
});
