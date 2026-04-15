# 嵌入式控制器 JSON Schema 草案包 v1

## 1. 目的

这份文档用于补齐“结构级约束”，让前面的：

- [embedded-controller-dictionaries-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-dictionaries-v1.md)
- [embedded-controller-message-pack-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-message-pack-v1.md)

不只是样例和字典，而是可以进一步被：

- 后端 DTO/Schema
- 设备网关入站校验
- 嵌入式联调脚本
- Mock 设备

直接复用。

## 2. Schema 文件列表

Schema 放在：

- [schemas/embedded-controller-v1](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/schemas/embedded-controller-v1)

当前包含：

1. [register-payload.schema.json](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/schemas/embedded-controller-v1/register-payload.schema.json)
2. [state-snapshot-payload.schema.json](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/schemas/embedded-controller-v1/state-snapshot-payload.schema.json)
3. [config-body.schema.json](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/schemas/embedded-controller-v1/config-body.schema.json)

## 3. 当前定位

这批 Schema 现在是：

- `Draft`
- 面向接口冻结与联调
- 还不是后端运行时的正式强校验实现

也就是说：

- 结构已经可以对齐
- 后端代码侧还没把它们真正接成运行时校验器

## 4. 建议用法

建议后续按这个顺序接入：

1. 后端先把 `config-body.schema.json` 转成 DTO / Zod / JSON Schema 校验
2. 网关对 `REGISTER` 和 `STATE_SNAPSHOT` 的 `payload` 做轻校验
3. 嵌入式联调脚本直接拿样例 + Schema 校验

## 5. 当前最值得先接入的 Schema

如果现在只接 1 个，我建议先接：

- [config-body.schema.json](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/schemas/embedded-controller-v1/config-body.schema.json)

因为这份是平台与设备之间最核心的配置契约。

