import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createSign, createVerify, randomBytes } from 'crypto';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCodes } from '../../common/errors/error-codes';
import { FarmerFundService } from '../farmer-fund/farmer-fund.service';
import { PaymentAccountService } from '../payment-account/payment-account.module';
import { OrderSettlementService } from '../order/order-settlement.service';
import { RuntimeCheckoutService } from './runtime-checkout.service';

type CallbackAccount = Awaited<ReturnType<PaymentAccountService['resolveCallbackAccount']>>;

@Injectable()
export class PaymentCallbackService {
  private readonly logger = new Logger(PaymentCallbackService.name);

  constructor(
    private readonly checkoutService: RuntimeCheckoutService,
    private readonly farmerFundService: FarmerFundService,
    private readonly paymentAccountService: PaymentAccountService,
    private readonly orderSettlementService: OrderSettlementService,
    private readonly configService: ConfigService
  ) {}

  private asString(value: unknown) {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return '';
  }

  private asNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private asObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private normalizeRecord(value: Record<string, unknown>) {
    const result: Record<string, string> = {};
    for (const [key, rawValue] of Object.entries(value)) {
      if (Array.isArray(rawValue)) {
        const firstValue = rawValue[0];
        const normalized = this.asString(firstValue);
        if (normalized) result[key] = normalized;
        continue;
      }

      const normalized = this.asString(rawValue);
      if (normalized) {
        result[key] = normalized;
      }
    }
    return result;
  }

  private safeStringify(value: unknown) {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  }

  private escapeXml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private buildWechatResponse(returnCode: 'SUCCESS' | 'FAIL', returnMsg: string) {
    return `<xml><return_code><![CDATA[${returnCode}]]></return_code><return_msg><![CDATA[${this.escapeXml(
      returnMsg
    )}]]></return_msg></xml>`;
  }

  private parseWechatXml(xmlText: string) {
    const normalized = xmlText.trim().replace(/^\uFEFF/, '');
    const xmlBody = normalized.match(/^<xml[^>]*>([\s\S]*)<\/xml>$/i)?.[1] ?? normalized;
    const result: Record<string, string> = {};
    const fieldPattern = /<([A-Za-z0-9_:-]+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/\1>/g;
    let match: RegExpExecArray | null = null;

    while ((match = fieldPattern.exec(xmlBody))) {
      result[match[1]] = (match[2] ?? match[3] ?? '').trim();
    }

    return result;
  }

  private buildWechatSign(payload: Record<string, string>, apiKey: string) {
    const content = Object.entries(payload)
      .filter(([key, value]) => key !== 'sign' && value !== '')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');

    return createHash('md5')
      .update(`${content}&key=${apiKey}`, 'utf8')
      .digest('hex')
      .toUpperCase();
  }

  private verifyWechatSignature(payload: Record<string, string>, apiKey: string) {
    const sign = this.asString(payload.sign).toUpperCase();
    if (!sign) return false;
    return sign === this.buildWechatSign(payload, apiKey);
  }

  private buildAlipaySignContent(params: Record<string, string>) {
    return Object.entries(params)
      .filter(([key, value]) => key !== 'sign' && key !== 'sign_type' && value !== '')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
  }

  private wrapPem(key: string, label: 'PUBLIC KEY' | 'PRIVATE KEY') {
    const normalized = key.trim();
    if (!normalized) return '';
    if (normalized.includes('BEGIN')) return normalized;
    const lines = normalized.match(/.{1,64}/g)?.join('\n') ?? normalized;
    return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
  }

  private verifyAlipaySignature(params: Record<string, string>, alipayPublicKey: string) {
    const sign = this.asString(params.sign).replace(/ /g, '+');
    if (!sign) return false;

    const verifier = createVerify('RSA-SHA256');
    verifier.update(this.buildAlipaySignContent(params), 'utf8');
    verifier.end();

    return verifier.verify(this.wrapPem(alipayPublicKey, 'PUBLIC KEY'), sign, 'base64');
  }

  private signAlipayPayload(params: Record<string, string>, merchantPrivateKey: string) {
    const signer = createSign('RSA-SHA256');
    signer.update(this.buildAlipaySignContent(params), 'utf8');
    signer.end();
    return signer.sign(this.wrapPem(merchantPrivateKey, 'PRIVATE KEY'), 'base64');
  }

  private isCardRechargeIntent(intent: { checkoutSnapshot?: Record<string, unknown> | null }) {
    return this.asString(intent.checkoutSnapshot?.created_from) === 'card_recharge';
  }

  private buildDefaultCardRechargeReturnUrl(intent: { id: string; checkoutSnapshot?: Record<string, unknown> | null }) {
    const cardToken = this.asString(intent.checkoutSnapshot?.card_token);
    const url = new URL(`${this.getPublicWebBaseUrl()}/card/recharge`);
    if (cardToken) url.searchParams.set('card_no', cardToken);
    url.searchParams.set('payment_intent_id', intent.id);
    return url.toString();
  }

  private resolveAccountConfigValue(account: CallbackAccount, path: string[]) {
    let current: unknown = account?.configJson ?? {};
    for (const segment of path) {
      const record = this.asObject(current);
      current = record[segment];
    }
    return current;
  }

  private async resolveWechatAccount(payload: Record<string, string>) {
    return this.paymentAccountService.resolveCallbackAccount('wechat', {
      merchantNo: payload.mch_id || null,
      appId: payload.appid || null
    });
  }

  private async resolveAlipayAccount(payload: Record<string, string>) {
    return this.paymentAccountService.resolveCallbackAccount('alipay', {
      merchantNo: payload.seller_id || payload.pid || null,
      appId: payload.app_id || null,
      accountIdentity: payload.seller_id || payload.seller_email || null
    });
  }

  private buildReturnRedirectUrl(baseUrl: string, params: Record<string, string>) {
    if (/^https?:\/\//i.test(baseUrl)) {
      const url = new URL(baseUrl);
      for (const [key, value] of Object.entries(params)) {
        if (value) url.searchParams.set(key, value);
      }
      return url.toString();
    }

    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }

    return search.size > 0 ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${search.toString()}` : baseUrl;
  }

  private formatCallbackError(error: unknown, fallback = 'internal error') {
    if (error instanceof AppException || error instanceof Error) {
      return this.asString(error.message) || fallback;
    }
    return fallback;
  }

  private getPublicWebBaseUrl() {
    const configured =
      this.asString(this.configService.get<string>('PUBLIC_WEB_BASE_URL')) ||
      this.asString(this.configService.get<string>('PORTAL_PUBLIC_BASE_URL')) ||
      'http://xupengpeng.top';
    return configured.replace(/\/+$/, '');
  }

  private joinPublicUrl(pathOrUrl: string) {
    const normalized = this.asString(pathOrUrl);
    if (!normalized) return this.getPublicWebBaseUrl();
    if (/^https?:\/\//i.test(normalized)) return normalized;
    if (normalized.startsWith('/')) return `${this.getPublicWebBaseUrl()}${normalized}`;
    return `${this.getPublicWebBaseUrl()}/${normalized}`;
  }

  private buildDefaultWechatReturnUrl(intent: {
    id: string;
    imei: string;
    checkoutSnapshot?: Record<string, unknown> | null;
  }) {
    if (this.isCardRechargeIntent(intent)) {
      return this.buildDefaultCardRechargeReturnUrl(intent);
    }
    const url = new URL(`${this.getPublicWebBaseUrl()}/u/scan`);
    url.searchParams.set('imei', intent.imei);
    url.searchParams.set('payment_intent_id', intent.id);
    return url.toString();
  }

  private async completeIntentByOutTradeNo(
    outTradeNo: string,
    input: {
      provider: 'wechat' | 'alipay';
      paidAmount?: number | null;
      providerTradeNo?: string | null;
      providerPayload?: Record<string, unknown>;
      startedVia?: string | null;
    }
  ) {
    const intent = await this.orderSettlementService.getPaymentIntentByOutTradeNo(outTradeNo);
    if (!intent) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'payment intent not found', 404, { out_trade_no: outTradeNo });
    }

    if (this.isCardRechargeIntent(intent)) {
      return this.farmerFundService.completeRechargePaymentByOutTradeNo({
        outTradeNo,
        provider: input.provider,
        paidAmount: input.paidAmount ?? null,
        providerTradeNo: input.providerTradeNo ?? null,
        providerPayload: {
          ...(input.providerPayload ?? {}),
          callback_source: input.startedVia ?? null,
        }
      });
    }

    return this.checkoutService.completeProviderPaymentByOutTradeNo(outTradeNo, input);
  }

  private normalizeReturnUrl(rawValue: string | null | undefined, fallback: string) {
    const normalized = this.asString(rawValue);
    if (!normalized) return fallback;
    if (/^https?:\/\//i.test(normalized)) return normalized;
    return this.joinPublicUrl(normalized.startsWith('/') ? normalized : `/${normalized}`);
  }

  private buildWechatOauthUrl(input: { appId: string; redirectUrl: string; state: string }) {
    const url = new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
    url.searchParams.set('appid', input.appId);
    url.searchParams.set('redirect_uri', input.redirectUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'snsapi_base');
    url.searchParams.set('state', input.state);
    return `${url.toString()}#wechat_redirect`;
  }

  private buildWechatUnifiedOrderXml(fields: Record<string, string>) {
    const body = Object.entries(fields)
      .map(([key, value]) => `<${key}><![CDATA[${value}]]></${key}>`)
      .join('');
    return `<xml>${body}</xml>`;
  }

  private randomNonce(length = 24) {
    return randomBytes(Math.max(8, Math.ceil(length / 2))).toString('hex').slice(0, length);
  }

  private async fetchJson(url: string) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new AppException(ErrorCodes.INTERNAL_ERROR, `upstream request failed: ${response.status}`, 502, {
        url
      });
    }
    return (await response.json()) as Record<string, unknown>;
  }

  private async resolveWechatOpenId(input: { appId: string; appSecret: string; code: string }) {
    const url = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
    url.searchParams.set('appid', input.appId);
    url.searchParams.set('secret', input.appSecret);
    url.searchParams.set('code', input.code);
    url.searchParams.set('grant_type', 'authorization_code');
    const payload = await this.fetchJson(url.toString());
    const openId = this.asString(payload.openid);
    if (!openId) {
      throw new AppException(
        ErrorCodes.INTERNAL_ERROR,
        this.asString(payload.errmsg) || 'failed to resolve wechat openid',
        502,
        payload
      );
    }
    return {
      openId,
      payload
    };
  }

  private async createWechatJsapiOrder(input: {
    appId: string;
    mchId: string;
    apiKeyV2: string;
    openId: string;
    notifyUrl: string;
    outTradeNo: string;
    amount: number;
    body: string;
    clientIp: string;
    attach?: string;
  }) {
    const nonceStr = this.randomNonce(24);
    const totalFeeFen = Math.max(1, Math.round(input.amount * 100));
    const requestPayload: Record<string, string> = {
      appid: input.appId,
      mch_id: input.mchId,
      nonce_str: nonceStr,
      body: input.body,
      out_trade_no: input.outTradeNo,
      total_fee: String(totalFeeFen),
      spbill_create_ip: input.clientIp || '127.0.0.1',
      notify_url: input.notifyUrl,
      trade_type: 'JSAPI',
      openid: input.openId,
    };
    if (input.attach) {
      requestPayload.attach = input.attach;
    }
    requestPayload.sign = this.buildWechatSign(requestPayload, input.apiKeyV2);

    this.logger.log(
      `wechat unifiedorder request out_trade_no=${input.outTradeNo} notify_url=${input.notifyUrl} amount=${input.amount.toFixed(
        2
      )} openid=${input.openId ? 'present' : 'missing'}`
    );

    const response = await fetch('https://api.mch.weixin.qq.com/pay/unifiedorder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: this.buildWechatUnifiedOrderXml(requestPayload),
    });

    const xmlText = await response.text();
    const payload = this.parseWechatXml(xmlText);
    this.logger.log(
      `wechat unifiedorder response out_trade_no=${input.outTradeNo} return_code=${this.asString(
        payload.return_code
      )} result_code=${this.asString(payload.result_code)} prepay_id=${this.asString(payload.prepay_id) || 'missing'}`
    );
    const returnCode = this.asString(payload.return_code).toUpperCase();
    const resultCode = this.asString(payload.result_code).toUpperCase();
    if (returnCode !== 'SUCCESS' || resultCode !== 'SUCCESS') {
      throw new AppException(
        ErrorCodes.INTERNAL_ERROR,
        this.asString(payload.return_msg) || this.asString(payload.err_code_des) || 'wechat unifiedorder failed',
        502,
        payload
      );
    }

    const prepayId = this.asString(payload.prepay_id);
    if (!prepayId) {
      throw new AppException(ErrorCodes.INTERNAL_ERROR, 'wechat unifiedorder missing prepay_id', 502, payload);
    }

    return {
      prepayId,
      payload,
    };
  }

  private buildWechatJsapiInvokeParams(input: { appId: string; apiKeyV2: string; prepayId: string }) {
    const nonceStr = this.randomNonce(24);
    const timeStamp = String(Math.floor(Date.now() / 1000));
    const invokePayload: Record<string, string> = {
      appId: input.appId,
      timeStamp,
      nonceStr,
      package: `prepay_id=${input.prepayId}`,
      signType: 'MD5',
    };
    const paySign = this.buildWechatSign(invokePayload, input.apiKeyV2);
    return {
      ...invokePayload,
      paySign,
    };
  }

  private buildWechatPayPage(input: {
    invokeParams: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
    failUrl: string;
    title: string;
  }) {
    const invokePayloadJson = JSON.stringify(input.invokeParams);
    const successUrlJson = JSON.stringify(input.successUrl);
    const cancelUrlJson = JSON.stringify(input.cancelUrl);
    const failUrlJson = JSON.stringify(input.failUrl);
    const title = this.escapeXml(input.title);

    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: linear-gradient(180deg, #f7fbff 0%, #eef5ff 100%); color: #172033; box-sizing: border-box; }
      .card { width: min(100%, 520px); background: rgba(255,255,255,.96); border: 1px solid rgba(22,119,255,.1); border-radius: 18px; padding: 24px; box-shadow: 0 18px 48px rgba(23,32,51,.08); }
      .title { font-size: 20px; font-weight: 600; margin-bottom: 10px; }
      .desc { font-size: 14px; color: #5f6b85; line-height: 1.7; }
      .status { margin-top: 14px; display: flex; align-items: center; gap: 10px; font-size: 13px; color: #3b4a69; }
      .spinner { width: 16px; height: 16px; border-radius: 999px; border: 2px solid rgba(7,193,96,.22); border-top-color: #07c160; animation: spin 0.9s linear infinite; flex: 0 0 auto; }
      .btn { display: none; margin-top: 18px; width: 100%; align-items: center; justify-content: center; padding: 12px 18px; border-radius: 10px; border: 0; background: #07c160; color: #fff; font-size: 15px; cursor: pointer; }
      .btn.show { display: inline-flex; }
      .muted { margin-top: 12px; font-size: 12px; color: #7d879c; line-height: 1.6; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="title">正在拉起微信支付</div>
      <div class="desc">支付完成后会自动回到业务页面，并根据支付回调继续发起设备启动，无需手动跳转。</div>
      <div class="status" id="pay-status">
        <span class="spinner" aria-hidden="true"></span>
        <span id="status-text">正在准备支付，请稍候...</span>
      </div>
      <button id="pay-btn" class="btn" type="button">重新发起支付</button>
      <div class="muted" id="hint-text">如果微信没有自动弹出支付确认，这里会给你一个重试入口。</div>
    </div>
    <script>
      const invokeParams = ${invokePayloadJson};
      const successUrl = ${successUrlJson};
      const cancelUrl = ${cancelUrlJson};
      const failUrl = ${failUrlJson};
      const payButton = document.getElementById("pay-btn");
      const statusText = document.getElementById("status-text");
      const hintText = document.getElementById("hint-text");
      let retryTimer = null;

      function redirectTo(url) {
        window.location.replace(url);
      }

      function showRetry(message) {
        if (message && hintText) {
          hintText.textContent = message;
        }
        payButton?.classList.add("show");
      }

      function invokePay() {
        if (typeof WeixinJSBridge === "undefined") return;
        if (retryTimer) {
          window.clearTimeout(retryTimer);
        }
        if (statusText) {
          statusText.textContent = "已发起支付，请在微信内确认。";
        }
        WeixinJSBridge.invoke("getBrandWCPayRequest", invokeParams, function(res) {
          if (retryTimer) {
            window.clearTimeout(retryTimer);
          }
          const err = (res && res.err_msg ? String(res.err_msg) : "").toLowerCase();
          if (err.indexOf("ok") >= 0) {
            redirectTo(successUrl);
            return;
          }
          if (err.indexOf("cancel") >= 0) {
            redirectTo(cancelUrl);
            return;
          }
          redirectTo(failUrl);
        });
        retryTimer = window.setTimeout(function() {
          showRetry("如果微信没有弹出支付确认，请点击下方按钮重新发起支付。");
        }, 1800);
      }

      payButton?.addEventListener("click", invokePay);
      if (typeof WeixinJSBridge === "undefined") {
        if (statusText) {
          statusText.textContent = "正在连接微信支付能力，请稍候。";
        }
        document.addEventListener("WeixinJSBridgeReady", invokePay, false);
        window.setTimeout(function() {
          showRetry("如果当前页面迟迟没有自动拉起支付，可以点击下方按钮重试。");
        }, 2500);
      } else {
        invokePay();
      }
    </script>
  </body>
</html>`;
  }

  private buildWechatOpenHintPage(paymentUrl: string) {
    const paymentUrlJson = JSON.stringify(paymentUrl);
    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>请在微信中打开</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; padding: 24px; background: #f5f7fb; color: #172033; }
      .card { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 12px 36px rgba(23,32,51,.08); }
      .title { font-size: 20px; font-weight: 600; margin-bottom: 10px; }
      .desc { font-size: 14px; color: #5f6b85; line-height: 1.7; }
      .btn { display: inline-block; margin-top: 18px; padding: 12px 18px; border-radius: 10px; border: 0; background: #1677ff; color: #fff; font-size: 15px; cursor: pointer; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="title">请在微信内完成支付</div>
      <div class="desc">当前页面不在微信内，无法直接拉起微信支付。请将当前链接复制到微信中打开后继续支付。</div>
      <button id="copy-btn" class="btn" type="button">复制支付链接</button>
    </div>
    <script>
      const paymentUrl = ${paymentUrlJson};
      document.getElementById("copy-btn")?.addEventListener("click", async function() {
        try {
          await navigator.clipboard.writeText(paymentUrl);
          alert("支付链接已复制，请到微信中打开。");
        } catch (error) {
          alert(paymentUrl);
        }
      });
    </script>
  </body>
</html>`;
  }

  async createWechatPayLaunch(input: {
    paymentIntentId: string;
    returnUrl?: string | null;
    oauthCode?: string | null;
    userAgent?: string | null;
    clientIp?: string | null;
  }) {
    const intent = await this.orderSettlementService.getPaymentIntentById(input.paymentIntentId);
    if (!intent) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'payment intent not found', 404, {
        payment_intent_id: input.paymentIntentId
      });
    }

    const fallbackReturnUrl = this.buildDefaultWechatReturnUrl({ id: intent.id, imei: intent.imei });
    const returnUrl = this.normalizeReturnUrl(input.returnUrl, fallbackReturnUrl);
    const successUrl = this.buildReturnRedirectUrl(returnUrl, {
      imei: intent.imei,
      payment_intent_id: intent.id,
      payment_result: 'success'
    });
    const cancelUrl = this.buildReturnRedirectUrl(returnUrl, {
      imei: intent.imei,
      payment_intent_id: intent.id,
      payment_result: 'cancel'
    });
    const failUrl = this.buildReturnRedirectUrl(returnUrl, {
      imei: intent.imei,
      payment_intent_id: intent.id,
      payment_result: 'failed'
    });

    if (intent.status === 'paid') {
      return {
        type: 'redirect' as const,
        location: successUrl
      };
    }

    if (intent.status === 'refunded') {
      return {
        type: 'redirect' as const,
        location: failUrl
      };
    }

    const account = await this.paymentAccountService.resolveCallbackAccount('wechat', {
      merchantNo: this.asString(intent.paymentAccountSnapshot?.merchant_no) || null,
      appId: this.asString(intent.paymentAccountSnapshot?.app_id) || null
    });
    if (!account) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'wechat payment account not found', 404, {
        payment_intent_id: intent.id
      });
    }

    const appId =
      this.asString(this.resolveAccountConfigValue(account, ['public_account', 'app_id'])) ||
      this.asString(this.resolveAccountConfigValue(account, ['app_id'])) ||
      this.asString(account.appId);
    const appSecret =
      this.asString(this.resolveAccountConfigValue(account, ['public_account', 'app_secret'])) ||
      this.asString(this.resolveAccountConfigValue(account, ['app_secret']));
    const mchId =
      this.asString(this.resolveAccountConfigValue(account, ['merchant', 'mch_id'])) ||
      this.asString(this.resolveAccountConfigValue(account, ['mch_id'])) ||
      this.asString(account.merchantNo);
    const apiKeyV2 =
      this.asString(this.resolveAccountConfigValue(account, ['merchant', 'api_key_v2'])) ||
      this.asString(this.resolveAccountConfigValue(account, ['api_key_v2']));
    const notifyUrl = this.joinPublicUrl(
      this.asString(this.resolveAccountConfigValue(account, ['notify_url'])) || '/api/v1/payments/wechat/notify'
    );

    if (!appId || !appSecret || !mchId || !apiKeyV2) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'wechat payment account config is incomplete', 400, {
        payment_intent_id: intent.id
      });
    }

    const currentLaunchUrl = `${this.getPublicWebBaseUrl()}/api/v1/payments/wechat/pay/${encodeURIComponent(intent.id)}?return_url=${encodeURIComponent(returnUrl)}`;
    const isWechatBrowser = this.asString(input.userAgent).toLowerCase().includes('micromessenger');
    if (!isWechatBrowser) {
      return {
        type: 'html' as const,
        html: this.buildWechatOpenHintPage(currentLaunchUrl)
      };
    }

    const oauthCode = this.asString(input.oauthCode);
    if (!oauthCode) {
      return {
        type: 'redirect' as const,
        location: this.buildWechatOauthUrl({
          appId,
          redirectUrl: currentLaunchUrl,
          state: intent.id
        })
      };
    }

    const { openId } = await this.resolveWechatOpenId({
      appId,
      appSecret,
      code: oauthCode
    });
    const unifiedOrder = await this.createWechatJsapiOrder({
      appId,
      mchId,
      apiKeyV2,
      openId,
      notifyUrl,
      outTradeNo: intent.outTradeNo,
      amount: Number(intent.amount ?? 0),
      body: this.asString(intent.checkoutSnapshot?.device_name) || this.asString(intent.checkoutSnapshot?.well_name) || 'Houji Irrigation Payment',
      clientIp: this.asString(input.clientIp) || '127.0.0.1',
      attach: JSON.stringify({
        payment_intent_id: intent.id,
        imei: intent.imei
      })
    });
    const invokeParams = this.buildWechatJsapiInvokeParams({
      appId,
      apiKeyV2,
      prepayId: unifiedOrder.prepayId
    });

    return {
      type: 'html' as const,
      html: this.buildWechatPayPage({
        invokeParams,
        successUrl,
        cancelUrl,
        failUrl,
        title: '微信支付'
      })
    };
  }

  async createAlipayPayLaunch(input: {
    paymentIntentId: string;
    returnUrl?: string | null;
  }) {
    const intent = await this.orderSettlementService.getPaymentIntentById(input.paymentIntentId);
    if (!intent) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'payment intent not found', 404, {
        payment_intent_id: input.paymentIntentId
      });
    }

    const defaultReturnUrl = this.isCardRechargeIntent(intent)
      ? this.buildDefaultCardRechargeReturnUrl(intent)
      : this.buildDefaultWechatReturnUrl(intent);
    const finalReturnUrl = this.normalizeReturnUrl(input.returnUrl, defaultReturnUrl);
    if (intent.status === 'paid') {
      return {
        type: 'redirect' as const,
        location: this.buildReturnRedirectUrl(finalReturnUrl, {
          payment_intent_id: intent.id,
          payment_result: 'success',
        })
      };
    }

    const account = await this.paymentAccountService.resolveCallbackAccount('alipay', {
      merchantNo: this.asString(intent.paymentAccountSnapshot?.merchant_no) || null,
      appId: this.asString(intent.paymentAccountSnapshot?.app_id) || null,
      accountIdentity: this.asString(intent.paymentAccountSnapshot?.account_identity) || null
    });
    if (!account) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'alipay payment account not found', 404, {
        payment_intent_id: intent.id
      });
    }

    const appId =
      this.asString(this.resolveAccountConfigValue(account, ['app_id'])) ||
      this.asString(account.appId);
    const merchantPrivateKey = this.asString(this.resolveAccountConfigValue(account, ['merchant_private_key']));
    const notifyUrl = this.joinPublicUrl(
      this.asString(this.resolveAccountConfigValue(account, ['notify_url'])) || '/api/v1/payments/alipay/notify'
    );
    const alipayReturnUrl = this.joinPublicUrl(
      this.asString(this.resolveAccountConfigValue(account, ['return_url'])) || '/api/v1/payments/alipay/return'
    );

    if (!appId || !merchantPrivateKey) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'alipay payment account config is incomplete', 400, {
        payment_intent_id: intent.id
      });
    }

    const subject =
      this.asString(intent.checkoutSnapshot?.holder_name) ||
      this.asString(intent.checkoutSnapshot?.device_name) ||
      this.asString(intent.checkoutSnapshot?.well_name) ||
      '后稷农服充值';
    const bizContent = JSON.stringify({
      out_trade_no: intent.outTradeNo,
      total_amount: Number(intent.amount ?? 0).toFixed(2),
      subject,
      product_code: 'QUICK_WAP_WAY',
      body: this.isCardRechargeIntent(intent) ? `卡片充值 ${this.asString(intent.checkoutSnapshot?.card_token)}` : subject,
      passback_params: encodeURIComponent(
        JSON.stringify({
          payment_intent_id: intent.id,
          return_url: finalReturnUrl
        })
      ),
      quit_url: finalReturnUrl
    });

    const params: Record<string, string> = {
      app_id: appId,
      method: 'alipay.trade.wap.pay',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
      version: '1.0',
      notify_url: notifyUrl,
      return_url: alipayReturnUrl,
      biz_content: bizContent
    };
    params.sign = this.signAlipayPayload(params, merchantPrivateKey);
    const gatewayUrl = new URL('https://openapi.alipay.com/gateway.do');
    for (const [key, value] of Object.entries(params)) {
      gatewayUrl.searchParams.set(key, value);
    }

    return {
      type: 'redirect' as const,
      location: gatewayUrl.toString()
    };
  }

  async handleWechatNotify(rawPayload: string | Record<string, unknown>) {
    try {
      const payload =
        typeof rawPayload === 'string' ? this.parseWechatXml(rawPayload) : this.normalizeRecord(rawPayload);
      this.logger.log(`wechat notify received payload=${this.safeStringify(payload)}`);
      if (!payload.out_trade_no) {
        this.logger.warn('wechat notify missing out_trade_no');
        return this.buildWechatResponse('FAIL', 'missing out_trade_no');
      }

      const account = await this.resolveWechatAccount(payload);
      if (!account) {
        this.logger.warn(`wechat notify payment account not found out_trade_no=${payload.out_trade_no}`);
        return this.buildWechatResponse('FAIL', 'payment account not found');
      }

      const apiKey =
        this.asString(this.resolveAccountConfigValue(account, ['merchant', 'api_key_v2'])) ||
        this.asString(this.resolveAccountConfigValue(account, ['api_key_v2']));
      if (!apiKey) {
        this.logger.warn(`wechat notify api_key_v2 missing out_trade_no=${payload.out_trade_no}`);
        return this.buildWechatResponse('FAIL', 'api_key_v2 not configured');
      }

      if (!this.verifyWechatSignature(payload, apiKey)) {
        this.logger.warn(`wechat notify invalid sign out_trade_no=${payload.out_trade_no}`);
        return this.buildWechatResponse('FAIL', 'invalid sign');
      }

      const returnCode = this.asString(payload.return_code).toUpperCase();
      const resultCode = this.asString(payload.result_code).toUpperCase();
      if (returnCode !== 'SUCCESS' || resultCode !== 'SUCCESS') {
        this.logger.warn(
          `wechat notify not-success out_trade_no=${payload.out_trade_no} return_code=${returnCode || 'EMPTY'} result_code=${
            resultCode || 'EMPTY'
          }`
        );
        return this.buildWechatResponse('SUCCESS', 'OK');
      }

      const paidAmountFen = this.asNumber(payload.total_fee);
      await this.completeIntentByOutTradeNo(payload.out_trade_no, {
        provider: 'wechat',
        paidAmount: paidAmountFen === null ? null : paidAmountFen / 100,
        providerTradeNo: payload.transaction_id || null,
        startedVia: 'wechat_notify',
        providerPayload: {
          callback_source: 'wechat_notify',
          callback_result: resultCode,
          transaction_id: payload.transaction_id || null,
          bank_type: payload.bank_type || null,
          time_end: payload.time_end || null,
          cash_fee: this.asNumber(payload.cash_fee),
          notify_payload: payload
        }
      });
      this.logger.log(
        `wechat notify completed out_trade_no=${payload.out_trade_no} transaction_id=${
          payload.transaction_id || 'unknown'
        } total_fee=${payload.total_fee || 'unknown'}`
      );

      return this.buildWechatResponse('SUCCESS', 'OK');
    } catch (error) {
      this.logger.error(`wechat notify failed: ${this.formatCallbackError(error)}`);
      return this.buildWechatResponse('FAIL', this.formatCallbackError(error));
    }
  }

  async handleAlipayNotify(rawPayload: Record<string, unknown>) {
    try {
      const payload = this.normalizeRecord(rawPayload);
      if (!payload.out_trade_no) {
        return 'failure';
      }

      const account = await this.resolveAlipayAccount(payload);
      if (!account) {
        return 'failure';
      }

      const alipayPublicKey = this.asString(this.resolveAccountConfigValue(account, ['alipay_public_key']));
      if (!alipayPublicKey || !this.verifyAlipaySignature(payload, alipayPublicKey)) {
        return 'failure';
      }

      const tradeStatus = this.asString(payload.trade_status).toUpperCase();
      if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
        return 'success';
      }

      await this.completeIntentByOutTradeNo(payload.out_trade_no, {
        provider: 'alipay',
        paidAmount: this.asNumber(payload.total_amount),
        providerTradeNo: payload.trade_no || null,
        startedVia: 'alipay_notify',
        providerPayload: {
          callback_source: 'alipay_notify',
          callback_result: tradeStatus,
          trade_no: payload.trade_no || null,
          buyer_id: payload.buyer_id || null,
          seller_id: payload.seller_id || null,
          notify_time: payload.notify_time || null,
          notify_payload: payload
        }
      });

      return 'success';
    } catch {
      return 'failure';
    }
  }

  async handleAlipayReturn(rawPayload: Record<string, unknown>) {
    const payload = this.normalizeRecord(rawPayload);
    const account = await this.resolveAlipayAccount(payload);
    let redirectBase =
      this.asString(this.resolveAccountConfigValue(account, ['return_redirect_url'])) ||
      this.asString(this.resolveAccountConfigValue(account, ['auth_callback_url'])) ||
      'https://mobile.jiumengfood.com';

    if (!account) {
      return this.buildReturnRedirectUrl(redirectBase, {
        payment_provider: 'alipay',
        callback_result: 'account_not_found',
        out_trade_no: payload.out_trade_no || ''
      });
    }

    const alipayPublicKey = this.asString(this.resolveAccountConfigValue(account, ['alipay_public_key']));
    if (!alipayPublicKey || !this.verifyAlipaySignature(payload, alipayPublicKey)) {
      return this.buildReturnRedirectUrl(redirectBase, {
        payment_provider: 'alipay',
        callback_result: 'invalid_signature',
        out_trade_no: payload.out_trade_no || ''
      });
    }

    const tradeStatus = this.asString(payload.trade_status).toUpperCase();
    try {
      const intent = payload.out_trade_no
        ? await this.orderSettlementService.getPaymentIntentByOutTradeNo(payload.out_trade_no)
        : null;
      if (intent && this.isCardRechargeIntent(intent)) {
        redirectBase = this.normalizeReturnUrl(this.asString(intent.checkoutSnapshot?.return_url), this.buildDefaultCardRechargeReturnUrl(intent));
      }

      const completion =
        tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED'
          ? await this.completeIntentByOutTradeNo(payload.out_trade_no, {
              provider: 'alipay',
              paidAmount: this.asNumber(payload.total_amount),
              providerTradeNo: payload.trade_no || null,
              startedVia: 'alipay_return',
              providerPayload: {
                callback_source: 'alipay_return',
                callback_result: tradeStatus,
                trade_no: payload.trade_no || null,
                notify_payload: payload
              }
            })
          : null;

      return this.buildReturnRedirectUrl(redirectBase, {
        payment_provider: 'alipay',
        callback_result: tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED' ? 'success' : 'noop',
        out_trade_no: payload.out_trade_no || '',
        trade_no: payload.trade_no || '',
        trade_status: tradeStatus,
        payment_intent_id: this.asString((completion as Record<string, unknown> | null)?.payment_intent_id),
        session_id: this.asString((completion as Record<string, unknown> | null)?.session_id),
        order_id: this.asString((completion as Record<string, unknown> | null)?.order_id)
      });
    } catch (error) {
      return this.buildReturnRedirectUrl(redirectBase, {
        payment_provider: 'alipay',
        callback_result: 'failed',
        out_trade_no: payload.out_trade_no || '',
        trade_no: payload.trade_no || '',
        error_message: this.formatCallbackError(error)
      });
    }
  }
}
