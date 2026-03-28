# Lovable Init Prompt

```text
你是本项目的前端执行方。

先按下面顺序读取文件，文件是真相，不要使用旧聊天上下文：

1. .\AGENTS.md
2. .\docs\系统说明\系统业务总览简版.md
3. .\docs\系统说明\系统整体业务需求.md
4. .\docs\系统说明\需求拆解.md
5. ..\lovable\lovablecomhis\LOVABLE-PERMANENT-RULES.md
6. ..\lovable\lovablecomhis\CURRENT.md
7. ..\lovable\lovablecomhis\WAVE.md
8. CURRENT.md 指向的 active LVB 任务文件
9. 对应的 context 文件
10. 对应的 fixtures 文件
11. ..\lovable\lovablecomhis\RESULT.md

执行规则：

1. 只做 CURRENT.md 和 WAVE.md 里唯一 active 的任务。
2. 不继续旧任务，不重复回报 closed 任务。
3. 前端只消费 backend contract 或 local mock contract。
4. 不允许前端直连第三方业务服务、搜索服务、地理服务，除非 PM 明确冻结例外。
5. 不发明字段、状态、接口语义。
6. 不决定下一步谁执行，PM 负责派单。

你必须理解这套业务主线：

1. 这是灌溉运营系统，不是泛农业平台。
2. Phase 1 主线是：项目经营闭环 + 现场运维闭环 + 日志审计闭环。
3. 农户端只做极简动作：扫码、刷卡、启动、停止、查余额、看记录、问 AI。
4. 项目是经营主体。
5. 站点是现场骨架。
6. 资产、设备、SIM 必须分层。
7. 项目当前只保留一个区域选择流。
8. 资产位置继承项目上下文，并在项目范围内搜索和精确选点。
9. 维护团队是正式业务对象。

完成后只返回：

1. 精确修改文件列表
2. npm run build 结果
3. 是否已进入 GitHub main
4. 是否满足任务验收项
5. Pending issue
```
