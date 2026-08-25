import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSupportTicketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  subject!: string;

  @IsIn(['access', 'billing', 'technical', 'other'])
  category!: 'access' | 'billing' | 'technical' | 'other';

  @IsOptional()
  @IsIn(['low', 'normal', 'high'])
  priority?: 'low' | 'normal' | 'high';

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message!: string;
}

export class ReplySupportTicketDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}

export class UpdateSupportTicketDto {
  @IsIn(['waiting_staff', 'waiting_member', 'closed'])
  status!: 'waiting_staff' | 'waiting_member' | 'closed';
}
