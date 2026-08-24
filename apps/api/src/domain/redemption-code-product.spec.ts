import { BadRequestException } from '@nestjs/common';
import { ControlPlaneStoreService } from './control-plane.store';

describe('Traffic pack product redemption', () => {
  it('rejects a CDK that is not bound to the selected product', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user_1' }),
      },
      subscription: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      trafficPack: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      redemptionCode: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'code_1',
          code: 'PACK-OTHER',
          kind: 'TRAFFIC_PACK',
          status: 'ACTIVE',
          trafficPackProductId: 'pack_other',
          expiresAt: null,
        }),
      },
    };
    const service = new ControlPlaneStoreService(prisma as never);

    await expect(
      service.redeemRedemptionCode('user_1', 'PACK-OTHER', 'pack_selected'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
