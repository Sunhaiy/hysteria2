import { validate } from 'class-validator';
import { CreateSupportTicketDto } from './tickets.dto';

describe('CreateSupportTicketDto', () => {
  it('accepts a non-empty two-character Chinese subject', async () => {
    const input = Object.assign(new CreateSupportTicketDto(), {
      subject: '咨询',
      category: 'access',
      priority: 'normal',
      message: '无法正常提交工单',
    });

    await expect(validate(input)).resolves.toEqual([]);
  });
});
