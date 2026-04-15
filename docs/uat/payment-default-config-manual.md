# 支付默认配置与回调接入手册

状态：active  
适用对象：产品、实施、运维、测试、研发  
更新时间：2026-04-08

## 1. 目的

这份手册说明三件事：

- 默认微信/支付宝账户已经内置到系统默认配置中。
- 支付账户页面现在会展示并支持复制支付回调配置。
- 微信、支付宝的支付回调接口已经在后端实现，可用于商户平台配置。

配置来源包：

- `C:/Users/xupengpeng.DESKTOP-NUC7T8L/Desktop/微信和支付宝配置.zip`

## 2. 已落地内容

### 2.1 后端内置默认支付账户

文件：

- `backend/src/modules/payment-account/payment-account.module.ts`

说明：

- 当数据库里没有可用默认账户时，系统会自动回退到这份内置默认配置。
- 页面 `/ops/payment-accounts` 会把内置默认配置一起展示出来。

### 2.2 数据库默认支付账户

文件：

- `backend/sql/migrations/033_seed_default_payment_accounts.sql`

说明：

- 迁移后会把微信、支付宝默认账户写入 `payment_account`。
- 迁移同时会写入回调路径相关字段，供页面展示和后续核对。

### 2.3 微信商户证书

文件：

- `backend/fixtures/payment/wechat-dev-merchant-1393406502.p12`

说明：

- 微信默认账户通过 `merchant.certificate_p12_path` 引用该证书。
- 支付账户页面支持直接下载证书文件。

### 2.4 已实现的回调接口

后端接口：

- 微信支付异步通知：`POST /api/v1/payments/wechat/notify`
- 支付宝异步通知：`POST /api/v1/payments/alipay/notify`
- 支付宝页面回跳：`GET /api/v1/payments/alipay/return`

说明：

- 微信回调用微信支付 v2 XML 格式接收，并按 `api_key_v2` 校验签名。
- 支付宝回调按 RSA2 校验 `sign`，返回平台要求的纯文本 `success` / `failure`。
- 支付成功后，系统会按 `out_trade_no` 找到 `payment_intent` 并完成入账与开机链路。

## 3. 默认配置摘要

### 3.1 微信默认支付账户

- 账户编码：`SYS-WECHAT-DEFAULT`
- 账户名称：`系统默认微信支付账户（杭州东骏开发测试）`
- 公司主体：`杭州东骏科技有限公司`
- 公众号 AppID：`wx9595c7045f48308d`
- 商户号：`1393406502`
- 证书路径：`fixtures/payment/wechat-dev-merchant-1393406502.p12`
- 支付通知路径：`/api/v1/payments/wechat/notify`

页面和商户平台配置说明：

- 页面展示的是“路径”。
- 实际配置到微信商户平台时，请填写“公网域名 + 路径”。
- 例如：`https://你的业务域名/api/v1/payments/wechat/notify`

### 3.2 支付宝默认支付账户

- 账户编码：`SYS-ALIPAY-DEFAULT`
- 账户名称：`系统默认支付宝账户（杭州东骏开发测试）`
- 公司主体：`杭州东骏科技有限公司`
- PID：`2088421319332222`
- AppID：`2021001146600257`
- 签名方式：`RSA2`
- 异步通知路径：`/api/v1/payments/alipay/notify`
- 页面回跳路径：`/api/v1/payments/alipay/return`
- 页面最终跳转地址：`https://mobile.jiumengfood.com`
- 授权回调地址：`https://mobile.jiumengfood.com`

页面和开放平台配置说明：

- “异步通知地址”请填写“公网域名 + `/api/v1/payments/alipay/notify`”。
- “返回地址 / 页面回跳地址”请填写“公网域名 + `/api/v1/payments/alipay/return`”。
- `https://mobile.jiumengfood.com` 是当前默认前端落地页，不是支付宝异步通知接口。

## 4. 页面查看位置

后台页面：

- `/ops/payment-accounts`

页面能力：

- 查看默认微信/支付宝账户
- 查看配置说明
- 复制异步通知地址
- 复制页面回跳地址
- 复制授权回调地址
- 下载微信默认证书

## 5. 第三方平台如何配置

### 5.1 微信商户平台

建议配置项：

1. 支付结果通知地址填写：`公网域名 + /api/v1/payments/wechat/notify`
2. 确认 AppID 与商户号已经完成绑定
3. 确认服务端公网出口已加入 IP 白名单
4. 确认公众号相关域名配置已按原始手册完成

### 5.2 支付宝开放平台

建议配置项：

1. 异步通知地址填写：`公网域名 + /api/v1/payments/alipay/notify`
2. 页面回跳地址填写：`公网域名 + /api/v1/payments/alipay/return`
3. 授权回调地址按原始资料使用：`https://mobile.jiumengfood.com`
4. 校验开放平台公钥、应用公钥、私钥与系统默认配置一致

## 6. 验证步骤

1. 在后端执行数据库迁移：`npm run db:migrate`
2. 打开后台页面：`/ops/payment-accounts`
3. 在微信页签确认能看到“微信支付异步通知”
4. 在支付宝页签确认能看到“支付宝异步通知”“支付宝页面回跳”“支付宝授权回调”
5. 通过商户平台或模拟请求验证：
   - 微信回调返回 XML `SUCCESS`
   - 支付宝回调返回 `success`

## 7. 原始手册归档

已归档文件：

- `docs/uat/payment-manual-source/微信公众配置 20241012.docx`
- `docs/uat/payment-manual-source/公众号微信商户关联 20241012.docx`
- `docs/uat/payment-manual-source/支付宝应用配置.docx`
- `docs/uat/payment-manual-source/README.md`

## 8. 注意事项

- 这批账户、密钥、证书均来自开发测试资料，请不要直接用于生产环境。
- 正式环境建议将支付密钥迁移到环境变量或密钥管理系统，不要长期固化在 migration 中。
- 如果后续调整 AppID、商户号、证书、回调域名，请同时更新：
  - `backend/src/modules/payment-account/payment-account.module.ts`
  - `backend/sql/migrations/033_seed_default_payment_accounts.sql`
  - `docs/uat/payment-default-config-manual.md`
