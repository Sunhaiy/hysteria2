import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class RequestPasswordResetDto {
  @IsEmail({}, { message: '邮箱格式不正确，请检查后重试' })
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
