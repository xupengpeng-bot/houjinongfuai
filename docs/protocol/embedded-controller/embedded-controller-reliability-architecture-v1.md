# 嵌入式控制器稳定轻量架构方案 v1

## 1. 文档目的

这份文档给当前这套平台提供一份正式、可执行、可验收的嵌入式控制器架构口径。

目标顺序固定为：

1. 稳定
2. 准确
3. 轻量
4. 高效

它不是脱离现状的理想化方案，而是基于当前平台、当前协议、当前后端升级中心、当前 STM32F103 资源约束给出的收敛设计。

## 2. 当前已确认事实

### 2.1 平台与公开协议事实

- 后端与嵌入式当前正式线协议仍然是短协议：
  - `4-byte big-endian length + UTF-8 JSON`
  - 顶层短字段：`v/t/i/m/s/c/r/p`
  - 消息码：`RG/HB/SS/ER/QR/QS/EX/SC/AK/NK`
- 公网 TCP 入口仍为 `xupengpeng.top:32563`
- 本地 TCP 端口仍为 `19001`
- 对外公开协议页仍为 `/ops/interface-protocols`
- 后端已经存在设备命令、消息日志、连接会话、升级任务与升级明细表，说明平台侧已经具备命令真相源和升级作业骨架

### 2.2 嵌入式当前实现事实

- 当前本地 `hartware/` 是工作区默认嵌入式真源
- 当前固件已经具备：
  - `rbt / upg / qgs / qgc`
  - manifest 持久化
  - SHA256 校验
  - HTTP Range 下载
  - boot control 页
  - trial boot 成功确认
- 当前 flash 方案仍是：
  - `16K bootloader`
  - `120K app`
  - `116K staging`
  - `2K ota metadata`
  - `2K boot control`
- 当前配置提交流程已经有“切换 active 配置”的代码路径，但配置存储仍偏内存语义，不足以视为真正抗掉电日志式提交

### 2.3 结论

当前最优路线不是推翻短协议重来，而是：

- 保持线协议兼容
- 升级业务语义
- 补齐设备侧可靠性
- 收紧平台和设备的控制纪律

## 3. 最终架构决策

## 3.1 网络分两面

### 3.1.1 业务控制面

- 只保留一条轻量 TCP 长连接
- 承载：
  - `RG`
  - `HB`
  - `SS`
  - `ER`
  - `SC`
  - `QR`
  - `QS`
  - `EX`
  - `AK`
  - `NK`

### 3.1.2 OTA 下载面

- 固件包只允许通过 `HTTP/HTTPS` 下载
- 下载链路只承载制品，不承载业务语义
- 允许 `Range` 续拉
- 不允许平台通过业务长连接推送固件大包

## 3.2 线协议保持兼容，先不切二进制定长头

当前阶段不把设备主线协议切成新的固定二进制头。

原因：

- 后端、前端公开协议页、联调脚本和现有固件已经围绕短 JSON 协议冻结
- 对 48K RAM 设备来说，业务稳定性收益主要来自状态机和存储可靠性，而不是立即更换 envelope
- 直接切头部格式会把风险同时扩散到三端

当前阶段的正式口径是：

- wire format 继续保持 `4-byte BE length + compact JSON`
- 语义层升级为更严格的同步、异步、租约、OTA、回滚规则
- 后续如果确有必要，可在未来增加协商式 `V2` 头，但必须双栈兼容，不进入本阶段主方案

## 3.3 控制类指令硬约束

这是本方案新增并冻结的硬规则。

### 3.3.1 不允许设备侧控制队列

- 控制类 `EX` 不允许设备侧保留待执行队列
- 不允许离线缓存控制命令
- 不允许“先收下，稍后慢慢执行”的控制语义

### 3.3.2 不允许设备侧控制缓存

- 设备侧不保存普通控制命令缓存
- 当前控制指令结束后，本地上下文立即清空
- “结束”包括：
  - 已完成
  - 已拒绝
  - 已超时
  - 已明确失败

### 3.3.3 同一时刻只允许一条副作用控制在途

- 同一设备同一时刻只允许一条副作用控制在途
- 当前指令未结束前，新的控制类 `EX` 一律返回忙或拒绝
- 这条规则适用于：
  - `spu`
  - `tpu`
  - `ovl`
  - `cvl`
  - `pas`
  - `res`
  - 其它未来副作用动作

### 3.3.4 不允许自动回放历史控制

- 设备重连后不得自动重放历史控制命令
- 设备重启后不得自动重放历史控制命令
- 平台超时后如需再次执行，必须重新生成新的控制命令并重新判定幂等

### 3.3.5 审计与设备执行分离

平台可以保留：

- `device_command`
- `device_message_log`
- 审计和超时恢复记录

但这些是平台真相源，不表示设备侧允许保留待执行控制队列。

### 3.3.6 OTA 是唯一例外，但不算控制队列

OTA 允许设备持久化：

- manifest
- 下载偏移
- 校验状态
- boot control

这是升级事务状态，不属于普通控制命令缓存或控制队列。

## 3.4 查询类与控制类分治

### 3.4.1 查询类

- `qcs / qwf / qem / qgs / qgc` 保持 sync-first
- 同一时刻只允许单条查询在途
- 查询允许平台侧短时重试

### 3.4.2 控制类

- 控制类只返回接受决策，不做设备侧排队
- 副作用控制集合应按正式短码治理：`spu / tpu / ovl / cvl / pas / res / ppu / upg / rbt`
- `AK` 表示设备接受本次执行请求
- `NK` 表示设备明确拒绝
- `rbt` 必须先完成 ACK 发送，再允许进入 MCU 重启；不能在 EX 处理函数里直接硬复位
- 当 OTA 工作流活跃，或灌溉会话处于 `STARTING / RUNNING / STOPPING` 时，`rbt` 必须返回 `NK / DEVICE_BUSY`
- 最终状态仍以 `ER + SS` 收敛

## 3.5 心跳改为租约续命，不再傻发全量体征

### 3.5.1 正式规则

- 心跳语义改为 lease keepalive
- 默认租约窗口建议 `30s ~ 60s`
- `heartbeat_interval_sec` 必须是平台可配置项，由 `runtime config / runtime_rules` 正式下发
- 在租约窗口内如果已有任何上行业务消息：
  - `SS`
  - `ER`
  - `QS`
  - 其它业务上报
  不再额外补发冗余 `HB`

### 3.5.2 心跳最小字段

建议 `HB` 最小只保留：

- `wf`
- `cv`
- `csq`
- `bs`
- `bv`
- `sv`
- `ota_stage`
- `reboot_reason`
- `queue_depth`
- `cap_hash`

其中没有值的字段不传。

### 3.5.3 全量状态快照

- 全量 `SS` 只在状态变化、动作后、保护后、或较长周期上报
- `snapshot_idle_interval_sec` 与 `snapshot_running_interval_sec` 必须是平台可配置项，由 `runtime config / runtime_rules` 正式下发
- 空闲期建议 `5 ~ 10` 分钟一次全量快照
- 运行期可维持较短快照周期，但仍应比 `HB` 更重、更少

## 3.6 能力集版本化

注册时一次性上报：

- `proto_ver`
- `cap_ver`
- `cap_hash`
- `modules_bitmap`
- `config_bitmap`
- `actions_bitmap`
- `queries_bitmap`
- `limits`

其中能力集不是只描述模块或动作。
正式能力集至少同时覆盖：

- 配置项能力：设备可接收、校验、提交、激活的配置项与配置域
- 控制项能力：设备允许执行的副作用动作与目标范围
- 查询项能力：设备允许返回的查询码与结果集合
- 限制项能力：并发、块大小、重试、供电门槛、信号门槛等运行边界

`fm` 或 `modules_bitmap` 只表示模块声明，不等于完整能力集。
平台必须依据 `cap_hash` 同时治理配置入口、查询入口和控制入口，不能只按动作能力放行。

后续 `HB` 只带：

- `cap_hash`
- `config_ver`

平台依据 `cap_hash` 控制可下发配置、可发起查询、可执行动作，不能只靠文档口头约定。

## 3.7 配置存储必须改成日志式双页提交

### 3.7.1 当前问题

当前配置代码已有 active/inactive 切换语义，但还不足以作为真正抗掉电配置提交方案。

### 3.7.2 正式方案

配置固定分三层：

- `factory config`
- `runtime config`
- `shadow config`

提交流程固定为：

1. `prepare`
2. `validate`
3. `commit`
4. `activate`

每份配置记录必须带：

- `seq`
- `schema_ver`
- `length`
- `crc32`

### 3.7.3 掉电要求

- 任意掉电点都必须能恢复到最后一份完整配置
- 禁止原地覆盖当前生效配置
- 禁止只有内存双槽、没有 flash 日志页的提交方案被视为完成

## 3.8 安全面

### 3.8.1 传输安全优先级

优先级固定为：

1. 4G 模组做 TLS 卸载
2. 如果 TLS 当前不稳，则至少对关键命令和 manifest 做签名校验

### 3.8.2 命令级安全

当 TLS 不能完全依赖时，关键命令至少带：

- `nonce`
- `expire_at`
- `session_nonce`
- `hmac_sha256`

### 3.8.3 固件授权

设备绝不能只因为拿到 URL 就相信该制品可执行。

必须先验：

- 签名 manifest
- 目标机型
- 目标版本
- 包摘要
- 最低电量
- 最低信号
- 过期时间

## 3.9 OTA 正式方案

### 3.9.1 设备只认 manifest，不直接认裸 URL

manifest 至少包含：

- `model`
- `class_id`
- `target_version`
- `artifact_id`
- `size`
- `sha256`
- `etag`
- `url`
- `min_battery`
- `min_signal`
- `expire_at`
- `signature`

### 3.9.2 下载前门禁

下载前必须校验：

- `HTTP 200/206`
- `Content-Type = application/octet-stream`
- `Content-Length`
- `ETag`
- `Accept-Ranges = bytes`

### 3.9.3 OTA 阶段

平台与设备统一阶段口径：

- `accepted`
- `downloading`
- `downloaded`
- `verified`
- `staged`
- `scheduled`
- `rebooting`
- `boot_confirmed`
- `failed`

### 3.9.4 成功判定

- `AK` 不算升级成功
- `downloading/installing/rebooting` 不算升级成功
- 平台只在 `boot_confirmed` 后判定升级成功

## 3.10 Boot 与回滚

### 3.10.1 当前实现判断

当前实现属于：

- 单应用槽
- 单 staging 区
- trial boot 确认

它已经比“直接覆写应用”安全很多，但还不是完整 A/B 回滚。

### 3.10.2 本阶段正式说法

当前可表述为：

- 支持 staged upgrade
- 支持 boot confirm
- 支持失败后不立即把升级判成功

当前不可表述为：

- 已具备完整双槽 A/B 回滚

### 3.10.3 目标布局

如果应用能压到 `104K` 以内，建议目标布局为：

- `16K bootloader`
- `104K Slot A`
- `104K Slot B`
- `32K config/journal/meta`

若镜像压不进该上限，本阶段第一优先级应为缩镜像，而不是继续叠协议复杂度。

## 4. 资源预算建议

### 4.1 RAM

- RX ring：`2KB`
- TX staging：`512B ~ 768B`
- 协议解析：`1KB`
- OTA chunk：`512B ~ 1024B`
- 控制上下文：`1` 条
- 查询上下文：`1` 条
- 幂等去重环：`8 ~ 16` 条

### 4.2 Flash

- bootloader：`16K ~ 24K`
- app slot：当前先收敛到 `<=120K`，目标压到 `<=104K`
- staging / B slot：与上面对应
- config + journal + boot flags：建议 `>=16K`

## 5. 与当前代码的差距

当前最关键差距有三个：

1. 控制类指令的“不缓存、不排队、结束即清空”还没有作为正式平台协议规则冻结
2. 配置提交还缺真正 flash 双页日志式提交
3. 当前 boot 仍是 staging copy 路线，不是完整 A/B 回滚

## 6. 落地优先级

### 6.1 第一阶段

- 冻结控制类指令无缓存无队列规则
- 冻结 OTA 只认 `boot_confirmed` 成功
- 冻结租约式心跳规则
- 冻结 manifest 必带 `etag`，并强校验 `Content-Type / ETag / Accept-Ranges / Content-Length`

### 6.2 第二阶段

- 实现 flash 双页配置日志
- 实现持久化幂等环
- 把 `cap_hash` 和配置版本正式纳入治理

### 6.3 第三阶段

- 压缩镜像体积
- 迁移到真双槽 A/B
- 完整确认回滚

## 7. 最终冻结结论

对于当前这套平台，最合适的正式方案是：

- 线协议保持现有短 JSON 兼容口径
- 业务面和制品面彻底分离
- 控制类指令不缓存、不排队、当前指令结束即清空
- 查询 sync-first，控制 single-inflight
- 心跳改为 lease keepalive
- 配置改为日志式双页提交
- OTA 改为签名 manifest + HTTP/HTTPS Range 下载
- 平台只在 `boot_confirmed` 后判定升级成功
- 只有镜像压缩到位后，才进入完整双槽回滚

这就是当前阶段“稳定、准确、轻量、可演进”的正式口径。
