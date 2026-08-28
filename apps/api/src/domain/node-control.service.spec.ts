import { BadRequestException } from '@nestjs/common';
import { NodeControlService, type SaveNodeInput } from './node-control.service';

describe('NodeControlService port hopping validation', () => {
  const input = (overrides: Partial<SaveNodeInput> = {}): SaveNodeInput => ({
    protocol: 'hysteria2',
    label: 'US Hysteria2',
    hostname: '203.0.113.20',
    port: 59620,
    portHoppingEnabled: true,
    portHoppingStart: 20000,
    portHoppingEnd: 29999,
    portHoppingIntervalSeconds: 30,
    allowInsecureTls: false,
    trafficApiBaseUrl: 'https://203.0.113.20:59621',
    trafficApiSecret: 'traffic-secret',
    active: true,
    speedUpMbps: 0,
    speedDownMbps: 0,
    ...overrides,
  });
  const prisma = { node: { create: jest.fn() } };
  const cipher = { encrypt: jest.fn((value: string) => value) };
  const service = new NodeControlService(prisma as never, cipher as never);

  beforeEach(() => jest.clearAllMocks());

  it('rejects port hopping on VLESS Reality nodes', async () => {
    await expect(
      service.createNode(
        input({
          protocol: 'vless_reality',
          sni: 'www.cloudflare.com',
          realityPublicKey: 'public-key',
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.node.create).not.toHaveBeenCalled();
  });

  it('rejects invalid or oversized hopping ranges', async () => {
    await expect(
      service.createNode(
        input({ portHoppingStart: 10000, portHoppingEnd: 40001 }),
      ),
    ).rejects.toThrow('valid range');
    expect(prisma.node.create).not.toHaveBeenCalled();
  });

  it('keeps the primary Hysteria2 port outside the hopping range', async () => {
    await expect(
      service.createNode(
        input({ portHoppingStart: 59000, portHoppingEnd: 60000 }),
      ),
    ).rejects.toThrow('primary Hysteria2 port');
    expect(prisma.node.create).not.toHaveBeenCalled();
  });
});
