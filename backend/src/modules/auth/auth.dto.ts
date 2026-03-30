import { IsOptional, IsString } from 'class-validator';

/** 与前端 Login 表单一致；均可选以便兼容空 body / Phase1 占位登录 */
export class AuthLoginDto {
  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;
}
