# BE-REGION-LIBRARY-CONTRACT-001

状态：proposal  
范围：Phase 1 最小 contract 补丁说明  
目的：把 Region / Project / Asset 的行政区录入从“手工拼级联”收口为“行政区划参考库驱动”

## 1. 背景

当前 `regions/cascade-options` 已经能提供一条稳定的五级行政区树，但它仍然属于业务 Region 主数据视图，不适合作为长期唯一真源。

本轮收口目标变更为：

- 省 / 市 / 县(区) / 乡(镇) / 村 不再手工输入
- 前端不再自己拼接行政区级联树
- 后端维护标准行政区划参考库，并提供搜索 / 级联 / 路径接口

## 2. 建议新增参考表

建议新增：`region_reference`

最小字段：

- `code`
- `name`
- `level`
- `parent_code`
- `full_path_name`
- `full_path_code`
- `enabled`
- `source_type`
- `source_version`
- `effective_date`

建议补充字段：

- `id`
- `pinyin`
- `short_name`
- `sort_order`
- `created_at`
- `updated_at`

## 3. 语义边界

`region_reference` 是标准行政区划参考库，不直接承载项目、资产、运行态语义。

它只回答：

- 这个行政区代码是什么
- 上级是谁
- 它属于哪一级
- 完整路径是什么
- 数据来源和版本是什么

它不直接回答：

- 项目归属
- 资产归属
- 运行区域
- 业务流程权限

## 4. 数据来源策略

### 4.1 省 / 市 / 县(区)

采用官方行政区划代码作为主参考。

### 4.2 乡(镇)

采用省级民政公告或已采集的正式行政区划资料。

### 4.3 村

村级在 Phase 1 允许作为参考库维护，但必须保留：

- `source_type`
- `source_version`
- `effective_date`

这样后续即使村级存在维护更新，也能追溯版本来源。

## 5. 建议接口

### 5.1 搜索

`GET /api/v1/region-library/search`

建议参数：

- `q`
- `level`
- `parent_code`
- `enabled`
- `page`
- `page_size`

建议返回项至少包括：

- `code`
- `name`
- `level`
- `parent_code`
- `full_path_name`
- `full_path_code`
- `enabled`

### 5.2 子节点查询

`GET /api/v1/region-library/children?parent_code=...`

说明：

- 当 `parent_code` 为空时返回顶级省份
- 当前前端级联选择器优先依赖这个接口逐级加载

建议返回项至少包括：

- `code`
- `name`
- `level`
- `parent_code`
- `full_path_name`
- `full_path_code`
- `enabled`

### 5.3 路径查询

`GET /api/v1/region-library/path?code=...`

说明：

- 给前端回填完整链路
- 用于编辑表单初始化和路径展示

建议返回：

- `selected`
- `ancestors`
- `path`

其中每个节点至少带：

- `code`
- `name`
- `level`
- `parent_code`
- `full_path_name`
- `full_path_code`

## 6. 前端使用规则

前端以后不再手填这些字段：

- `province`
- `city`
- `county`
- `town`
- `village`
- `level`
- `code`
- `parent`

前端改为：

- 从 `region-library` 逐级选择行政区
- 后端返回并自动回填：
  - `level`
  - `code`
  - `parent_code`
  - `full_path_name`
  - `full_path_code`

## 7. 与现有业务对象的关系

### Region

业务 `Region` 页面不再代表“自由创建行政区节点”。

应逐步收口为：

- 从行政区划参考库选择 / 绑定
- 对业务启用状态做管理
- 对附加业务字段做补充

### Project

`project.region_id` 或其等价字段，最终应来自行政区划参考库选择结果。

### Asset manual location

`manual_region_id` 应来自行政区划参考库选择结果。

同时保留可手工录入字段：

- `manual_address_text`
- `manual_latitude`
- `manual_longitude`
- `install_position_desc`

## 8. 最小实施建议

最小补丁优先级：

1. 建 `region_reference`
2. 导入至少一套稳定五级链
3. 提供：
   - `search`
   - `children`
   - `path`
4. 先让前端 Region / Project / Asset 录入不再依赖手工级联拼装

本轮不要求：

- 重写全部 Region 业务模型
- 一次性替换所有旧接口
- 改 reported / effective location 规则
- 引入第三方前端行政区划包作为真源

## 9. 当前结论

这是一个 **B 类：后端最小 contract 补丁**。

原因：

- 前端体验收口已经明确要求行政区划库驱动
- 现有 `regions/cascade-options` 仍不足以承担长期唯一真源
- 需要后端给出稳定的参考库接口，而不是继续让前端猜测或手工拼装
