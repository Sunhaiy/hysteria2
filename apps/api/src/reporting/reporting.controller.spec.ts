import type { Response } from 'express';
import { ReportingController } from './reporting.controller';

describe('ReportingController', () => {
  it('sets an attachment filename and sends the CSV', async () => {
    const reporting = {
      exportOrdersCsv: jest.fn().mockResolvedValue('\uFEFFheader\r\n'),
    };
    const response = {
      setHeader: jest.fn(),
      send: jest.fn(),
    };
    const controller = new ReportingController(reporting as never);

    await controller.exportOrders(response as unknown as Response);

    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv; charset=utf-8',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(
        /^attachment; filename="orders-\d{4}-\d{2}-\d{2}\.csv"$/,
      ),
    );
    expect(response.send).toHaveBeenCalledWith('\uFEFFheader\r\n');
  });
});
