# Phase 1 全链路就绪度审计 v5

状态：`active`
适用范围：
- `D:\Develop\houji\houjinongfuai`
- `D:\Develop\houji\lovable`
- `Phase 1`

更新时间：`2026-03-29 14:10`

## 1. 当前结论

当前系统已经进入“主链可跑、硬件联调可继续推进、串口 bridge 已有正式落地点”的阶段。

- 主链可运行度：`82% - 86%`
- 研发稳定度：`79%`
- 整体就绪度：`74%`

这轮最关键的新增不是页面，而是硬件交接链：

1. 后端 `device-gateway` 合同已经正式声明 `serial_bridge`
2. 仓库内已经有可执行的 Python 串口 bridge 脚本
3. 串口脚本已进入 e2e 回归，不再只是“文档里说以后要做”

## 2. 当前已稳住的部分

### 2.1 构建与验证

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

### 2.2 三张主工作台

当前已经形成三张正式主工作台：

- 配置台：`/ops/dwg-import`
- 调度台：`/ops/auto-scheduling`
- 处置台：`/ops/disposal`

它们现在都不是说明页，而是能直接承接真实操作的主入口。

### 2.3 设备联调链

当前后端已经具备：

- 统一设备命令注册表
- `ACK / NACK / retry_pending / dead_letter` 语义
- `tcp-json-v1` socket 通道
- `HTTP bridge connect / heartbeat / disconnect` sidecar 通道
- 设备离线自动告警、自动建单、自动派单、自动收口
- 平台侧在连接恢复时可重新激活 `retry_pending`
- `bridge/heartbeat` 在 sidecar bridge 模式下仅在显式 `dispatch_pending_commands=true` 时可回带平台待派发命令，但这不代表 MCU 设备侧存在命令队列
- Python 串口 bridge 脚本：
  - `backend/scripts/device_gateway_serial_bridge.py`
  - 支持 `COM3` 或 `loop://`
  - 支持 `connect -> heartbeat -> ingest -> disconnect`

当前阶段可定义为：

`后端联调 ready，串口 bridge 已有正式落点，生产级 bridge 编排未完`

## 3. 这轮新增确认

### 3.1 串口 bridge 已正式落地

新增文件：

- [device_gateway_serial_bridge.py](/D:/Develop/houji/houjinongfuai/backend/scripts/device_gateway_serial_bridge.py)

当前能力：

- 连接后端 `HTTP bridge`
- 周期性发 `heartbeat`
- 把串口收到的 JSON 行转成后端 runtime event
- 可把后端 `pending_commands` 回写到串口 sidecar，但该能力仅限 bridge 模式且应显式开启
- 支持 `--once` 便于联调和快速自检

### 3.2 串口 bridge 已进入合同与回归

后端合同：

- [network-workbench.service.ts](/D:/Develop/houji/houjinongfuai/backend/src/modules/network-workbench/network-workbench.service.ts)

前端调度台展示：

- [AutoScheduling.tsx](/D:/Develop/houji/lovable/src/pages/ops/AutoScheduling.tsx)
- [types.ts](/D:/Develop/houji/lovable/src/api/types.ts)

回归保护：

- [device-gateway-http-bridge.e2e-spec.ts](/D:/Develop/houji/houjinongfuai/backend/test/e2e/device-gateway-http-bridge.e2e-spec.ts)

## 4. 当前最关键缺口

### P0. 求解器还不是真正优化内核

位置：

- [solver.service.ts](/D:/Develop/houji/houjinongfuai/backend/src/modules/solver/solver.service.ts)

当前状态：

- 已有候选方案
- 已有评分和风险解释
- 还不是最终优化器

### P0. 硬件 bridge 还没到生产级

位置：

- [device-gateway.service.ts](/D:/Develop/houji/houjinongfuai/backend/src/modules/device-gateway/device-gateway.service.ts)
- [tcp-json-v1.server.ts](/D:/Develop/houji/houjinongfuai/backend/src/modules/device-gateway/tcp-json-v1.server.ts)
- [device_gateway_serial_bridge.py](/D:/Develop/houji/houjinongfuai/backend/scripts/device_gateway_serial_bridge.py)

当前状态：

- `tcp socket + http bridge + serial bridge script` 已可联调
- 还没到真正生产级

还缺：

- 串口异常恢复策略更完整
- 外部网关 bridge 更完整的恢复编排
- 更强的自动 backoff / 死信处理 / 守护进程能力

### P0. 处置台还没完全压成单页闭环

位置：

- [DisposalWorkbench.tsx](/D:/Develop/houji/lovable/src/pages/ops/DisposalWorkbench.tsx)

当前状态：

- 高频动作已可同页完成
- 复杂处置仍有少量跳页

### P1. 前端 lint 仍是最大的工程闸门

当前状态：

- 已压到 `96 errors / 17 warnings`
- 但闸门还没完全关闭

## 5. 下一步优先顺序

第一优先级：

1. 继续把 `solver` 从候选评分推进到更真实的优化内核
2. 继续把硬件 bridge 往生产级推进，重点补守护、恢复和 backoff

第二优先级：

1. 继续把处置台复杂动作压平
2. 按共享层 -> hooks -> 页面层顺序继续清 `lint`

## 6. 验收口径

只有下面这些一起成立，才算真正接近“全流程高效稳定准确跑起来”：

1. 配置人员能独立完成图源导入、分析、发布
2. 调度人员能直接看懂方案、风险、transport 健康度和设备脚本
3. 值守人员大部分告警与工单能在处置台闭环
4. 外部网关和串口 bridge 都能按统一合同直接对接后端
5. `backend build / unit / e2e` 与 `frontend build / smoke / lint` 全绿
