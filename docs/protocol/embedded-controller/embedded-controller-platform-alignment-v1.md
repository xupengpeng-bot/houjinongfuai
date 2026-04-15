# 嵌入式控制器与现有平台对齐方案 v1

## 1. 目标

这份文档只回答一个问题：

- 在现有平台能力上
- 怎么把嵌入式控制器接入做得更顺
- 怎么做到少配置
- 怎么尽量自识别

重点不是重新设计平台，而是：

- 复用现有对象模型
- 复用现有字段
- 复用现有后台入口
- 只做必要收口

## 2. 现有平台已经具备的能力

从当前代码看，现有平台已经有 4 个非常关键的基础。

### 2.1 设备类型表本身就支持扩展配置

`device_type` 现在已经有：

- `capability_json`
- `default_config_json`
- `form_schema_json`

这意味着平台天然就能承载：

- 设备能力描述
- 默认配置模板
- 表单参数模板

相关结构见 [002_init_objects.sql](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/backend/sql/migrations/002_init_objects.sql) 和当前字典扩展 [024_device_type_dictionary_expansion.sql](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/backend/sql/migrations/024_device_type_dictionary_expansion.sql)。

### 2.2 设备台账已经支持项目/地块/来源绑定

`device` 当前通过 `ext_json` 已经支持：

- `project_id`
- `block_id`
- `source_module`
- `source_node_code`
- `source_unit_code`
- `imei`
- `iccid`
- `module_model`
- `firmware_version`

也就是说，控制器完全可以：

- 先按项目/地块入台账
- 先按点位来源挂上
- 后面再补资产

相关代码见 [device-ledger.dto.ts](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/backend/src/modules/device-ledger/device-ledger.dto.ts) 和 [device-ledger.repository.ts](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/backend/src/modules/device-ledger/device-ledger.repository.ts)。

### 2.3 工作台已经能自动创建运行设备

工作台现在已经会根据图上的点位节点自动初始化设备，而且会把设备绑到：

- `project_id`
- `block_id`
- `source_node_code`
- `source_unit_code`

相关逻辑在：

- [networkWorkbenchDraft.ts](D:/Develop/houji/houjinongfuAI-Cursor/lovable-working/src/features/waterflow/lib/networkWorkbenchDraft.ts)
- [networkWorkbenchBatchInit.ts](D:/Develop/houji/houjinongfuAI-Cursor/lovable-working/src/features/waterflow/lib/networkWorkbenchBatchInit.ts)

### 2.4 设备类型字典已经有一批灌溉设备基础项

当前 `device_type` 字典里已经有：

- `TYPE-S08-WELL`
- `TYPE-S08-PUMP`
- `TYPE-S08-VALVE`
- `TYPE-S08-METER`
- `TYPE-S08-PRESSURE`
- `TYPE-S08-FLOW`
- `TYPE-S08-LEVEL`
- `TYPE-S08-WEATHER`
- `TYPE-S08-GATEWAY`
- `TYPE-S08-PLC`
- `TYPE-S08-VFD`
- `TYPE-S08-REMOTEIO`

这些不是最终答案，但说明平台并不是从零开始。

## 3. 现有平台里不顺的地方

虽然基础不错，但现在有 4 个地方和“少配置、自识别”是冲突的。

### 3.1 设备表单仍然偏“手工台账录入”

当前前端设备表单仍然默认要求：

- 手工选设备类型
- 手工选资产
- 手工填位置

这更像传统台账录入，不像硬件接入。

相关前端在 [DeviceFormDialog.tsx](D:/Develop/houji/houjinongfuAI-Cursor/lovable-working/src/components/ops/DeviceFormDialog.tsx)。

### 3.2 工作台初始化仍然偏“一个功能一个设备”

当前工作台会按节点拆成：

- 控制器
- 压力采集器
- 流量采集器
- 水表采集器

这对“多个物理设备”是对的，但对“同一块板带多种功能”是不顺的。  
例如一块板既控变频器，又采压力和流量，不应该拆成 3 台设备台账。

### 3.3 设备类型管理页还没把高级模板用起来

现有设备类型页只暴露了：

- 分类
- 首选通信标识
- 是否支持控制/遥测/定位

但没有把：

- `capability_json`
- `default_config_json`
- `form_schema_json`

真正转成平台可配置能力。

相关前端在 [DeviceTypeFormDialog.tsx](D:/Develop/houji/houjinongfuAI-Cursor/lovable-working/src/components/device-types/DeviceTypeFormDialog.tsx)。

### 3.4 平台还没有“控制器配置页”这个明确入口

现在有：

- 点位/地块
- 工作台
- 设备台账

但还没有一层很明确的：

- 控制器安装与配置

所以流程容易在：

- 工作台
- 设备台账
- 资产台账

之间绕来绕去。

## 4. 结合现有平台，我建议的主收口

核心建议是：

- 继续沿用 `点位 -> 控制器 -> 终端单元`
- 但在设备台账里，把“控制器”作为主设备
- 集成在同一板上的采集/控制能力，不默认拆成多台设备

### 4.1 控制器是主设备

对一块有 IMEI 的板：

- 在设备台账里只创建 `1` 条主设备记录

这条主记录承载：

- `device_type`
- `imei`
- `firmware_family`
- `module_model`
- `firmware_version`
- `project_id`
- `block_id`
- `source_node_code`
- `controller_config`

### 4.2 集成功能不默认拆成多个设备

如果同一块板上集成：

- 变频器控制
- 压力采集
- 流量采集

那么默认只是一台控制器设备。  
其内部能力通过：

- `feature_modules`
- `channel_bindings`

表达，不需要再建：

- 压力采集器设备
- 流量采集器设备

### 4.3 只有“物理独立硬件”才拆成额外设备

例如：

- 独立网关
- 独立 VFD 面板
- 独立 RS485 仪表
- 独立扩展 IO

这类才在设备台账里另建设备。

## 5. 最小改造下，字段应该怎么用

为了尽量不动大结构，我建议直接复用现有 3 类字段。

### 5.1 `device_type.capability_json`

用于定义：

- 这类控制器支持哪些功能模块
- 默认有哪些硬件资源
- 支持哪些自识别字段

建议放：

```json
{
  "firmware_family": "FW_H2_UNIFIED",
  "supports_control": true,
  "supports_telemetry": true,
  "feature_modules": [
    "pump_vfd_control",
    "single_valve_control",
    "pressure_acquisition",
    "flow_acquisition",
    "soil_moisture_acquisition",
    "soil_temperature_acquisition",
    "power_monitoring"
  ],
  "resource_inventory": {
    "relay_output": 2,
    "digital_input": 2,
    "analog_input": 2,
    "pulse_input": 1,
    "rs485_modbus": 1,
    "power_monitor": 1
  },
  "auto_identity_keys": ["imei", "hardware_sku", "firmware_family"]
}
```

### 5.2 `device_type.default_config_json`

用于定义：

- 默认模块组合
- 默认通道模板
- 针对点位类型的自动映射规则

建议放：

```json
{
  "bindingDefaults": {
    "scope": "node",
    "nodeTypes": ["source_station", "outlet", "sensor"],
    "role": "primary_controller"
  },
  "autoProfiles": {
    "source_station": {
      "feature_modules": ["pump_vfd_control", "pressure_acquisition", "flow_acquisition", "power_monitoring"]
    },
    "outlet": {
      "feature_modules": ["single_valve_control", "valve_feedback_monitor"]
    },
    "sensor:soil": {
      "feature_modules": ["soil_moisture_acquisition", "soil_temperature_acquisition"]
    }
  },
  "channelTemplates": {
    "pump_vfd_control": [
      { "channel_code": "CH_RELAY_1", "channel_role": "vfd_run", "io_kind": "relay_output" }
    ],
    "pressure_acquisition": [
      { "channel_code": "CH_AI_1", "channel_role": "pressure_sensor", "io_kind": "analog_input" }
    ]
  }
}
```

### 5.3 `device.ext_json`

用于放某一台控制器的实际配置状态。

建议放：

- `firmware_family`
- `config_version`
- `feature_modules`
- `channel_bindings`
- `runtime_rules`
- `last_register_payload`
- `auto_identified`

## 6. 平台怎样做到少配置

建议平台固定成下面这条最短流程。

### 第一步：先有点位

仍然通过：

- 地块 -> 管网工作台 -> 点位

来确定空间归属。

### 第二步：给点位安装控制器

在点位下点“安装控制器”，只填最少字段：

- `IMEI`
- 控制器名称

如果 `IMEI` 还不知道，也可以先建占位控制器。

### 第三步：平台自动识别基础身份

设备第一次 `REGISTER` 后，平台自动回填：

- `hardware_sku`
- `module_model`
- `firmware_family`
- `firmware_version`
- `resource_inventory`

这些都来自设备上报，不用人填。

### 第四步：平台自动推荐功能组合

平台根据：

- 点位类型
- `source_kind`
- `firmware_family`
- `resource_inventory`
- `device_type.default_config_json.autoProfiles`

自动推荐模块组合。

例如：

- 点位是 `source_station`
  - 默认推荐 `pump_vfd_control + pressure_acquisition + flow_acquisition`
- 点位是 `outlet`
  - 默认推荐 `single_valve_control + valve_feedback_monitor`
- 点位是 `sensor` 且 `sensor_kind=soil`
  - 默认推荐 `soil_moisture_acquisition + soil_temperature_acquisition`

### 第五步：用户只补差异参数

只让用户补最少参数。

例如：

- 压力量程
- 流量脉冲系数
- RS485 从站地址
- 阀门超时时间

不要让用户去选：

- 设备分类
- 通道编码
- 大段 JSON

## 7. 平台怎样做到尽量自识别

我建议把自识别分成 3 层。

### 第一层：通信身份自识别

通过 `REGISTER` 自动识别：

- `imei`
- `hardware_sku`
- `firmware_family`
- `firmware_version`

这层完全自动。

### 第二层：点位归属自识别

如果控制器是从工作台安装出来的，占位设备已经带：

- `project_id`
- `block_id`
- `source_node_code`

那么设备上线后，平台可以直接自动归位到对应点位。

### 第三层：功能组合自识别

基于：

- 点位类型
- 设备类型默认模板
- 板卡资源

自动生成候选配置。

只有在下面几种情况才让人确认：

- 有多个候选组合
- 资源冲突
- 需要选 RS485 设备协议模板

## 8. 结合现有平台，我建议怎么收口

### 8.1 新增一个“统一控制器设备类型”

建议增加一个新的设备类型，例如：

- `TYPE-S08-H2-UNIFIED`

它不是：

- 单个传感器
- 单个阀控器
- 单个泵控器

而是：

- 可组合控制器

### 8.2 保留现有 `TYPE-S08-*` 作为物理独立设备类型

当前这些类型不要删：

- `TYPE-S08-VFD`
- `TYPE-S08-PRESSURE`
- `TYPE-S08-FLOW`
- `TYPE-S08-VALVE`

但建议它们以后用于：

- 真正独立的外设
- 独立 RS485 仪表
- 独立控制器

而不是默认用于“一块集成板”的内部能力拆分。

### 8.3 工作台初始化逻辑要改成“优先生成主控制器”

当前工作台会按节点拆出多个设备。  
建议改成：

- 如果点位使用的是集成控制器类型
  - 默认只生成 `1` 台主控制器设备
- 压力、流量、土壤墒情这些作为通道配置，不单独建台账设备

### 8.4 设备表单要从“资产优先”改成“点位/项目优先”

后端现在已经支持：

- `asset_id` 或 `project_id`

但前端设备表单仍然要求资产。  
建议改成：

- 优先选点位/项目/地块
- 资产改成可空、后补

### 8.5 设备类型页增加管理员级高级配置

普通用户不要看到复杂 JSON。  
但管理员需要能维护：

- `capability_json`
- `default_config_json`
- `form_schema_json`

否则“少配置、自识别”没有落脚点。

## 9. 最顺的后台使用方式

如果完全贴现有平台，我建议后台最终就是下面 4 步。

### 9.1 从点位进入安装控制器

不要从资产页起步。  
从：

- 点位详情
- 或工作台点位右侧面板

进入“安装控制器”。

### 9.2 只填最小字段

只填：

- `IMEI`
- 控制器名称

其余尽量自动识别。

### 9.3 自动带出模板

平台自动带出：

- 默认设备类型
- 默认功能模块
- 默认通道模板

### 9.4 只补关键参数

用户只需要补：

- 压力量程
- 流量系数
- 阀门时长
- RS485 传感器模板

## 10. 我建议的优先级

如果按最小代价落地，我建议顺序是：

1. 增加 `TYPE-S08-H2-UNIFIED`
2. 把 `capability_json/default_config_json/form_schema_json` 真正用起来
3. 工作台初始化改成“集成板优先单设备”
4. 设备表单改成“项目/地块优先，资产后补”
5. `REGISTER` 自动回填设备身份

## 11. 一句话结论

结合现有平台，最顺的做法不是重做一套控制器系统，而是：

- 继续用现有 `device_type`
- 继续用现有 `device.ext_json`
- 继续用现有工作台点位模型
- 把“一个功能一个设备”收成“一个控制器 + 多个功能模块 + 多个通道”
- 再通过设备注册做自动识别和自动带出

这样既贴现有平台，又能做到少配置，甚至在大部分场景下实现半自动配置。
