import { RedemptionCodesController } from './redemption-codes.controller';

describe('RedemptionCodesController', () => {
  it('keeps plan CDK generation available when site payments are enabled', async () => {
    const createRedemptionCode = jest
      .fn()
      .mockResolvedValue([{ code: 'PLAN-001' }]);
    const controller = new RedemptionCodesController({
      createRedemptionCode,
    } as never);

    await expect(
      controller.createCode(
        {
          label: '会员套餐',
          kind: 'plan',
          catalogOfferId: 'offer-monthly',
          planMode: 'renew',
          count: 1,
        },
        { sub: 'admin-1' } as never,
      ),
    ).resolves.toEqual([{ code: 'PLAN-001' }]);

    expect(createRedemptionCode).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'plan',
        catalogOfferId: 'offer-monthly',
        createdById: 'admin-1',
      }),
    );
  });

  it('keeps traffic-pack CDK generation available when site payments are enabled', async () => {
    const createRedemptionCode = jest
      .fn()
      .mockResolvedValue([{ code: 'PACK-001' }]);
    const controller = new RedemptionCodesController({
      createRedemptionCode,
    } as never);

    await expect(
      controller.createCode(
        {
          label: '流量包',
          kind: 'traffic_pack',
          catalogOfferId: 'offer-pack',
          count: 1,
        },
        { sub: 'admin-1' } as never,
      ),
    ).resolves.toEqual([{ code: 'PACK-001' }]);

    expect(createRedemptionCode).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'traffic_pack',
        catalogOfferId: 'offer-pack',
        createdById: 'admin-1',
      }),
    );
  });
});
