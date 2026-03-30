# Phase 1 用户流优化包 v3

状态：`active`
适用范围：`houjinongfuai / lovable / Phase 1`
更新时间：`2026-03-29 13:40`

## 1. 本轮结论

当前最影响体验的主流已经不是“页面能不能打开”，而是：
- 动作是不是足够少
- 页面是不是足够直白
- 用户是不是还要自己猜下一步

这轮优化继续确认 3 个原则：
1. 主工作台优先展示当前对象、当前状态、当前动作。
2. 没有真后端支撑的动作，不要放在主页面占位。
3. 外部硬件 / 网关调用链也要按“少跳一次接口”的习惯设计。

## 2. 当前最顺的主流

### 2.1 配置人员

主入口：
- [DwgImport.tsx](D:\Develop\houji\lovable\src\pages\ops\DwgImport.tsx)

当前已顺的点：
- 选范围、传图源、看分析、保存草稿或发布已经是一条主路径
- 发布影响和关系生成依据已直接进入主视图

还值得继续压的点：
- 发布影响可以继续再压成更少判断

### 2.2 调度人员

主入口：
- [AutoScheduling.tsx](D:\Develop\houji\lovable\src\pages\ops\AutoScheduling.tsx)

当前已顺的点：
- solver 结果、设备脚本、transport 健康度、最近会话观测已在主页上
- bridge 合同已直接可见
- 现在又补上了：`bridge/heartbeat` 默认可直接回带命令，外部网关少打一轮接口

还值得继续压的点：
- solver 还不是最终优化内核

### 2.3 值守 / 运维人员

主入口：
- [DisposalWorkbench.tsx](D:\Develop\houji\lovable\src\pages\ops\DisposalWorkbench.tsx)

当前已顺的点：
- 同页能做焦点事件处理、工单推进、观测查看、审计复核

还值得继续压的点：
- 更复杂处置动作仍有少量跳页

### 2.4 外部网关 / 硬件接入方

主入口：
- [device-gateway.controller.ts](D:\Develop\houji\houjinongfuai\backend\src\modules\device-gateway\device-gateway.controller.ts)
- [network-workbench.service.ts](D:\Develop\houji\houjinongfuai\backend\src\modules\network-workbench\network-workbench.service.ts)

当前已顺的点：
- `connect / heartbeat / disconnect` 已是正式合同
- `heartbeat` 可直接带回待执行命令
- 恢复结果已统一合并，不用调用方自己拼装

这条链的体验提升很明显：
- 原来：`heartbeat -> pending-commands`
- 现在：`heartbeat -> 直接拿命令`

## 3. 本轮新增体验价值

1. 硬件联调从“两跳取命令”变成“一跳取命令”。
2. 调度台展示的 transport 合同和后端实际行为一致了。
3. 前端共享层工程债继续往下压，后面做业务页的噪音会少很多。

## 4. 现在最值得继续优化的点

### P0

1. solver 深化成真实优化内核，而不是候选评分器。
2. 硬件 bridge 往生产级推进，尤其串口 bridge 和更强恢复编排。

### P1

1. 处置台继续压平成单页闭环。
2. 继续清共享 hooks 和后台 CRUD 页的 `lint` 债。

## 5. 验收口径

下面这些成立时，才能说“用户体验已经足够丝滑”：

1. 配置人员不需要猜发布影响。
2. 调度人员不需要来回跳监控页确认会话状态。
3. 外部网关不需要多打一轮接口拿命令。
4. 值守人员大部分处置动作能在单页完成。
