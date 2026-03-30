# Phase 1 用户流优化包 v4

状态：`active`
适用范围：`houjinongfuai / lovable / Phase 1`
更新时间：`2026-03-29 14:10`

## 1. 本轮结论

当前最影响体验的主问题，已经不是“页面能不能打开”，而是：

- 动作够不够少
- 状态够不够直白
- 是否还要人工猜下一层系统行为

这轮优化继续坚持 3 个原则：

1. 主工作台优先展示当前对象、当前状态、当前动作
2. 没有真实后台支撑的动作，不放在主页面占位
3. 外部硬件 / 网关链路也按“少跳一次接口”的习惯设计

## 2. 当前最顺的主流

### 2.1 配置人员

主入口：

- [DwgImport.tsx](/D:/Develop/houji/lovable/src/pages/ops/DwgImport.tsx)

当前已顺的点：

- 选范围、传图源、看分析、保存草稿或发布，已经是一条主路径
- 已直接展示发布影响和关系生成依据

### 2.2 调度人员

主入口：

- [AutoScheduling.tsx](/D:/Develop/houji/lovable/src/pages/ops/AutoScheduling.tsx)

当前已顺的点：

- solver 结果、设备脚本、transport 健康度、最近会话观测都在同一页
- `HTTP bridge` 合同可直接看
- 现在又补上了 `serial bridge` 合同和脚本入口，嵌入式对接时不用再到文档里翻

### 2.3 值守 / 运维人员

主入口：

- [DisposalWorkbench.tsx](/D:/Develop/houji/lovable/src/pages/ops/DisposalWorkbench.tsx)

当前已顺的点：

- 高频告警与工单动作已能同页闭环
- 运行观测和审计也更贴近当前焦点事件

### 2.4 外部网关 / 硬件接入方

主入口：

- [device-gateway.controller.ts](/D:/Develop/houji/houjinongfuai/backend/src/modules/device-gateway/device-gateway.controller.ts)
- [device_gateway_serial_bridge.py](/D:/Develop/houji/houjinongfuai/backend/scripts/device_gateway_serial_bridge.py)

当前已顺的点：

- `connect / heartbeat / disconnect` 是正式合同
- `heartbeat` 可直接回带待执行命令
- 串口接入已有现成 bridge 脚本，不用再自己临时写一层

## 3. 本轮新增体验价值

1. 嵌入式联调从“只有合同”推进到“合同 + 可跑脚本”
2. 调度台看到的硬件接入信息，已经和仓库里的真实脚本一致
3. 设备接入方可以先用 `loop://` 做本机回归，再接真实 `COM` 口

## 4. 现在最值得继续优化的点

### P0

1. `solver` 深化成真正优化内核，而不是候选评分器
2. `serial bridge` 往生产级推进，补守护、恢复、异常编排

### P1

1. 处置台继续压成单页深闭环
2. 继续清共享层 / hooks / CRUD 页的 `lint`

## 5. 验收口径

下面这些成立时，才能说“用户体验已经足够丝滑”：

1. 配置人员不需要猜发布会影响什么
2. 调度人员不需要来回跳页确认 transport 和会话状态
3. 外部网关和串口设备不用多打一轮接口拿命令
4. 值守人员大部分高频动作能在一个主工作台完成
