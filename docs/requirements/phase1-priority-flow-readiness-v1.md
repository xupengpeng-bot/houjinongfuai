# Phase 1 优先主流程就绪度 v1

状态：`active`
适用范围：
- `D:\Develop\houji\houjinongfuai`
- `D:\Develop\houji\lovable`
- `Phase 1`

更新时间：`2026-03-29 17:05`

## 1. 本轮结论

本轮优先盯住的不是“页面总数”，而是这条主业务链能不能顺着跑通：

1. 创建区域
2. 创建项目
3. 创建项目区块
4. 导入 `DWG`
5. 自动生成并保存设备关联关系
6. 模拟设备上线
7. 农户办卡 / 刷卡用电
8. 运行、停机、结算、回看

当前判断：

- `区域 / 项目 / 项目区块 / DWG / 关系 / 设备联调` 这一段已经进入 `可跑` 状态
- `农户办卡 / 刷卡` 这一段仍然没有进入正式实现，只停留在业务规则口径
- 因为最后一段没补上，所以**整条优先主流程当前可用度约为 `60%`**

这意味着：

- 如果按“建区域 -> 建项目 -> 建区块 -> 导图 -> 配关系 -> 设备联调”来验，当前可用度约 `80%`
- 如果按你要求的**完整业务主链**来验，当前仍然不能声称已经全通

## 2. 本轮已修正的主路径断点

本轮已修：

- 配置工作台 `[DwgImport.tsx](/D:/Develop/houji/lovable/src/pages/ops/DwgImport.tsx)`
- 调度工作台 `[AutoScheduling.tsx](/D:/Develop/houji/lovable/src/pages/ops/AutoScheduling.tsx)`
- 管网模型详情 `[PipeNetworkModel.tsx](/D:/Develop/houji/lovable/src/pages/ops/PipeNetworkModel.tsx)`

修正内容：

- 项目下拉不再“看起来像摆设”
- 当用户切到“已有项目但还没有区块”的场景时，页面会明确进入缺区块状态
- 不再给人造成“项目没选上”或“页面没生效”的错觉
- 同类选择器问题已在三张主工作台一起修掉

自动回归已补：

- `D:\Develop\houji\lovable\tests\real-mode-smoke.spec.ts`
- 已覆盖“切到无区块项目时，配置台/调度台要显示明确阻塞状态”

## 3. 按主流程逐步评估

### 3.1 创建区域

入口：

- `[AreaManagement.tsx](/D:/Develop/houji/lovable/src/pages/ops/AreaManagement.tsx)`

当前状态：

- 页面存在
- 基础管理能力已接进后端
- 已纳入主路由和基础烟测

判断：

- `可用`

### 3.2 创建项目

入口：

- `[ProjectManagement.tsx](/D:/Develop/houji/lovable/src/pages/ops/ProjectManagement.tsx)`

当前状态：

- 页面存在
- 基础管理能力已接进后端
- 已纳入主路由和基础烟测

判断：

- `可用`

### 3.3 创建项目区块

入口：

- `[BlockManagement.tsx](/D:/Develop/houji/lovable/src/pages/ops/BlockManagement.tsx)`

当前状态：

- 页面存在
- 配置台 / 调度台 / 管网模型页已经把“无区块”作为显式阻塞状态处理
- 也就是说，区块现在已经被正式视为后续建模和调度的前置条件

判断：

- `可用`
- `是后续 DWG / 模型 / 调度的硬前置`

### 3.4 导入 DWG

入口：

- `[DwgImport.tsx](/D:/Develop/houji/lovable/src/pages/ops/DwgImport.tsx)`

当前状态：

- 已支持上传主图源与 sidecar
- 已支持后端预检、保存草稿、发布版本
- 已支持显示发布影响范围和关系生成依据
- 已支持在没有区块时给出明确阻塞状态

判断：

- `可用`

### 3.5 配置关联关系

入口：

- `[DwgImport.tsx](/D:/Develop/houji/lovable/src/pages/ops/DwgImport.tsx)`
- `[PipeNetworkModel.tsx](/D:/Develop/houji/lovable/src/pages/ops/PipeNetworkModel.tsx)`
- `[DeviceRelations.tsx](/D:/Develop/houji/lovable/src/pages/ops/DeviceRelations.tsx)`

当前状态：

- 配置台保存时已支持自动生成设备联动关系
- 关系页可查询
- 管网详情页可查看当前版本和图元结果

判断：

- `可用`
- 关系配置主逻辑已经转成“后端自动生成 + 前端查询确认”

### 3.6 模拟设备上线

入口：

- `[AutoScheduling.tsx](/D:/Develop/houji/lovable/src/pages/ops/AutoScheduling.tsx)`
- `[device-gateway.service.ts](/D:/Develop/houji/houjinongfuai/backend/src/modules/device-gateway/device-gateway.service.ts)`
- `[device_gateway_serial_bridge.py](/D:/Develop/houji/houjinongfuai/backend/scripts/device_gateway_serial_bridge.py)`

当前状态：

- 已有 `tcp socket`
- 已有 `HTTP bridge`
- 已有仓库内 `serial bridge` 脚本
- 已有命令队列、ACK、NACK、重试、死信、恢复
- 调度台已能直接看到 transport 合同和健康度

判断：

- `后端联调可用`
- `还不是最终生产级`

### 3.7 农户办卡 / 刷卡用电

当前状态：

- `AGENTS.md` 已明确业务口径：
  - `order_channel = CARD | QR`
  - `funding_mode = CARD_HOLD | QR_PREPAID`
- 但当前前后端真正落地的只有：
  - `[Scan.tsx](/D:/Develop/houji/lovable/src/pages/u/Scan.tsx)` 的井位扫码 / 井编码输入
  - `[farmer.ts](/D:/Develop/houji/lovable/src/api/services/farmer.ts)` 的 `start-check -> createSession -> stopSession`

当前缺失：

- 办卡入口
- 卡介质对象模型
- 刷卡鉴权 / 刷卡扣款 / 挂起资金
- 卡交易审计
- 卡与农户、井、订单、会话的正式映射

判断：

- `未完成`
- 这是当前这条优先主流程里最大的真实缺口

### 3.8 运行、停机、结算、回看

入口：

- `[Session.tsx](/D:/Develop/houji/lovable/src/pages/u/Session.tsx)`
- `[History.tsx](/D:/Develop/houji/lovable/src/pages/u/History.tsx)`
- `[MyTodos.tsx](/D:/Develop/houji/lovable/src/pages/m/MyTodos.tsx)`
- `[FieldProcess.tsx](/D:/Develop/houji/lovable/src/pages/m/FieldProcess.tsx)`

当前状态：

- 农户端运行、停机、记录页已可跑
- 移动端待办、工单、现场处理已可跑
- 处置工作台已能把告警、工单、运行观测压进一页

判断：

- `可用`
- 但“农户办卡 / 刷卡”没补上之前，这一段仍然是建立在现有扫码模型之上

## 4. 当前整条链的真实可用度

按你要求的完整业务链来算：

- `创建区域`：`90%`
- `创建项目`：`90%`
- `创建项目区块`：`88%`
- `DWG 导入与发布`：`85%`
- `关系自动生成与查询`：`82%`
- `设备模拟上线与联调`：`78%`
- `农户办卡 / 刷卡用电`：`20%`
- `运行 / 停机 / 结算 / 回看`：`72%`

综合判断：

- **当前优先主流程整体可用度：`60%`**

原因不是前半段没做，而是最后一段的 `CARD` 业务还没有真正落地。

## 5. 按开发规范的优先顺序

接下来这条链必须按下面顺序继续，不要跳：

1. 先补 `CARD` 业务对象和接口合同
2. 再补办卡 / 刷卡 / 资金挂起 / 结算审计
3. 然后把农户端当前扫码链升级成 `CARD | QR` 双通道
4. 最后再把调度求解器和硬件 bridge 继续做深

原因：

- `CARD` 现在是这条优先主流程里唯一的硬断层
- 如果不先补它，后面的“刷卡用电”只是口头需求，不是系统能力

## 6. 当前最该继续开发的内容

最优先：

1. `CARD` 介质模型、办卡、刷卡、资金与订单合同
2. 农户端入口从“纯扫码”升级成“卡 / 码双入口”

第二优先：

1. 求解器继续从候选评分推进到真实优化内核
2. 硬件 bridge 继续往生产级恢复编排推进

## 7. 验收口径

只有下面这些都成立，才能说这条优先主流程真正接近完成：

1. 运维人员能独立完成区域、项目、区块、图源导入、发布
2. 系统能自动生成并保存设备联动关系，且列表可查
3. 模拟设备能按统一合同上线、收命令、回 ACK
4. 农户能通过 `CARD` 或 `QR` 两种入口之一开始用电 / 用水
5. 停机、结算、历史回看与审计链闭环
