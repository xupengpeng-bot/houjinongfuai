# 嵌入式控制器能力组合与平台配置规范 v1

## 1. 这份文档解决什么问题

前一版 [embedded-controller-profile-config-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-profile-config-v1.md) 已经把：

- 控制器主身份
- 通道模型
- `SYNC_CONFIG`
- 几个典型场景

定义出来了。

但仅靠“一个场景一个 profile”还不够，因为现场很可能出现组合场景，例如：

- 同一块板既控变频器，又采压力和流量
- 同一块板既控单阀，又采土壤墒情
- 同一块板既是泵控主板，又顺手挂 1 路阀控和 1 路压力采集

所以这一版要解决的是：

- 同一块板
- 基于现有硬件接口能力
- 如何支持功能组合
- 平台如何更简单地配置
- 固件如何更稳定地执行

## 2. 结论先行

我建议不要把这块板设计成：

- 一个场景一个固件
- 一个场景一个配置页
- 一个场景一套报文

更合理的方式是：

1. `一个固件家族`
   - 例如 `FW_H2_UNIFIED`

2. `多个功能模块`
   - 例如泵控、阀控、压力采集、流量采集、土壤墒情采集

3. `平台按资源做组合配置`
   - 不是选唯一场景
   - 而是勾选功能模块

4. `平台生成标准配置`
   - 固件按配置启用功能

一句话：

- 固件做成“统一运行时”
- 平台做成“模块组合器”

## 3. 总体模型

建议把控制器配置拆成 4 层。

### 第一层：硬件家族

固定不变：

- `hardware_sku`
- `hardware_rev`

例子：

- `H2 / A1`

### 第二层：固件家族

建议不要按场景拆太多固件，而是统一成：

- `firmware_family`

例子：

- `FW_H2_UNIFIED`

它表示：

- 同一套报文
- 同一套通道抽象
- 同一套配置应用机制

### 第三层：功能模块

功能模块才是变化主体。

建议定义：

- `feature_modules`

例子：

- `pump_vfd_control`
- `single_valve_control`
- `pressure_acquisition`
- `flow_acquisition`
- `soil_moisture_acquisition`
- `soil_temperature_acquisition`
- `power_monitoring`
- `rs485_sensor_gateway`

### 第四层：通道实例

最终所有功能都落实到：

- `channel_bindings`

也就是：

- 哪个逻辑通道
- 承担什么角色
- 绑到哪个终端单元
- 用什么参数

## 4. 为什么这样最顺

如果继续走“一个场景一个 profile”，很快会膨胀成：

- `FW_VFD_PRESSURE_FLOW`
- `FW_VFD_PRESSURE_FLOW_VALVE`
- `FW_VFD_PRESSURE_FLOW_SOIL`
- `FW_VALVE_SOIL`
- `FW_PUMP_VALVE_SOIL`

这条线会越做越乱。

而改成“统一固件 + 模块组合”后：

- 固件不需要指数爆炸
- 后台也不用爆炸出很多模板
- 平台只做资源校验和配置下发
- 设备只做功能启停和参数应用

## 5. 平台主对象怎么映射

继续沿用现有业务主线：

- `点位 -> 控制器 -> 终端单元`

但对控制器补一层内部结构：

- `controller`
  - 一个 IMEI
  - 一个固件家族
  - 一组功能模块
  - 一组逻辑通道

### 5.1 平台字段建议

建议控制器记录里固定这些字段：

- `imei`
- `hardware_sku`
- `hardware_rev`
- `firmware_family`
- `controller_role`
- `feature_modules`
- `config_version`
- `resource_inventory`

其中：

- `controller_role`
  - 是控制器在业务上的主角色
  - 例如 `water_source_controller`
  - 但不代表它只能做这一件事

## 6. 资源模型

平台之所以能支持组合，前提是平台知道这块板“有什么资源”。

建议把硬件能力抽象成：

```json
{
  "resource_inventory": {
    "relay_output": 2,
    "motor_driver": 2,
    "digital_input": 2,
    "analog_input": 2,
    "pulse_input": 1,
    "rs485_modbus": 1,
    "power_monitor": 1
  }
}
```

注意：

- 这不是给用户配置的
- 这是平台内置的硬件资源模板

平台根据这个模板判断：

- 组合是否合法
- 是否通道冲突
- 是否超资源

## 7. 功能模块定义

建议把组合能力收敛成标准功能模块。

### 7.1 控制类模块

- `pump_vfd_control`
- `pump_direct_control`
- `single_valve_control`

### 7.2 采集类模块

- `pressure_acquisition`
- `flow_acquisition`
- `level_acquisition`
- `soil_moisture_acquisition`
- `soil_temperature_acquisition`
- `power_monitoring`

### 7.3 总线类模块

- `rs485_sensor_gateway`
- `rs485_vfd_gateway`

### 7.4 平台策略类模块

- `auto_stop_on_low_pressure`
- `auto_stop_on_high_pressure`
- `remote_start_enable`
- `auto_linkage_enable`

关键点：

- 前三类是设备侧能力
- 第四类是平台运行策略
- 不要混在一起

## 8. 推荐的配置结构

建议 `SYNC_CONFIG` 统一长这样：

```json
{
  "firmware_family": "FW_H2_UNIFIED",
  "controller_role": "water_source_controller",
  "feature_modules": [
    "pump_vfd_control",
    "pressure_acquisition",
    "flow_acquisition"
  ],
  "resource_inventory": {
    "relay_output": 2,
    "motor_driver": 2,
    "digital_input": 2,
    "analog_input": 2,
    "pulse_input": 1,
    "rs485_modbus": 1
  },
  "channel_bindings": [],
  "runtime_rules": {}
}
```

## 9. REGISTER 怎么定义

设备注册时，不再只带 `firmware_profile`，建议改成：

```json
{
  "protocol_version": "tcp-json-v1",
  "msg_type": "REGISTER",
  "imei": "860000000000001",
  "msg_id": "MSG-REG-0001",
  "seq_no": 1,
  "device_ts": "2026-04-07T13:00:00Z",
  "payload": {
    "hardware_sku": "H2",
    "hardware_rev": "A1",
    "firmware_family": "FW_H2_UNIFIED",
    "firmware_version": "1.0.0",
    "controller_role": "water_source_controller",
    "feature_modules": [
      "pump_vfd_control",
      "pressure_acquisition",
      "flow_acquisition"
    ],
    "config_version": 6
  }
}
```

这表示：

- 设备当前烧的是统一固件
- 当前启用了哪些功能模块
- 当前应用的是哪一版配置

## 10. STATE_SNAPSHOT 怎么定义

建议状态上报中明确区分：

- 控制器整体状态
- 当前启用模块
- 通道状态

```json
{
  "msg_type": "STATE_SNAPSHOT",
  "payload": {
    "firmware_family": "FW_H2_UNIFIED",
    "feature_modules": [
      "pump_vfd_control",
      "pressure_acquisition",
      "flow_acquisition"
    ],
    "config_version": 6,
    "controller_state": {
      "online": true,
      "mode": "remote",
      "run_state": "RUNNING"
    },
    "channels": []
  }
}
```

## 11. 平台配置流程

后台不要让用户“自己拼 JSON”。  
最顺的流程是：

### 第一步：安装控制器

只录：

- `IMEI`
- 点位
- 控制器名称

### 第二步：选择主角色

例如：

- 水源控制器
- 阀控器
- 监测控制器

### 第三步：勾选功能模块

例如：

- 泵控
- 压力采集
- 流量采集
- 单阀控制
- 土壤墒情采集

### 第四步：平台自动做资源校验

平台必须检查：

- 是否超出 `resource_inventory`
- 是否存在同一通道被复用
- 是否存在互斥模块

### 第五步：自动生成通道模板

平台按模块自动生成默认 `channel_bindings`。

### 第六步：用户只补参数

例如：

- 量程
- 寄存器地址
- 阈值
- 超时
- 采样周期

### 第七步：生成 `config_version`

保存后生成新配置版本。

### 第八步：下发并回读

- 下发 `SYNC_CONFIG`
- 设备 `ACK`
- 设备下一帧 `STATE_SNAPSHOT` 回带新版本

## 12. 组合规则怎么定

不是所有功能都能自由组合。  
建议平台固定校验下面几类规则。

### 12.1 资源占用规则

例如：

- `pump_vfd_control`
  - 占用 `1` 个继电器输出
- `single_valve_control`
  - 占用 `1` 个继电器输出
  - 可选占用 `1` 个数字输入做反馈
- `pressure_acquisition`
  - 占用 `1` 个模拟量输入
- `flow_acquisition`
  - 占用 `1` 个脉冲输入或 `1` 个 RS485 端口
- `soil_moisture_acquisition`
  - 占用 `1` 个 RS485 端口或 `1` 个模拟量输入

### 12.2 互斥规则

例如：

- `pump_vfd_control` 与 `pump_direct_control`
  - 对同一目标泵互斥

- `single_valve_control`
  - 不能绑定到已经被泵控占用的执行通道

### 12.3 角色约束规则

例如：

- 主角色是 `monitor_controller` 时
  - 默认不允许启用泵控
- 主角色是 `water_source_controller` 时
  - 可以额外挂少量采集模块

注意：

- 角色是主展示口径
- 不是绝对物理限制

## 13. 典型组合场景

## 13.1 组合 A：变频器 + 压力 + 流量 + 电量计量

```json
{
  "controller_role": "water_source_controller",
  "feature_modules": [
    "pump_vfd_control",
    "pressure_acquisition",
    "flow_acquisition",
    "electric_meter_modbus",
    "power_monitoring"
  ]
}
```

平台自动生成：

- `CH_RELAY_1 -> vfd_run`
- `CH_AI_1 -> pressure_sensor`
- `CH_PULSE_1 -> flow_sensor`
- `CH_RS485_1 -> electric_meter`
- `CH_PWR_1 -> power_sensor`

组合内默认纳入：

- 实时功率、电压、电流
- 累计电量统计
- 运行期电量统计

## 13.2 组合 B：单阀 + 土壤墒情 + 电量计量

```json
{
  "controller_role": "valve_controller",
  "feature_modules": [
    "single_valve_control",
    "soil_moisture_acquisition",
    "soil_temperature_acquisition",
    "electric_meter_modbus",
    "power_monitoring"
  ]
}
```

平台自动生成：

- `CH_RELAY_1 -> valve_open`
- `CH_DI_1 -> valve_feedback`
- `CH_RS485_1 -> soil_moisture_sensor`
- `CH_RS485_1 -> soil_temperature_sensor`
- `CH_RS485_2 -> electric_meter`
- `CH_PWR_1 -> power_sensor`

这里土壤墒情和土温可以共用一条 RS485 总线。
如果电表与土壤传感器共总线，平台和固件要额外校验：

- 从站地址不冲突
- 轮询预算可接受
- 统计周期不压缩业务采样周期

## 13.3 组合 C：泵控 + 压力 + 流量 + 单阀 + 电量计量

```json
{
  "controller_role": "water_source_controller",
  "feature_modules": [
    "pump_vfd_control",
    "pressure_acquisition",
    "flow_acquisition",
    "single_valve_control",
    "electric_meter_modbus",
    "power_monitoring"
  ]
}
```

如果资源够，就允许。  
平台自动分配：

- `CH_RELAY_1 -> vfd_run`
- `CH_RELAY_2 -> valve_open`
- `CH_AI_1 -> pressure_sensor`
- `CH_PULSE_1 -> flow_sensor`
- `CH_DI_1 -> valve_feedback`
- `CH_RS485_1 -> electric_meter`
- `CH_PWR_1 -> power_sensor`

## 13.4 组合 D：纯土壤墒情采集 + 电量计量

```json
{
  "controller_role": "monitor_controller",
  "feature_modules": [
    "soil_moisture_acquisition",
    "soil_temperature_acquisition",
    "electric_meter_modbus",
    "power_monitoring"
  ]
}
```

平台自动走“监测点”模板，不显示控制命令入口。
同时补充电量与供电统计看板，不暴露控制动作。

## 13.5 组合的统一电量计量与统计口径

从现在起，上述标准组合默认都把“电量计量与统计”并入标准能力集，不再作为组合外的可选附属项。

统一要求：

- 组合里默认包含 `electric_meter_modbus`
- 组合里默认包含 `power_monitoring`
- 平台默认生成电量统计视图
- 固件默认输出可用于结算和统计的累计量字段

建议最小统计字段：

- `voltage_v`
- `current_a`
- `power_kw`
- `energy_kwh`
- `cumulative_energy_wh`
- `cumulative_energy_kwh`
- `cumulative_runtime_sec`

建议最小统计结果：

- 当前功率
- 当前电压/电流
- 会话累计电量
- 当日电量
- 累计电量
- 运行时长

实现原则：

- 实时值走 `STATE_SNAPSHOT` / `QUERY`
- 运行中增量统计走 `EVENT_REPORT workflow_runtime_tick`
- 结算优先使用 `cumulative_energy_wh / cumulative_energy_kwh` 差分

如果某一现场硬件没有独立电表，也必须在产品定义中明确写出：

- 是不支持电量计量
- 还是仅支持电源监测、不支持结算级电量统计

## 14. 下行命令怎么统一

继续沿用：

- `START_COMMAND`
- `STOP_COMMAND`
- `QUERY_STATE`

动作通过 `command_code` 区分。

建议冻结：

- `SET_VFD_RUN`
- `SET_VFD_FREQUENCY`
- `OPEN_VALVE`
- `CLOSE_VALVE`
- `QUERY_CHANNEL_STATE`
- `SYNC_CONFIG`
- `SYNC_CLOCK`
- `REBOOT_DEVICE`

关键原则：

- 下行命令针对 `channel_code`
- 不针对 MCU 引脚
- 不针对“板型”

## 15. 平台怎么更简单高效

我的建议是：

### 不要做很多场景专用配置页

而是做一个统一的：

- 控制器配置页

里面只有 4 步：

1. 选主角色
2. 选功能模块
3. 补参数
4. 下发配置

### 不要让用户手工配通道编码

平台自动分配。

### 不要让用户手工拼报文

平台生成 `SYNC_CONFIG`。

### 不要让固件自由解释业务

固件只认：

- 模块开关
- 通道绑定
- 参数配置

## 16. 对现有平台最顺的落地方式

结合你们当前平台，我建议这样接：

1. 点位下安装控制器
2. 控制器下配置“功能模块组合”
3. 平台自动生成终端单元绑定
4. 平台自动生成设备运行配置
5. 下发 `SYNC_CONFIG`
6. 设备回 `STATE_SNAPSHOT`
7. 工作台和设备管理只消费：
   - 控制器
   - 通道
   - 终端单元

这和你们现在的：

- `点位 -> 控制器 -> 终端单元`

是完全顺的，不需要推翻现有业务模型。

## 17. 我最建议冻结的 4 组字典

这一轮最值得冻结的是：

1. `firmware_family`
2. `feature_module_code`
3. `channel_role / io_kind`
4. `command_code / alarm_code / reject_code`

## 18. 一句话结论

你这个判断是对的。  
不能把它理解成“几个孤立场景模板”，而应该理解成：

- 一块板
- 一套统一固件
- 多个功能模块
- 平台按资源组合

这样现有硬件接口能满足的能力，就都可以被统一编排，而不是每来一个组合就再做一套新协议。

