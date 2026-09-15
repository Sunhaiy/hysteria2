import 'reflect-metadata';
import { validate } from 'class-validator';
import { SaveNodeServerDto } from './node-ops.dto';
import { NodeOpsService } from './node-ops.service';

describe('machine billing configuration', () => {
  const input = {
    slug: 'us',
    name: '[顶级]美国',
    hostname: 'test.invalid',
    active: true,
  };
  function harness() {
    const tx = {
      nodeServer: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'server',
          trafficMultiplierBasisPoints: 15_000,
        }),
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: object }) =>
            Promise.resolve({ id: 'server', ...data }),
          ),
        update: jest
          .fn()
          .mockImplementation(({ data }: { data: object }) =>
            Promise.resolve({ id: 'server', ...data }),
          ),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    return { tx, service: new NodeOpsService(prisma as never, {} as never) };
  }
  it('defaults top-tier machines to 2x and audits their creation', async () => {
    const { service, tx } = harness();
    await expect(service.createServer(input, 'admin')).resolves.toMatchObject({
      trafficMultiplierBasisPoints: 20_000,
    });
    expect(tx.auditLog.create.mock.calls[0]).toMatchObject([
      { data: { actorId: 'admin', targetId: 'server' } },
    ]);
  });
  it('preserves a configured rate when an older client renames a machine', async () => {
    const { service } = harness();
    await expect(
      service.updateServer('server', input, 'admin'),
    ).resolves.toMatchObject({ trafficMultiplierBasisPoints: 15_000 });
  });
  it('accepts an explicit rate and records the previous rate', async () => {
    const { service, tx } = harness();
    await expect(
      service.updateServer(
        'server',
        { ...input, trafficMultiplier: 2.1234 },
        'admin',
      ),
    ).resolves.toMatchObject({ trafficMultiplierBasisPoints: 21_234 });
    expect(tx.auditLog.create.mock.calls[0]).toMatchObject([
      {
        data: {
          metadata: {
            beforeTrafficMultiplierBasisPoints: 15_000,
            trafficMultiplierBasisPoints: 21_234,
          },
        },
      },
    ]);
  });
  it.each([0, -1, 101, NaN, Infinity, 1.12345])(
    'rejects invalid billing rate %s',
    async (trafficMultiplier) => {
      const dto = Object.assign(new SaveNodeServerDto(), input, {
        trafficMultiplier,
      });
      expect(
        (await validate(dto)).some(
          (error) => error.property === 'trafficMultiplier',
        ),
      ).toBe(true);
    },
  );
});
