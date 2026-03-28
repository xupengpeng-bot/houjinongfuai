# 业务需求目录

状态：active
适用范围：后稷灌溉 AI 运营系统业务需求与功能口径

本目录用于汇总“给人看的需求文档”入口。

边界：

- 这里放业务需求、功能范围、对象模型、协议口径、验收口径
- 这里不放 AI 任务指令
- 这里不放派单、执行状态、CURRENT/RESULT
- AI 任务指令在外部开发体系目录维护：
  - `D:\20251211\zhinengti\development-system\projects\houjinongfuai`

## 推荐阅读顺序

1. [系统业务总览简版](/D:/20251211/zhinengti/houjinongfuai/docs/系统说明/系统业务总览简版.md)
2. [系统整体业务需求](/D:/20251211/zhinengti/houjinongfuai/docs/系统说明/系统整体业务需求.md)
3. [骨架冻结与开发分期](/D:/20251211/zhinengti/houjinongfuai/docs/系统说明/骨架冻结与开发分期.md)
4. [需求拆解](/D:/20251211/zhinengti/houjinongfuai/docs/系统说明/需求拆解.md)
5. [Phase 1 研发基线](/D:/20251211/zhinengti/houjinongfuai/docs/p1/README.md)
6. [设备协议](/D:/20251211/zhinengti/houjinongfuai/docs/protocol/device-protocol-v1.md)
7. [设备事件模型](/D:/20251211/zhinengti/houjinongfuai/docs/protocol/device-event-model-v1.md)
8. [UAT 活跃文档](/D:/20251211/zhinengti/houjinongfuai/docs/uat/README.md)

## 使用规则

1. 业务需求文档服务于人类协作和业务确认，描述整体目标、范围、功能点、对象关系和验收口径。
2. 任何 AI 研发任务都不能替代业务需求文档本身。
3. 当业务需求未确认时，不应直接拆解执行型 AI 任务。
4. 当业务需求确认后，PM 再到开发体系目录中拆解为 typed tasks 给 AI 执行。
