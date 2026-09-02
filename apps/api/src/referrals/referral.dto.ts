import { IsBoolean, IsInt, Max, Min } from 'class-validator';

export class UpdateReferralSettingsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(0)
  @Max(10_000)
  inviterRewardBasisPoints!: number;
}
