# 嵌入式控制器 Profile 与平台配置规范 v1

## 1. 目标

这份文档只解决一件事：

- 同一块控制器板卡
- 在不同业务场景下
- 如何通过 `profile + channel_map + config_version`
- 让嵌入式和平台都走同一套流程

不讨论：

- 板卡怎么画
- 硬件 BOM 怎么裁剪
- 采购和资产台账怎么入账

讨论范围只到：

- 嵌入式北向接口
- 平台配置模型
- 平台到设备的交互规则
- 典型场景如何配置

## 2. 总体原则

建议固定这 4 条原则：

1. 一块板只暴露一个通信身份
   - 即一个 `IMEI`
   - 平台把它认作一个 `controller`

2. 不按“板型”切业务
   - 按 `firmware_profile` 切业务

3. 不按 MCU 引脚做平台配置
   - 按逻辑通道 `channel_code` 配置

4. 平台运行依赖“控制器 + 通道 + 终端单元”
   - 不依赖资产先建好

## 3. 平台对象模型

结合现有平台，建议继续沿用：

- `点位 -> 控制器 -> 终端单元`

对应到嵌入式，建议是：

- `point`
  - 机井
  - 泵站
  - 控制点
  - 监测点

- `controller`
  - 一台有 IMEI 的控制器
  - 即这一块板

- `channel`
  - 控制器内部的逻辑通道

- `terminal_unit`
  - 平台里的泵、阀、传感器等终端对象
  - 通过通道绑定到控制器

### 3.1 推荐关系

- 一个点位 `1:N` 控制器
- 一个控制器 `1:N` 通道
- 一个通道 `0..1` 绑定一个终端单元
- 一个终端单元 `0..1` 关联一条资产记录

关键判断：

- 运行、联动、仿真主要依赖 `控制器 + 通道 + 终端单元`
- 资产绑定放后面，不作为主流程前置

## 4. 控制器主身份字段

平台和固件都要冻结这些主字段：

- `imei`
- `hardware_sku`
- `hardware_rev`
- `firmware_version`
- `firmware_profile`
- `controller_role`
- `deployment_mode`
- `config_version`
- `capabilities`

### 4.1 推荐取值

- `hardware_sku`
  - `H2`

- `firmware_profile`
  - `FW_VFD_PRESSURE_FLOW`
  - `FW_VALVE_SINGLE`
  - `FW_SOIL_MONITOR`

- `controller_role`
  - `water_source_controller`
  - `valve_controller`
  - `monitor_controller`

- `deployment_mode`
  - `standalone`
  - `station_child`

## 5. 通道模型

平台永远只配置逻辑通道，不配置物理引脚。

### 5.1 通道核心字段

```json
{
  "channel_code": "CH_AI_1",
  "channel_type": "sensor",
  "channel_role": "pressure_sensor",
  "io_kind": "analog_input",
  "enabled": true,
  "bind_target_code": "e18",
  "unit": "MPa",
  "sample_interval_sec": 10,
  "value_scale": {
    "raw_min": 4.0,
    "raw_max": 20.0,
    "engineering_min": 0.0,
    "engineering_max": 1.6
  }
}
```

### 5.2 建议冻结的 `channel_type`

- `actuator`
- `sensor`
- `feedback`
- `bus`
- `power`

### 5.3 建议冻结的 `io_kind`

- `relay_output`
- `motor_driver`
- `digital_input`
- `analog_input`
- `pulse_input`
- `rs485_modbus`
- `power_monitor`

### 5.4 建议冻结的 `channel_role`

- `pump_start`
- `pump_stop`
- `vfd_run`
- `vfd_setpoint`
- `valve_open`
- `valve_close`
- `valve_feedback`
- `pressure_sensor`
- `flow_sensor`
- `level_sensor`
- `soil_moisture_sensor`
- `soil_temperature_sensor`
- `power_sensor`
- `alarm_input`
- `reserved`

## 6. 协议主线

不换协议，继续沿用：

- `tcp-json-v1`
- `REGISTER`
- `HEARTBEAT`
- `STATE_SNAPSHOT`
- `RUNTIME_TICK`
- `RUNTIME_STOPPED`
- `ALARM_REPORT`
- `COMMAND_ACK`
- `COMMAND_NACK`

真正新增的不是消息类型，而是 `payload` 语义。

## 7. REGISTER 规范

首次注册时，建议固定带：

```json
{
  "protocol_version": "tcp-json-v1",
  "msg_type": "REGISTER",
  "imei": "860000000000001",
  "msg_id": "MSG-REG-0001",
  "seq_no": 1,
  "device_ts": "2026-04-07T12:00:00Z",
  "payload": {
    "hardware_sku": "H2",
    "hardware_rev": "A1",
    "firmware_version": "1.0.0",
    "firmware_profile": "FW_VFD_PRESSURE_FLOW",
    "controller_role": "water_source_controller",
    "deployment_mode": "standalone",
    "config_version": 3,
    "capabilities": [
      "relay_output",
      "analog_input",
      "pulse_input",
      "rs485_modbus",
      "4g"
    ]
  }
}
```

平台收到后只做 4 件事：

1. 识别 `IMEI`
2. 识别当前 `profile`
3. 比对 `config_version`
4. 决定是否下发 `SYNC_CONFIG`

## 8. STATE_SNAPSHOT 规范

所有 profile 都共用一套快照骨架：

```json
{
  "protocol_version": "tcp-json-v1",
  "msg_type": "STATE_SNAPSHOT",
  "imei": "860000000000001",
  "msg_id": "MSG-STATE-0001",
  "seq_no": 25,
  "device_ts": "2026-04-07T12:05:00Z",
  "run_state": "IDLE",
  "power_state": "ON",
  "alarm_codes": [],
  "payload": {
    "firmware_profile": "FW_VFD_PRESSURE_FLOW",
    "config_version": 3,
    "controller_state": {
      "online": true,
      "mode": "remote",
      "battery_voltage": 12.6,
      "solar_voltage": 18.9
    },
    "channels": []
  }
}
```

平台要求：

- `controller_state` 必填
- `channels` 必填
- 通道只上报“当前 profile 启用的通道”

## 9. 下行命令规范

下行仍然沿用：

- `START_COMMAND`
- `STOP_COMMAND`
- `QUERY_STATE`

细分动作放到：

- `payload.command_code`

### 9.1 建议冻结的 `command_code`

- `START_PUMP`
- `STOP_PUMP`
- `SET_VFD_RUN`
- `SET_VFD_FREQUENCY`
- `OPEN_VALVE`
- `CLOSE_VALVE`
- `QUERY_CHANNEL_STATE`
- `SYNC_CONFIG`
- `APPLY_PROFILE`
- `SYNC_CLOCK`
- `REBOOT_DEVICE`

### 9.2 ACK/NACK 规则

- `ACK` 只代表“设备接受执行”
- `NACK` 只代表“设备拒绝执行”
- 最终结果看后续状态上报

`COMMAND_ACK` 最少带：

- `command_id`
- `command_code`
- `target_channel_code`
- `accept_state`

`COMMAND_NACK` 最少带：

- `command_id`
- `command_code`
- `reject_code`
- `reject_reason`

## 10. 平台配置模型

后台配置不要让用户自由拼 JSON。  
最顺的方式是：

1. 先选控制器
2. 再选 `profile`
3. 后台自动带出该 profile 的默认通道模板
4. 用户只做少量绑定和阈值调整
5. 平台生成标准配置并下发

### 10.1 平台配置分 4 层

#### 第一层：控制器基础信息

- `imei`
- `point_id`
- `controller_role`
- `firmware_profile`
- `deployment_mode`

#### 第二层：通道映射

- 每个逻辑通道是否启用
- 每个逻辑通道绑定哪个终端单元
- 每个逻辑通道的数据类型和单位

#### 第三层：运行参数

- 采样周期
- 心跳周期
- 控制超时
- 安全联锁
- 阈值范围

#### 第四层：平台策略

- 是否允许远程启动
- 是否允许自动联动
- 是否允许告警自动停机

## 11. SYNC_CONFIG 规范

建议由平台生成统一配置：

```json
{
  "protocol_version": "tcp-json-v1",
  "msg_type": "START_COMMAND",
  "imei": "860000000000001",
  "msg_id": "CMD-CONFIG-0001",
  "seq_no": 105,
  "device_ts": "2026-04-07T12:10:00Z",
  "payload": {
    "command_id": "CFG-20260407-0001",
    "command_code": "SYNC_CONFIG",
    "config_version": 4,
    "config_body": {
      "firmware_profile": "FW_VFD_PRESSURE_FLOW",
      "heartbeat_interval_sec": 60,
      "runtime_tick_interval_sec": 15,
      "channels": [],
      "rules": {}
    }
  }
}
```

设备规则：

- 收到 `SYNC_CONFIG`
- 先校验配置合法性
- 合法则 `ACK`
- 应用成功后在下一次 `STATE_SNAPSHOT` 回带新 `config_version`

## 12. 三个典型场景怎么定义

## 12.1 场景 A：控制变频器，读取压力和流量

### 平台业务含义

- 点位类型：`机井` 或 `泵站`
- 控制器角色：`water_source_controller`
- 固件 profile：`FW_VFD_PRESSURE_FLOW`

### 推荐通道定义

```json
{
  "channels": [
    {
      "channel_code": "CH_RELAY_1",
      "channel_type": "actuator",
      "channel_role": "vfd_run",
      "io_kind": "relay_output",
      "enabled": true,
      "bind_target_code": "e0-pump-1"
    },
    {
      "channel_code": "CH_AI_1",
      "channel_type": "sensor",
      "channel_role": "pressure_sensor",
      "io_kind": "analog_input",
      "enabled": true,
      "bind_target_code": "e18",
      "unit": "MPa",
      "sample_interval_sec": 10
    },
    {
      "channel_code": "CH_PULSE_1",
      "channel_type": "sensor",
      "channel_role": "flow_sensor",
      "io_kind": "pulse_input",
      "enabled": true,
      "bind_target_code": "e19",
      "unit": "m3/h",
      "sample_interval_sec": 10
    }
  ]
}
```

### 平台怎么用最顺

- 工作台里点位下安装控制器
- 选择 profile：`变频器 + 压力 + 流量`
- 平台自动生成 3 个默认通道
- 用户只需要补：
  - 压力量程
  - 流量换算系数
  - 启停超时
  - 低压/高压阈值

### 下行命令怎么用

- 启泵：`SET_VFD_RUN`
- 停泵：`STOP_PUMP`
- 调整频率：`SET_VFD_FREQUENCY`

### 上行快照重点

- 运行状态
- 当前压力
- 当前流量
- 变频器运行状态
- 告警码

## 12.2 场景 B：同一块板控制电磁阀

### 平台业务含义

- 点位类型：`控制点`
- 控制器角色：`valve_controller`
- 固件 profile：`FW_VALVE_SINGLE`

### 推荐通道定义

```json
{
  "channels": [
    {
      "channel_code": "CH_RELAY_1",
      "channel_type": "actuator",
      "channel_role": "valve_open",
      "io_kind": "relay_output",
      "enabled": true,
      "bind_target_code": "e10"
    },
    {
      "channel_code": "CH_DI_1",
      "channel_type": "feedback",
      "channel_role": "valve_feedback",
      "io_kind": "digital_input",
      "enabled": true,
      "bind_target_code": "e10"
    }
  ]
}
```

### 平台怎么用最顺

- 点位下安装控制器
- 选择 profile：`单路阀控`
- 平台自动生成 1 个执行通道 + 1 个反馈通道
- 用户只补：
  - 控制脉冲时长
  - 开阀超时
  - 关阀超时
  - 是否启用到位反馈

### 下行命令怎么用

- 开阀：`OPEN_VALVE`
- 关阀：`CLOSE_VALVE`

### 上行快照重点

- 阀当前状态
- 是否到位
- 控制超时是否发生
- 电池/供电状态

## 12.3 场景 C：采集土壤墒情数据

### 平台业务含义

- 点位类型：`监测点`
- 控制器角色：`monitor_controller`
- 固件 profile：`FW_SOIL_MONITOR`

### 推荐通道定义

```json
{
  "channels": [
    {
      "channel_code": "CH_RS485_1",
      "channel_type": "bus",
      "channel_role": "soil_moisture_sensor",
      "io_kind": "rs485_modbus",
      "enabled": true,
      "bind_target_code": "e30",
      "sample_interval_sec": 300,
      "protocol": {
        "slave_id": 1,
        "baud_rate": 9600,
        "register_map": [
          {
            "metric_code": "soil_moisture",
            "register": 0,
            "data_type": "uint16",
            "scale": 0.1,
            "unit": "%"
          },
          {
            "metric_code": "soil_temperature",
            "register": 1,
            "data_type": "int16",
            "scale": 0.1,
            "unit": "℃"
          }
        ]
      }
    }
  ]
}
```

### 平台怎么用最顺

- 点位下安装控制器
- 选择 profile：`土壤墒情采集`
- 平台自动带出一个 RS485 采集模板
- 用户只补：
  - 从站地址
  - 波特率
  - 寄存器映射模板
  - 采样周期

### 下行命令怎么用

这个场景下基本不做控制，只需：

- `QUERY_STATE`
- `SYNC_CONFIG`
- `SYNC_CLOCK`

### 上行快照重点

- 墒情值
- 土温值
- 传感器离线告警
- RS485 通信状态

## 13. 推荐的后台使用流程

为了让这套流程顺，我建议后台固定成下面 6 步。

### 第一步：创建设备控制器

只录：

- `IMEI`
- 点位
- 控制器名称

不要一上来让用户配所有明细。

### 第二步：选择 profile

让用户从模板选：

- `变频器 + 压力 + 流量`
- `单路阀控`
- `土壤墒情采集`

不要让用户自己拼 profile 名。

### 第三步：自动生成通道模板

平台按 profile 自动生成标准通道。

### 第四步：用户只补业务参数

例如：

- 量程
- 寄存器地址
- 采样周期
- 阈值
- 超时

### 第五步：生成 `config_version`

平台保存配置版本。

### 第六步：下发并回读

- 平台下发 `SYNC_CONFIG`
- 设备 `ACK`
- 平台要求设备回一帧 `STATE_SNAPSHOT`
- 如果快照里的 `config_version` 对上，就算配置生效

## 14. 为什么这套方式最简单

它的好处是：

- 同一块板可以反复复用
- 平台不用按不同硬件写很多套表单
- 嵌入式也不用为每个场景做完全不同的北向协议
- 用户理解的是“我选什么场景模板”
- 平台内部理解的是“profile + channel_map”
- 固件内部理解的是“通道启用与参数配置”

## 15. 我对这块的建议

如果你要让这套流程后面不打架，我建议下一步就冻结 3 张字典：

1. `firmware_profile`
2. `channel_role / io_kind`
3. `command_code / alarm_code / reject_code`

再往后做两件事：

1. 后台设备配置页改成“选模板 + 补参数”
2. 嵌入式按 `SYNC_CONFIG` 做真正的 profile 应用

## 16. 一句话结论

这块板完全可以在不同场景复用。  
关键不是换板，而是把嵌入式接口收敛成：

- `一个控制器身份`
- `一套通道模型`
- `几种固定 profile`
- `平台模板化配置`

这样“变频器 + 压力流量”“单路阀控”“土壤墒情采集”三种场景，都能用同一条主流程跑通。
