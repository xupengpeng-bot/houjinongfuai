# Lovable 指令

## 元信息

- 编号：`2026-04-14-001`
- 日期：`2026-04-14`
- 主题：`投资者移动端 V1 后端契约对齐`
- 前端仓库：`..\lovable-working`
- 来源仓库：`.`
- 状态：`待 Lovable 执行`

## 目标

把当前 `/i` 投资者移动端从本地存储驱动，平滑升级为“可切真实后端接口”的结构，但本轮只做前端接线与兼容，不发明新的投资语义，不伪造真实持仓、认购或分红数据。

## 已冻结后端契约

请先阅读这些文件，再开始改前端：

- [投资者移动端后端补齐包](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/requirements/phase1-investor-mobile-v1.md)
- [API 草案](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/p1/03-api.md)
- [状态机](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/p1/02-state.md)

重点口径：

1. 投资者端只做 `项目披露 + 意向登记 + 资料留痕 + 消息跟进`
2. `converted_offline` 不等于成交，也不等于已创建认购单
3. 不允许重新引入“假持仓、假收益、假年化”

## 约束

1. 不新增投资交易类页面
2. 不新增支付、分红、提现、持仓计算逻辑
3. 前端不自行推导意向状态，只展示后端返回
4. 继续保留 `/i` 现有信息架构：`首页 / 项目 / 消息 / 我的`
5. 若后端接口尚未落地，必须保留 `mock/local fallback` 边界，不能让页面白屏
6. `npm run build` 必须通过

## 必做项

### 1. 新增投资者端 API service 与类型

请在前端仓库补齐一组 investor service，建议文件：

- `src/api/services/investor.ts`
- `src/api/types.ts` 中追加 investor 相关 DTO

建议接口：

```ts
createInvestorContact(payload)
submitProjectInterest(payload)
listProjectInterests(params)
getProjectInterest(id)
appendProjectInterestEvent(id, payload)
logInvestorMaterialAccess(payload)
listInvestorMessages(params)
markInvestorMessageRead(id)
```

真实模式对齐路径：

- `POST /investor/contacts`
- `POST /investor/project-interests`
- `GET /investor/project-interests`
- `GET /investor/project-interests/:id`
- `POST /investor/project-interests/:id/events`
- `POST /investor/material-access`
- `GET /investor/messages`
- `POST /investor/messages/:id/read`

### 2. 重构 `use-investor-hub.ts` 的数据来源分层

当前本地状态能力先不要删，但要拆成两层：

1. `server state`
   - 项目意向列表
   - 消息列表
   - 联系人提交
   - 资料访问留痕
2. `local ui state`
   - 收藏项目
   - 当前筛选条件
   - 临时表单草稿

要求：

- `real` 模式优先调后端
- 接口不可用时，回退到当前本地 mock/fallback
- fallback 仅用于体验兜底，不得回写出假“收益/持仓”

### 3. 对齐页面动作

请核对这些页面/组件：

- `src/pages/i/Home.tsx`
- `src/pages/i/Projects.tsx`
- `src/pages/i/ProjectDetail.tsx`
- `src/pages/i/Messages.tsx`
- `src/pages/i/Profile.tsx`
- `src/components/investor/InvestorIntentDialog.tsx`
- `src/hooks/use-investor-hub.ts`

动作改法：

- 提交意向：先确保存在 `contact_id`，再提交 `project_interest`
- 查看/下载资料：调用 `material-access` 留痕
- 消息已读：优先调用后端，再更新本地已读 UI
- 我的页：展示意向状态时间线，不展示任何“收益金额”

### 4. 状态与文案映射

前端只允许使用以下状态：

- `submitted`
- `contacted`
- `materials_shared`
- `meeting_scheduled`
- `watchlist`
- `converted_offline`
- `closed_lost`
- `archived`

不要再展示或复用这些旧心智：

- `portfolio`
- `yield`
- `annualized_return`
- `dividend`

### 5. 页面防崩要求

所有 investor 页面统一兜底：

```ts
const items = data?.items ?? [];
const total = data?.total ?? items.length;
const timeline = detail?.event_timeline ?? [];
const messages = messageData?.items ?? [];
```

不允许出现：

- `Cannot read properties of undefined (reading 'map')`
- `Cannot read properties of undefined (reading 'length')`
- `Cannot read properties of undefined (reading 'title')`

## 交付要求

完成后请输出：

1. 修改文件清单
2. 已接后端契约的页面清单
3. 仍处于 fallback/mock 的数据点清单
4. `npm run build` 结果
5. 一句提示：请告诉 Codex“Lovable 已完成投资者端契约对齐”

## 验收标准

1. `/i` 页面保持现有信息架构不变
2. 真实模式下可以开始消费后端投资者接口契约
3. 接口未落地时页面仍可运行，不白屏
4. 不出现虚假的持仓、分红、收益展示
