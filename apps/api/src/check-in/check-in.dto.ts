import { IsBoolean, IsNumber, Max, Min } from 'class-validator';

export class UpdateCheckInSettingsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rewardGiB!: number;
}
