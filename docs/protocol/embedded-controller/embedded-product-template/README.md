# 嵌入式新产品开发模板包 README

## 1. 目标

这套模板用于新嵌入式产品立项时，快速梳理：

- 这个产品到底要做哪些能力
- 这些能力需要什么硬件资源
- 固件要拆成哪些模块
- 协议、配置、状态机怎么定义
- 联调和验收要交付什么

核心原则：

- 先确定产品模板和能力集，再做详细开发
- 先冻结能力边界，再进入模块化实现

## 2. 权威口径

这里最重要的一条是：

- 模板里出现的长字段、长消息名、平台字段名，默认表示语义名或平台内部字段
- 新嵌入式产品的实际上行线协议，默认必须使用轻量短字段协议

因此，MCU 线协议的权威文档只有：

- [embedded-controller-compact-protocol-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-compact-protocol-v1.md)
- [embedded-controller-compact-dictionaries-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-compact-dictionaries-v1.md)
- [embedded-controller-4g-packet-rules-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-4g-packet-rules-v1.md)
- [embedded-controller-minimal-implementation-rules-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-minimal-implementation-rules-v1.md)

`device-protocol-v2.md` 只作为历史/平台语义参考，不作为新产品默认上行协议。

## 3. 适用范围

适用于：

- 新控制器主板
- 现有控制器的衍生 SKU
- 面向新场景的新固件家族
- 平台能力暴露模式下的新设备接入

不适用于：

- 只改 1 个寄存器地址的小修补
- 只改 UI 文案或页面字段
- 已有产品的小版本补丁且不改变能力边界

## 4. 模板文件清单

- [00-product-template-selection-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/00-product-template-selection-template.md)
- [00-capability-inventory-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/00-capability-inventory-template.md)
- [01-product-definition-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/01-product-definition-template.md)
- [02-hardware-interface-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/02-hardware-interface-template.md)
- [03-firmware-module-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/03-firmware-module-template.md)
- [04-message-contract-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/04-message-contract-template.md)
- [05-config-profile-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/05-config-profile-template.md)
- [06-state-machine-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/06-state-machine-template.md)
- [07-joint-debug-acceptance-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/07-joint-debug-acceptance-template.md)
- [08-md-maintenance-rules.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/08-md-maintenance-rules.md)

## 5. 推荐顺序

### 阶段 A：立项冻结

先完成：

1. [00-product-template-selection-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/00-product-template-selection-template.md)
2. [00-capability-inventory-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/00-capability-inventory-template.md)
3. [01-product-definition-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/01-product-definition-template.md)
4. [02-hardware-interface-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/02-hardware-interface-template.md)

### 阶段 B：研发设计

再完成：

1. [03-firmware-module-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/03-firmware-module-template.md)
2. [04-message-contract-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/04-message-contract-template.md)
3. [05-config-profile-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/05-config-profile-template.md)
4. [06-state-machine-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/06-state-machine-template.md)

### 阶段 C：联调验收

最后完成：

1. [07-joint-debug-acceptance-template.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/07-joint-debug-acceptance-template.md)
2. 按 [08-md-maintenance-rules.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-product-template/08-md-maintenance-rules.md) 检查是否要回写模板

## 6. 需要参考的公共规范

- [embedded-controller-capability-composition-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-capability-composition-v1.md)
- [embedded-controller-capability-set-planning-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-capability-set-planning-v1.md)
- [embedded-controller-capability-set-dictionary-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-capability-set-dictionary-v1.md)
- [embedded-controller-compact-protocol-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-compact-protocol-v1.md)
- [embedded-controller-compact-dictionaries-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-compact-dictionaries-v1.md)
- [embedded-controller-4g-packet-rules-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-4g-packet-rules-v1.md)
- [embedded-controller-minimal-implementation-rules-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-minimal-implementation-rules-v1.md)
- [embedded-controller-interface-catalog-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-interface-catalog-v1.md)
- [embedded-controller-firmware-dev-spec-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-firmware-dev-spec-v1.md)
- [embedded-controller-profile-config-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-profile-config-v1.md)
- [embedded-controller-dictionaries-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-dictionaries-v1.md)

## 7. 模块化建议

建议把新产品拆成这些并行模块：

- `common`
- `connectivity`
- `protocol`
- `config`
- `module-*`
- `workflow`
- `diag`

在模块拆分前，先冻结 4 个业务维度：

- `control_anchor`
- `billing_subject`
- `settlement_basis`
- `payment_anchor`

## 8. 维护提醒

后面如果出现这些情况，需要回写 MD：

- 新增能力模块
- 修改模块边界
- 修改查询码、动作码、事件码
- 修改配置域或默认策略
- 修改状态机或 ready 口径
- 修改硬件资源映射
- 联调时发现模板缺关键决策项
