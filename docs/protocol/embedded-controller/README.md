# 嵌入式控制器开发规范

## 入口说明

嵌入式控制器、固件、联调、4G 发包、任务书，统一从这个目录进入。

## 最高优先级规则

后端与嵌入式的 TCP 交互只允许短协议：

- 短 envelope：`v/t/i/m/s/c/r/p`
- 短消息码：`RG/HB/SS/ER/QR/QS/EX/SC/AK/NK`
- 短业务码：`qcs/qwf/qem/spu/tpu/ovl/cvl/...`

不要把下面这些当成 MCU 线协议要求：

- `protocol/type/msg_id/seq/payload`
- `query_code/action_code/module_code`
- `tcp-json-v1`
- “平台还能兼容长字段，所以固件也可以先发长字段”

如果文档里出现长字段名，默认表示平台内部语义或存储字段，不表示 MCU 组包格式。

## 必看文档

- [embedded-controller-compact-protocol-v1.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-compact-protocol-v1.md)
- [embedded-controller-compact-dictionaries-v1.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-compact-dictionaries-v1.md)
- [embedded-controller-4g-packet-rules-v1.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-4g-packet-rules-v1.md)
- [embedded-controller-minimal-implementation-rules-v1.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-minimal-implementation-rules-v1.md)
- [embedded-controller-firmware-dev-spec-v1.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-firmware-dev-spec-v1.md)
- [embedded-controller-reliability-architecture-v1.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-reliability-architecture-v1.md)

## 新产品从哪里开始

1. [embedded-product-template/00-product-template-selection-template.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/00-product-template-selection-template.md)
2. [embedded-controller-capability-set-planning-v1.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-capability-set-planning-v1.md)
3. [embedded-controller-capability-set-dictionary-v1.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-capability-set-dictionary-v1.md)
4. [embedded-controller-task-book-template-v1.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-task-book-template-v1.md)

## 维护规则

- 新增协议说明时，优先写短协议版本。
- 新增示例时，不要再添加长 envelope 示例。
- 如果协议字段、字典或 4G 发包规则变化，先改这里的 MD，再改代码。
