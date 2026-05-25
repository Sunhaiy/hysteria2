import { HysteriaAuthService } from './hysteria-auth.service';

describe('HysteriaAuthService', () => {
  const authorizeHysteriaAccess = jest.fn();
  let service: HysteriaAuthService;

  beforeEach(() => {
    authorizeHysteriaAccess.mockReset();
    service = new HysteriaAuthService({
      authorizeHysteriaAccess,
    } as never);
  });

  it('delegates Hysteria HTTP auth payloads to the control plane service', async () => {
    authorizeHysteriaAccess.mockResolvedValue({
      ok: true,
      id: 'usr_lin',
    });

    const payload = {
      nodeId: 'node_hk_core',
      tokenValue: 'hy2_live_lin_primary',
      remoteAddr: '198.51.100.10:44321',
      requestedTxBps: 5_000_000,
    };
    const result = await service.authorize(payload);

    expect(result).toEqual({
      ok: true,
      id: 'usr_lin',
    });
    expect(authorizeHysteriaAccess).toHaveBeenCalledWith(payload);
  });
});
