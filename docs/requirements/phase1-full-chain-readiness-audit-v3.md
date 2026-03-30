# Phase 1 全链路就绪度审计 v3

状态：`active`
适用范围：

- `D:\Develop\houji\houjinongfuai`
- `D:\Develop\houji\lovable`
- `Phase 1`

更新时间：`2026-03-29 13:20`

## 1. 审计目标

本审计关注 3 件事：

1. 高效：用户能沿主路径完成配置、调度、处置，而不是自己猜页面顺序。
2. 稳定：构建、测试、关键链路不会被小改动轻易打断。
3. 准确：调度、设备、工单、告警、结算都以后端真实状态为准。

## 2. 当前结论

系统已经进入“主链可运行”阶段，但还没到“生产级顺滑运行”的最终态。

- 主链可运行度：`80% - 85%`
- 研发稳定度：`75%`
- 整体就绪度：`70%`

## 3. 已稳住的部分

### 3.1 质量闸门

当前通过：

- `backend npm run build`
- `backend npm run test:unit`
- `backend solver contract e2e`
- `backend device-gateway recovery e2e`
- `frontend npm run build`
- `frontend npm run test:smoke`

当前未通过：

- `frontend npm run lint`
  - 当前结果：`116 errors / 17 warnings`

### 3.2 三张主工作台

当前主台已经形成：

- 配置台：`/ops/dwg-import`
- 调度台：`/ops/auto-scheduling`
- 处置台：`/ops/disposal`

本轮新增确认：

1. Dashboard 已经成为正式首页，而不是说明页。
2. 告警中心已经变成“队列 + 当前告警 + 直接动作”的结构。
3. 运行监控已经能同页查看会话和观测数据。
4. 工单中心已经能同页完成建单、派单、接单、完结。

### 3.3 solver 当前成熟度

当前 solver 已具备：

- 多候选方案
- 目标偏好
- 方案评分
- 风险等级
- 解释文本

当前阶段应定义为：

`确定性编排预览 -> 候选方案与评分`

仍未达到：

- 真正多目标优化
- 严格约束求解
- 资源冲突深度建模
- 成本 / 时效 / 安全联合权衡

### 3.4 device-gateway / transport 当前成熟度

当前后端已具备：

1. 统一设备命令注册表
2. 设备按 `IMEI` 拉取待执行命令
3. `HTTP ingest` 和 `tcp-json-v1` socket 双入口
4. `ACK / NACK / retry_pending / dead_letter` 语义
5. retry backoff、死信回收、连接健康、离线清扫
6. 设备离线自动告警、自动建单、自动派单、自动收口
7. 心跳恢复和 TCP 重连后自动重激活 `retry_pending`

当前阶段应定义为：

`后端联调 ready`

仍未达到：

- 串口 bridge
- 外部网关 bridge
- 自动断连恢复编排
- 更完整的重试 / backoff / 死信恢复策略
- 真实硬件生产 ready

## 4. 当前关键缺口

### P0. solver 还不是真正优化内核

位置：

- `D:\Develop\houji\houjinongfuai\backend\src\modules\solver\solver.service.ts`

当前问题：

1. 现在能给候选方案和评分，但还不是最终优化器。
2. 复杂约束、资源冲突、安全优先级还没深度进入求解。

### P0. 硬件 bridge 还没到生产级

位置：

- `D:\Develop\houji\houjinongfuai\backend\src\modules\device-gateway\device-gateway.service.ts`
- `D:\Develop\houji\houjinongfuai\backend\src\modules\device-gateway\tcp-json-v1.server.ts`

当前问题：

1. 串口 bridge 还没做。
2. 外部网关 bridge 还没做。
3. 自动断连恢复编排还没做透。
4. 生产级恢复策略还缺。

### P0. 处置主线还没完全压平

位置：

- `D:\Develop\houji\lovable\src\pages\ops\DisposalWorkbench.tsx`
- `D:\Develop\houji\lovable\src\pages\ops\AlertCenter.tsx`
- `D:\Develop\houji\lovable\src\pages\ops\RunMonitor.tsx`
- `D:\Develop\houji\lovable\src\pages\ops\WorkOrders.tsx`

当前问题：

1. 处置台虽然已经是主入口，但复杂事件仍然需要切到其他页对照。
2. 还没有完全收成“单页闭环”的值守操作流。

### P1. 农户端与移动端结果态还可继续收

当前问题：

1. 停止后的业务解释还能更直接。
2. 附件和拍照流程还没做实。
3. 术语统一还可继续收一轮。

### P1. 前端工程闸门未闭环

当前问题：

1. `frontend lint` 仍然是红的。
2. 主要错误仍集中在 `any`、空接口、旧式 `require`、部分 hook 依赖。

## 5. 本轮新增确认

1. Dashboard、告警中心、运行监控、工单中心已经从乱码 / 演示式结构收成正式中文操作页。
2. 通用状态组件文案已经统一成正式中文。
3. 构建和烟测在这轮 UI 重构后仍然稳定通过。

## 6. 下一步优先顺序

### 第一优先级

1. 继续把处置主线压成真正的一条连续工作流。
2. 继续往真实硬件 bridge / 自动断连恢复推进。
3. 继续把 solver 推到真实优化内核。

### 第二优先级

1. 再收一轮农户端和移动端结果态。
2. 统一前后端接口合同风格。
3. 清前端 `lint`。

## 7. 验收标准

只有下面这些同时成立，才算真正接近“全流程高效稳定准确跑起来”：

1. 配置人员能独立完成图源上传、分析、草稿保存、发布。
2. 调度人员能直接看懂候选方案、风险、transport 健康和设备脚本。
3. 值守人员能在处置台完成绝大多数告警和工单闭环。
4. 设备离线、重连、重试、死信、恢复都能自动收口并被回归测试保护。
5. 农户端和移动端的开始、停止、结果确认都顺畅。
6. `backend build`、`backend unit test`、关键 `e2e`、`frontend build`、`frontend smoke`、`frontend lint` 全绿。

## 8. 2026-03-29 高频页与验证更新

本轮新增确认：

1. 配置台、调度台、处置台都已经从“说明页”继续收成“操作页”。
2. 农户端首页和移动端待办首页已经改成更直接的结果态入口。
3. `frontend smoke` 已同步到当前真实 DWG 上传主路径，不再盯旧 placeholder。

本轮验证结果：

1. `frontend build`：通过
2. `frontend smoke`：通过
3. `frontend lint`：失败，当前为 `116 errors / 17 warnings`

当前就绪度判断不变，但把结论收得更实：

1. 主链可运行度：约 `80%`
2. 整体就绪度：约 `65%-70%`
3. 最高频页面已经更接近正式系统，但工程闸门和硬件桥接仍然没有闭环

本轮更新后仍然最关键的缺口：

1. `solver.service.ts` 还不是真正优化内核。
2. 串口 bridge、外部网关 bridge、自动断连恢复编排还没做完。
3. 处置主线虽然更完整了，但复杂事件仍未完全压平。
4. `frontend lint` 仍然是工程稳定性的明确阻塞项。

## 9. 2026-03-29 结果态与共用状态更新

本轮新增确认：

1. 农户端当前会话和历史记录已经进入正式结果态，不再像 demo 页。
2. 移动端现场处理页已经拿掉无后台支撑的占位动作，避免误导用户。
3. 共用状态组件已经统一成正式中文，能直接改善全局体验。

本轮验证结果：

1. `frontend build`：通过
2. `frontend smoke`：通过
3. `frontend lint`：失败，当前仍为 `116 errors / 17 warnings`

本轮更新后最值得继续压的体验点：

1. 现场处理附件 / 拍照如果要回归，就必须后端真接通后再上页面。
2. 农户端停止后的异常结果态还需要继续设计和落地。
3. `lint` 仍然是前端工程稳定性的清晰阻塞项。

## 10. 2026-03-29 工作台主路径复核

这一轮复核重点不再是“页面能不能打开”，而是“主工作台是否让人少跳页、少判断、少猜结果”。

本轮确认新增：

1. 配置台已经具备主路径内的发布影响可见性。
   - 文件：`D:\Develop\houji\lovable\src\pages\ops\DwgImport.tsx`
   - 现在主视图可直接看到发布范围、当前生效版本、发布后模型规模、自动关系刷新范围、关系生成依据。
2. 调度台已经具备主路径内的最近会话观测。
   - 文件：`D:\Develop\houji\lovable\src\pages\ops\AutoScheduling.tsx`
   - 现在最近调度和会话观测已经同页，能直接看到会话状态、井位、订单结算、最近回执、状态推进。
3. 本轮没有新增前端工程债。
   - `build` 和 `smoke` 持续通过。
   - `lint` 回到真实基线：`116 errors / 17 warnings`。

本轮验证结果：

1. `frontend build`：通过
2. `frontend smoke`：通过
3. `frontend lint`：失败，但没有因为本轮新增告警；当前仍是 `116 errors / 17 warnings`

对全链路就绪度的影响：

1. 配置主线现在更接近“上传 -> 分析 -> 判断影响 -> 保存 / 发布”的正式工作流。
2. 调度主线现在更接近“看调度 -> 看会话观测 -> 判断是否异常”的正式工作流。
3. 两条主工作台都减少了一次高频跳页，因此整体顺畅度有明显提升。

当前仍未收口的关键缺口：

1. `D:\Develop\houji\houjinongfuai\backend\src\modules\solver\solver.service.ts`
   - 仍是真实编排和候选评分，不是最终优化内核。
2. `D:\Develop\houji\houjinongfuai\backend\src\modules\device-gateway\device-gateway.service.ts`
   - 仍未完成串口 bridge、外部网关 bridge、自动断连恢复编排。
3. `D:\Develop\houji\lovable\src\pages\ops\DisposalWorkbench.tsx`
   - 仍需继续压平复杂处置动作，减少与监控页、审计页来回切换。
4. 前端工程闸门仍未关闭：
   - `116 errors / 17 warnings`

更新后的阶段判断：

1. 主链可运行度：约 `80%`
2. 整体就绪度：约 `65%-70%`
3. 当前最值钱的继续投入方向仍然是：
   - 真实硬件 bridge / 自动断连恢复
   - solver 深化
   - 处置台继续压平
