import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PaymentCallbackService } from './payment-callback.service';

@Controller('payments')
export class PaymentCallbackController {
  constructor(private readonly callbackService: PaymentCallbackService) {}

  @Get('wechat/pay/:id')
  async launchWechatPay(
    @Param('id') id: string,
    @Query('return_url') returnUrl: string | undefined,
    @Query('code') oauthCode: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Res() res: Response
  ) {
    const clientIp = forwardedFor?.split(',')[0]?.trim() || undefined;
    const payload = await this.callbackService.createWechatPayLaunch({
      paymentIntentId: id,
      returnUrl: returnUrl ?? null,
      oauthCode: oauthCode ?? null,
      userAgent: userAgent ?? null,
      clientIp: clientIp ?? null
    });

    if (payload.type === 'redirect') {
      res.redirect(302, payload.location);
      return;
    }

    res.type('text/html; charset=utf-8');
    res.send(payload.html);
  }

  @Get('alipay/pay/:id')
  async launchAlipayPay(
    @Param('id') id: string,
    @Query('return_url') returnUrl: string | undefined,
    @Res() res: Response
  ) {
    const payload = await this.callbackService.createAlipayPayLaunch({
      paymentIntentId: id,
      returnUrl: returnUrl ?? null
    });

    res.redirect(302, payload.location);
  }

  @Post('wechat/notify')
  @HttpCode(200)
  async handleWechatNotify(
    @Body() body: string | Record<string, unknown>,
    @Headers('content-type') _contentType: string | undefined,
    @Res() res: Response
  ) {
    const payload = await this.callbackService.handleWechatNotify(body);
    res.type('application/xml; charset=utf-8');
    res.send(payload);
  }

  @Post('alipay/notify')
  @HttpCode(200)
  async handleAlipayNotify(@Body() body: Record<string, unknown>, @Res() res: Response) {
    const payload = await this.callbackService.handleAlipayNotify(body);
    res.type('text/plain; charset=utf-8');
    res.send(payload);
  }

  @Get('alipay/return')
  async handleAlipayReturn(@Query() query: Record<string, unknown>, @Res() res: Response) {
    const redirectUrl = await this.callbackService.handleAlipayReturn(query);
    res.redirect(302, redirectUrl);
  }
}
