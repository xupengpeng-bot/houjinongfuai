# Embedded Controller OTA Spec v1

## 1. 目的

这份文档专门定义控制器固件升级接口。

目标：

- 保留老系统“准备 -> 分发 -> 校验 -> 切换 -> 完成”的升级语义
- 但不再沿用老字符串分包协议作为新主方案
- 与现有 `tcp-json-v1`、现有平台设备台账和配置体系兼容
- 让平台侧使用简单，嵌入式侧实现可控

## 2. 结论先行

有规划，而且建议按下面这个口径冻结：

- 升级接口属于 `common` 侧的维护能力，不属于 `workflow` 业务流程
- 顶层协议仍然是一套 `tcp-json-v1`
- OTA 不单独再开第二套业务协议
- 但 OTA 最好从 `SYNC_CONFIG` 中独立成明确的 `EXECUTE_ACTION + EVENT_REPORT + QUERY` 子流程
- 固件包分发方式优先采用“设备拉取”而不是“平台按 TCP 一包一包推送”

也就是：

- 平台通过现有长连接“发升级任务”
- 设备再按 manifest 去下载升级包
- 升级过程通过统一上报事件和查询状态完成闭环

## 3. 为什么不建议继续用老式分包推送

老项目里升级命令链是：

- `AUS`
- `AUB`
- `AUP`
- `AUM`
- `AUT`

这一套语义本身没问题，代表：

- 升级导航
- 分块导航
- 分包写入
- 校验
- 结束切换

但如果新系统继续完全照搬“平台通过 TCP 长连接逐包推送固件块”，会有几个问题：

- 后端和网关都要承担大文件分包、断点续传、重传和粘包处理
- JSON 长连接不适合长期承载大体量固件块
- 平台压力会比“设备自拉取”大得多
- 后续如果升级包大起来，联调和重试成本会很高

所以建议：

- 保留老流程语义
- 替换底层分发方式

## 4. 推荐升级模式

推荐主模式：

- `Manifest + URL Pull OTA`

流程是：

1. 平台下发升级任务
2. 设备收到 manifest
3. 设备自检
4. 设备通过 HTTP/HTTPS 下载升级包
5. 下载完成后本地校验
6. 写入升级区
7. 切换启动区
8. 重启
9. 重新 `REGISTER`
10. 平台确认版本更新成功

## 5. 接口归属

## 5.1 语义层归属

OTA 建议归到：

- `scope=common`

原因：

- 它是设备维护能力
- 不是模块业务能力
- 也不是灌溉 workflow 流程

## 5.2 顶层消息怎么用

升级只使用已有顶层消息：

- `QUERY`
- `EXECUTE_ACTION`
- `EVENT_REPORT`
- `COMMAND_ACK`
- `COMMAND_NACK`
- `REGISTER`

必要时可用：

- `STATE_SNAPSHOT`

不建议把 OTA 主流程继续塞进 `SYNC_CONFIG`。  
`SYNC_CONFIG` 更适合配置同步，不适合承载整个升级事务。

## 6. 固定接口目录

## 6.1 查询接口

### `QUERY scope=common query_code=query_upgrade_status`

用于查询当前升级状态。

返回建议字段：

```json
{
  "upgrade_status": {
    "ota_stage": "idle",
    "ota_state": "IDLE",
    "target_version": null,
    "current_version": "1.3.0",
    "package_sha256": null,
    "package_etag": null,
    "download_progress_pct": 0,
    "write_progress_pct": 0,
    "last_result": "NONE",
    "last_error_code": null,
    "last_error_message": null
  }
}
```

### `QUERY scope=common query_code=query_upgrade_capability`

返回：

- 是否支持 OTA
- 当前双分区能力
- 支持的包格式
- 支持的压缩格式
- 最低电量要求
- 最低信号要求

## 6.2 动作接口

### `EXECUTE_ACTION scope=common action_code=ota_prepare`

作用：

- 平台发起升级任务
- 下发升级 manifest

建议 payload：

```json
{
  "target_version": "1.4.0",
  "package_url": "https://example.com/fw/h2-1.4.0.bin",
  "package_size": 524288,
  "package_etag": "artifact-h2-1.4.0-abcd1234",
  "package_sha256": "abc123...",
  "package_format": "raw-bin",
  "min_battery_soc": 40,
  "min_signal_csq": 10,
  "force_upgrade": false,
  "allow_running_upgrade": false,
  "upgrade_ticket": "OTA-20260407-0001"
}
```

设备收到后只做准备与校验，不立即切换版本。

下载前必须校验：

- `Content-Type=application/octet-stream`
- `Accept-Ranges=bytes`
- 响应 `ETag` 与 manifest 一致
- `Content-Length` 与剩余包大小一致

### `EXECUTE_ACTION scope=common action_code=ota_start`

作用：

- 正式开始下载和写入

如果 `ota_prepare` 已经通过校验，这一步才可执行。

### `EXECUTE_ACTION scope=common action_code=ota_cancel`

作用：

- 取消尚未提交的升级任务

### `EXECUTE_ACTION scope=common action_code=ota_commit`

作用：

- 下载和校验都成功后，允许切换版本并重启

如果希望“下载完成即自动提交”，也可以在 `ota_prepare` 中带：

- `auto_commit = true`

### `EXECUTE_ACTION scope=common action_code=ota_rollback`

作用：

- 回滚到旧版本

前提：

- bootloader 支持双分区或镜像回退

## 6.3 事件接口

### `EVENT_REPORT event_code=ota_precheck_passed`

表示设备完成升级前置检查。

### `EVENT_REPORT event_code=ota_precheck_failed`

建议带：

- `error_code`
- `battery_soc`
- `signal_csq`
- `workflow_state`

### `EVENT_REPORT event_code=ota_download_progress`

建议每 10% 或每 30 秒上报一次。

### `EVENT_REPORT event_code=ota_download_completed`

### `EVENT_REPORT event_code=ota_verify_passed`

### `EVENT_REPORT event_code=ota_verify_failed`

### `EVENT_REPORT event_code=ota_write_completed`

### `EVENT_REPORT event_code=ota_switch_scheduled`

### `EVENT_REPORT event_code=ota_upgrade_succeeded`

### `EVENT_REPORT event_code=ota_upgrade_failed`

### `EVENT_REPORT event_code=ota_rollback_succeeded`

### `EVENT_REPORT event_code=ota_rollback_failed`

## 7. 升级状态机

建议冻结：

- `IDLE`
- `PRECHECKING`
- `PRECHECK_FAILED`
- `READY_TO_DOWNLOAD`
- `DOWNLOADING`
- `DOWNLOAD_FAILED`
- `DOWNLOADED`
- `VERIFYING`
- `VERIFY_FAILED`
- `VERIFIED`
- `WRITING`
- `WRITE_FAILED`
- `READY_TO_SWITCH`
- `SWITCHING`
- `UPGRADED`
- `UPGRADE_FAILED`
- `ROLLING_BACK`
- `ROLLED_BACK`

## 8. 升级前置检查

## 8.1 必须检查

- 当前是否在线
- 当前 TCP 会话是否稳定
- 电池电量是否满足最低要求
- 4G 信号是否满足最低要求
- 当前是否存在关键 workflow 正在运行
- Flash 剩余空间是否足够
- 当前是否已有未完成升级任务

## 8.2 默认拒绝条件

默认应拒绝升级的场景：

- `workflow_state = RUNNING`
- `battery_soc < min_battery_soc`
- `signal_csq < min_signal_csq`
- `storage_space_insufficient`
- `upgrade_state != IDLE`

## 9. 与现有业务流程的关系

升级流程必须独立于灌溉 workflow。

规则：

- workflow 正在运行时，默认拒绝升级
- workflow 未完成结算时，默认拒绝升级
- 不允许通过升级把业务会话直接中断成未知状态

如果业务必须支持“运行时升级”，应单独审批，不纳入第一阶段。

## 10. 老命令映射建议

| 老命令 | 旧语义 | 新语义建议 |
| --- | --- | --- |
| `AUS` | 升级导航 | `ota_prepare` |
| `AUB` | 分块导航 | manifest 中的 chunk / range 信息 |
| `AUP` | 分包写入 | 设备拉取下载或本地写块 |
| `AUM` | MD5 校验 | `ota_verify` |
| `AUT` | 结束切换 | `ota_commit` |

也就是说：

- 老流程语义保留
- 但不再直接暴露老字符串命令给新固件主流程

## 11. 与平台现有功能的对接方式

## 11.1 后台应该怎么配

平台只需要支持：

- 选择设备或设备批次
- 选择目标固件版本
- 上传固件包并生成 `package_url`
- 自动生成 manifest
- 下发 `ota_prepare`
- 查看升级进度和结果

不应该让后台用户配置：

- 固件分包大小
- TCP 分块序号
- 手工 MD5 步骤

## 11.2 设备台账应保存什么

建议在设备扩展信息里保留：

- `firmware_version`
- `firmware_family`
- `last_upgrade_ticket`
- `last_upgrade_result`
- `last_upgrade_at`

## 12. 报文样例建议

后续建议单独补 6 个样例：

1. `query-upgrade-status.json`
2. `ota-prepare.json`
3. `ota-start.json`
4. `ota-download-progress.json`
5. `ota-upgrade-succeeded.json`
6. `ota-upgrade-failed.json`

## 13. Phase 1 / Phase 2 边界

## 13.1 Phase 1 必做

- `query_upgrade_status`
- `ota_prepare`
- `ota_start`
- `ota_cancel`
- `ota_commit`
- 下载进度上报
- 结果上报

## 13.2 Phase 1 可不做

- 差分包
- 多镜像并行
- 断点续传优化
- 自动回滚策略细化

## 13.3 Phase 2 再做

- `ota_rollback`
- 差分升级
- 灰度批次控制
- 更细的失败原因码

## 14. 对嵌入式开发的直接要求

Cursor 后续在固件里应至少预留这些文件：

- `protocol/proto_ota.c`
- `protocol/proto_ota.h`
- `storage/storage_upgrade.c`
- `storage/storage_upgrade.h`
- `workflow/workflow_upgrade_guard.c`
- `workflow/workflow_upgrade_guard.h`

职责分别是：

- `proto_ota.*`
  - 升级命令解析
  - 升级事件上报
  - 升级状态查询

- `storage_upgrade.*`
  - 升级 manifest 持久化
  - 升级中间态持久化
  - 断电恢复升级状态

- `workflow_upgrade_guard.*`
  - 判断当前业务状态是否允许升级

## 15. 最终建议

结论是：

- 升级接口有规划
- 但我建议把它从“泛化配置接口”里抽出来，单独作为 `common` 维护子流程
- 老项目升级命令的语义可以保留
- 新实现方式建议改成“manifest + 设备拉取 + 事件回报”

这样对平台最省事，对嵌入式也最稳。
