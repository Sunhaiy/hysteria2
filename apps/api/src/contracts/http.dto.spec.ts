import { validate } from 'class-validator';
import { UpdateSettingsDto } from './http.dto';

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
