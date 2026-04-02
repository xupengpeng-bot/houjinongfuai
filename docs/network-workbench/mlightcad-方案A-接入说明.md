# mlightcad 方案 A：浏览器内 DWG/DXF 高精度预览（接入说明）

本文档对应选型 **方案 A**：通过 **npm / mlightcad 生态** 在浏览器内做 **DWG/DXF 高精度预览**（接近 CAD 观感），并与现有 **图层 ↔ 项目资产**、**后端 dwgread 拓扑** 形成可演进的导入链路。

---

## 1. 官方包与角色

| 包名 | 作用 | 技术栈 | 许可（npm 标注） |
|------|------|--------|------------------|
| `@mlightcad/cad-viewer` | 完整 CAD 查看器 UI（打开文件、图层、测量等） | **Vue 3** + Element Plus、vue-i18n、@vueuse/core 等 | MIT |
| `@mlightcad/cad-simple-viewer` | 文档/命令/渲染协作核心，偏 **程序化集成** | peer：`@mlightcad/data-model`、`three@^0.172.0`、`lodash-es` | MIT |
| `@mlightcad/data-model` | 数据模型 | — | MIT |
| `@mlightcad/libredwg-converter` | DWG 等转换相关（cad-simple-viewer 依赖链） | — | MIT |
| `@mlightcad/libredwg-web` | 另一形态 LibreDWG Web（若单独引入需核对） | — | **GPL-2.0**（闭源产品需法务评估） |

**结论**：优先使用 **cad-viewer / cad-simple-viewer 官方推荐安装方式**；若 bundle 中实际打入 **GPL 包**，须单独做依赖树审计与合规结论。

---

## 2. 与当前工程的关系

- **前端** `lovable-working`：**React + Vite**。`cad-viewer` 为 Vue 组件，**不能**像普通 React 组件一样直接 `import` 使用，需桥接。
- **已有能力**：`DwgImport` + `NetworkWorkbenchGeoViewer`（Leaflet `CRS.Simple`）在存在 `display_geojson` 时展示 **后端 dwgread → GeoJSON**；制图与图层规范见 `管网工程图源制图与导入规范-v1.md`。
- **方案 A 的定位**：**高精度 CAD 预览**（线型、块、标注等）与 **GeoJSON 拓扑图** 可 **并行**：预览走浏览器 WASM/客户端解析；拓扑与资产绑定可继续走后端或后续统一数据源。

---

## 3. React 项目中的三种接法（推荐顺序）

### 3.1 独立子应用 / iframe（最快落地）

- 新建极小 **Vue 3 + Vite** 工程，只挂载 `cad-viewer`，通过 **postMessage** 或 **URL 参数** 传入文件（`File` 需经父页中转或同域上传后给子页 URL）。
- 主站 React 用 **iframe** 嵌入 `/cad-preview`。
- **优点**：依赖隔离、与 Vue 生态零冲突、升级 cad-viewer 独立。**缺点**：通信与鉴权 URL 需设计。

### 3.2 Vue「岛」嵌入 React（单构建）

- 在同一 Vite 工程中同时配置 React + Vue（`@vitejs/plugin-vue`），某路由下 `createApp` 挂载 `cad-viewer`。
- **优点**：无 iframe。**缺点**：构建体积与插件配置复杂，需维护双框架。

### 3.3 `cad-simple-viewer` + 自研薄 UI（长期）

- 在 React 中用 `useEffect` + ref 挂载 canvas/容器，按包文档调用 **打开文档、图层列表、点选回调**。
- **优点**：UI 与主题完全可控。**缺点**：需阅读其导出 API 与示例，开发量大于 iframe 方案。

---

## 4. 依赖与版本注意

- `cad-simple-viewer` peer 要求 **`three@^0.172.0`**。当前 `lovable-working` 未在顶层声明 `three`；接入前在 **全仓库 lock** 中检索是否已有传递依赖，避免 **多实例 three** 导致渲染异常。
- WASM / worker：Vite 需按包 README 配置 **静态资源与 worker**（以官方文档为准）。

---

## 5. 与「图层 ↔ 项目资产」的对接建议

1. **预览侧**：利用查看器 API 获取 **图层名、实体 id/handle**（以实际 API 为准），映射到内部 `layerKey` / `assetType`（与现有 `workbench-layer-infer` 规则对齐或扩展）。
2. **保存侧**：沿用或扩展现有 **映射 JSON** 与后端接口；**不要求**首版就与 WASM 解析结果 100% 与 dwgread 一致，可 **双轨** 标注差异。
3. **编码**：DWG 中文图层名继续遵循制图规范；预览库若需编码选项，与 `cad-text-encoding` 策略对齐。

---

## 6. 本仓库已落地的最小联调（iframe + Vue 子应用）

- 子应用目录：`lovable-working/cad-preview`（Vite 5 + Vue 3 + `@mlightcad/cad-viewer`）。
- 主站：`DwgImport` 页「主文件」区域有 **CAD 高精度预览** 按钮；选择 `.dwg` / `.dxf` 后打开对话框，通过 `postMessage` 把 `ArrayBuffer` 传给 iframe 内 viewer。
- **本地同时起两个 dev**：在 `lovable-working` 执行 `npm run dev:with-cad`（主站默认 `:8080`，子应用 `:5174`）。若子应用端口或域名不同，在主站环境变量中设置 `VITE_CAD_PREVIEW_URL`（无尾斜杠）。
- **生产**：将 `cad-preview` 的 `npm run build` 产物部署到可访问的静态路径或子域，并把 `VITE_CAD_PREVIEW_URL` 指到该地址；父页与子页需互相允许的 `postMessage` 源（当前子应用在 dev 下校验 `http://localhost:8080` / `127.0.0.1:8080`）。

## 7. 落地任务清单（后续）

1. [x] 选定接法（首版 **iframe + 独立 Vue 子应用**）。
2. [x] 子应用安装 `@mlightcad/cad-viewer`，跑通本地 File（postMessage）。
3. [ ] 鉴权 URL 直开、与上传存储联动。
4. [ ] 依赖树扫描：确认生产 bundle **无意外 GPL** 链（若仅用 MIT 链路的 cad-viewer 安装结果，仍建议 `npm ls` + 法务确认）。
5. [ ] （可选）点选回调 → 写入映射草稿，与后端保存 API 联调。

---

## 8. 参考链接

- [cad-viewer（npm）](https://www.npmjs.com/package/@mlightcad/cad-viewer)
- [cad-simple-viewer（npm）](https://www.npmjs.com/package/@mlightcad/cad-simple-viewer)
- [GitHub mlightcad](https://github.com/mlightcad)

文档版本：与方案 A 选型同步；实施时以 npm 与仓库 README 为准。
