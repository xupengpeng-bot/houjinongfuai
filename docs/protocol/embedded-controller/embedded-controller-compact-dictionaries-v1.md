# 嵌入式控制器轻量字典 v1

> 注意：本文件中的动作短码历史上存在旧版本。扫码灌溉控制器当前联调请以
> [embedded-controller-irrigation-compact-contract-v2.md](./embedded-controller-irrigation-compact-contract-v2.md)
> 为准。尤其不要继续使用旧动作短码 `st/sp/ps/rs/ov/cv/sv/tv`。

## 1. 目的

这份文档用于冻结“短字段、短码、短模块名”的字典，供：

- 固件实现
- 网关映射
- AI 代码生成
- 联调脚本

共同使用。

原则：

- 线协议短
- 平台存储仍可映射回标准长 code
- 短码一旦冻结，不随意修改

## 2. 字段短码

| 短码 | 长字段 |
| --- | --- |
| `v` | protocol_version / value |
| `t` | message_type |
| `i` | imei |
| `m` | msg_id |
| `s` | seq |
| `c` | correlation_id |
| `r` | session_ref |
| `p` | payload |
| `sc` | scope |
| `ac` | action_code |
| `qc` | query_code |
| `tr` | target_ref |
| `pm` | params / power_mode |
| `rc` | reject_code |

## 3. 模块短码

| 短码 | 长 code |
| --- | --- |
| `pvc` | pump_vfd_control |
| `pdc` | pump_direct_control |
| `svl` | single_valve_control |
| `ebr` | electric_meter_modbus |
| `prs` | pressure_acquisition |
| `flw` | flow_acquisition |
| `sma` | soil_moisture_acquisition |
| `sta` | soil_temperature_acquisition |
| `pwm` | power_monitoring |
| `pay` | payment_qr_control |
| `cdr` | card_auth_reader |
| `vfb` | valve_feedback_monitor |

## 4. 指标短码

| 短码 | 长 code |
| --- | --- |
| `pr` | pressure_mpa |
| `fm` | flow_m3h |
| `pw` | power_kw |
| `vv` | voltage_v |
| `ia` | current_a |
| `ew` | cumulative_energy_wh |
| `ek` | cumulative_energy_kwh |
| `fq` | cumulative_flow |
| `rt` | cumulative_runtime_sec |
| `bs` | battery_soc |
| `bv` | battery_voltage_v |
| `sv` | solar_voltage_v |
| `csq` | signal_csq |

## 5. workflow 状态短码

| 短码 | 长状态 |
| --- | --- |
| `BR` | BOOTING |
| `NR` | ONLINE_NOT_READY |
| `RI` | READY_IDLE |
| `ST` | STARTING |
| `RN` | RUNNING |
| `PA` | PAUSING |
| `PS` | PAUSED |
| `RS` | RESUMING |
| `SP` | STOPPING |
| `ED` | STOPPED |
| `ER` | ERROR_STOP |

## 6. scope 短码

| 短码 | 长语义 |
| --- | --- |
| `cm` | common |
| `md` | module |
| `wf` | workflow |

## 7. 动作短码

| 短码 | 长动作 |
| --- | --- |
| `pas` | pause_session |
| `res` | resume_session |
| `spu` | start_pump |
| `tpu` | stop_pump |
| `ovl` | open_valve |
| `cvl` | close_valve |
| `sf` | set_frequency |
| `rb` | reboot_device |

## 8. 查询短码

| 短码 | 长查询 |
| --- | --- |
| `qcs` | query_common_status |
| `qwf` | query_workflow_state |
| `qms` | query_module_status |
| `qcv` | query_channel_values |
| `qps` | query_power_status |
| `qem` | query_electric_meter |

## 9. 拒绝码短码

| 短码 | 长拒绝码 |
| --- | --- |
| `BZ` | DEVICE_BUSY |
| `UC` | UNSUPPORTED_COMMAND |
| `IC` | INVALID_CHANNEL |
| `CD` | CHANNEL_DISABLED |
| `MN` | MODULE_NOT_ENABLED |
| `CE` | CAPABILITY_NOT_EXPOSED |
| `SI` | SAFETY_INTERLOCK |
| `LB` | LOW_BATTERY |
| `PR` | POWER_NOT_READY |
| `SR` | SENSOR_REQUIRED |
| `PI` | PARAM_INVALID |
| `CV` | CONFIG_VERSION_MISMATCH |
| `EX` | EXPIRED_COMMAND |

## 10. 说明

- 固件侧尽量只使用本字典里的短码。
- 平台网关负责长短码映射。
- 如果新增短码，必须同步更新这份字典和实现任务书。
