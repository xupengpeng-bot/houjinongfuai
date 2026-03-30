# Phase 1 全链路就绪度审计 v4

状态：`active`
适用范围：
- `D:\Develop\houji\houjinongfuai`
- `D:\Develop\houji\lovable`
- `Phase 1`

更新时间：`2026-03-29 13:40`

## 1. 目标

本审计只看三件事：
1. 全流程是否能高效跑起来。
2. 关键链路是否稳定、可回归。
3. 真相是否以后端和真实设备合同为准，而不是前端 demo。

## 2. 当前结论

当前系统已经进入“主链可运行、硬件联调可继续推进”的阶段。

- 主链可运行度：`80% - 85%`
- 研发稳定度：`78%`
- 整体就绪度：`72%`

这次比上一轮更实的点有两个：
- `HTTP bridge` 已经成为真实可验证合同，不再只是“后端支持一下”。
- 前端工程闸门继续往下压，`lint` 从 `116 errors / 17 warnings` 降到 `96 errors / 17 warnings`。

## 3. 当前已稳住的部分

### 3.1 构建与验证

当前通过：
- `backend npm run build`
- `backend npm run test:unit`
- `backend e2e device-gateway-http-bridge`
- `backend e2e device-gateway-recovery`
- `frontend npm run build`
- `frontend npm run test:smoke`

当前未通过：
- `frontend npm run lint`
  - 当前结果：`96 errors / 17 warnings`

### 3.2 三张主工作台

当前已经形成三张正式主工作台：
- 配置台：`/ops/dwg-import`
- 调度台：`/ops/auto-scheduling`
- 处置台：`/ops/disposal`

它们现在都不是说明页，而是能直接操作的主入口。

### 3.3 设备联调链

当前后端已经具备：
- 统一设备命令注册表
- `ACK / NACK / retry_pending / dead_letter` 语义
- `tcp-json-v1` socket 通道
- `HTTP bridge connect / heartbeat / disconnect`
- 设备离线自动告警、自动建单、自动派单、自动收口
- 心跳恢复或重连恢复时自动重激活 `retry_pending`
- `bridge/heartbeat` 直接回带待执行命令

当前阶段应定义为：
`后端联调 ready，硬件生产链未完结`

## 4. 这轮新增确认

### 4.1 HTTP bridge 已正式成合同

当前后端正式支持：
- `POST /api/v1/ops/device-gateway/bridge/connect`
- `POST /api/v1/ops/device-gateway/bridge/heartbeat`
- `POST /api/v1/ops/device-gateway/bridge/disconnect`

并且：
- `bridge/heartbeat` 会合并连接恢复与事件恢复结果
- `bridge/heartbeat` 默认可直接回带待执行命令
- 调度台已同步展示 bridge 能力和默认行为

### 4.2 工程闸门继续下降

这一轮已清掉一批共享层债务，主要在：
- API 客户端
- API 配置入口
- `region / region-library / mobile / runtime` 服务层
- 登录页
- 通用 UI 组件
- Tailwind 配置

结果：
- `frontend lint` 从 `116 errors / 17 warnings`
- 压到 `96 errors / 17 warnings`

并且：
- `build` 仍绿
- `smoke` 仍绿

## 5. 当前最关键缺口

### P0. 求解器还不是真正优化内核

位置：
- [solver.service.ts](D:\Develop\houji\houjinongfuai\backend\src\modules\solver\solver.service.ts)

当前状态：
- 已具备候选方案、评分、风险解释
- 还不是最终优化器

还缺：
- 更真实的资源冲突约束
- 更明确的多目标优化
- 更强的安全、成本、效率联合权衡

### P0. 硬件 bridge 还没到生产级

位置：
- [device-gateway.service.ts](D:\Develop\houji\houjinongfuai\backend\src\modules\device-gateway\device-gateway.service.ts)
- [tcp-json-v1.server.ts](D:\Develop\houji\houjinongfuai\backend\src\modules\device-gateway\tcp-json-v1.server.ts)

当前状态：
- `tcp socket + http bridge` 已可联调
- 还没到真实生产级

还缺：
- 串口 bridge
- 外部网关更完整的恢复编排
- 更强的断连恢复与重试策略

### P0. 处置台还没完全压成单页闭环

位置：
- [DisposalWorkbench.tsx](D:\Develop\houji\lovable\src\pages\ops\DisposalWorkbench.tsx)

当前状态：
- 已能处理一批高频动作
- 更深层处置仍有跳页

还缺：
- 更复杂事件的单页闭环
- 更少依赖监控页和审计页来回切换

### P1. 前端 lint 仍是最大工程债

当前状态：
- 已下降到 `96 errors / 17 warnings`
- 但工程闸门仍未关闭

剩余高频集中区：
- `cockpit.ts`
- `data-scope.ts`
- `network-workbench.ts`
- `hooks/use-api-queries.ts`
- 一批后台 CRUD 页

## 6. 当前流程顺畅度判断

### 配置链

当前路径：
`选项目区块 -> 上传图源 -> 分析 -> 保存草稿/发布`

判断：
- 已经顺
- 但发布影响和关系生成依据还能继续更直观

### 调度链

当前路径：
`看当前状态 -> 看 solver 结果 -> 看设备脚本 -> 看 transport 健康度 -> 看最近会话观测`

判断：
- 已经能顺着跑
- 但 solver 还不是最终内核

### 处置链

当前路径：
`看焦点事件 -> 转工单/派单/推进 -> 看观测 -> 看审计`

判断：
- 已经可用
- 但复杂处置还没完全压平

### 设备联调链

当前路径：
`后端排队 -> bridge heartbeat -> 回带命令 -> 设备执行 -> ACK/NACK -> 恢复/重试/死信`

判断：
- 已经进入真联调阶段
- 但还没到生产级稳定闭环

## 7. 下一步优先顺序

第一优先级：
1. 继续把硬件 bridge / 恢复编排往生产级推进。
2. 继续把 solver 从候选评分推进到更真实的优化内核。

第二优先级：
1. 继续压平处置台复杂动作。
2. 继续按共享层 -> hooks -> 页面层的顺序清 `lint`。

## 8. 验收口径

只有下面这些一起成立，才能接近“全流程高效稳定准确跑起来”：

1. 配置人员能独立完成图源导入、分析、发布。
2. 调度人员能直接看懂方案、风险、transport 健康度和设备脚本。
3. 值守人员大部分告警与工单能在处置台闭环。
4. 外部 bridge 和设备侧能按统一合同直接对接后端。
5. `backend build / unit / e2e` 与 `frontend build / smoke / lint` 全绿。
