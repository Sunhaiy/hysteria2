import { validate } from 'class-validator';
import {
  RequestRegisterCodeDto,
  TestEmailDto,
  UpdateSettingsDto,
} from './http.dto';

describe('UpdateSettingsDto', () => {
  it.each([1, 1.5, 2.2, 3])(
    'accepts the supported icon stroke width %s',
    async (siteIconStrokeWidth) => {
      const input = Object.assign(new UpdateSettingsDto(), {
        siteIconStrokeWidth,
      });

      await expect(validate(input)).resolves.toEqual([]);
    },
  );

  it.each([0.9, 1.25, 3.1])(
    'rejects the unsupported icon stroke width %s',
    async (siteIconStrokeWidth) => {
      const input = Object.assign(new UpdateSettingsDto(), {
        siteIconStrokeWidth,
      });

      await expect(validate(input)).resolves.not.toEqual([]);
    },
  );
});

describe('email request DTOs', () => {
  it.each([
    ['registration code', RequestRegisterCodeDto, 'email'],
    ['test email', TestEmailDto, 'to'],
  ] as const)(
    'returns a Chinese format reason for %s',
    async (_, Dto, field) => {
      const input = Object.assign(new Dto(), { [field]: 'not-an-email' });

      const errors = await validate(input);
      expect(Object.values(errors[0]?.constraints ?? {})).toContain(
        '邮箱格式不正确，请检查后重试',
      );
    },
  );

  it('validates the optional invitation code alphabet', async () => {
    const valid = Object.assign(new RequestRegisterCodeDto(), {
      email: 'new@example.com',
      inviteCode: 'ABCDEFGH',
    });
    const invalid = Object.assign(new RequestRegisterCodeDto(), {
      email: 'new@example.com',
      inviteCode: 'INVALID1',
    });

    await expect(validate(valid)).resolves.toEqual([]);
    const errors = await validate(invalid);
    expect(Object.values(errors[0]?.constraints ?? {})).toContain(
      '邀请码格式不正确，请填写 8 位邀请码',
    );
  });
});
