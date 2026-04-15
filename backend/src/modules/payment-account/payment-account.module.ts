import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  Query
} from '@nestjs/common';
import { Res, StreamableFile } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type { Response } from 'express';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const PAYMENT_PROVIDERS = ['wechat', 'alipay'] as const;
const PAYMENT_ACCOUNT_STATUSES = ['active', 'disabled'] as const;

type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];
type PaymentAccountStatus = (typeof PAYMENT_ACCOUNT_STATUSES)[number];

type PaymentAccountProject = {
  project_id: string;
  project_name: string;
};

type PaymentAccountReadModel = {
  id: string;
  provider: PaymentProvider;
  account_code: string;
  account_name: string;
  merchant_no: string | null;
  app_id: string | null;
  account_identity: string | null;
  config_json: Record<string, unknown>;
  remarks: string | null;
  is_default: boolean;
  status: PaymentAccountStatus;
  record_source: 'database' | 'builtin_default';
  readonly: boolean;
  certificate_file_name: string | null;
  certificate_download_url: string | null;
  project_count: number;
  projects: PaymentAccountProject[];
  created_at: string;
  updated_at: string;
};

type PaymentAccountResolution = 'project_scoped' | 'system_default' | 'builtin_default';

type ResolvedPaymentAccount = {
  id: string | null;
  provider: PaymentProvider;
  accountCode: string;
  accountName: string;
  merchantNo: string | null;
  appId: string | null;
  accountIdentity: string | null;
  configJson: Record<string, unknown>;
  remarks: string | null;
  isDefault: boolean;
  status: 'active';
  resolution: PaymentAccountResolution;
  projectId: string | null;
};

type BuiltinDefaultPaymentAccount = {
  accountCode: string;
  accountName: string;
  merchantNo: string | null;
  appId: string | null;
  accountIdentity: string | null;
  configJson: Record<string, unknown>;
  remarks: string | null;
};

type WechatPortalAuthConfigReadModel = {
  provider: 'wechat';
  payment_account_id: string | null;
  source: 'database' | 'builtin_default';
  account_name: string;
  app_id: string;
  app_secret: string;
  oauth_scope: string;
  public_web_base_url: string;
  public_api_base_url: string;
  authorization_domain: string;
  callback_url: string;
  configured: boolean;
};

type WechatPortalAuthConfigPayload = {
  app_id?: string | null;
  app_secret?: string | null;
  oauth_scope?: string | null;
  public_web_base_url?: string | null;
  public_api_base_url?: string | null;
};

const WECHAT_PORTAL_AUTH_ACCOUNT_CODE = 'SYS-WECHAT-PORTAL-AUTH';

const BUILTIN_DEFAULT_PAYMENT_ACCOUNTS: Record<PaymentProvider, BuiltinDefaultPaymentAccount> = {
  wechat: {
    accountCode: 'SYS-WECHAT-DEFAULT',
    accountName: '系统默认微信支付账户（杭州东骏开发测试）',
    merchantNo: '1393406502',
    appId: 'wx9595c7045f48308d',
    accountIdentity: '杭州东骏科技有限公司',
    configJson: {
      usage_scope: 'dev_test_only',
      source_bundle: '微信和支付宝配置.zip',
      company_name: '杭州东骏科技有限公司',
      notify_url: '/api/v1/payments/wechat/notify',
      notify_url_note: '请使用可公网访问的正式域名拼接该路径后配置到微信商户平台支付结果通知地址',
      public_account: {
        app_id: 'wx9595c7045f48308d',
        app_secret: 'ae16103983a3d6892e0efa8518d26ee1',
        authorization_domain_required: true,
        jsapi_domain_required: true,
        business_domain_required: true,
      },
      merchant: {
        mch_id: '1393406502',
        api_key_v2: '123qwsdertfgnhjioklpdm839jedk7h2',
        api_key_v3: 'kjjdlfdioiiurue029dsafiiowfiwfiw',
        certificate_p12_path: 'fixtures/payment/wechat-dev-merchant-1393406502.p12',
      },
      manual_reference: {
        merchant_appid_relation_required: true,
        ip_whitelist_required: true,
      }
    },
    remarks: '来源：2026-04-08 桌面配置包；仅开发测试环境使用',
  },
  alipay: {
    accountCode: 'SYS-ALIPAY-DEFAULT',
    accountName: '系统默认支付宝账户（杭州东骏开发测试）',
    merchantNo: '2088421319332222',
    appId: '2021001146600257',
    accountIdentity: '杭州东骏科技有限公司',
    configJson: {
      usage_scope: 'dev_test_only',
      source_bundle: '微信和支付宝配置.zip',
      company_name: '杭州东骏科技有限公司',
      sign_type: 'RSA2',
      pid: '2088421319332222',
      app_id: '2021001146600257',
      notify_url: '/api/v1/payments/alipay/notify',
      return_url: '/api/v1/payments/alipay/return',
      return_redirect_url: 'https://mobile.jiumengfood.com',
      alipay_public_key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAi5URXf3QYiFwo266LU4WF1iBLLkjTWpBH7+UTFJcleP1/DxO58Xnny3MWsDOMLpLsG8OuCmxRfeJrY3ulLqbYcaM7dX5CRUUY1lF6XIyvsnP0lMuYDt5M2PHVhSRSiNpphBlYfLE/aB2QD1Gu9OpPqdjQ0k8GeLs7yjK3L5re0lXJnTppTgX77MGy/SAgR+8cvuRJyWh8fHzJc9S2Fjpnme6b/o5DKcHqfnd5E3GFCRejESb2mHMzx9BoOhVew4EiQXvWXKb0/wByKXwM7k9yQ+zDl8kjdBC+pmbYf2Xr0RcZtU2IexmDtZkhDXSS0uXlOMt8EqqhgieYn1hlg8pNwIDAQAB',
      merchant_private_key: 'MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCJXaNbnvSWvKcPw47TNlj+WTqEYg7S7DuXMcSai5cACEfU+WR7mfEVyeXzAgy7UZdORg51aBJWLErStD5ViOn9nFBnUB8VUJnjDON/wcNveehk8wmGBt0NIcNv9sP5isZxNCwQ1NKTp4ymOZ810+en49nyxwmtLqmoZt1irz7aeDGqPLj1oby/fRX2L5S28z5po1CY5EITDIXDILvnvuD/EB/Ei8KvxIHAPrGYpsMSCb7VBXrNtVyL092IrUkbvldOdOjUFbOC7M/mex/iJncKWYR9WDebzGG5tgpDagS49ql6jJCn2DZhV33F/kvxaRo34HNlzbRhOdft9U9r/HejAgMBAAECggEARh+3NR6AXjMQVcvPLaOg6rdCWDJ2vtY51YViiEKaYznW8bIeybpciHL5IIT7WuTcCOlamDT4p2UVDVtWNvQd/4m8wgD03Ty4UmBSAvY3fsENEfu/8NuwHPQPgSjIAqwFgeTQWgdLOHVgJ7tiu2fh6qM2r+lL10zq7z0T5zzvKTdTK6XLw4qvCE+CEAzYdmfzXvxXWEGqcmvyocb8xA8PNm6sed9eoJTwX+PzbmquoPgeFpq/KQlOcz34CUmzR/aCH8WiuaDa2APquWIWp6uFiEDlb/e4vgNAi4N6CIeWMTeAfK3wXjpTMwq0Saz2Gf6FRpgYanLWBrm5MXd/vTDFAQKBgQC84JL6sEFxC5p4y8Bjdtru2oKMPZzXbFGy1J53dA/g4qFlQXg6croK/6fuztcg4sIeW/cV/jpJMOBU6CGNPJFsrpZnlQ6tT9sxHZICpc7foSkmB8l7ttd89bH866agotetCBsaEHG5TTKOsisuIEs3J2UFZpC7ek3biqTdKVzzWwKBgQC6LrifeEHp287yIptyW6NwMdbFbFmjTgq7UfhsR4S8u5tkn6JXomKbE693WomBCiHNqLxxwlDnD+3wJZ0FznM8e1Nn6K/xUZAw/HpQtC8WtWnOWmZjVX/8CWcOG6NTAFijKfod+1fol4bxnW0DEvLMIYUb8ydrykZ2PffMVRsnWQKBgFYsrEKeWi1GmwLUC4IV/0uM/JUZo06SSDAsW+SqWnhDTlnRZhZcs89C147YZkTF0MVjNjedl2A/YYq7ols7MCqC+XJnCpw+XAZrtGtq1RkpAYotcVr1kBmeS8fWiF6wDXEPyrW4nPprY07BsXvJFigi3C97nTs8UPuCpTeWoKcTAoGBALi46EaYa1Va2B2XRoGU+Di1yjBAi0MiiDVIY+ESqFkVDl0soUavf4P7aQlTU8AqzFUfSDDaKajHPj0ZJI0BQ4ZLmforfH1CfnyL09PEoj+2qI6rVJDT4NKwhYYS193fJxJj8JvUp2jHBoUsu17kau8rhsSvYHpqy7Q/UV9zRSipAoGBAJSJ6XBo8CsILEJw8Bwr80yQYz3F4YJEINJf3XFSWd6WE2sHmhPaD8Y7huy4xUVNuil3MK3zmgSRfpJd+bMRIPrVwj+qlbpuA0GUTDeLtbCkxkOQ5pQ9gQIw9yG+WckWeahk+fSSqDtYsTwZcAGAS09zx/hnnb6rnSkFVrEPfqjo',
      merchant_public_key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiV2jW570lrynD8OO0zZY/lk6hGIO0uw7lzHEmouXAAhH1Plke5nxFcnl8wIMu1GXTkYOdWgSVixK0rQ+VYjp/ZxQZ1AfFVCZ4wzjf8HDb3noZPMJhgbdDSHDb/bD+YrGcTQsENTSk6eMpjmfNdPnp+PZ8scJrS6pqGbdYq8+2ngxqjy49aG8v30V9i+UtvM+aaNQmORCEwyFwyC7577g/xAfxIvCr8SBwD6xmKbDEgm+1QV6zbVci9PdiK1JG75XTnTo1BWzguzP5nsf4iZ3ClmEfVg3m8xhubYKQ2oEuPapeoyQp9g2YVd9xf5L8WkaN+BzZc20YTnX7fVPa/x3owIDAQAB',
      auth_callback_url: 'https://mobile.jiumengfood.com',
      face_to_face_pay_required: true,
      openid_mode_required: false,
    },
    remarks: '来源：2026-04-08 桌面配置包；仅开发测试环境使用',
  }
};

interface PaymentAccountPayload {
  provider?: PaymentProvider | string;
  account_code?: string;
  account_name?: string;
  merchant_no?: string | null;
  app_id?: string | null;
  account_identity?: string | null;
  config_json?: Record<string, unknown> | null;
  remarks?: string | null;
  is_default?: boolean;
  status?: PaymentAccountStatus | string;
  project_ids?: string[];
}

function appException(status: HttpStatus, code: string, message: string, data: Record<string, unknown> = {}) {
  return new HttpException({ requestId: 'local-dev', code, message, data }, status);
}

function parsePage(value?: string, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePageSize(value?: string, fallback = 20) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class PaymentAccountService {
  constructor(private readonly db: DatabaseService) {}

  private asString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asObject(value: unknown) {
    return isPlainObject(value) ? value : {};
  }

  private buildPublicWebBaseUrl(raw?: string | null) {
    return this.asString(raw || process.env.PUBLIC_WEB_BASE_URL || process.env.PORTAL_PUBLIC_BASE_URL || 'http://xupengpeng.top')
      .replace(/\/+$/, '');
  }

  private buildPublicApiBaseUrl(publicWebBaseUrl: string, raw?: string | null) {
    return this.asString(raw || process.env.PUBLIC_API_BASE_URL || `${publicWebBaseUrl}/api/v1`)
      .replace(/\/+$/, '');
  }

  private extractDomain(baseUrl: string) {
    try {
      return new URL(baseUrl).host;
    } catch {
      return baseUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    }
  }

  private buildBuiltinId(provider: PaymentProvider) {
    return `builtin-default-${provider}`;
  }

  private parseBuiltinId(id: string): PaymentProvider | null {
    const normalized = this.asString(id);
    if (normalized === this.buildBuiltinId('wechat')) return 'wechat';
    if (normalized === this.buildBuiltinId('alipay')) return 'alipay';
    return null;
  }

  private extractCertificatePath(configJson: Record<string, unknown> | null | undefined) {
    const config = this.asObject(configJson);
    const merchant = this.asObject(config.merchant);
    const candidates = [
      merchant.certificate_p12_path,
      merchant.certificate_path,
      config.certificate_p12_path,
      config.certificate_path
    ];

    for (const candidate of candidates) {
      const normalized = this.asString(candidate);
      if (normalized) return normalized;
    }

    return null;
  }

  private buildCertificateMeta(id: string, configJson: Record<string, unknown> | null | undefined) {
    const certificatePath = this.extractCertificatePath(configJson);
    if (!certificatePath) {
      return {
        certificate_file_name: null,
        certificate_download_url: null
      };
    }

    return {
      certificate_file_name: path.basename(certificatePath),
      certificate_download_url: `/payment-accounts/${encodeURIComponent(id)}/certificate`
    };
  }

  private getRecordSource(provider: PaymentProvider, accountCode: string): 'database' | 'builtin_default' {
    return accountCode === BUILTIN_DEFAULT_PAYMENT_ACCOUNTS[provider].accountCode ? 'builtin_default' : 'database';
  }

  private buildBuiltinReadModel(provider: PaymentProvider, isDefault: boolean): PaymentAccountReadModel {
    const builtin = BUILTIN_DEFAULT_PAYMENT_ACCOUNTS[provider];
    const id = this.buildBuiltinId(provider);
    const certificateMeta = this.buildCertificateMeta(id, builtin.configJson);
    const now = new Date().toISOString();

    return {
      id,
      provider,
      account_code: builtin.accountCode,
      account_name: builtin.accountName,
      merchant_no: builtin.merchantNo,
      app_id: builtin.appId,
      account_identity: builtin.accountIdentity,
      config_json: builtin.configJson,
      remarks: builtin.remarks,
      is_default: isDefault,
      status: 'active',
      record_source: 'builtin_default',
      readonly: true,
      certificate_file_name: certificateMeta.certificate_file_name,
      certificate_download_url: certificateMeta.certificate_download_url,
      project_count: 0,
      projects: [],
      created_at: now,
      updated_at: now
    };
  }

  private resolveCertificateFile(relativePath: string) {
    const backendRoot = path.resolve(process.cwd());
    const absolutePath = path.resolve(backendRoot, relativePath);
    const relativeToRoot = path.relative(backendRoot, absolutePath);

    if (
      !relativeToRoot ||
      relativeToRoot.startsWith('..') ||
      path.isAbsolute(relativeToRoot)
    ) {
      throw new NotFoundException('payment account certificate not found');
    }

    if (!fs.existsSync(absolutePath)) {
      throw new NotFoundException('payment account certificate not found');
    }

    return {
      absolute_path: absolutePath,
      file_name: path.basename(absolutePath)
    };
  }

  private normalizeProvider(value?: string | null): PaymentProvider {
    const normalized = this.asString(value).toLowerCase();
    if (normalized === 'wechat' || normalized === 'alipay') {
      return normalized;
    }
    throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
      fieldErrors: { provider: ['provider is invalid'] }
    });
  }

  private normalizeStatus(value?: string | null): PaymentAccountStatus {
    const normalized = this.asString(value).toLowerCase();
    if (normalized === 'disabled') return 'disabled';
    return 'active';
  }

  private normalizeProjectIds(value: unknown) {
    if (!Array.isArray(value)) return [] as string[];
    return Array.from(new Set(value.map((item) => this.asString(item)).filter(Boolean)));
  }

  private mapRow(row: {
    id: string;
    provider: string;
    account_code: string;
    account_name: string;
    merchant_no: string | null;
    app_id: string | null;
    account_identity: string | null;
    config_json: Record<string, unknown> | null;
    remarks: string | null;
    is_default: boolean;
    status: string;
    project_count: number;
    projects: PaymentAccountProject[] | null;
    created_at: string;
    updated_at: string;
  }): PaymentAccountReadModel {
    const provider = this.normalizeProvider(row.provider);
    const configJson = this.asObject(row.config_json);
    const recordSource = this.getRecordSource(provider, row.account_code);
    const certificateMeta = this.buildCertificateMeta(row.id, configJson);

    return {
      id: row.id,
      provider,
      account_code: row.account_code,
      account_name: row.account_name,
      merchant_no: row.merchant_no,
      app_id: row.app_id,
      account_identity: row.account_identity,
      config_json: configJson,
      remarks: row.remarks,
      is_default: row.is_default === true,
      status: this.normalizeStatus(row.status),
      record_source: recordSource,
      readonly: recordSource === 'builtin_default',
      certificate_file_name: certificateMeta.certificate_file_name,
      certificate_download_url: certificateMeta.certificate_download_url,
      project_count: Number(row.project_count ?? 0),
      projects: Array.isArray(row.projects) ? row.projects : [],
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private async ensureProjectsExist(projectIds: string[], client?: PoolClient) {
    if (projectIds.length === 0) return;
    const result = await this.db.query<{ id: string }>(
      `
      select id::text as id
      from project
      where tenant_id = $1
        and id = any($2::uuid[])
      `,
      [TENANT_ID, projectIds],
      client
    );
    const existing = new Set(result.rows.map((row) => row.id));
    const invalid = projectIds.filter((projectId) => !existing.has(projectId));
    if (invalid.length > 0) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: {
          project_ids: [`project_ids contain invalid values: ${invalid.join(', ')}`]
        }
      });
    }
  }

  private async ensureProjectAssignmentsAvailable(
    provider: PaymentProvider,
    projectIds: string[],
    status: PaymentAccountStatus,
    excludeId?: string,
    client?: PoolClient
  ) {
    if (projectIds.length === 0 || status !== 'active') return;

    const params: unknown[] = [TENANT_ID, provider, projectIds];
    let excludeClause = '';
    if (excludeId) {
      params.push(excludeId);
      excludeClause = `and pa.id <> $4::uuid`;
    }

    const result = await this.db.query<{ project_id: string; project_name: string; account_name: string }>(
      `
      select
        pap.project_id::text as project_id,
        p.project_name as project_name,
        pa.account_name as account_name
      from payment_account_project pap
      join payment_account pa on pa.id = pap.payment_account_id
      join project p on p.id = pap.project_id
      where pa.tenant_id = $1
        and pa.provider = $2
        and pa.status = 'active'
        and pap.project_id = any($3::uuid[])
        ${excludeClause}
      `,
      params,
      client
    );

    if (result.rows.length > 0) {
      const details = result.rows.map(
        (row) => `${row.project_name || row.project_id} -> ${row.account_name || '未命名账户'}`
      );
      throw appException(HttpStatus.CONFLICT, 'VALIDATION_ERROR', '项目已配置其他收费账户', {
        fieldErrors: {
          project_ids: details
        }
      });
    }
  }

  private validatePayload(dto: PaymentAccountPayload, isCreate: boolean) {
    const fieldErrors: Record<string, string[]> = {};
    const provider = this.asString(dto.provider);
    const accountCode = this.asString(dto.account_code);
    const accountName = this.asString(dto.account_name);

    if (isCreate && !provider) fieldErrors.provider = ['provider is required'];
    if (provider && !PAYMENT_PROVIDERS.includes(provider as PaymentProvider)) {
      fieldErrors.provider = ['provider is invalid'];
    }
    if (isCreate && !accountCode) fieldErrors.account_code = ['account_code is required'];
    if (isCreate && !accountName) fieldErrors.account_name = ['account_name is required'];
    if (!isCreate && dto.account_code !== undefined && !accountCode) {
      fieldErrors.account_code = ['account_code is required'];
    }
    if (!isCreate && dto.account_name !== undefined && !accountName) {
      fieldErrors.account_name = ['account_name is required'];
    }
    if (dto.is_default === true && this.normalizeStatus(dto.status) !== 'active') {
      fieldErrors.status = ['default account must be active'];
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', { fieldErrors });
    }
  }

  private async fetchById(id: string, client?: PoolClient) {
    const result = await this.db.query<{
      id: string;
      provider: string;
      account_code: string;
      account_name: string;
      merchant_no: string | null;
      app_id: string | null;
      account_identity: string | null;
      config_json: Record<string, unknown> | null;
      remarks: string | null;
      is_default: boolean;
      status: string;
      project_count: number;
      projects: PaymentAccountProject[] | null;
      created_at: string;
      updated_at: string;
    }>(
      `
      select
        pa.id,
        pa.provider,
        pa.account_code,
        pa.account_name,
        pa.merchant_no,
        pa.app_id,
        pa.account_identity,
        pa.config_json,
        pa.remarks,
        pa.is_default,
        pa.status,
        count(p.id)::int as project_count,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'project_id', p.id::text,
              'project_name', p.project_name
            )
            order by p.project_name asc
          ) filter (where p.id is not null),
          '[]'::jsonb
        ) as projects,
        pa.created_at::text as created_at,
        pa.updated_at::text as updated_at
      from payment_account pa
      left join payment_account_project pap on pap.payment_account_id = pa.id
      left join project p on p.id = pap.project_id
      where pa.tenant_id = $1
        and pa.id = $2::uuid
      group by pa.id
      limit 1
      `,
      [TENANT_ID, id],
      client
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async list(page = 1, pageSize = 20, provider?: string) {
    const normalizedProvider = provider?.trim() ? this.normalizeProvider(provider) : null;
    const offset = (page - 1) * pageSize;
    const params: unknown[] = [TENANT_ID];
    let providerClause = '';
    if (normalizedProvider) {
      params.push(normalizedProvider);
      providerClause = `and pa.provider = $2`;
    }

    const listParams = normalizedProvider ? [...params, pageSize, offset] : [...params, pageSize, offset];
    const countParams = normalizedProvider ? params : params;

    const totalResult = await this.db.query<{ total: string }>(
      `
      select count(*)::text as total
      from payment_account pa
      where pa.tenant_id = $1
        ${providerClause}
      `,
      countParams
    );

    const result = await this.db.query<{
      id: string;
      provider: string;
      account_code: string;
      account_name: string;
      merchant_no: string | null;
      app_id: string | null;
      account_identity: string | null;
      config_json: Record<string, unknown> | null;
      remarks: string | null;
      is_default: boolean;
      status: string;
      project_count: number;
      projects: PaymentAccountProject[] | null;
      created_at: string;
      updated_at: string;
    }>(
      `
      select
        pa.id,
        pa.provider,
        pa.account_code,
        pa.account_name,
        pa.merchant_no,
        pa.app_id,
        pa.account_identity,
        pa.config_json,
        pa.remarks,
        pa.is_default,
        pa.status,
        count(p.id)::int as project_count,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'project_id', p.id::text,
              'project_name', p.project_name
            )
            order by p.project_name asc
          ) filter (where p.id is not null),
          '[]'::jsonb
        ) as projects,
        pa.created_at::text as created_at,
        pa.updated_at::text as updated_at
      from payment_account pa
      left join payment_account_project pap on pap.payment_account_id = pa.id
      left join project p on p.id = pap.project_id
      where pa.tenant_id = $1
        ${providerClause}
      group by pa.id
      order by pa.provider asc, pa.is_default desc, pa.updated_at desc
      limit $${listParams.length - 1} offset $${listParams.length}
      `,
      listParams
    );

    const items = result.rows.map((row) => this.mapRow(row));
    const providersToFill = normalizedProvider ? [normalizedProvider] : PAYMENT_PROVIDERS;
    let appendedCount = 0;

    for (const itemProvider of providersToFill) {
      const builtinAccountCode = BUILTIN_DEFAULT_PAYMENT_ACCOUNTS[itemProvider].accountCode;
      const hasBuiltinRow = items.some(
        (item) => item.provider === itemProvider && item.account_code === builtinAccountCode
      );
      if (!hasBuiltinRow) {
        const hasDefaultRow = items.some((item) => item.provider === itemProvider && item.is_default);
        items.push(this.buildBuiltinReadModel(itemProvider, !hasDefaultRow));
        appendedCount += 1;
      }
    }

    items.sort((left, right) => {
      if (left.provider !== right.provider) {
        return left.provider.localeCompare(right.provider);
      }
      if (left.is_default !== right.is_default) {
        return left.is_default ? -1 : 1;
      }
      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    });

    return {
      items,
      total: Number(totalResult.rows[0]?.total ?? 0) + appendedCount,
      page,
      page_size: pageSize
    };
  }

  async detail(id: string) {
    const builtinProvider = this.parseBuiltinId(id);
    if (builtinProvider) {
      return this.buildBuiltinReadModel(builtinProvider, true);
    }

    const row = await this.fetchById(id);
    if (!row) throw new NotFoundException('payment_account not found');
    return row;
  }

  async create(dto: PaymentAccountPayload) {
    this.validatePayload(dto, true);
    const id = await this.db.withTransaction(async (client) => {
      const provider = this.normalizeProvider(dto.provider);
      const projectIds = this.normalizeProjectIds(dto.project_ids);
      const status = this.normalizeStatus(dto.status);
      await this.ensureProjectsExist(projectIds, client);
      await this.ensureProjectAssignmentsAvailable(provider, projectIds, status, undefined, client);

      const inserted = await this.db.query<{ id: string }>(
        `
        insert into payment_account (
          tenant_id, provider, account_code, account_name,
          merchant_no, app_id, account_identity, config_json,
          remarks, is_default, status
        )
        values (
          $1, $2, $3, $4,
          $5, $6, $7, $8::jsonb,
          $9, $10, $11
        )
        returning id
        `,
        [
          TENANT_ID,
          provider,
          this.asString(dto.account_code),
          this.asString(dto.account_name),
          this.asString(dto.merchant_no) || null,
          this.asString(dto.app_id) || null,
          this.asString(dto.account_identity) || null,
          JSON.stringify(this.asObject(dto.config_json)),
          this.asString(dto.remarks) || null,
          dto.is_default === true,
          status
        ],
        client
      );

      const createdId = inserted.rows[0].id;
      await this.replaceProjectAssignments(createdId, projectIds, client);
      if (dto.is_default === true) {
        await this.resetOtherDefaults(provider, createdId, client);
      }
      return createdId;
    });

    return this.detail(id);
  }

  async update(id: string, dto: PaymentAccountPayload) {
    if (this.parseBuiltinId(id)) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', '系统内置默认账户不支持直接编辑');
    }

    this.validatePayload(dto, false);
    const existing = await this.fetchById(id);
    if (!existing) throw new NotFoundException('payment_account not found');

    await this.db.withTransaction(async (client) => {
      const provider = dto.provider ? this.normalizeProvider(dto.provider) : existing.provider;
      const projectIds = dto.project_ids ? this.normalizeProjectIds(dto.project_ids) : existing.projects.map((item) => item.project_id);
      const status = dto.status ? this.normalizeStatus(dto.status) : existing.status;
      const isDefault = dto.is_default === undefined ? existing.is_default : dto.is_default === true;

      await this.ensureProjectsExist(projectIds, client);
      await this.ensureProjectAssignmentsAvailable(provider, projectIds, status, id, client);
      if (isDefault && status !== 'active') {
        throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
          fieldErrors: { status: ['default account must be active'] }
        });
      }

      await this.db.query(
        `
        update payment_account
        set provider = $3,
            account_code = $4,
            account_name = $5,
            merchant_no = $6,
            app_id = $7,
            account_identity = $8,
            config_json = $9::jsonb,
            remarks = $10,
            is_default = $11,
            status = $12,
            updated_at = now()
        where tenant_id = $1
          and id = $2::uuid
        `,
        [
          TENANT_ID,
          id,
          provider,
          dto.account_code !== undefined ? this.asString(dto.account_code) : existing.account_code,
          dto.account_name !== undefined ? this.asString(dto.account_name) : existing.account_name,
          dto.merchant_no !== undefined ? this.asString(dto.merchant_no) || null : existing.merchant_no,
          dto.app_id !== undefined ? this.asString(dto.app_id) || null : existing.app_id,
          dto.account_identity !== undefined ? this.asString(dto.account_identity) || null : existing.account_identity,
          JSON.stringify(dto.config_json !== undefined ? this.asObject(dto.config_json) : existing.config_json),
          dto.remarks !== undefined ? this.asString(dto.remarks) || null : existing.remarks,
          isDefault,
          status
        ],
        client
      );

      if (dto.project_ids !== undefined) {
        await this.replaceProjectAssignments(id, projectIds, client);
      }
      if (isDefault) {
        await this.resetOtherDefaults(provider, id, client);
      }
    });

    return this.detail(id);
  }

  async downloadCertificate(id: string) {
    const builtinProvider = this.parseBuiltinId(id);
    if (builtinProvider) {
      const relativePath = this.extractCertificatePath(BUILTIN_DEFAULT_PAYMENT_ACCOUNTS[builtinProvider].configJson);
      if (!relativePath) throw new NotFoundException('payment account certificate not found');
      return this.resolveCertificateFile(relativePath);
    }

    const row = await this.fetchById(id);
    if (!row) throw new NotFoundException('payment_account not found');
    const relativePath = this.extractCertificatePath(row.config_json);
    if (!relativePath) throw new NotFoundException('payment account certificate not found');
    return this.resolveCertificateFile(relativePath);
  }

  async resolveCallbackAccount(
    provider: PaymentProvider,
    input?: {
      merchantNo?: string | null;
      appId?: string | null;
      accountIdentity?: string | null;
    }
  ) {
    const normalizedProvider = this.normalizeProvider(provider);
    const merchantNo = this.asString(input?.merchantNo) || null;
    const appId = this.asString(input?.appId) || null;
    const accountIdentity = this.asString(input?.accountIdentity) || null;

    if (merchantNo || appId || accountIdentity) {
      const result = await this.db.query<{
        id: string;
        provider: string;
        account_code: string;
        account_name: string;
        merchant_no: string | null;
        app_id: string | null;
        account_identity: string | null;
        config_json: Record<string, unknown> | null;
        remarks: string | null;
        is_default: boolean;
        status: string;
        project_count: number;
        projects: PaymentAccountProject[] | null;
        created_at: string;
        updated_at: string;
      }>(
        `
        select
          pa.id,
          pa.provider,
          pa.account_code,
          pa.account_name,
          pa.merchant_no,
          pa.app_id,
          pa.account_identity,
          pa.config_json,
          pa.remarks,
          pa.is_default,
          pa.status,
          0::int as project_count,
          '[]'::jsonb as projects,
          pa.created_at::text as created_at,
          pa.updated_at::text as updated_at
        from payment_account pa
        where pa.tenant_id = $1
          and pa.provider = $2
          and pa.status = 'active'
          and (
            ($3::text is not null and pa.merchant_no = $3)
            or ($4::text is not null and pa.app_id = $4)
            or ($5::text is not null and pa.account_identity = $5)
          )
        order by
          case when $3::text is not null and pa.merchant_no = $3 then 0 else 1 end,
          case when $4::text is not null and pa.app_id = $4 then 0 else 1 end,
          case when $5::text is not null and pa.account_identity = $5 then 0 else 1 end,
          pa.is_default desc,
          pa.updated_at desc
        limit 1
        `,
        [TENANT_ID, normalizedProvider, merchantNo, appId, accountIdentity]
      );

      const matched = result.rows[0];
      if (matched) {
        const row = this.mapRow(matched);
        return {
          id: row.id,
          provider: row.provider,
          accountCode: row.account_code,
          accountName: row.account_name,
          merchantNo: row.merchant_no,
          appId: row.app_id,
          accountIdentity: row.account_identity,
          configJson: this.asObject(row.config_json),
          remarks: row.remarks,
          isDefault: row.is_default,
          status: row.status,
          resolution: row.is_default ? 'system_default' : 'project_scoped',
          recordSource: row.record_source
        };
      }
    }

    const builtin = BUILTIN_DEFAULT_PAYMENT_ACCOUNTS[normalizedProvider];
    const builtinMerchantNo = this.asString(builtin.merchantNo);
    const builtinAppId = this.asString(builtin.appId);
    const builtinAccountIdentity = this.asString(builtin.accountIdentity);
    const shouldUseBuiltin =
      (!merchantNo && !appId && !accountIdentity) ||
      (merchantNo && merchantNo === builtinMerchantNo) ||
      (appId && appId === builtinAppId) ||
      (accountIdentity && accountIdentity === builtinAccountIdentity);

    if (!shouldUseBuiltin) {
      return null;
    }

    return {
      id: null,
      provider: normalizedProvider,
      accountCode: builtin.accountCode,
      accountName: builtin.accountName,
      merchantNo: builtin.merchantNo,
      appId: builtin.appId,
      accountIdentity: builtin.accountIdentity,
      configJson: builtin.configJson,
      remarks: builtin.remarks,
      isDefault: true,
      status: 'active' as const,
      resolution: 'builtin_default' as const,
      recordSource: 'builtin_default' as const
    };
  }

  private async replaceProjectAssignments(paymentAccountId: string, projectIds: string[], client: PoolClient) {
    await this.db.query(`delete from payment_account_project where payment_account_id = $1::uuid`, [paymentAccountId], client);
    if (projectIds.length === 0) return;
    await this.db.query(
      `
      insert into payment_account_project (payment_account_id, project_id)
      select $1::uuid, unnest($2::uuid[])
      `,
      [paymentAccountId, projectIds],
      client
    );
  }

  private async resetOtherDefaults(provider: PaymentProvider, currentId: string, client: PoolClient) {
    await this.db.query(
      `
      update payment_account
      set is_default = false,
          updated_at = now()
      where tenant_id = $1
        and provider = $2
        and id <> $3::uuid
        and is_default = true
      `,
      [TENANT_ID, provider, currentId],
      client
    );
  }

  async resolveEffectiveAccount(
    tenantId: string,
    provider: PaymentProvider,
    projectId?: string | null
  ): Promise<ResolvedPaymentAccount> {
    const normalizedProvider = this.normalizeProvider(provider);
    const normalizedProjectId = this.asString(projectId) || null;

    if (normalizedProjectId) {
      const projectScoped = await this.db.query<{
        id: string;
        account_code: string;
        account_name: string;
        merchant_no: string | null;
        app_id: string | null;
        account_identity: string | null;
        config_json: Record<string, unknown> | null;
        remarks: string | null;
      }>(
        `
        select
          pa.id::text as id,
          pa.account_code,
          pa.account_name,
          pa.merchant_no,
          pa.app_id,
          pa.account_identity,
          pa.config_json,
          pa.remarks
        from payment_account pa
        join payment_account_project pap on pap.payment_account_id = pa.id
        where pa.tenant_id = $1
          and pa.provider = $2
          and pa.status = 'active'
          and pap.project_id = $3::uuid
        order by pa.updated_at desc
        limit 1
        `,
        [tenantId, normalizedProvider, normalizedProjectId]
      );
      const row = projectScoped.rows[0];
      if (row) {
        return {
          id: row.id,
          provider: normalizedProvider,
          accountCode: row.account_code,
          accountName: row.account_name,
          merchantNo: row.merchant_no,
          appId: row.app_id,
          accountIdentity: row.account_identity,
          configJson: this.asObject(row.config_json),
          remarks: row.remarks,
          isDefault: false,
          status: 'active',
          resolution: 'project_scoped',
          projectId: normalizedProjectId
        };
      }
    }

    const defaults = await this.db.query<{
      id: string;
      account_code: string;
      account_name: string;
      merchant_no: string | null;
      app_id: string | null;
      account_identity: string | null;
      config_json: Record<string, unknown> | null;
      remarks: string | null;
    }>(
      `
      select
        pa.id::text as id,
        pa.account_code,
        pa.account_name,
        pa.merchant_no,
        pa.app_id,
        pa.account_identity,
        pa.config_json,
        pa.remarks
      from payment_account pa
      where pa.tenant_id = $1
        and pa.provider = $2
        and pa.status = 'active'
        and pa.is_default = true
      order by pa.updated_at desc
      limit 1
      `,
      [tenantId, normalizedProvider]
    );

    const defaultRow = defaults.rows[0];
    if (defaultRow) {
      return {
        id: defaultRow.id,
        provider: normalizedProvider,
        accountCode: defaultRow.account_code,
        accountName: defaultRow.account_name,
        merchantNo: defaultRow.merchant_no,
        appId: defaultRow.app_id,
        accountIdentity: defaultRow.account_identity,
        configJson: this.asObject(defaultRow.config_json),
        remarks: defaultRow.remarks,
        isDefault: true,
        status: 'active',
        resolution: 'system_default',
        projectId: normalizedProjectId
      };
    }

    const builtin = BUILTIN_DEFAULT_PAYMENT_ACCOUNTS[normalizedProvider];

    return {
      id: null,
      provider: normalizedProvider,
      accountCode: builtin.accountCode,
      accountName: builtin.accountName,
      merchantNo: builtin.merchantNo,
      appId: builtin.appId,
      accountIdentity: builtin.accountIdentity,
      configJson: builtin.configJson,
      remarks: builtin.remarks,
      isDefault: true,
      status: 'active',
      resolution: 'builtin_default',
      projectId: normalizedProjectId
    };
  }

  async getWechatPortalAuthConfig(): Promise<WechatPortalAuthConfigReadModel> {
    const account = await this.resolveEffectiveAccount(TENANT_ID, 'wechat');
    const configJson = this.asObject(account.configJson);
    const publicAccount = this.asObject(configJson.public_account);
    const publicWebBaseUrl = this.buildPublicWebBaseUrl(
      this.asString(configJson.public_web_base_url) ||
        this.asString(configJson.portal_public_base_url) ||
        this.asString(configJson.public_base_url)
    );
    const publicApiBaseUrl = this.buildPublicApiBaseUrl(
      publicWebBaseUrl,
      this.asString(configJson.public_api_base_url)
    );
    const appId =
      this.asString(publicAccount.app_id) ||
      this.asString(configJson.app_id) ||
      this.asString(account.appId);
    const appSecret =
      this.asString(publicAccount.app_secret) ||
      this.asString(configJson.app_secret);
    const oauthScope =
      this.asString(publicAccount.oauth_scope) ||
      this.asString(configJson.oauth_scope) ||
      'snsapi_userinfo';

    return {
      provider: 'wechat',
      payment_account_id: account.id,
      source: account.resolution === 'builtin_default' ? 'builtin_default' : 'database',
      account_name: account.accountName,
      app_id: appId,
      app_secret: appSecret,
      oauth_scope: oauthScope,
      public_web_base_url: publicWebBaseUrl,
      public_api_base_url: publicApiBaseUrl,
      authorization_domain: this.extractDomain(publicWebBaseUrl),
      callback_url: `${publicApiBaseUrl}/card-recharge/portal/wechat/callback`,
      configured: Boolean(appId && appSecret)
    };
  }

  async saveWechatPortalAuthConfig(dto: WechatPortalAuthConfigPayload): Promise<WechatPortalAuthConfigReadModel> {
    const appId = this.asString(dto.app_id);
    const appSecret = this.asString(dto.app_secret);
    const oauthScope = this.asString(dto.oauth_scope) || 'snsapi_userinfo';
    const publicWebBaseUrl = this.buildPublicWebBaseUrl(dto.public_web_base_url);
    const publicApiBaseUrl = this.buildPublicApiBaseUrl(publicWebBaseUrl, dto.public_api_base_url);

    if (!appId || !appSecret) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: {
          app_id: !appId ? ['app_id is required'] : undefined,
          app_secret: !appSecret ? ['app_secret is required'] : undefined,
        }
      });
    }

    const existing = await this.resolveEffectiveAccount(TENANT_ID, 'wechat');
    const mergedConfig = this.asObject(existing.configJson);
    const mergedPublicAccount = this.asObject(mergedConfig.public_account);
    mergedPublicAccount.app_id = appId;
    mergedPublicAccount.app_secret = appSecret;
    mergedPublicAccount.oauth_scope = oauthScope;
    mergedPublicAccount.authorization_domain_required = true;
    mergedPublicAccount.jsapi_domain_required = true;
    mergedPublicAccount.business_domain_required = true;
    mergedConfig.public_account = mergedPublicAccount;
    mergedConfig.public_web_base_url = publicWebBaseUrl;
    mergedConfig.public_api_base_url = publicApiBaseUrl;
    mergedConfig.portal_public_base_url = publicWebBaseUrl;
    mergedConfig.oauth_scope = oauthScope;

    if (existing.id && existing.resolution === 'system_default') {
      await this.update(existing.id, {
        provider: 'wechat',
        account_code: existing.accountCode,
        account_name: existing.accountName,
        merchant_no: existing.merchantNo,
        app_id: appId,
        account_identity: existing.accountIdentity,
        config_json: mergedConfig,
        remarks: existing.remarks,
        is_default: true,
        status: 'active'
      });
      return this.getWechatPortalAuthConfig();
    }

    const accountName = existing.accountName || '系统默认微信支付账户';
    await this.create({
      provider: 'wechat',
      account_code: WECHAT_PORTAL_AUTH_ACCOUNT_CODE,
      account_name: accountName,
      merchant_no: existing.merchantNo,
      app_id: appId,
      account_identity: existing.accountIdentity,
      config_json: mergedConfig,
      remarks: existing.remarks || '微信公众号扫码授权配置',
      is_default: true,
      status: 'active',
      project_ids: []
    });
    return this.getWechatPortalAuthConfig();
  }
}

@Controller('payment-accounts')
class PaymentAccountController {
  constructor(private readonly service: PaymentAccountService) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
    @Query('provider') provider?: string
  ) {
    return ok(await this.service.list(parsePage(page), parsePageSize(pageSize), provider));
  }

  @Get('wechat/portal-auth-config')
  async getWechatPortalAuthConfig() {
    return ok(await this.service.getWechatPortalAuthConfig());
  }

  @Put('wechat/portal-auth-config')
  async updateWechatPortalAuthConfig(@Body() dto: WechatPortalAuthConfigPayload) {
    return ok(await this.service.saveWechatPortalAuthConfig(dto));
  }

  @Get(':id/certificate')
  async certificate(@Param('id') id: string, @Res({ passthrough: true }) res?: Response) {
    const file = await this.service.downloadCertificate(id);
    res?.setHeader('Content-Type', 'application/x-pkcs12');
    res?.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    return new StreamableFile(fs.createReadStream(file.absolute_path));
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return ok(await this.service.detail(id));
  }

  @Post()
  async create(@Body() dto: PaymentAccountPayload) {
    return ok(await this.service.create(dto));
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: PaymentAccountPayload) {
    return ok(await this.service.update(id, dto));
  }
}

@Module({
  controllers: [PaymentAccountController],
  providers: [PaymentAccountService],
  exports: [PaymentAccountService]
})
export class PaymentAccountModule {}
