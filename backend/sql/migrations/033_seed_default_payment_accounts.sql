begin;

update payment_account
set is_default = false,
    updated_at = now()
where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and provider in ('wechat', 'alipay')
  and is_default = true;

insert into payment_account (
  tenant_id,
  provider,
  account_code,
  account_name,
  merchant_no,
  app_id,
  account_identity,
  config_json,
  remarks,
  is_default,
  status
)
select
  '00000000-0000-0000-0000-000000000001'::uuid,
  'wechat',
  'SYS-WECHAT-DEFAULT',
  '系统默认微信支付账户（杭州东骏开发测试）',
  '1393406502',
  'wx9595c7045f48308d',
  '杭州东骏科技有限公司',
  $json$
  {
    "usage_scope": "dev_test_only",
    "source_bundle": "微信和支付宝配置.zip",
    "company_name": "杭州东骏科技有限公司",
    "notify_url": "/api/v1/payments/wechat/notify",
    "notify_url_note": "请使用可公网访问的正式域名拼接该路径后配置到微信商户平台支付结果通知地址",
    "public_account": {
      "app_id": "wx9595c7045f48308d",
      "app_secret": "ae16103983a3d6892e0efa8518d26ee1",
      "authorization_domain_required": true,
      "jsapi_domain_required": true,
      "business_domain_required": true
    },
    "merchant": {
      "mch_id": "1393406502",
      "api_key_v2": "123qwsdertfgnhjioklpdm839jedk7h2",
      "api_key_v3": "kjjdlfdioiiurue029dsafiiowfiwfiw",
      "certificate_p12_path": "fixtures/payment/wechat-dev-merchant-1393406502.p12"
    },
    "manual_reference": {
      "merchant_appid_relation_required": true,
      "ip_whitelist_required": true
    }
  }
  $json$::jsonb,
  '来源：2026-04-08 桌面配置包；仅开发测试环境使用',
  true,
  'active'
where exists (
  select 1
  from tenant
  where id = '00000000-0000-0000-0000-000000000001'::uuid
)
on conflict (tenant_id, provider, account_code)
do update set
  account_name = excluded.account_name,
  merchant_no = excluded.merchant_no,
  app_id = excluded.app_id,
  account_identity = excluded.account_identity,
  config_json = excluded.config_json,
  remarks = excluded.remarks,
  is_default = true,
  status = 'active',
  updated_at = now();

insert into payment_account (
  tenant_id,
  provider,
  account_code,
  account_name,
  merchant_no,
  app_id,
  account_identity,
  config_json,
  remarks,
  is_default,
  status
)
select
  '00000000-0000-0000-0000-000000000001'::uuid,
  'alipay',
  'SYS-ALIPAY-DEFAULT',
  '系统默认支付宝账户（杭州东骏开发测试）',
  '2088421319332222',
  '2021001146600257',
  '杭州东骏科技有限公司',
  $json$
  {
    "usage_scope": "dev_test_only",
    "source_bundle": "微信和支付宝配置.zip",
    "company_name": "杭州东骏科技有限公司",
    "sign_type": "RSA2",
    "pid": "2088421319332222",
    "app_id": "2021001146600257",
    "notify_url": "/api/v1/payments/alipay/notify",
    "return_url": "/api/v1/payments/alipay/return",
    "return_redirect_url": "https://mobile.jiumengfood.com",
    "alipay_public_key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAi5URXf3QYiFwo266LU4WF1iBLLkjTWpBH7+UTFJcleP1/DxO58Xnny3MWsDOMLpLsG8OuCmxRfeJrY3ulLqbYcaM7dX5CRUUY1lF6XIyvsnP0lMuYDt5M2PHVhSRSiNpphBlYfLE/aB2QD1Gu9OpPqdjQ0k8GeLs7yjK3L5re0lXJnTppTgX77MGy/SAgR+8cvuRJyWh8fHzJc9S2Fjpnme6b/o5DKcHqfnd5E3GFCRejESb2mHMzx9BoOhVew4EiQXvWXKb0/wByKXwM7k9yQ+zDl8kjdBC+pmbYf2Xr0RcZtU2IexmDtZkhDXSS0uXlOMt8EqqhgieYn1hlg8pNwIDAQAB",
    "merchant_private_key": "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCJXaNbnvSWvKcPw47TNlj+WTqEYg7S7DuXMcSai5cACEfU+WR7mfEVyeXzAgy7UZdORg51aBJWLErStD5ViOn9nFBnUB8VUJnjDON/wcNveehk8wmGBt0NIcNv9sP5isZxNCwQ1NKTp4ymOZ810+en49nyxwmtLqmoZt1irz7aeDGqPLj1oby/fRX2L5S28z5po1CY5EITDIXDILvnvuD/EB/Ei8KvxIHAPrGYpsMSCb7VBXrNtVyL092IrUkbvldOdOjUFbOC7M/mex/iJncKWYR9WDebzGG5tgpDagS49ql6jJCn2DZhV33F/kvxaRo34HNlzbRhOdft9U9r/HejAgMBAAECggEARh+3NR6AXjMQVcvPLaOg6rdCWDJ2vtY51YViiEKaYznW8bIeybpciHL5IIT7WuTcCOlamDT4p2UVDVtWNvQd/4m8wgD03Ty4UmBSAvY3fsENEfu/8NuwHPQPgSjIAqwFgeTQWgdLOHVgJ7tiu2fh6qM2r+lL10zq7z0T5zzvKTdTK6XLw4qvCE+CEAzYdmfzXvxXWEGqcmvyocb8xA8PNm6sed9eoJTwX+PzbmquoPgeFpq/KQlOcz34CUmzR/aCH8WiuaDa2APquWIWp6uFiEDlb/e4vgNAi4N6CIeWMTeAfK3wXjpTMwq0Saz2Gf6FRpgYanLWBrm5MXd/vTDFAQKBgQC84JL6sEFxC5p4y8Bjdtru2oKMPZzXbFGy1J53dA/g4qFlQXg6croK/6fuztcg4sIeW/cV/jpJMOBU6CGNPJFsrpZnlQ6tT9sxHZICpc7foSkmB8l7ttd89bH866agotetCBsaEHG5TTKOsisuIEs3J2UFZpC7ek3biqTdKVzzWwKBgQC6LrifeEHp287yIptyW6NwMdbFbFmjTgq7UfhsR4S8u5tkn6JXomKbE693WomBCiHNqLxxwlDnD+3wJZ0FznM8e1Nn6K/xUZAw/HpQtC8WtWnOWmZjVX/8CWcOG6NTAFijKfod+1fol4bxnW0DEvLMIYUb8ydrykZ2PffMVRsnWQKBgFYsrEKeWi1GmwLUC4IV/0uM/JUZo06SSDAsW+SqWnhDTlnRZhZcs89C147YZkTF0MVjNjedl2A/YYq7ols7MCqC+XJnCpw+XAZrtGtq1RkpAYotcVr1kBmeS8fWiF6wDXEPyrW4nPprY07BsXvJFigi3C97nTs8UPuCpTeWoKcTAoGBALi46EaYa1Va2B2XRoGU+Di1yjBAi0MiiDVIY+ESqFkVDl0soUavf4P7aQlTU8AqzFUfSDDaKajHPj0ZJI0BQ4ZLmforfH1CfnyL09PEoj+2qI6rVJDT4NKwhYYS193fJxJj8JvUp2jHBoUsu17kau8rhsSvYHpqy7Q/UV9zRSipAoGBAJSJ6XBo8CsILEJw8Bwr80yQYz3F4YJEINJf3XFSWd6WE2sHmhPaD8Y7huy4xUVNuil3MK3zmgSRfpJd+bMRIPrVwj+qlbpuA0GUTDeLtbCkxkOQ5pQ9gQIw9yG+WckWeahk+fSSqDtYsTwZcAGAS09zx/hnnb6rnSkFVrEPfqjo",
    "merchant_public_key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiV2jW570lrynD8OO0zZY/lk6hGIO0uw7lzHEmouXAAhH1Plke5nxFcnl8wIMu1GXTkYOdWgSVixK0rQ+VYjp/ZxQZ1AfFVCZ4wzjf8HDb3noZPMJhgbdDSHDb/bD+YrGcTQsENTSk6eMpjmfNdPnp+PZ8scJrS6pqGbdYq8+2ngxqjy49aG8v30V9i+UtvM+aaNQmORCEwyFwyC7577g/xAfxIvCr8SBwD6xmKbDEgm+1QV6zbVci9PdiK1JG75XTnTo1BWzguzP5nsf4iZ3ClmEfVg3m8xhubYKQ2oEuPapeoyQp9g2YVd9xf5L8WkaN+BzZc20YTnX7fVPa/x3owIDAQAB",
    "auth_callback_url": "https://mobile.jiumengfood.com",
    "face_to_face_pay_required": true,
    "openid_mode_required": false
  }
  $json$::jsonb,
  '来源：2026-04-08 桌面配置包；仅开发测试环境使用',
  true,
  'active'
where exists (
  select 1
  from tenant
  where id = '00000000-0000-0000-0000-000000000001'::uuid
)
on conflict (tenant_id, provider, account_code)
do update set
  account_name = excluded.account_name,
  merchant_no = excluded.merchant_no,
  app_id = excluded.app_id,
  account_identity = excluded.account_identity,
  config_json = excluded.config_json,
  remarks = excluded.remarks,
  is_default = true,
  status = 'active',
  updated_at = now();

commit;
