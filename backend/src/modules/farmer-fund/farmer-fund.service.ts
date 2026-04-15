import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { createHash, createSign, randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { request as httpsRequest } from 'https';
import * as path from 'path';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCodes } from '../../common/errors/error-codes';
import { PaymentAccountService } from '../payment-account/payment-account.module';
import { FarmerFundRepository } from './farmer-fund.repository';

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';
const PORTAL_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const WECHAT_OAUTH_AUTHORIZE_URL = 'https://open.weixin.qq.com/connect/oauth2/authorize';
const WECHAT_OAUTH_ACCESS_TOKEN_URL = 'https://api.weixin.qq.com/sns/oauth2/access_token';
const WECHAT_OAUTH_USERINFO_URL = 'https://api.weixin.qq.com/sns/userinfo';

@Injectable()
export class FarmerFundService {
  private readonly logger = new Logger(FarmerFundService.name);

  constructor(
    private readonly repo: FarmerFundRepository,
    private readonly db: DatabaseService,
    private readonly paymentAccountService: PaymentAccountService
  ) {}

  private asString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
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

  private roundMoney(value: number) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  private randomNonce(length = 24) {
    return randomBytes(Math.max(8, Math.ceil(length / 2))).toString('hex').slice(0, length);
  }

  private resolveAccountConfigValue(account: { configJson?: Record<string, unknown> | null } | null | undefined, pathSegments: string[]) {
    let current: unknown = account?.configJson ?? {};
    for (const segment of pathSegments) {
      current = this.asObject(current)[segment];
    }
    return current;
  }

  private buildWechatXml(fields: Record<string, string>) {
    const body = Object.entries(fields)
      .map(([key, value]) => `<${key}><![CDATA[${value}]]></${key}>`)
      .join('');
    return `<xml>${body}</xml>`;
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
    return createHash('md5').update(`${content}&key=${apiKey}`, 'utf8').digest('hex').toUpperCase();
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

  private signAlipayPayload(params: Record<string, string>, merchantPrivateKey: string) {
    const signer = createSign('RSA-SHA256');
    signer.update(this.buildAlipaySignContent(params), 'utf8');
    signer.end();
    return signer.sign(this.wrapPem(merchantPrivateKey, 'PRIVATE KEY'), 'base64');
  }

  private buildRechargeRefundRequestNo(paymentIntentId: string) {
    return `CARDREF${paymentIntentId.replace(/-/g, '').toUpperCase()}`.slice(0, 64);
  }

  private inferPaymentProvider(paymentMode?: string | null, paymentChannel?: string | null) {
    const mode = this.asString(paymentMode).toLowerCase();
    const channel = this.asString(paymentChannel).toLowerCase();
    if (mode === 'wechat' || channel.includes('wechat')) return 'wechat' as const;
    if (mode === 'alipay' || channel.includes('alipay')) return 'alipay' as const;
    throw new AppException(ErrorCodes.VALIDATION_ERROR, '当前充值订单缺少可识别的支付渠道，无法发起原路退款', 400, {
      payment_mode: paymentMode,
      payment_channel: paymentChannel,
    });
  }

  private async postWechatMutualTlsXml(input: {
    url: string;
    xml: string;
    pfx: Buffer;
    passphrase: string;
  }) {
    return new Promise<string>((resolve, reject) => {
      const requestUrl = new URL(input.url);
      const req = httpsRequest(
        {
          protocol: requestUrl.protocol,
          hostname: requestUrl.hostname,
          port: requestUrl.port || 443,
          path: `${requestUrl.pathname}${requestUrl.search}`,
          method: 'POST',
          pfx: input.pfx,
          passphrase: input.passphrase,
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Content-Length': Buffer.byteLength(input.xml, 'utf8'),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        }
      );
      req.on('error', reject);
      req.write(input.xml, 'utf8');
      req.end();
    });
  }

  private async postWechatMutualTlsXmlWithLegacyFallback(input: {
    url: string;
    xml: string;
    pfxPath: string;
    passphrase: string;
  }) {
    try {
      return await this.postWechatMutualTlsXml({
        url: input.url,
        xml: input.xml,
        pfx: readFileSync(input.pfxPath),
        passphrase: input.passphrase,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (!message.includes('Unsupported PKCS12 PFX data')) {
        throw error;
      }

      this.logger.warn(`wechat refund p12 requires legacy provider, fallback enabled path=${input.pfxPath}`);

      const script = `
const fs = require('fs');
const https = require('https');
const [url, pfxPath, passphrase, xmlBase64] = process.argv.slice(1);
const xml = Buffer.from(xmlBase64, 'base64').toString('utf8');
const requestUrl = new URL(url);
const req = https.request({
  protocol: requestUrl.protocol,
  hostname: requestUrl.hostname,
  port: requestUrl.port || 443,
  path: requestUrl.pathname + requestUrl.search,
  method: 'POST',
  pfx: fs.readFileSync(pfxPath),
  passphrase,
  headers: {
    'Content-Type': 'application/xml; charset=utf-8',
    'Content-Length': Buffer.byteLength(xml, 'utf8'),
  },
}, (res) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  res.on('end', () => {
    process.stdout.write(Buffer.concat(chunks).toString('utf8'));
  });
});
req.on('error', (err) => {
  process.stderr.write(String(err && err.message ? err.message : err));
  process.exit(1);
});
req.write(xml, 'utf8');
req.end();
`;

      return await new Promise<string>((resolve, reject) => {
        const child = execFile(
          process.execPath,
          ['-e', script, input.url, input.pfxPath, input.passphrase, Buffer.from(input.xml, 'utf8').toString('base64')],
          {
            env: {
              ...process.env,
              NODE_OPTIONS: [process.env.NODE_OPTIONS, '--openssl-legacy-provider'].filter(Boolean).join(' '),
            },
            windowsHide: true,
            maxBuffer: 1024 * 1024,
          },
          (childError, stdout, stderr) => {
            if (childError) {
              reject(
                new AppException(
                  ErrorCodes.INTERNAL_ERROR,
                  '微信原路退款证书加载失败，请检查商户证书格式',
                  500,
                  {
                    reason: stderr || childError.message,
                    certificate_path: input.pfxPath,
                  }
                )
              );
              return;
            }
            resolve(stdout);
          }
        );
        child.on('error', reject);
      });
    }
  }

  private async requestWechatOriginalRefund(input: {
    account: Awaited<ReturnType<PaymentAccountService['resolveCallbackAccount']>>;
    outTradeNo: string;
    amount: number;
    refundRequestNo: string;
    remark?: string | null;
  }) {
    const appId =
      this.asString(this.resolveAccountConfigValue(input.account, ['public_account', 'app_id'])) ||
      this.asString(this.resolveAccountConfigValue(input.account, ['app_id'])) ||
      this.asString(input.account?.appId);
    const mchId =
      this.asString(this.resolveAccountConfigValue(input.account, ['merchant', 'mch_id'])) ||
      this.asString(this.resolveAccountConfigValue(input.account, ['mch_id'])) ||
      this.asString(input.account?.merchantNo);
    const apiKeyV2 =
      this.asString(this.resolveAccountConfigValue(input.account, ['merchant', 'api_key_v2'])) ||
      this.asString(this.resolveAccountConfigValue(input.account, ['api_key_v2']));
    const certificateRelativePath =
      this.asString(this.resolveAccountConfigValue(input.account, ['merchant', 'certificate_p12_path'])) ||
      this.asString(this.resolveAccountConfigValue(input.account, ['merchant', 'certificate_path'])) ||
      this.asString(this.resolveAccountConfigValue(input.account, ['certificate_p12_path'])) ||
      this.asString(this.resolveAccountConfigValue(input.account, ['certificate_path']));

    if (!appId || !mchId || !apiKeyV2 || !certificateRelativePath) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, '微信支付账户未配置完整的原路退款参数', 400, {
        app_id: Boolean(appId),
        mch_id: Boolean(mchId),
        api_key_v2: Boolean(apiKeyV2),
        certificate: Boolean(certificateRelativePath),
      });
    }

    const certificateAbsolutePath = path.resolve(process.cwd(), certificateRelativePath);
    if (!existsSync(certificateAbsolutePath)) {
      throw new AppException(ErrorCodes.INTERNAL_ERROR, '微信退款证书文件不存在，无法发起原路退款', 500, {
        certificate_path: certificateRelativePath,
      });
    }

    const amountFen = Math.max(1, Math.round(input.amount * 100));
    const payload: Record<string, string> = {
      appid: appId,
      mch_id: mchId,
      nonce_str: this.randomNonce(24),
      out_trade_no: input.outTradeNo,
      out_refund_no: input.refundRequestNo,
      total_fee: String(amountFen),
      refund_fee: String(amountFen),
    };
    payload.sign = this.buildWechatSign(payload, apiKeyV2);

    const xmlText = await this.postWechatMutualTlsXmlWithLegacyFallback({
      url: 'https://api.mch.weixin.qq.com/secapi/pay/refund',
      xml: this.buildWechatXml(payload),
      pfxPath: certificateAbsolutePath,
      passphrase: mchId,
    });
    const responsePayload = this.parseWechatXml(xmlText);
    const returnCode = this.asString(responsePayload.return_code).toUpperCase();
    const resultCode = this.asString(responsePayload.result_code).toUpperCase();
    if (returnCode !== 'SUCCESS' || resultCode !== 'SUCCESS') {
      throw new AppException(
        ErrorCodes.INTERNAL_ERROR,
        this.asString(responsePayload.return_msg) ||
          this.asString(responsePayload.err_code_des) ||
          '微信原路退款失败',
        502,
        responsePayload
      );
    }

    return {
      refundChannel: 'wechat',
      refundMode: 'wechat_original',
      refundStatus: 'succeeded',
      refundRequestNo: input.refundRequestNo,
      refundProviderTradeNo: this.asString(responsePayload.refund_id) || null,
      refundedAt: new Date().toISOString(),
      responsePayload,
    };
  }

  private async requestAlipayOriginalRefund(input: {
    account: Awaited<ReturnType<PaymentAccountService['resolveCallbackAccount']>>;
    outTradeNo: string;
    amount: number;
    refundRequestNo: string;
    remark?: string | null;
  }) {
    const appId =
      this.asString(this.resolveAccountConfigValue(input.account, ['app_id'])) ||
      this.asString(input.account?.appId);
    const merchantPrivateKey = this.asString(this.resolveAccountConfigValue(input.account, ['merchant_private_key']));

    if (!appId || !merchantPrivateKey) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, '支付宝支付账户未配置完整的原路退款参数', 400, {
        app_id: Boolean(appId),
        merchant_private_key: Boolean(merchantPrivateKey),
      });
    }

    const bizContent = JSON.stringify({
      out_trade_no: input.outTradeNo,
      refund_amount: input.amount.toFixed(2),
      refund_reason: this.asString(input.remark) || '卡片充值退款',
      out_request_no: input.refundRequestNo,
    });
    const params: Record<string, string> = {
      app_id: appId,
      method: 'alipay.trade.refund',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
      version: '1.0',
      biz_content: bizContent,
    };
    params.sign = this.signAlipayPayload(params, merchantPrivateKey);

    const response = await fetch('https://openapi.alipay.com/gateway.do', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: new URLSearchParams(params),
    });
    const rawText = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      throw new AppException(ErrorCodes.INTERNAL_ERROR, '支付宝原路退款返回了无法解析的响应', 502, {
        raw_response: rawText,
      });
    }
    const responsePayload = this.asObject(parsed.alipay_trade_refund_response);
    const code = this.asString(responsePayload.code);
    if (code !== '10000') {
      throw new AppException(
        ErrorCodes.INTERNAL_ERROR,
        this.asString(responsePayload.sub_msg) ||
          this.asString(responsePayload.msg) ||
          '支付宝原路退款失败',
        502,
        parsed
      );
    }

    return {
      refundChannel: 'alipay',
      refundMode: 'alipay_original',
      refundStatus: 'succeeded',
      refundRequestNo: input.refundRequestNo,
      refundProviderTradeNo: this.asString(responsePayload.trade_no) || null,
      refundedAt: new Date().toISOString(),
      responsePayload: parsed,
    };
  }

  private extractProviderSummary(input: {
    paymentChannel?: string | null;
    providerPayload?: Record<string, unknown> | null;
    paymentProviderPayload?: Record<string, unknown> | null;
  }) {
    const rechargePayload = this.asObject(input.providerPayload);
    const paymentPayload = this.asObject(input.paymentProviderPayload);
    return {
      payment_provider: input.paymentChannel?.includes('alipay') ? 'alipay' : 'wechat',
      provider_trade_no:
        this.asString(rechargePayload.provider_trade_no) ||
        this.asString(paymentPayload.provider_trade_no) ||
        this.asString(rechargePayload.transaction_id) ||
        this.asString(paymentPayload.transaction_id) ||
        this.asString(rechargePayload.trade_no) ||
        this.asString(paymentPayload.trade_no) ||
        null,
      refund_status: this.asString(rechargePayload.refund_status) || null,
      refund_mode: this.asString(rechargePayload.refund_mode) || null,
      refund_request_no:
        this.asString(rechargePayload.refund_request_no) ||
        this.asString(paymentPayload.refund_request_no) ||
        null,
      refund_provider_trade_no:
        this.asString(rechargePayload.refund_provider_trade_no) ||
        this.asString(paymentPayload.refund_provider_trade_no) ||
        null,
      refunded_at:
        this.asString(rechargePayload.refunded_at) ||
        this.asString(paymentPayload.refunded_at) ||
        null,
    };
  }

  private getPublicWebBaseUrl() {
    return String(process.env.PUBLIC_WEB_BASE_URL || process.env.PORTAL_PUBLIC_BASE_URL || 'http://xupengpeng.top')
      .trim()
      .replace(/\/+$/, '');
  }

  private getPublicApiBaseUrl() {
    return String(process.env.PUBLIC_API_BASE_URL || `${this.getPublicWebBaseUrl()}/api/v1`)
      .trim()
      .replace(/\/+$/, '');
  }

  private async getWechatOauthConfig() {
    const portalConfig = await this.paymentAccountService.getWechatPortalAuthConfig();
    return {
      appId: this.asString(portalConfig.app_id || process.env.WECHAT_MP_APP_ID),
      appSecret: this.asString(portalConfig.app_secret || process.env.WECHAT_MP_APP_SECRET),
      scope: this.asString(portalConfig.oauth_scope || process.env.WECHAT_MP_OAUTH_SCOPE) || 'snsapi_userinfo',
      publicWebBaseUrl: this.asString(portalConfig.public_web_base_url) || this.getPublicWebBaseUrl(),
      publicApiBaseUrl: this.asString(portalConfig.public_api_base_url) || this.getPublicApiBaseUrl(),
    };
  }

  private encodeOauthState(payload: Record<string, unknown>) {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  private decodeOauthState<T extends Record<string, unknown>>(state?: string | null) {
    const raw = this.asString(state);
    if (!raw) return null;
    try {
      return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as T;
    } catch {
      return null;
    }
  }

  private normalizePortalReturnTo(raw: string | null | undefined) {
    const fallback = `${this.getPublicWebBaseUrl()}/card/recharge`;
    const normalized = this.asString(raw);
    if (!normalized) return fallback;
    if (/^https?:\/\//i.test(normalized)) return normalized;
    return `${this.getPublicWebBaseUrl()}${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
  }

  private normalizeReturnUrl(raw: string | null | undefined, cardToken: string, paymentIntentId?: string | null) {
    const normalized = this.asString(raw);
    const fallback = new URL(`${this.getPublicWebBaseUrl()}/card/recharge`);
    fallback.searchParams.set('card_no', cardToken);
    if (paymentIntentId) fallback.searchParams.set('payment_intent_id', paymentIntentId);
    if (!normalized) return fallback.toString();
    if (/^https?:\/\//i.test(normalized)) return normalized;
    return `${this.getPublicWebBaseUrl()}${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
  }

  private buildWechatPayLink(paymentIntentId: string, returnUrl: string) {
    return `${this.getPublicWebBaseUrl()}/api/v1/payments/wechat/pay/${encodeURIComponent(paymentIntentId)}?return_url=${encodeURIComponent(returnUrl)}`;
  }

  private buildAlipayPayLink(paymentIntentId: string, returnUrl: string) {
    return `${this.getPublicWebBaseUrl()}/api/v1/payments/alipay/pay/${encodeURIComponent(paymentIntentId)}?return_url=${encodeURIComponent(returnUrl)}`;
  }

  private buildOutTradeNo(prefix: 'WXC' | 'ALC') {
    return `${prefix}${Date.now()}${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  private buildCallbackToken() {
    return randomBytes(16).toString('hex');
  }

  private buildPortalSessionToken() {
    return randomBytes(24).toString('hex');
  }

  async resolvePortalSession(sessionToken?: string | null) {
    const token = this.asString(sessionToken);
    if (!token) return null;
    const session = await this.repo.getPortalSession(token);
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() < Date.now()) return null;
    await this.repo.touchPortalSession(String(session.sessionId));
    return {
      session_id: String(session.sessionId),
      session_token: token,
      tenant_id: String(session.tenantId),
      user_id: String(session.portalUserId),
      provider: this.asString(session.provider),
      provider_user_key: this.asString(session.providerUserKey),
      mobile: this.asString(session.mobile) || null,
      display_name: this.asString(session.displayName) || null,
      auth_identity: (session.authIdentity as Record<string, unknown> | null) ?? {},
      expires_at: new Date(session.expiresAt).toISOString(),
    };
  }

  private async requirePortalSession(sessionToken?: string | null) {
    const session = await this.resolvePortalSession(sessionToken);
    if (!session) {
      throw new AppException(ErrorCodes.FORBIDDEN, '请先完成扫码登录后再继续操作', 401);
    }
    return session;
  }

  async portalLogin(input: {
    provider: 'wechat' | 'alipay';
    mobile?: string | null;
    smsCode?: string | null;
    providerUserKey?: string | null;
    displayName?: string | null;
    authIdentity?: Record<string, unknown> | null;
    tenantId?: string;
  }) {
    const tenantId = input.tenantId ?? DEFAULT_TENANT;
    const provider = this.asString(input.provider) as 'wechat' | 'alipay';
    const mobile = this.asString(input.mobile) || null;
    const smsCode = this.asString(input.smsCode);
    const providerUserKey = this.asString(input.providerUserKey) || `${provider}:${mobile || 'anonymous'}`;
    const displayName = this.asString(input.displayName) || null;

    if (!provider) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, '登录方式不能为空', 400);
    }
    if (!providerUserKey) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, '缺少登录身份标识', 400);
    }
    if (provider !== 'wechat' && (!mobile || !smsCode)) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, '登录方式、手机号、验证码不能为空', 400);
    }

    const portalUser = await this.repo.upsertPortalUser({
      tenantId,
      provider,
      providerUserKey,
      mobile,
      displayName,
      authIdentity: input.authIdentity ?? {},
    });
    const sessionToken = this.buildPortalSessionToken();
    const expiresAt = new Date(Date.now() + PORTAL_SESSION_TTL_MS).toISOString();
    await this.repo.createPortalSession({
      tenantId,
      portalUserId: String(portalUser?.id),
      sessionToken,
      expiresAt,
    });
    return {
      session_token: sessionToken,
      expires_at: expiresAt,
      user: {
        id: String(portalUser?.id),
        provider,
        provider_user_key: providerUserKey,
        mobile,
        display_name: displayName,
        auth_identity: input.authIdentity ?? {},
      },
      sms_verified: false,
      sms_verify_mode: 'debug_bypass',
    };
  }

  async bindPortalMobile(input: {
    portalSessionToken?: string | null;
    mobile?: string | null;
    smsCode?: string | null;
  }) {
    const session = await this.requirePortalSession(input.portalSessionToken);
    const mobile = this.asString(input.mobile);
    const smsCode = this.asString(input.smsCode);
    if (!mobile) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, '手机号不能为空', 400);
    }
    if (!smsCode) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, '短信验证码不能为空', 400);
    }

    const authIdentity = {
      ...(session.auth_identity ?? {}),
      bound_mobile: mobile,
      mobile_bound_at: new Date().toISOString(),
      sms_verify_mode: 'debug_bypass',
    };
    await this.repo.updatePortalUserMobile({
      portalUserId: session.user_id,
      mobile,
      authIdentity,
    });
    const refreshed = await this.resolvePortalSession(session.session_token);
    if (!refreshed) {
      throw new AppException(ErrorCodes.INTERNAL_ERROR, '手机号绑定成功，但会话刷新失败', 500);
    }
    return refreshed;
  }

  async getWechatOauthAuthorizeUrl(input?: { returnTo?: string | null }) {
    const cfg = await this.getWechatOauthConfig();
    if (!cfg.appId || !cfg.appSecret) {
      throw new AppException(ErrorCodes.INTERNAL_ERROR, '未配置微信公众号网页授权参数', 500);
    }

    const callbackUrl = `${cfg.publicApiBaseUrl}/card-recharge/portal/wechat/callback`;
    const returnTo = this.normalizePortalReturnTo(input?.returnTo || `${cfg.publicWebBaseUrl}/card/recharge`);
    const state = this.encodeOauthState({ return_to: returnTo, ts: Date.now() });
    const authorizeUrl =
      `${WECHAT_OAUTH_AUTHORIZE_URL}?appid=${encodeURIComponent(cfg.appId)}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
      `&response_type=code&scope=${encodeURIComponent(cfg.scope)}` +
      `&state=${encodeURIComponent(state)}#wechat_redirect`;

    return {
      authorize_url: authorizeUrl,
      callback_url: callbackUrl,
      provider: 'wechat' as const,
      scope: cfg.scope,
    };
  }

  private async fetchWechatJson<T>(url: string) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new AppException(ErrorCodes.INTERNAL_ERROR, `微信授权请求失败：HTTP ${response.status}`, 502);
    }
    return (await response.json()) as T & { errcode?: number; errmsg?: string };
  }

  async handleWechatOauthCallback(input: { code?: string | null; state?: string | null }) {
    const cfg = await this.getWechatOauthConfig();
    if (!cfg.appId || !cfg.appSecret) {
      throw new AppException(ErrorCodes.INTERNAL_ERROR, '未配置微信公众号网页授权参数', 500);
    }

    const code = this.asString(input.code);
    if (!code) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, '微信授权回调缺少 code', 400);
    }

    const state = this.decodeOauthState<{ return_to?: string }>(input.state);
    const returnTo = this.normalizePortalReturnTo(state?.return_to ?? null);
    const tokenUrl =
      `${WECHAT_OAUTH_ACCESS_TOKEN_URL}?appid=${encodeURIComponent(cfg.appId)}` +
      `&secret=${encodeURIComponent(cfg.appSecret)}` +
      `&code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    const tokenResponse = await this.fetchWechatJson<{
      access_token?: string;
      openid?: string;
      scope?: string;
      unionid?: string;
    }>(tokenUrl);

    if (tokenResponse.errcode || !tokenResponse.openid) {
      throw new AppException(
        ErrorCodes.INTERNAL_ERROR,
        `微信授权换取身份失败：${this.asString(tokenResponse.errmsg) || '未知错误'}`,
        502,
        { errcode: tokenResponse.errcode ?? null }
      );
    }

    let nickname: string | null = null;
    let unionid = this.asString(tokenResponse.unionid) || null;
    let headimgurl: string | null = null;
    const accessToken = this.asString(tokenResponse.access_token);
    const scope = this.asString(tokenResponse.scope);

    if (accessToken && scope.includes('userinfo')) {
      const userInfoUrl =
        `${WECHAT_OAUTH_USERINFO_URL}?access_token=${encodeURIComponent(accessToken)}` +
        `&openid=${encodeURIComponent(tokenResponse.openid)}&lang=zh_CN`;
      const userInfoResponse = await this.fetchWechatJson<{
        nickname?: string;
        unionid?: string;
        headimgurl?: string;
      }>(userInfoUrl);
      if (!userInfoResponse.errcode) {
        nickname = this.asString(userInfoResponse.nickname) || null;
        unionid = this.asString(userInfoResponse.unionid) || unionid;
        headimgurl = this.asString(userInfoResponse.headimgurl) || null;
      }
    }

    const loginResult = await this.portalLogin({
      provider: 'wechat',
      providerUserKey: unionid || this.asString(tokenResponse.openid),
      displayName: nickname,
      authIdentity: {
        app_id: cfg.appId,
        openid: this.asString(tokenResponse.openid),
        unionid,
        scope,
        nickname,
        headimgurl,
      },
    });

    const redirectUrl = new URL(returnTo);
    redirectUrl.searchParams.set('portal_login', 'success');
    redirectUrl.searchParams.set('portal_provider', 'wechat');
    redirectUrl.searchParams.set('portal_token', loginResult.session_token);

    return {
      redirect_url: redirectUrl.toString(),
      session_token: loginResult.session_token,
    };
  }

  private async getResolvedCardCatalog(cardToken: string, tenantId: string = DEFAULT_TENANT) {
    const card = await this.repo.getCardCatalogByToken(tenantId, cardToken);
    if (!card) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, '卡号不存在，请先导入卡片列表', 404, { card_token: cardToken });
    }
    return card;
  }

  async getCardCatalogDetail(cardToken: string, tenantId: string = DEFAULT_TENANT) {
    const card = await this.repo.getCardCatalogByToken(tenantId, cardToken);
    if (!card) {
      return {
        found: false,
        card_token: cardToken,
        registered: false,
        status: 'missing',
      };
    }
    const holderName = this.asString(card.userDisplayName ?? card.holderName) || null;
    const holderMobile = this.asString(card.userMobile ?? card.holderMobile) || null;
    const wallet =
      card.userId ? await this.repo.getWalletState(tenantId, String(card.userId)) : { balance: 0, lockedBalance: 0 };
    return {
      found: true,
      card_token: card.cardToken,
      status: card.status,
      registered: Boolean(card.userId),
      card_label: card.label,
      batch_no: card.batchNo,
      holder_name: holderName,
      holder_mobile: holderMobile,
      balance: Number(wallet.balance ?? 0),
      locked_balance: Number(wallet.lockedBalance ?? 0),
      can_register: !card.userId,
      can_recharge: Boolean(card.userId) && card.status !== 'disabled' && card.status !== 'cancelled',
      payment_hint: card.userId ? '已绑卡，可直接充值' : '卡片已导入，先登记持卡人后再充值'
    };
  }

  async registerImportedCard(input: {
    cardToken: string;
    holderName: string;
    holderMobile: string;
    portalSessionToken?: string | null;
    tenantId?: string;
  }) {
    const portalSession = await this.requirePortalSession(input.portalSessionToken);
    const tenantId = input.tenantId ?? portalSession.tenant_id ?? DEFAULT_TENANT;
    const cardToken = this.asString(input.cardToken);
    const holderName = this.asString(input.holderName);
    const holderMobile = this.asString(input.holderMobile);
    if (!cardToken || !holderName || !holderMobile) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, '卡号、持卡人姓名、手机号不能为空', 400);
    }

    return this.db.withTransaction(async (client) => {
      const card = await this.repo.getCardCatalogByToken(tenantId, cardToken, client);
      if (!card) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, '卡号不存在，请先导入卡片列表', 404, { card_token: cardToken });
      }
      if (card.userId) {
        return this.getCardCatalogDetail(cardToken, tenantId);
      }

      let farmer = await this.repo.findFarmerUserByMobile(tenantId, holderMobile, client);
      if (!farmer) {
        const userId = await this.repo.insertFarmerUser({ tenantId, displayName: holderName, mobile: holderMobile }, client);
        farmer = { id: userId, tenantId, displayName: holderName, mobile: holderMobile };
      } else if (this.asString(farmer.displayName) !== holderName) {
        await this.repo.updateFarmerDisplayName(tenantId, farmer.id, holderName, client);
      }

      await this.repo.bindCardCatalogToUser(
        { tenantId, cardToken, userId: farmer.id, holderName, holderMobile },
        client
      );
      await this.repo.ensureFarmerCardBinding(
        { tenantId, userId: farmer.id, cardToken, label: card.label as string | null | undefined },
        client
      );
      await this.repo.ensureWallet(tenantId, farmer.id, client);
      return this.getCardCatalogDetail(cardToken, tenantId);
    });
  }

  async resolvePortalUser(cardToken?: string | null) {
    const t = cardToken?.trim();
    if (t) {
      const row = await this.repo.findActiveCardUser(t);
      if (!row) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'Card not found or inactive', 404, { cardToken: t });
      }
      return row;
    }
    const row = await this.repo.findDefaultFarmerUser();
    if (!row) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'No active farmer user found', 404);
    }
    return row;
  }

  async getWalletSummary(userId: string, tenantId: string = DEFAULT_TENANT) {
    const wallet = await this.repo.getWalletState(tenantId, userId);
    const ledger = await this.repo.listLedger(tenantId, userId, 30);
    return { balance: wallet.balance, locked_balance: wallet.lockedBalance, ledger };
  }

  async recharge(input: {
    tenantId?: string;
    userId: string;
    amount: number;
    idempotencyKey: string;
    remark?: string;
  }) {
    const tenantId = input.tenantId ?? DEFAULT_TENANT;
    if (input.amount <= 0) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'amount must be positive', 400);
    }
    return this.db.withTransaction(async (client) => {
      try {
        const { balanceAfter } = await this.repo.insertLedgerAndApplyBalance(client, {
          tenantId,
          userId: input.userId,
          entryType: 'recharge',
          amount: input.amount,
          idempotencyKey: input.idempotencyKey,
          remark: input.remark ?? 'recharge'
        });
        return { balance: balanceAfter };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '';
        if (msg === 'WALLET_INSUFFICIENT_BALANCE') {
          throw new AppException(ErrorCodes.WALLET_INSUFFICIENT_BALANCE, 'Invalid wallet operation', 400);
        }
        throw e;
      }
    });
  }

  async createCardRechargePayment(input: {
    cardToken: string;
    amount: number;
    paymentProvider: 'wechat' | 'alipay';
    rechargeMode?: 'self' | 'other';
    holderMobile?: string | null;
    payerMobile?: string | null;
    returnUrl?: string | null;
    portalSessionToken?: string | null;
    tenantId?: string;
  }) {
    const portalSession = await this.requirePortalSession(input.portalSessionToken);
    const tenantId = input.tenantId ?? portalSession.tenant_id ?? DEFAULT_TENANT;
    const card = await this.getResolvedCardCatalog(this.asString(input.cardToken), tenantId);
    if (!card.userId) {
      throw new AppException(ErrorCodes.FORBIDDEN, '卡片尚未登记持卡人，暂时不能充值', 400, { card_token: input.cardToken });
    }
    const amount = this.roundMoney(Math.max(0, Number(input.amount ?? 0)));
    if (amount <= 0) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, '充值金额必须大于 0', 400, { amount: input.amount });
    }

    const boundHolderMobile = this.asString(card.userMobile ?? card.holderMobile);
    const holderMobile = boundHolderMobile || this.asString(input.holderMobile);
    const payerMobile = this.asString(input.payerMobile) || this.asString(portalSession?.mobile);
    const rechargeMode = input.rechargeMode === 'other' ? 'other' : 'self';
    if (rechargeMode === 'other') {
      if (!payerMobile) {
        throw new AppException(ErrorCodes.VALIDATION_ERROR, '代充值需要填写充值人手机号', 400);
      }
    }

    const account = await this.paymentAccountService.resolveEffectiveAccount(tenantId, input.paymentProvider, null);
    const outTradeNo = this.buildOutTradeNo(input.paymentProvider === 'alipay' ? 'ALC' : 'WXC');
    const callbackToken = this.buildCallbackToken();
    const checkoutSnapshot = {
      created_from: 'card_recharge',
      business_type: 'card_recharge',
      card_token: card.cardToken,
      card_label: card.label,
      holder_name: this.asString(card.userDisplayName ?? card.holderName),
      holder_mobile: holderMobile || null,
      payer_mobile: payerMobile || null,
      recharge_mode: rechargeMode,
      amount,
      return_url: this.normalizeReturnUrl(input.returnUrl, card.cardToken),
      portal_user: portalSession
        ? {
            id: portalSession.user_id,
            provider: portalSession.provider,
            provider_user_key: portalSession.provider_user_key,
            mobile: portalSession.mobile,
            display_name: portalSession.display_name,
          }
        : null,
    };
    const paymentIntentId = await this.repo.insertRechargePaymentIntent({
      tenantId,
      userId: String(card.userId),
      cardToken: card.cardToken,
      paymentAccountId: account.id ?? null,
      paymentAccountSnapshot: {
        account_code: account.accountCode,
        account_name: account.accountName,
        merchant_no: account.merchantNo,
        app_id: account.appId,
        account_identity: account.accountIdentity,
        resolution: account.resolution,
        is_default: account.isDefault,
      },
      paymentChannel: input.paymentProvider === 'alipay' ? 'alipay_wap' : 'wechat_h5',
      paymentMode: input.paymentProvider,
      amount,
      outTradeNo,
      callbackToken,
      checkoutSnapshot,
      providerPayload: {
        provider: input.paymentProvider,
        created_from: 'card_recharge',
      },
      expiredAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    const returnUrl = this.normalizeReturnUrl(input.returnUrl, card.cardToken, paymentIntentId);
    const payLink =
      input.paymentProvider === 'alipay'
        ? this.buildAlipayPayLink(paymentIntentId, returnUrl)
        : this.buildWechatPayLink(paymentIntentId, returnUrl);
    await this.repo.updatePaymentIntentPayLink(paymentIntentId, payLink);

    return {
      payment_intent_id: paymentIntentId,
      out_trade_no: outTradeNo,
      amount,
      pay_link: payLink,
      callback_token: callbackToken,
      payment_provider: input.paymentProvider,
      card_token: card.cardToken,
      holder_name: this.asString(card.userDisplayName ?? card.holderName) || null,
      holder_mobile: this.asString(card.userMobile ?? card.holderMobile) || null,
    };
  }

  async getCardRechargePaymentStatus(paymentIntentId: string, tenantId: string = DEFAULT_TENANT) {
    const intent = await this.repo.getPaymentIntentById(paymentIntentId);
    if (!intent) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, '充值单不存在', 404, { payment_intent_id: paymentIntentId });
    }
    const snapshot = (intent.checkoutSnapshot as Record<string, unknown> | null) ?? {};
    if (this.asString(snapshot.created_from) !== 'card_recharge') {
      throw new AppException(ErrorCodes.FORBIDDEN, '这不是卡充值支付单', 400, { payment_intent_id: paymentIntentId });
    }
    if (String(intent.tenantId) !== tenantId) {
      throw new AppException(ErrorCodes.FORBIDDEN, '无权查看该充值单', 403, { payment_intent_id: paymentIntentId });
    }

    const cardToken = this.asString(snapshot.card_token);
    const card = cardToken ? await this.repo.getCardCatalogByToken(tenantId, cardToken) : null;
    const wallet =
      card?.userId ? await this.repo.getWalletState(tenantId, String(card.userId)) : { balance: 0, lockedBalance: 0 };
    return {
      payment_intent_id: String(intent.id),
      status: this.asString(intent.status),
      amount: Number(intent.amount ?? 0),
      card_token: cardToken,
      pay_link: this.asString(intent.payLink) || null,
      paid_at: intent.paidAt ?? null,
      holder_name: card ? this.asString(card.userDisplayName ?? card.holderName) || null : null,
      holder_mobile: card ? this.asString(card.userMobile ?? card.holderMobile) || null : null,
      balance: Number(wallet.balance ?? 0),
      locked_balance: Number(wallet.lockedBalance ?? 0),
      checkout_snapshot: snapshot,
    };
  }

  async completeRechargePaymentByOutTradeNo(input: {
    outTradeNo: string;
    provider: 'wechat' | 'alipay';
    paidAmount?: number | null;
    providerTradeNo?: string | null;
    providerPayload?: Record<string, unknown>;
  }) {
    const intent = await this.repo.getPaymentIntentByOutTradeNo(this.asString(input.outTradeNo));
    if (!intent) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, '充值支付单不存在', 404, { out_trade_no: input.outTradeNo });
    }
    const snapshot = (intent.checkoutSnapshot as Record<string, unknown> | null) ?? {};
    if (this.asString(snapshot.created_from) !== 'card_recharge') {
      throw new AppException(ErrorCodes.FORBIDDEN, '这不是卡充值支付单', 400, { out_trade_no: input.outTradeNo });
    }

    const amount = this.roundMoney(Number(intent.amount ?? 0));
    const paidAmount = input.paidAmount === null || input.paidAmount === undefined ? null : this.roundMoney(Number(input.paidAmount));
    if (paidAmount !== null && Math.abs(paidAmount - amount) > 0.01) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, '支付回调金额与充值单不一致', 400, {
        expected_amount: amount,
        paid_amount: paidAmount,
      });
    }

    const cardToken = this.asString(snapshot.card_token);
    const card = await this.getResolvedCardCatalog(cardToken, String(intent.tenantId));
    if (!card.userId) {
      throw new AppException(ErrorCodes.FORBIDDEN, '卡片尚未绑定持卡人，无法入账', 400, { card_token: cardToken });
    }

    await this.db.withTransaction(async (client) => {
      const latestIntent = await this.repo.getPaymentIntentById(String(intent.id), client);
      if (this.asString(latestIntent?.status) !== 'paid') {
        await this.repo.markPaymentIntentPaid(client, {
          id: String(intent.id),
          providerPayload: {
            ...(input.providerPayload ?? {}),
            callback_provider: input.provider,
            provider_trade_no: input.providerTradeNo ?? null,
            callback_confirmed_at: new Date().toISOString(),
          }
        });
      }

      await this.repo.createRechargeRecord(client, {
        tenantId: String(intent.tenantId),
        cardCatalogId: String(card.id),
        userId: String(card.userId),
        paymentIntentId: String(intent.id),
        paymentChannel: this.asString(intent.paymentChannel),
        rechargeMode: this.asString(snapshot.recharge_mode) || 'self',
        amount,
        holderMobile: this.asString(snapshot.holder_mobile) || null,
        payerMobile: this.asString(snapshot.payer_mobile) || null,
        requestSnapshot: snapshot,
        providerPayload: {
          ...(input.providerPayload ?? {}),
          callback_provider: input.provider,
          provider_trade_no: input.providerTradeNo ?? null,
        },
        status: 'paid',
        paidAt: new Date().toISOString(),
      });

      await this.repo.insertLedgerAndApplyBalance(client, {
        tenantId: String(intent.tenantId),
        userId: String(card.userId),
        entryType: 'recharge',
        amount,
        referenceType: 'card_recharge',
        referenceId: String(intent.id),
        idempotencyKey: `card_recharge:${String(intent.id)}`,
        remark: `card recharge ${card.cardToken}`,
      });
    });

    const wallet = await this.repo.getWalletState(String(intent.tenantId), String(card.userId));
    return {
      payment_intent_id: String(intent.id),
      out_trade_no: this.asString(intent.outTradeNo),
      status: 'paid',
      card_token: card.cardToken,
      balance: Number(wallet.balance ?? 0),
      locked_balance: Number(wallet.lockedBalance ?? 0),
    };
  }

  async issueCard(input: { tenantId?: string; userId: string; cardToken: string; label?: string }) {
    const tenantId = input.tenantId ?? DEFAULT_TENANT;
    try {
      const id = await this.repo.insertCard({
        tenantId,
        userId: input.userId,
        cardToken: input.cardToken.trim(),
        label: input.label
      });
      await this.repo.upsertCardCatalog({
        tenantId,
        cardToken: input.cardToken.trim(),
        userId: input.userId,
        label: input.label,
        sourceType: 'manual_issue',
        status: 'active',
      });
      return { id };
    } catch (e: unknown) {
      if (this.isUniqueViolation(e, 'farmer_card_tenant_id_card_token_key')) {
        throw new AppException(ErrorCodes.VALIDATION_ERROR, 'Card token already exists', 400);
      }
      throw e;
    }
  }

  async listFarmers(page = 1, pageSize = 20, tenantId: string = DEFAULT_TENANT) {
    const ps = Math.min(100, Math.max(1, pageSize));
    const pg = Math.max(1, page);
    const offset = (pg - 1) * ps;
    const { items, total } = await this.repo.listFarmers(tenantId, offset, ps);
    return { items, total, page: pg, page_size: ps };
  }

  private isUniqueViolation(error: unknown, constraint: string) {
    const c = error as { code?: string; constraint?: string };
    return c?.code === '23505' && c?.constraint === constraint;
  }

  async createFarmer(input: { displayName: string; mobile: string; tenantId?: string }) {
    const tenantId = input.tenantId ?? DEFAULT_TENANT;
    try {
      const id = await this.repo.insertFarmerUser({
        tenantId,
        displayName: input.displayName.trim(),
        mobile: input.mobile.trim()
      });
      return { id };
    } catch (e: unknown) {
      if (this.isUniqueViolation(e, 'sys_user_tenant_id_mobile_key')) {
        throw new AppException(ErrorCodes.VALIDATION_ERROR, 'Mobile number already registered for this tenant', 400);
      }
      throw e;
    }
  }

  async listCardsForFarmer(userId: string, tenantId: string = DEFAULT_TENANT) {
    return this.repo.listCards(tenantId, userId);
  }

  async listCardCatalog(page = 1, pageSize = 20, filters?: { q?: string | null; status?: string | null }, tenantId: string = DEFAULT_TENANT) {
    const ps = Math.min(100, Math.max(1, pageSize));
    const pg = Math.max(1, page);
    const offset = (pg - 1) * ps;
    const { items, total } = await this.repo.listCardCatalog({
      tenantId,
      offset,
      limit: ps,
      q: filters?.q ?? null,
      status: filters?.status ?? null,
    });
    return { items, total, page: pg, page_size: ps };
  }

  async listCardRechargeOrders(
    page = 1,
    pageSize = 20,
    filters?: {
      q?: string | null;
      status?: string | null;
      paymentChannel?: string | null;
      rechargeMode?: string | null;
      userId?: string | null;
      refundState?: 'eligible' | 'blocked' | null;
    },
    tenantId: string = DEFAULT_TENANT
  ) {
    const ps = Math.min(100, Math.max(1, pageSize));
    const pg = Math.max(1, page);
    const offset = (pg - 1) * ps;
    const { items, total } = await this.repo.listCardRechargeOrders({
      tenantId,
      offset,
      limit: ps,
      q: filters?.q ?? null,
      status: filters?.status ?? null,
      paymentChannel: filters?.paymentChannel ?? null,
      rechargeMode: filters?.rechargeMode ?? null,
      userId: filters?.userId ?? null,
      refundState: filters?.refundState ?? null,
    });
    return {
      items: items.map((item) => {
        const currentStatus = this.asString(item.paymentIntentStatus) || this.asString(item.status);
        const amount = Number(item.amount ?? 0);
        const currentBalance = Number((item as { currentBalance?: number }).currentBalance ?? 0);
        const isLatestPaidRecharge = Boolean((item as { isLatestPaidRecharge?: boolean }).isLatestPaidRecharge);
        const canRefund =
          currentStatus === 'paid' && isLatestPaidRecharge && currentBalance + 0.000001 >= amount;
        const refundBlockReason =
          currentStatus !== 'paid'
            ? '只有已支付成功的充值订单才允许退款。'
            : !isLatestPaidRecharge
              ? '只允许最后一次充值发起退款。'
              : currentBalance + 0.000001 < amount
                ? '当前卡片余额小于充值金额，不能发起退款。'
                : null;
        return {
          ...item,
          currentBalance,
          isLatestPaidRecharge,
          canRefund,
          refundBlockReason,
        };
      }),
      total,
      page: pg,
      page_size: ps,
    };
  }

  private async resolveCardRechargeRefundPolicy(
    input: {
      tenantId: string;
      id: string;
      userId: string;
      cardToken: string;
      amount: number;
      currentBalance: number;
      status: string;
      paymentIntentStatus?: string | null;
    },
    client?: PoolClient
  ) {
    const currentStatus = this.asString(input.paymentIntentStatus) || this.asString(input.status);
    if (currentStatus !== 'paid') {
      return {
        canRefund: false,
        isLatestPaidRecharge: false,
        refundBlockReason: '只有已支付成功的充值订单才允许退款。',
      };
    }

    const latestPaidRecharge = await this.repo.getLatestPaidRechargeForCard(
      {
        tenantId: input.tenantId,
        userId: input.userId,
        cardToken: input.cardToken,
      },
      client
    );
    const isLatestPaidRecharge = latestPaidRecharge?.id === input.id;
    if (!isLatestPaidRecharge) {
      return {
        canRefund: false,
        isLatestPaidRecharge: false,
        refundBlockReason: '只允许最后一次充值发起退款。',
      };
    }

    if (Number(input.currentBalance ?? 0) + 0.000001 < Number(input.amount ?? 0)) {
      return {
        canRefund: false,
        isLatestPaidRecharge: true,
        refundBlockReason: '当前卡片余额小于充值金额，不能发起退款。',
      };
    }

    return {
      canRefund: true,
      isLatestPaidRecharge: true,
      refundBlockReason: null,
    };
  }

  async getCardRechargeOrderDetail(id: string, tenantId: string = DEFAULT_TENANT) {
    const detail = await this.repo.getCardRechargeOrderById({ tenantId, id });
    if (!detail) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, '充值订单不存在', 404, { id });
    }
    const paidAt = detail.paidAt ? String(detail.paidAt) : null;
    const usageAfterRecharge =
      paidAt && this.asString(detail.cardToken) && this.asString(detail.userId)
        ? await this.repo.getCardUsageAfterRecharge({
            tenantId,
            userId: this.asString(detail.userId),
            cardToken: this.asString(detail.cardToken),
            paidAt,
          })
        : { count: 0, items: [] as Array<Record<string, unknown>> };
    const refundPolicy = await this.resolveCardRechargeRefundPolicy({
      tenantId,
      id: String(detail.id),
      userId: this.asString(detail.userId),
      cardToken: this.asString(detail.cardToken),
      amount: Number(detail.amount ?? 0),
      currentBalance: Number(detail.currentBalance ?? 0),
      status: this.asString(detail.status),
      paymentIntentStatus: this.asString(detail.paymentIntentStatus) || null,
    });
    const providerSummary = this.extractProviderSummary({
      paymentChannel: this.asString(detail.paymentChannel),
      providerPayload: (detail.providerPayload as Record<string, unknown> | null) ?? {},
      paymentProviderPayload: (detail.paymentProviderPayload as Record<string, unknown> | null) ?? {},
    });
    return {
      id: String(detail.id),
      payment_intent_id: this.asString(detail.paymentIntentId),
      card_token: this.asString(detail.cardToken),
      card_label: this.asString(detail.cardLabel) || null,
      holder_name: this.asString(detail.holderName) || null,
      holder_mobile: this.asString(detail.holderMobile) || null,
      payer_mobile: this.asString(detail.payerMobile) || null,
      amount: Number(detail.amount ?? 0),
      status: this.asString(detail.status),
      recharge_mode: this.asString(detail.rechargeMode),
      payment_channel: this.asString(detail.paymentChannel),
      out_trade_no: this.asString(detail.outTradeNo) || null,
      payment_intent_status: this.asString(detail.paymentIntentStatus) || null,
      refunded_amount: Number(detail.refundedAmount ?? 0),
      current_balance: Number(detail.currentBalance ?? 0),
      current_locked_balance: Number(detail.currentLockedBalance ?? 0),
      pay_link: this.asString(detail.payLink) || null,
      callback_token: this.asString(detail.callbackToken) || null,
      created_at: String(detail.createdAt),
      paid_at: detail.paidAt ? String(detail.paidAt) : null,
      request_snapshot: (detail.requestSnapshot as Record<string, unknown> | null) ?? {},
      provider_payload: (detail.providerPayload as Record<string, unknown> | null) ?? {},
      checkout_snapshot: (detail.checkoutSnapshot as Record<string, unknown> | null) ?? {},
      payment_provider_payload: (detail.paymentProviderPayload as Record<string, unknown> | null) ?? {},
      payment_provider: providerSummary.payment_provider,
      provider_trade_no: providerSummary.provider_trade_no,
      refund_status: providerSummary.refund_status,
      refund_mode: providerSummary.refund_mode,
      refund_request_no: providerSummary.refund_request_no,
      refund_provider_trade_no: providerSummary.refund_provider_trade_no,
      refunded_at: providerSummary.refunded_at,
      card_usage_after_recharge: usageAfterRecharge,
      can_refund: refundPolicy.canRefund,
      is_latest_paid_recharge: refundPolicy.isLatestPaidRecharge,
      refund_block_reason: refundPolicy.refundBlockReason,
    };
  }

  async refundCardRechargeOrder(
    input: { id: string; remark?: string | null; tenantId?: string }
  ) {
    return this.refundCardRechargeOrderReal(input);
    const tenantId = input.tenantId ?? DEFAULT_TENANT;
    const remark = this.asString(input.remark) || null;
    const preflight = await this.db.withTransaction(async (client) => {
      const detail = await this.repo.getCardRechargeOrderById({ tenantId, id: input.id, forUpdate: true }, client);
      if (!detail) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, '充值订单不存在', 404, { id: input.id });
      }
      const status = this.asString(detail.status);
      if (status === 'refunded') {
        return this.getCardRechargeOrderDetail(String(detail.id), tenantId);
      }
      if (status !== 'paid') {
        throw new AppException(ErrorCodes.VALIDATION_ERROR, '只有已支付的充值订单才能退款', 400, {
          id: input.id,
          status,
        });
      }
      const paidAt = detail.paidAt ? String(detail.paidAt) : null;
      if (paidAt) {
        const usageAfterRecharge = await this.repo.getCardUsageAfterRecharge({
          tenantId,
          userId: String(detail.userId),
          cardToken: this.asString(detail.cardToken),
          paidAt,
        }, client);
        if (usageAfterRecharge.count > 0) {
          throw new AppException(ErrorCodes.VALIDATION_ERROR, '该充值后卡片已产生刷卡用水订单，不能退款', 400, {
            id: input.id,
            card_token: this.asString(detail.cardToken),
            related_orders: usageAfterRecharge.items,
          });
        }
      }

      const amount = Number(detail.amount ?? 0);
      try {
        await this.repo.insertLedgerAndApplyBalance(client, {
          tenantId,
          userId: String(detail.userId),
          entryType: 'refund',
          amount: -amount,
          referenceType: 'card_recharge',
          referenceId: String(detail.paymentIntentId),
          idempotencyKey: `card_recharge_refund:${String(detail.id)}`,
          remark: remark ?? `refund card recharge ${this.asString(detail.cardToken)}`,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'WALLET_INSUFFICIENT_BALANCE') {
          throw new AppException(ErrorCodes.WALLET_INSUFFICIENT_BALANCE, '当前余额不足，无法退款', 400, {
            id: input.id,
            amount,
          });
        }
        throw error;
      }

      const refundPayload = {
        refund_status: 'refunded',
        refunded_at: new Date().toISOString(),
        refund_remark: remark,
      };
      await this.repo.markRechargeRecordRefunded(client, {
        id: String(detail.id),
        providerPayload: refundPayload,
      });
      await this.repo.markPaymentIntentRefunded(client, {
        id: String(detail.paymentIntentId),
        refundedAmount: amount,
        providerPayload: refundPayload,
      });

      return this.getCardRechargeOrderDetail(String(detail.id), tenantId);
    });
  }

  private async refundCardRechargeOrderReal(
    input: { id: string; remark?: string | null; tenantId?: string }
  ) {
    const tenantId = input.tenantId ?? DEFAULT_TENANT;
    const remark = this.asString(input.remark) || null;

    const preflight = await this.db.withTransaction(async (client) => {
      const detail = await this.repo.getCardRechargeOrderById({ tenantId, id: input.id, forUpdate: true }, client);
      if (!detail) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, '充值订单不存在', 404, { id: input.id });
      }

      const status = this.asString(detail.status);
      if (status === 'refunded') {
        return {
          alreadyRefunded: true as const,
          detailId: String(detail.id),
        };
      }

      if (status !== 'paid') {
        throw new AppException(ErrorCodes.VALIDATION_ERROR, '只有已支付的充值订单才能退款', 400, {
          id: input.id,
          status,
        });
      }

      const paidAt = detail.paidAt ? String(detail.paidAt) : null;
      if (paidAt) {
        const usageAfterRecharge = await this.repo.getCardUsageAfterRecharge(
          {
            tenantId,
            userId: String(detail.userId),
            cardToken: this.asString(detail.cardToken),
            paidAt,
          },
          client
        );
        if (usageAfterRecharge.count > 0) {
          throw new AppException(ErrorCodes.VALIDATION_ERROR, '这笔充值之后卡片已经发生过刷卡灌溉订单，不能退款', 400, {
            id: input.id,
            card_token: this.asString(detail.cardToken),
            related_orders: usageAfterRecharge.items,
          });
        }
      }

      const amount = Number(detail.amount ?? 0);
      const wallet = await this.repo.getWalletState(tenantId, String(detail.userId), client);
      if (Number(wallet.balance ?? 0) + 0.000001 < amount) {
        throw new AppException(ErrorCodes.WALLET_INSUFFICIENT_BALANCE, '当前卡片余额不足，无法执行原路退款', 400, {
          id: input.id,
          amount,
          current_balance: Number(wallet.balance ?? 0),
        });
      }

      const paymentIntent = await this.repo.getPaymentIntentById(String(detail.paymentIntentId), client);
      if (!paymentIntent) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, '充值支付单不存在，无法发起原路退款', 404, {
          payment_intent_id: String(detail.paymentIntentId),
        });
      }
      if (this.asString(paymentIntent.status) !== 'paid') {
        throw new AppException(ErrorCodes.VALIDATION_ERROR, '当前支付单未处于已支付状态，不能发起原路退款', 400, {
          payment_intent_id: String(detail.paymentIntentId),
          payment_intent_status: this.asString(paymentIntent.status),
        });
      }

      return {
        alreadyRefunded: false as const,
        detailId: String(detail.id),
        userId: String(detail.userId),
        cardToken: this.asString(detail.cardToken),
        amount,
        paymentIntentId: String(detail.paymentIntentId),
        outTradeNo: this.asString(paymentIntent.outTradeNo),
        paymentMode: this.asString(paymentIntent.paymentMode),
        paymentChannel: this.asString(paymentIntent.paymentChannel),
        paymentAccountSnapshot: this.asObject(paymentIntent.paymentAccountSnapshot),
      };
    });

    if (preflight.alreadyRefunded) {
      return this.getCardRechargeOrderDetail(preflight.detailId, tenantId);
    }

    const provider = this.inferPaymentProvider(preflight.paymentMode, preflight.paymentChannel);
    const account = await this.paymentAccountService.resolveCallbackAccount(provider, {
      merchantNo:
        this.asString(preflight.paymentAccountSnapshot.merchant_no) ||
        this.asString(preflight.paymentAccountSnapshot.mch_id) ||
        null,
      appId: this.asString(preflight.paymentAccountSnapshot.app_id) || null,
      accountIdentity:
        this.asString(preflight.paymentAccountSnapshot.account_identity) ||
        this.asString(preflight.paymentAccountSnapshot.account_code) ||
        null,
    });
    const refundRequestNo = this.buildRechargeRefundRequestNo(preflight.paymentIntentId);
    const refundResult =
      provider === 'wechat'
        ? await this.requestWechatOriginalRefund({
            account,
            outTradeNo: preflight.outTradeNo,
            amount: preflight.amount,
            refundRequestNo,
            remark,
          })
        : await this.requestAlipayOriginalRefund({
            account,
            outTradeNo: preflight.outTradeNo,
            amount: preflight.amount,
            refundRequestNo,
            remark,
          });

    await this.db.withTransaction(async (client) => {
      const detail = await this.repo.getCardRechargeOrderById({ tenantId, id: preflight.detailId, forUpdate: true }, client);
      if (!detail) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, '充值订单不存在', 404, { id: preflight.detailId });
      }
      if (this.asString(detail.status) === 'refunded') {
        return;
      }

      try {
        await this.repo.insertLedgerAndApplyBalance(client, {
          tenantId,
          userId: preflight.userId,
          entryType: 'refund',
          amount: -preflight.amount,
          referenceType: 'card_recharge',
          referenceId: preflight.paymentIntentId,
          idempotencyKey: `card_recharge_refund:${preflight.detailId}`,
          remark: remark ?? `refund card recharge ${preflight.cardToken}`,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'WALLET_INSUFFICIENT_BALANCE') {
          throw new AppException(ErrorCodes.WALLET_INSUFFICIENT_BALANCE, '当前卡片余额不足，无法完成退款冲正', 400, {
            id: preflight.detailId,
            amount: preflight.amount,
          });
        }
        throw error;
      }

      const refundPayload = {
        refund_status: refundResult.refundStatus,
        refund_mode: refundResult.refundMode,
        refund_channel: refundResult.refundChannel,
        refund_request_no: refundResult.refundRequestNo,
        refund_provider_trade_no: refundResult.refundProviderTradeNo,
        refunded_at: refundResult.refundedAt,
        refund_remark: remark,
        refund_response: refundResult.responsePayload,
      };

      await this.repo.markRechargeRecordRefunded(client, {
        id: preflight.detailId,
        providerPayload: refundPayload,
      });
      await this.repo.markPaymentIntentRefunded(client, {
        id: preflight.paymentIntentId,
        refundedAmount: preflight.amount,
        providerPayload: refundPayload,
      });
    });

    return this.getCardRechargeOrderDetail(preflight.detailId, tenantId);
  }

  async importCardCatalog(input: {
    cards: Array<{ cardToken: string; label?: string | null }>;
    batchNo?: string | null;
    tenantId?: string;
  }) {
    const tenantId = input.tenantId ?? DEFAULT_TENANT;
    let created = 0;
    let updated = 0;
    for (const item of input.cards) {
      const cardToken = this.asString(item.cardToken);
      if (!cardToken) continue;
      const existed = await this.repo.getCardCatalogByToken(tenantId, cardToken);
      await this.repo.upsertCardCatalog({
        tenantId,
        cardToken,
        label: this.asString(item.label) || null,
        batchNo: this.asString(input.batchNo) || null,
        sourceType: 'import',
        status: existed?.status ?? 'unregistered',
      });
      if (existed) {
        updated += 1;
      } else {
        created += 1;
      }
    }
    return { created, updated, total: created + updated };
  }

  /** 订单结算后从预付钱包扣款（幂等） */
  async debitForSettledOrder(
    client: PoolClient,
    input: { tenantId: string; userId: string; orderId: string; amount: number; fundingMode: string | null }
  ) {
    if (input.fundingMode !== 'card_wallet' || input.amount <= 0) {
      return { debited: false, balanceAfter: await this.repo.getBalance(input.tenantId, input.userId, client) };
    }
    const idempotencyKey = `order_settle_debit:${input.orderId}`;
    try {
      const r = await this.repo.insertLedgerAndApplyBalance(client, {
        tenantId: input.tenantId,
        userId: input.userId,
        entryType: 'consume',
        amount: -input.amount,
        referenceType: 'irrigation_order',
        referenceId: input.orderId,
        idempotencyKey,
        remark: 'settlement debit'
      });
      return { debited: r.applied, balanceAfter: r.balanceAfter };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'WALLET_INSUFFICIENT_BALANCE') {
        throw new AppException(
          ErrorCodes.WALLET_INSUFFICIENT_BALANCE,
          'Wallet balance insufficient at settlement',
          400,
          { orderId: input.orderId, amount: input.amount }
        );
      }
      throw e;
    }
  }

  async lockWalletAmount(
    client: PoolClient,
    input: { tenantId: string; userId: string; orderId: string; amount: number; remark?: string }
  ) {
    if (input.amount <= 0) {
      const wallet = await this.repo.getWalletState(input.tenantId, input.userId, client);
      return { locked: false, balanceAfter: wallet.balance, lockedBalanceAfter: wallet.lockedBalance };
    }

    try {
      const result = await this.repo.insertLedgerAndApplyWalletState(client, {
        tenantId: input.tenantId,
        userId: input.userId,
        entryType: 'lock',
        amount: 0,
        availableDelta: -input.amount,
        lockedDelta: input.amount,
        referenceType: 'irrigation_order',
        referenceId: input.orderId,
        idempotencyKey: `order_lock:${input.orderId}`,
        remark: input.remark ?? 'lock wallet amount'
      });
      return { locked: result.applied, balanceAfter: result.balanceAfter, lockedBalanceAfter: result.lockedBalanceAfter };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'WALLET_INSUFFICIENT_BALANCE') {
        throw new AppException(ErrorCodes.WALLET_INSUFFICIENT_BALANCE, 'Wallet balance is insufficient for lock', 400, {
          orderId: input.orderId,
          amount: input.amount,
        });
      }
      throw error;
    }
  }

  async settleLockedOrder(
    client: PoolClient,
    input: { tenantId: string; userId: string; orderId: string; chargeAmount: number; lockedAmount: number }
  ) {
    const chargeAmount = Math.max(0, Number(input.chargeAmount ?? 0));
    const lockedAmount = Math.max(0, Number(input.lockedAmount ?? 0));
    const consumeAmount = Math.min(chargeAmount, lockedAmount);
    const releaseAmount = Math.max(0, lockedAmount - consumeAmount);

    const consumeResult =
      consumeAmount > 0
        ? await this.repo.insertLedgerAndApplyWalletState(client, {
            tenantId: input.tenantId,
            userId: input.userId,
            entryType: 'consume_locked',
            amount: -consumeAmount,
            availableDelta: 0,
            lockedDelta: -consumeAmount,
            referenceType: 'irrigation_order',
            referenceId: input.orderId,
            idempotencyKey: `order_consume_locked:${input.orderId}`,
            remark: 'consume locked balance'
          })
        : await this.repo.insertLedgerAndApplyWalletState(client, {
            tenantId: input.tenantId,
            userId: input.userId,
            entryType: 'consume_locked',
            amount: 0,
            availableDelta: 0,
            lockedDelta: 0,
            referenceType: 'irrigation_order',
            referenceId: input.orderId,
            idempotencyKey: `order_consume_locked:${input.orderId}`,
            remark: 'consume locked balance'
          });

    const releaseResult =
      releaseAmount > 0
        ? await this.repo.insertLedgerAndApplyWalletState(client, {
            tenantId: input.tenantId,
            userId: input.userId,
            entryType: 'unlock',
            amount: 0,
            availableDelta: releaseAmount,
            lockedDelta: -releaseAmount,
            referenceType: 'irrigation_order',
            referenceId: input.orderId,
            idempotencyKey: `order_unlock:${input.orderId}`,
            remark: 'unlock remaining balance'
          })
        : consumeResult;

    return {
      consumedAmount: consumeAmount,
      unlockedAmount: releaseAmount,
      balanceAfter: releaseResult.balanceAfter,
      lockedBalanceAfter: releaseResult.lockedBalanceAfter,
      underpaidAmount: Math.max(0, chargeAmount - lockedAmount)
    };
  }

  async getWalletState(client: PoolClient, tenantId: string, userId: string) {
    return this.repo.getWalletState(tenantId, userId, client);
  }
}
