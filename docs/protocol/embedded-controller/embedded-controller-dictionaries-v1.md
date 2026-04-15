# 嵌入式控制器字典冻结清单 v1

## 1. 目的

这份文档用于冻结 4 组基础字典，供：

- 后台配置页
- 设备管理
- 工作台/联动
- 嵌入式固件
- 设备网关

共同使用。

本清单承接：

- [controller-board-reuse-and-embedded-interface-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/controller-board-reuse-and-embedded-interface-v1.md)
- [embedded-controller-profile-config-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-profile-config-v1.md)
- [embedded-controller-capability-composition-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-capability-composition-v1.md)

## 2. 冻结原则

1. 字典 code 一旦上线，不随意改名
2. 展示文案可以改，code 不改
3. 平台和固件都只认 code，不认中文名
4. 新增可以，废弃要走兼容期

## 3. `firmware_family`

`firmware_family` 表示固件主家族，不表示具体业务组合。

| code | 中文名 | 适用硬件 | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| `FW_H2_UNIFIED` | H2 统一控制固件 | `H2` | `active` | 当前主线固件，支持模块组合 |
| `FW_H1_GATEWAY` | H1 站级网关固件 | `H1` | `reserved` | 后续站级网关使用 |
| `FW_H3_VALVE_LITE` | H3 轻量阀控固件 | `H3` | `reserved` | 后续单路阀控专板使用 |
| `FW_H4_IO_MONITOR` | H4 采集扩展固件 | `H4` | `reserved` | 后续远程 IO / 采集扩展使用 |

### 3.1 Phase 1 建议

Phase 1 先只正式启用：

- `FW_H2_UNIFIED`

## 4. `feature_module_code`

`feature_module_code` 表示一项可独立开关、可独立配置、可参与资源校验的功能模块。

| code | 中文名 | 分类 | 默认占用资源 | 说明 |
| --- | --- | --- | --- | --- |
| `pump_vfd_control` | 变频泵控制 | control | `relay_output=1` | 启停变频器，频率给定可走模拟量或 RS485 |
| `pump_direct_control` | 直接启停泵控制 | control | `relay_output=1` | 直接驱动接触器或中间继电器 |
| `single_valve_control` | 单路阀控 | control | `relay_output=1` | 控制单个电磁阀或执行器 |
| `breaker_control` | 开合闸控制 | control | `relay_output=1` 或 `motor_driver=1` | 控制接触器、断路器或电动执行机构 |
| `pressure_acquisition` | 压力采集 | acquisition | `analog_input=1` | 典型 4-20mA |
| `flow_acquisition` | 流量采集 | acquisition | `pulse_input=1` 或 `rs485_modbus=1` | 脉冲表或 RS485 表 |
| `level_acquisition` | 液位采集 | acquisition | `analog_input=1` 或 `rs485_modbus=1` | 液位计 |
| `soil_moisture_acquisition` | 土壤墒情采集 | acquisition | `rs485_modbus=1` 或 `analog_input=1` | 多数为 RS485 |
| `soil_temperature_acquisition` | 土壤温度采集 | acquisition | `rs485_modbus=1` | 常与墒情共总线 |
| `power_monitoring` | 电源监测 | acquisition | `power_monitor=1` | 电池、电源、太阳能状态 |
| `electric_meter_modbus` | 电表采集 | acquisition | `rs485_modbus=1` | 读取电压、电流、功率、电量、频率等 |
| `rs485_sensor_gateway` | RS485 传感器网关 | bus | `rs485_modbus=1` | 下挂仪表或传感器 |
| `rs485_vfd_gateway` | RS485 变频器网关 | bus | `rs485_modbus=1` | 读取/设置变频器参数 |
| `payment_qr_control` | 扫码支付控制 | interaction | `none` | 支持平台支付下单、扫码启控、支付结果闭环 |
| `card_auth_reader` | 刷卡鉴权 | interaction | `card_reader=1` | 支持 IC/RFID 卡读取、本地鉴权触发 |
| `valve_feedback_monitor` | 阀位反馈监测 | feedback | `digital_input=1` | 开到位/关到位反馈 |
| `breaker_feedback_monitor` | 开合闸反馈监测 | feedback | `digital_input=1` | 合闸反馈、分闸反馈、故障跳闸反馈 |
| `pump_fault_feedback` | 泵故障反馈 | feedback | `digital_input=1` | 热继、故障干接点 |
| `remote_start_enable` | 允许远程启动 | policy | `none` | 平台策略，非硬件资源 |
| `auto_linkage_enable` | 允许自动联动 | policy | `none` | 平台策略，非硬件资源 |
| `auto_stop_on_low_pressure` | 低压自动停机 | policy | `none` | 平台策略，依赖压力采集 |
| `auto_stop_on_high_pressure` | 高压自动停机 | policy | `none` | 平台策略，依赖压力采集 |

### 4.1 组合规则建议

- `pump_vfd_control` 与 `pump_direct_control`
  - 对同一泵目标互斥
- `single_valve_control` 可与 `pressure_acquisition`、`flow_acquisition`、`soil_moisture_acquisition` 组合
- `breaker_control` 可独立存在，也可与 `electric_meter_modbus`、`payment_qr_control` 组合
- `payment_qr_control` 不代表板子一定有本地读卡能力
- `card_auth_reader` 与 `payment_qr_control` 可共存，但应分别暴露能力码
- `electric_meter_modbus` 与 `rs485_sensor_gateway` 可共总线，但要做从站地址与轮询预算校验
- `auto_stop_on_low_pressure` 依赖 `pressure_acquisition`
- `auto_stop_on_high_pressure` 依赖 `pressure_acquisition`
- `rs485_vfd_gateway` 与 `rs485_sensor_gateway` 可共存，但要做总线地址和轮询资源校验

### 4.2 Phase 1 建议开放模块

- `pump_vfd_control`
- `single_valve_control`
- `breaker_control`
- `pressure_acquisition`
- `flow_acquisition`
- `electric_meter_modbus`
- `soil_moisture_acquisition`
- `soil_temperature_acquisition`
- `power_monitoring`
- `payment_qr_control`
- `card_auth_reader`
- `valve_feedback_monitor`
- `remote_start_enable`
- `auto_linkage_enable`

## 5. `channel_role`

`channel_role` 表示逻辑通道承担的业务职责。

| code | 中文名 | 推荐 `channel_type` | 推荐 `io_kind` | 典型单位 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `pump_run` | 泵运行控制 | `actuator` | `relay_output` | - | 主启停通道 |
| `pump_stop` | 泵停机控制 | `actuator` | `relay_output` | - | 可选独立停机通道 |
| `vfd_run` | 变频器运行控制 | `actuator` | `relay_output` | - | 变频器 RUN |
| `vfd_setpoint` | 变频器给定 | `actuator` | `analog_input` 或 `rs485_modbus` | `Hz` | 频率设定 |
| `valve_open` | 阀门开控制 | `actuator` | `relay_output` | - | 单路阀控主通道 |
| `valve_close` | 阀门关控制 | `actuator` | `relay_output` | - | 双线圈或双继电器时使用 |
| `valve_feedback` | 阀门到位反馈 | `feedback` | `digital_input` | - | 开到位/关到位 |
| `breaker_open` | 合闸控制 | `actuator` | `relay_output` 或 `motor_driver` | - | 合闸/送电动作 |
| `breaker_close` | 分闸控制 | `actuator` | `relay_output` 或 `motor_driver` | - | 分闸/断电动作 |
| `breaker_feedback` | 开合闸反馈 | `feedback` | `digital_input` | - | 反馈当前闸位或跳闸状态 |
| `pressure_sensor` | 压力采集 | `sensor` | `analog_input` 或 `rs485_modbus` | `MPa` | 压力变送器 |
| `flow_sensor` | 流量采集 | `sensor` | `pulse_input` 或 `rs485_modbus` | `m3/h` | 流量计 |
| `level_sensor` | 液位采集 | `sensor` | `analog_input` 或 `rs485_modbus` | `m` | 液位计 |
| `soil_moisture_sensor` | 土壤墒情 | `sensor` | `rs485_modbus` 或 `analog_input` | `%` | 墒情值 |
| `soil_temperature_sensor` | 土壤温度 | `sensor` | `rs485_modbus` | `℃` | 土温值 |
| `electric_meter` | 电表采集 | `sensor` | `rs485_modbus` | `V/A/kW/kWh` | 电压、电流、功率、电量 |
| `power_sensor` | 电源监测 | `power` | `power_monitor` | `V/A/%` | 电池、太阳能、电源 |
| `card_reader` | 刷卡器 | `interaction` | `card_reader` | - | IC/RFID 读卡与卡号上报 |
| `alarm_input` | 告警输入 | `feedback` | `digital_input` | - | 外部故障/水位保护等 |
| `status_feedback` | 状态反馈 | `feedback` | `digital_input` | - | 接触器、运行反馈 |
| `reserved` | 预留通道 | `sensor`/`actuator` | 任意 | - | 保留扩展 |

## 6. `io_kind`

`io_kind` 表示逻辑通道映射到的硬件接口类型。

| code | 中文名 | 方向 | 说明 |
| --- | --- | --- | --- |
| `relay_output` | 继电器输出 | output | 控制接触器、阀门、RUN/STOP |
| `motor_driver` | 电机驱动输出 | output | 直接驱动执行机构 |
| `digital_input` | 数字量输入 | input | 到位反馈、故障反馈 |
| `analog_input` | 模拟量输入 | input | 4-20mA、0-5V、0-10V |
| `pulse_input` | 脉冲输入 | input | 流量脉冲、计量脉冲 |
| `rs485_modbus` | RS485 Modbus | bidirectional | 下挂传感器、仪表、变频器 |
| `power_monitor` | 电源监测 | input | 电池、电压、电流、充放电状态 |
| `card_reader` | 读卡器接口 | bidirectional | IC/RFID/串口读卡头 |

## 7. `command_code`

`command_code` 表示平台对控制器下发的标准动作。

| code | 中文名 | 目标 | 必要参数 | 说明 |
| --- | --- | --- | --- | --- |
| `START_PUMP` | 启泵 | `pump_run` / `vfd_run` | `target_channel_code` | 统一启动命令 |
| `STOP_PUMP` | 停泵 | `pump_run` / `vfd_run` | `target_channel_code` | 统一停机命令 |
| `SET_VFD_RUN` | 设置变频器运行状态 | `vfd_run` | `target_channel_code`, `target_state` | `ON/OFF` |
| `SET_VFD_FREQUENCY` | 设置变频器频率 | `vfd_setpoint` | `target_channel_code`, `target_value` | 单位 `Hz` |
| `OPEN_VALVE` | 开阀 | `valve_open` | `target_channel_code` | 单阀控制 |
| `CLOSE_VALVE` | 关阀 | `valve_open` / `valve_close` | `target_channel_code` | 单阀或双线圈 |
| `OPEN_BREAKER` | 合闸 | `breaker_open` | `target_channel_code` | 合闸、送电 |
| `CLOSE_BREAKER` | 分闸 | `breaker_close` | `target_channel_code` | 分闸、断电 |
| `SET_RELAY_STATE` | 设置继电器状态 | `relay_output` | `target_channel_code`, `target_state` | 通用继电器命令 |
| `QUERY_CHANNEL_STATE` | 查询通道状态 | 任意 | `target_channel_code` | 返回指定通道状态 |
| `QUERY_STATE` | 查询控制器状态 | 控制器 | 无 | 返回整机快照 |
| `SYNC_CONFIG` | 同步配置 | 控制器 | `config_version`, `config_body` | 主配置下发 |
| `APPLY_MODULE_SET` | 应用模块集合 | 控制器 | `feature_modules[]` | 可选，通常并入 `SYNC_CONFIG` |
| `SYNC_CLOCK` | 同步时钟 | 控制器 | `server_ts` | UTC |
| `REBOOT_DEVICE` | 重启设备 | 控制器 | 可空 | 谨慎开放 |

### 7.1 `COMMAND_ACK` 必带字段

- `command_id`
- `command_code`
- `target_channel_code`
- `accept_state`

### 7.2 `COMMAND_NACK` 必带字段

- `command_id`
- `command_code`
- `reject_code`
- `reject_reason`

## 8. `alarm_code`

`alarm_code` 用于设备主动告警或状态快照中的离散故障码。

| code | 中文名 | 严重级别 | 说明 |
| --- | --- | --- | --- |
| `PUMP_START_FAILED` | 泵启动失败 | `major` | 启动后未进入运行状态 |
| `PUMP_STOP_FAILED` | 泵停机失败 | `major` | 停机命令后状态异常 |
| `VFD_OFFLINE` | 变频器离线 | `major` | RS485 或状态链路异常 |
| `VFD_FAULT_ACTIVE` | 变频器故障 | `critical` | 变频器返回故障态 |
| `VALVE_OPEN_TIMEOUT` | 开阀超时 | `major` | 超时未到位 |
| `VALVE_CLOSE_TIMEOUT` | 关阀超时 | `major` | 超时未到位 |
| `PRESSURE_LOW` | 压力过低 | `warning`/`major` | 根据阈值策略升级 |
| `PRESSURE_HIGH` | 压力过高 | `warning`/`major` | 根据阈值策略升级 |
| `FLOW_LOW` | 流量过低 | `warning` | 低于设定阈值 |
| `FLOW_ABNORMAL` | 流量异常 | `major` | 波动异常或无流 |
| `LEVEL_LOW` | 液位过低 | `major` | 水位保护 |
| `SOIL_SENSOR_OFFLINE` | 土壤传感器离线 | `warning` | RS485 或采集异常 |
| `POWER_LOW` | 供电过低 | `major` | 主电源异常 |
| `BATTERY_LOW` | 电池电量低 | `major` | 蓄电池欠压 |
| `SOLAR_CHARGE_ABNORMAL` | 太阳能充电异常 | `warning` | 太阳能输入或充电回路异常 |
| `RS485_DEVICE_OFFLINE` | RS485 下挂设备离线 | `warning` | 任一下挂设备无响应 |
| `MCU_WATCHDOG_RESET` | 看门狗复位 | `major` | 固件异常后自恢复 |
| `COMMUNICATION_RECONNECT` | 通信重连 | `info` | 网络重连事件 |

## 9. `reject_code`

`reject_code` 用于 `COMMAND_NACK`。

| code | 中文名 | 说明 |
| --- | --- | --- |
| `DEVICE_BUSY` | 设备忙 | 正在执行不可重入动作 |
| `UNSUPPORTED_COMMAND` | 不支持命令 | 当前固件或模块不支持 |
| `INVALID_CHANNEL` | 非法通道 | 找不到目标通道 |
| `CHANNEL_DISABLED` | 通道未启用 | 通道存在但未配置启用 |
| `MODULE_NOT_ENABLED` | 模块未启用 | 目标命令依赖的模块未打开 |
| `CAPABILITY_NOT_EXPOSED` | 能力未暴露 | 设备未声明支持该能力 |
| `SAFETY_INTERLOCK` | 安全联锁阻断 | 本地保护条件不允许执行 |
| `LOW_BATTERY` | 电池电量不足 | 当前供电不足以执行动作 |
| `POWER_NOT_READY` | 电源未就绪 | 供电链路未稳定 |
| `SENSOR_REQUIRED` | 缺少前置传感器 | 依赖采集条件未满足 |
| `PARAM_INVALID` | 参数非法 | 频率、阈值、状态值非法 |
| `CONFIG_VERSION_MISMATCH` | 配置版本不一致 | 平台/设备版本不一致 |
| `EXPIRED_COMMAND` | 命令已过期 | 超过 `expire_at` |

## 10. Phase 1 推荐冻结最小集

如果现在要尽快开工，建议 Phase 1 先冻结下面这批最小集。

### 10.1 固件家族

- `FW_H2_UNIFIED`

### 10.2 功能模块

- `pump_vfd_control`
- `single_valve_control`
- `breaker_control`
- `pressure_acquisition`
- `flow_acquisition`
- `electric_meter_modbus`
- `soil_moisture_acquisition`
- `soil_temperature_acquisition`
- `power_monitoring`
- `payment_qr_control`
- `card_auth_reader`
- `valve_feedback_monitor`

### 10.3 通道角色

- `vfd_run`
- `vfd_setpoint`
- `valve_open`
- `valve_feedback`
- `breaker_open`
- `breaker_close`
- `breaker_feedback`
- `pressure_sensor`
- `flow_sensor`
- `electric_meter`
- `soil_moisture_sensor`
- `soil_temperature_sensor`
- `power_sensor`
- `card_reader`

### 10.4 命令

- `SET_VFD_RUN`
- `SET_VFD_FREQUENCY`
- `OPEN_VALVE`
- `CLOSE_VALVE`
- `OPEN_BREAKER`
- `CLOSE_BREAKER`
- `QUERY_STATE`
- `SYNC_CONFIG`
- `SYNC_CLOCK`

## 11. 一句话建议

你们现在最该冻结的，不是“场景模板”，而是这 4 组字典。  
只要这些字典先稳住，后面同一块板支持各种功能组合，平台和嵌入式都不会乱。

