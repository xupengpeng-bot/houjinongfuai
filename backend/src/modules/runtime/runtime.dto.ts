import { IsIn, IsOptional, IsString } from 'class-validator';

export class StartCheckDto {
  @IsIn(['valve', 'well', 'session'])
  targetType!: 'valve' | 'well' | 'session';

  @IsString()
  targetId!: string;

  @IsOptional()
  @IsString()
  sceneCode?: string;
}

export class CreateRuntimeSessionDto {
  @IsString()
  decisionId!: string;

  @IsOptional()
  @IsString()
  confirmToken?: string;
}
