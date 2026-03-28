# 系统说明

状态：active  
适用范围：后稷灌溉 AI 运营系统 Phase 1

本目录用于沉淀当前正式业务口径。后续产品、前后端联调、验收和任务拆解，均以本目录 Markdown 文档为准。

边界补充：

- 本目录是“给人看的业务需求与产品规则”
- 本目录不承载 AI 派单文件、CURRENT/RESULT、执行状态或任务回写
- AI 任务指令在开发体系目录维护：
  - `D:\20251211\zhinengti\development-system\projects\houjinongfuai`

## 当前正式文档

- [系统业务总览简版](D:/20251211/zhinengti/houjinongfuai/docs/系统说明/系统业务总览简版.md)
- [系统整体业务需求](D:/20251211/zhinengti/houjinongfuai/docs/系统说明/系统整体业务需求.md)
- [需求拆解](D:/20251211/zhinengti/houjinongfuai/docs/系统说明/需求拆解.md)
- [骨架冻结与开发分期](D:/20251211/zhinengti/houjinongfuai/docs/系统说明/骨架冻结与开发分期.md)
- [通用产品规则](D:/20251211/zhinengti/houjinongfuai/docs/系统说明/通用产品规则.md)

## 使用规则

1. 本目录下 Markdown 文档是当前正式真相。
2. 同目录历史 `.docx` 只作为参考来源，不再作为协作时的优先依据。
3. 若历史 `.docx` 与当前 Markdown 冲突，以当前 Markdown 为准。
4. 业务需求确认后，PM 再到开发体系目录中拆解 AI 执行任务。
5. 本轮文档已经融合了近期确认的产品口径：
   - 项目下新增正式对象“区块”
   - 驾驶舱默认打开“项目下某个区块”
   - 自动调度为主，人工主要处理异常
   - 资产/设备录入与驾驶舱、DWG 导入、地图定位统一规划
   - 变压器台区归资产，国网电表归设备，新增“电力计量点”做成本核算
   - 一物一码、自动生成、下拉优先、搜索优先、统计只读
   - 前期数据库骨架、核心表和权限颗粒度建议先冻结，便于前后端联调

## 当前推荐阅读顺序

1. [系统业务总览简版](D:/20251211/zhinengti/houjinongfuai/docs/系统说明/系统业务总览简版.md)
2. [系统整体业务需求](D:/20251211/zhinengti/houjinongfuai/docs/系统说明/系统整体业务需求.md)
3. [骨架冻结与开发分期](D:/20251211/zhinengti/houjinongfuai/docs/系统说明/骨架冻结与开发分期.md)
4. [需求拆解](D:/20251211/zhinengti/houjinongfuai/docs/系统说明/需求拆解.md)
5. [通用产品规则](D:/20251211/zhinengti/houjinongfuai/docs/系统说明/通用产品规则.md)
