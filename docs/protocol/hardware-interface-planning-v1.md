# 硬件接口规划 v1

## 1. 背景

当前项目的设备接入主线已经冻结为 `tcp-json-v1`，并已具备基础的设备网关、命令队列、心跳与 ACK/NACK 处理能力，相关基线见：

- [device-protocol-v1.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/device-protocol-v1.md)
- [HW-0001-通信与供电接口基线.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/codex-dispatch/hardwarecomhis/HW-0001-通信与供电接口基线.md)
- [EMB-0001-tcp-json-v1固件接入基线.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/codex-dispatch/embeddedcomhis/EMB-0001-tcp-json-v1固件接入基线.md)

这次额外参考了旧平台 `D:\Develop\hardware\3.0jijingoldplatform` 中的通讯实现，重点看了：

- 设备系统枚举 [EnumEquipSystem.java](D:/Develop/hardware/3.0jijingoldplatform/demeter/demeter-all/branch/poseidon-core/src/main/java/com/dongjun/core/enums/EnumEquipSystem.java)
- 同步指令超时结果 [ServiceResult.java](D:/Develop/hardware/3.0jijingoldplatform/demeter/demeter-all/branch/poseidon-core/src/main/java/com/dongjun/core/result/ServiceResult.java)
- API 请求/通知与 session 模型 [ApiRequest.java](D:/Develop/hardware/3.0jijingoldplatform/demeter/demeter-all/branch/poseidon-core-misc/src/main/java/com/dongjun/iot/service/core/api/request/ApiRequest.java) [ApiNotifyEvent.java](D:/Develop/hardware/3.0jijingoldplatform/demeter/demeter-all/branch/poseidon-core-misc/src/main/java/com/dongjun/iot/service/core/api/notify/ApiNotifyEvent.java) [ApiSession.java](D:/Develop/hardware/3.0jijingoldplatform/demeter/demeter-all/branch/poseidon-core-misc/src/main/java/com/dongjun/iot/service/core/api/session/ApiSession.java)
- 传输层命令模块与上报接口号 [EnumCmdModule.java](D:/Develop/hardware/3.0jijingoldplatform/demeter/demeter-all/branch/poseidon-core-misc/src/main/java/com/dongjun/iot/service/core/enums/net/EnumCmdModule.java) [EnumUploadSequence.java](D:/Develop/hardware/3.0jijingoldplatform/demeter/demeter-all/branch/poseidon-core-misc/src/main/java/com/dongjun/iot/service/core/enums/net/EnumUploadSequence.java)
- 网络层同步等待基类 [BaseNettyService.java](D:/Develop/hardware/3.0jijingoldplatform/demeter/demeter-all/branch/poseidon-network/poseidon-network-base/src/main/java/com/dongjun/iot/poseidon/network/base/base/service/BaseNettyService.java)

## 2. 旧平台里值得继承的点

### 2.1 设备角色划分是清楚的

旧平台虽然整体比较重，但对厚吉 3.0 至少明确区分了：

- `HOUJI_MONITOR`
- `HOUJI_FARM_V3_MASTER`
- `HOUJI_FARM_V3_SLAVE`
- `HOUJI_FARM_V3_SINGLE`

这个思路是对的。它说明硬件接入不能只看“是不是一台设备”，还要看：

- 它是主控终端还是操作端
- 是单机一体还是主从部署
- 是纯监测还是可控设备

### 2.2 同步命令和异步上报是分开的

旧平台把这两类语义分得很明确：

- 下行命令通过 `EnumCmdModule`
- 上报事件通过 `EnumUploadSequence`
- 同步发送若超时，会落到 `ServiceResult.timeout()`
- 传输层等待按 `globalSessionId = deviceNo + "_" + sessionId` 做匹配

这说明它很清楚：

- 下发命令不是普通 HTTP 请求
- 上报不是命令的“反向接口”
- 必须有一层独立的会话和超时管理

### 2.3 上报接口号是显式登记的

旧平台把每一种设备上报都登记成唯一编号，例如：

- 公共上报
- 农业灌溉上报
- 农业灌溉 V3.0 操作端上报
- 农业灌溉 V3.0 终端上报
- 单机版上报

这背后的优点不是“编号很多”，而是：

- 服务端和固件都知道自己在说哪一类消息
- 上报类型有字典，不靠随意字符串
- 便于灰度、兼容和审计

### 2.4 业务状态码做了离散化

旧平台为机井 3.0 单独维护了：

- 运行状态
- 启动结果
- 结束原因
- 故障码
- 打断操作
- 刷卡结果

这点很值得保留，因为硬件接入不是只要“开/关成功”就够了。很多现场问题真正需要的是：

- 为什么没启动
- 为什么结束
- 当前是离线、故障、暂停还是未就绪
- 是终端问题还是下挂设备问题

## 3. 旧平台里不建议继续沿用的点

### 3.1 设备类型、业务类型、协议类型耦合太深

旧平台把很多内容直接塞进枚举：

- 厂家
- 系统类型
- 设备产品形态
- 业务模式
- 上报编号

这样短期开发快，但后面一旦：

- 厂家变了
- 协议升级了
- 同一控制器挂更多终端
- 一种控制器兼容多部署模式

枚举会迅速膨胀。

### 3.2 主从单机被做成了“顶层设备系统”

旧平台里 `MASTER / SLAVE / SINGLE` 是设备系统枚举的一部分，这在当年可以理解，但对我们现在的业务模型来说不够顺。

更合理的是把这三者变成：

- `controller_role`
- `deployment_mode`
- `parent_controller_code`

而不是新的“顶层产品种类”。

### 3.3 上传接口号过于产品化

旧平台上报编号能解决可识别问题，但它的问题是和具体产品代次绑得太紧。现在不适合完全复刻这种大枚举。

更好的做法是：

- 保留“显式事件代码”这个思想
- 不再让代码号直接承担产品版本管理

### 3.4 旧平台过度依赖设备侧业务

旧平台里有不少“刷卡、充值、订单结束、余额查询”一体化语义，这和当时的机井计费模式强绑定。

我们现在不应该把“支付业务逻辑”做成硬件接口的中心，而应该把硬件接口收敛到：

- 设备注册
- 在线状态
- 运行态
- 通道控制
- 计量采集
- 报警故障

## 4. 和当前系统的关系

当前系统的业务对象模型已经在往这条线统一：

`点位 -> 控制器 -> 终端单元 -> 资产归口`

对应文档见：

- [point-controller-terminal-unified-model.md](/D:/Develop/houji/houjinongfuAI-Cursor/docs/network-workbench/point-controller-terminal-unified-model.md)
- [device-type-dictionary.md](/D:/Develop/houji/houjinongfuAI-Cursor/docs/network-workbench/device-type-dictionary.md)

当前后端接入主线也已经具备基础雏形：

- `tcp-json-v1` 解析与事件映射 [tcp-json-v1.adapter.ts](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/backend/src/modules/protocol-adapter/tcp-json-v1.adapter.ts)
- 设备网关入口 [device-gateway.controller.ts](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/backend/src/modules/device-gateway/device-gateway.controller.ts)
- 命令队列、桥接、ACK/NACK、恢复编排 [device-gateway.service.ts](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/backend/src/modules/device-gateway/device-gateway.service.ts)

所以这轮规划不应该推翻现有 `tcp-json-v1`，而应该做：

- 保留当前主协议
- 吸收旧平台“角色 / 会话 / 事件码 / 状态码”的优点
- 把硬件接口收敛成更适合当前模型的一层

## 5. 建议的硬件接口分层

### 5.1 业务对象层

这层是业务系统理解设备的方式：

- `点位 point`
- `控制器 controller`
- `终端单元 terminal_unit`

说明：

- 点位回答“这个地方是什么”
- 控制器回答“谁负责控制/采集”
- 终端单元回答“控制器实际管了哪些泵、阀、传感器、计量件”

### 5.2 硬件接入层

这层是南向接入真正需要看的对象：

- `gateway_device`
- `controller_device`
- `subdevice`
- `channel`

建议定义：

| 对象 | 含义 | 是否必须独立通信 |
| --- | --- | --- |
| `gateway_device` | 4G/以太网/串口桥设备 | 可选 |
| `controller_device` | 站级控制器、井控器、泵控器、PLC、RTU | 是 |
| `subdevice` | 从控板、操作屏、远程 IO、采集从站 | 否，可挂父控制器 |
| `channel` | 控制通道或采集通道 | 否 |

### 5.3 协议适配层

这层只处理通讯，不处理业务拓扑：

- `tcp-json-v1`
- `http_bridge`
- `serial_bridge`
- 后续可扩展 `mqtt-json-v1`
- 后续可扩展 `modbus-bridge-v1`

原则：

- 业务层不直接依赖某一种链路
- 同一控制器可通过不同 bridge 接入
- 协议适配器只负责“消息 -> 标准事件”

## 6. 需要冻结的硬件身份字段

建议把身份字段统一成下面这套：

### 6.1 控制器级

- `controller_code`
- `controller_role`
- `deployment_mode`
- `protocol_type`
- `comm_identity`
- `firmware_version`
- `hardware_version`

字段说明：

- `controller_code`
  业务稳定编号，给平台、工作台、配置、运维使用
- `controller_role`
  如 `well_master`、`operator_panel`、`single_integrated`、`station_gateway`
- `deployment_mode`
  如 `master_slave`、`single`、`monitor_only`
- `comm_identity`
  当前 Phase 1 建议继续主用 `imei`

### 6.2 下挂单元级

- `subdevice_code`
- `parent_controller_code`
- `subdevice_role`
- `slave_addr`
- `port_no`

说明：

- 老平台的 `MASTER / SLAVE / SINGLE` 仍然有价值
- 但应该落到 `role + parent + slave_addr`，而不是再造新的顶层设备系统

### 6.3 通道级

- `channel_code`
- `channel_type`
- `direction`
- `binding_target_type`
- `binding_target_code`

其中：

- `channel_type`
  可取 `control` / `sampling`
- `direction`
  可取 `output` / `input`

## 7. 建议的命令模型

旧平台“命令模块 + session”这套是值得保留的，但建议改成更可读的命令字典。

### 7.1 命令分类

建议先冻结这些命令：

- `register_sync`
- `time_sync`
- `query_state`
- `query_config`
- `sync_config`
- `start_session`
- `stop_session`
- `open_channel`
- `close_channel`
- `set_parameter`
- `ota_prepare`
- `ota_chunk`
- `ota_commit`
- `reboot`

### 7.2 命令必须带的标识

- `command_id`
- `command_code`
- `target_controller_code`
- `target_subdevice_code`
- `target_channel_code`
- `session_ref`
- `timeout_sec`
- `issued_at`
- `request_payload`

### 7.3 会话建议

当前系统已经有 `session_ref`，这个方向是对的。

建议补齐两层概念：

- `command_id`
  单次命令幂等标识
- `transport_session_id`
  纯通讯层配对标识

也就是：

- 平台层用 `command_id`
- 业务运行层用 `session_ref`
- 传输匹配层用 `transport_session_id`

这样比旧平台把所有东西都压在一个 `globalSessionId` 上更清楚。

## 8. 建议的上报事件模型

旧平台 `EnumUploadSequence` 的核心思想值得保留，但建议换成“显式事件代码 + 可读事件名”。

### 8.1 Phase 1 主事件

- `REGISTER`
- `HEARTBEAT`
- `STATE_SNAPSHOT`
- `RUNTIME_TICK`
- `RUNTIME_STOPPED`
- `ALARM_REPORT`
- `COMMAND_ACK`
- `COMMAND_NACK`

### 8.2 建议新增的标准事件代码

给每类事件补一层稳定 `event_code`：

| msg_type | event_code | 用途 |
| --- | --- | --- |
| `REGISTER` | `common.register` | 设备注册 |
| `HEARTBEAT` | `common.heartbeat` | 在线维持 |
| `STATE_SNAPSHOT` | `controller.state_snapshot` | 控制器整体现状 |
| `RUNTIME_TICK` | `session.runtime_tick` | 运行过程计量 |
| `RUNTIME_STOPPED` | `session.runtime_stopped` | 运行结束 |
| `ALARM_REPORT` | `controller.alarm_report` | 报警/故障 |
| `COMMAND_ACK` | `command.ack` | 命令接受/完成 |
| `COMMAND_NACK` | `command.nack` | 命令拒绝/失败 |

后面若出现监测型设备、远程 IO、变频器、子站采集，可继续扩展：

- `monitor.flow_report`
- `monitor.level_report`
- `channel.state_changed`
- `subdevice.fault_report`

### 8.3 状态码建议

建议把旧平台里已经做过离散化的内容，重新抽成统一字典：

- `controller_status_code`
- `start_result_code`
- `stop_reason_code`
- `fault_code`
- `interrupt_reason_code`

原则：

- 状态码是协议合同
- 状态文案是展示层
- 不让固件直接把“中文描述”当唯一判断依据

## 9. 拓扑和联动在硬件接口里的位置

你前面问过“管网配置里的拓扑、联动有没有用”。从硬件接口角度，我的判断是：

### 9.1 拓扑不是南向接口的必需输入

硬件设备真正需要知道的是：

- 我是谁
- 我控制哪些通道
- 本次该执行哪条命令
- 本次该回传哪些计量和状态

它不需要知道整张管网图。

### 9.2 联动能力有用，但不应该暴露成硬件协议核心

联动的价值在平台侧：

- 根据运行目标决定该起哪些泵、开哪些阀
- 最终拆成多个控制器命令下发

所以联动应是：

- 平台编排层能力
- 不是硬件协议层能力

结论：

- `拓扑` 对工作台和求解器有用
- `联动` 对调度编排有用
- 但硬件接口不应该直接依赖“管网图已配置完整”

## 10. 建议的接口规划口径

建议对外统一成下面这套。

### 10.1 控制器侧

控制器必须支持：

- 注册
- 心跳
- 状态快照
- 运行过程上报
- 命令 ACK/NACK
- 基础报警上报

### 10.2 终端单元侧

终端单元不要求都独立联网，但必须可被控制器映射为：

- 控制通道
- 采集通道

例如：

- 水泵 -> 控制通道
- 电磁阀 -> 控制通道
- 流量计 -> 采集通道
- 压力计 -> 采集通道
- 液位计 -> 采集通道

### 10.3 网关/桥接侧

桥接设备只负责：

- 维持连接
- 携带控制器身份
- 拉取待发命令
- 回推运行事件

不要把业务编排写进桥接。

## 11. 我建议先冻结的最小合同

第一批建议冻结这些内容：

1. `controller_role` 字典  
2. `deployment_mode` 字典  
3. `command_code` 字典  
4. `event_code` 字典  
5. `fault_code` 字典  
6. `session_ref / command_id / transport_session_id` 三层标识含义  
7. `controller -> subdevice -> channel` 编码规则  

## 12. 建议的落地顺序

### P1. 先冻结对象和字典

- 冻结控制器角色
- 冻结部署模式
- 冻结命令码
- 冻结事件码
- 冻结故障码

### P2. 冻结报文字段

在 `tcp-json-v1` 基础上补齐：

- `controller_code`
- `controller_role`
- `deployment_mode`
- `subdevice_code`
- `channel_code`
- `event_code`
- `command_id`

### P3. 冻结桥接接口

统一桥接输入输出：

- `bridge/connect`
- `bridge/heartbeat`
- `bridge/disconnect`
- `pending-commands`

让 HTTP bridge、串口 bridge 走同一份 sidecar 合同。

TCP 直连 MCU 仍走 `hj-device-v2` 主协议，不混用 `pending-commands` 或 bridge heartbeat 回带命令语义。

### P4. 再做硬件映射表

针对每一种控制器，补一份：

- 支持哪些控制通道
- 支持哪些采集通道
- 支持哪些从站地址
- 支持哪些故障码

### P5. 最后做深协议扩展

例如：

- Modbus 从站映射
- MQTT 接入
- OTA 分片
- 离线缓存与补传

## 13. 结论

老平台最值得继承的，不是它那一大坨枚举本身，而是 4 个观念：

- 设备角色必须显式建模
- 命令和上报必须分层
- 同步命令必须有独立会话和超时管理
- 状态/故障/结束原因必须离散化

但它不值得继续照搬的，是：

- 把产品代次、厂家、业务语义全绑在大枚举里
- 把主从单机做成顶层设备系统
- 把支付/订单业务深埋进硬件接口

对当前项目，最顺的做法是：

- 继续以 `tcp-json-v1` 为主线
- 吸收旧平台的“角色 / 会话 / 事件码 / 状态码”思想
- 南向接口只围绕 `控制器 -> 子设备 -> 通道`
- 平台层继续围绕 `点位 -> 控制器 -> 终端单元`

这样硬件接口和业务模型就能接上，而且后面不管扩展监测设备、井控器、泵站控制器还是水肥机，都不会再绕弯。
