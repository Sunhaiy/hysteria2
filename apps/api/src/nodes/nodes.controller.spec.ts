import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { NodesController } from './nodes.controller';

describe('NodesController manual synchronization', () => {
  it('accepts a worker request without collecting traffic in the API process', async () => {
    const request = jest
      .fn()
      .mockResolvedValue({ accepted: true, nodeId: 'node' });
    const syncNode = jest
      .fn()
      .mockRejectedValue(new Error('API must not call a node agent'));
    const controller = new NodesController(
      {} as never,
      { request, syncNode } as never,
    );

    await expect(controller.syncNode('node')).resolves.toEqual({
      accepted: true,
      nodeId: 'node',
    });
    expect(syncNode).not.toHaveBeenCalled();
    // Metadata inspection does not invoke or detach the handler for execution.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.syncNode)).toBe(
      202,
    );
  });
});
