import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class StartCheckDto {
  @IsIn(['valve', 'well', 'pump', 'session'])
  targetType!: 'valve' | 'well' | 'pump' | 'session';

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

export class CreateWechatPaymentLinkDto {
  @IsNumber()
  @Min(0.01)
  amount!: number;
}

export class CompleteWechatPaymentDto {
  @IsString()
  callback_token!: string;
}

export class CardSwipeDto {
  @IsOptional()
  @IsString()
  card_token?: string;

  @IsOptional()
  @IsIn(['start', 'stop'])
  swipe_action?: 'start' | 'stop';

  @IsOptional()
  @IsString()
  swipe_event_id?: string;

  @IsOptional()
  @IsString()
  swipe_at?: string;
}
