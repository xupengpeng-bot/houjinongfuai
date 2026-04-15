# 协议文档说明

## 权威口径

后端与嵌入式之间的 TCP 交互，今后只有一条规则：

- 只使用短协议
- 只使用 `4-byte big-endian length + UTF-8 JSON`
- 只使用短字段 envelope：`v/t/i/m/s/c/r/p`
- 只使用短消息码：`RG/HB/SS/ER/QR/QS/EX/SC/AK/NK`
- 只使用短业务码：`qcs/qwf/qem/spu/tpu/ovl/cvl/...`
- `HB` 采用租约续命语义；已有 `SS/ER/QS` 等上行时不额外补发冗余心跳
- 控制类 `EX` 只允许实时执行；设备侧不缓存、不排队、不自动回放历史控制
- OTA 升级只在 `boot_confirmed` 后由平台判定成功
- `HTTP bridge/pending-commands` 只是 sidecar bridge 交付能力，不是 MCU TCP 主协议的一部分

以下写法都不是 TCP 线协议：

- `protocol/type/imei/msg_id/seq/payload`
- `query_code/action_code/module_code` 作为 TCP 线字段
- `tcp-json-v1` 作为新的嵌入式主协议
- “长 envelope 也可兼容”的理解

## 嵌入式开发入口

嵌入式开发、联调、出包、任务书统一从这里进入：

- [embedded-controller/README.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/README.md)
- [embedded-controller/embedded-controller-reliability-architecture-v1.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-reliability-architecture-v1.md)

## 当前目录用途

- [device-protocol-v2.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/device-protocol-v2.md)
  当前对外 TCP 短协议总说明
- [device-gateway-sidecar-bridge-v1.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/device-gateway-sidecar-bridge-v1.md)
  平台 sidecar bridge 合同，明确与 MCU TCP 主协议的边界
- `examples/embedded-controller-v1/`
  只保留短协议示例
- `schemas/`
  保留配套结构资料

## 约束

- 如果文档和代码注释发生冲突，以“TCP 只走短协议”为准。
- 如果平台内部仍出现长字段，只表示内部归一语义，不表示 MCU 要按长字段组包。
- 新增协议示例时，不要再添加长 envelope、snake_case 顶层字段或 `tcp-json-v1` 示例。
