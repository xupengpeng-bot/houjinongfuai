# waterflow-control：仓库位置与本地配置（固化备忘）

状态：active  
用途：记录 **农用灌溉调度/管网配置前端 Demo** 的 Git 地址、推荐目录、运行参数与技术栈摘要，避免后续换机器或 Agent 环境时反复核对。  
说明：**本文档不替代** 主仓库 `docs/系统说明` 中的业务真值；Demo 仅作产品与技术参考。

---

## 1. Git 远程与目录约定

| 项 | 值 |
|----|-----|
| **HTTPS（当前本地 clone 的 `origin`）** | `https://github.com/xupengpeng-bot/waterflow-control.git` |
| **SSH（等价）** | `git@github.com:xupengpeng-bot/waterflow-control.git` |
| **与主工程 Cursor workspace 并列的推荐克隆路径** | `D:\Develop\houji\houjinongfuAI-Cursor\waterflow-control` |
| **现有本地副本（开发常用）** | `D:\Develop\houji\waterflow-control` |

建议在 **新环境** 将仓库克隆到 **`houjinongfuAI-Cursor` 同级** 的 `waterflow-control`，与业务主仓同一工作区根下，便于联调与文档交叉引用。若继续使用 `D:\Develop\houji\waterflow-control`，只需在 IDE 中多根目录加入该路径即可。

### 克隆示例（PowerShell）

```powershell
Set-Location D:\Develop\houji\houjinongfuAI-Cursor
git clone https://github.com/xupengpeng-bot/waterflow-control.git
# 或
git clone git@github.com:xupengpeng-bot/waterflow-control.git waterflow-control
```

### SSH / Agent 环境说明

若在某终端（含部分自动化环境）下 SSH 克隆报 `Repository not found`，多为 **该环境使用的 SSH 密钥** 与 GitHub 上 **授权仓库的密钥** 不一致；可改用 HTTPS，或为该环境配置具备读本仓库权限的 key。业务上以 **能 `git fetch` 成功的本机 `origin` 为准**。

---

## 2. 技术栈摘要（来自 `package.json`）

- **运行时**：React 18、TypeScript、Vite 5  
- **UI**：shadcn/ui（Radix）、Tailwind CSS 3、`tailwindcss-animate`、`class-variance-authority`  
- **路由**：react-router-dom 6  
- **状态与数据**：Zustand、TanStack React Query  
- **地图**：Leaflet、react-leaflet  
- **管网/水力**：`epanet-js`；稳态模拟、调度逻辑在 `src/simulator`、`src/services`（含 `irrigationAPI.ts`、`schedulingService.ts`）  
- **表单与校验**：react-hook-form、zod、`@hookform/resolvers`  
- **图表/导出**：recharts、jspdf、jspdf-autotable  
- **测试**：Vitest、Testing Library、jsdom；`@playwright/test`（dev）  
- **其他**：开发态可选 `lovable-tagger`（Vite 插件）

---

## 3. 构建与开发命令

| 命令 | 含义 |
|------|------|
| `npm run dev` | Vite 开发服务器 |
| `npm run build` | 生产构建 |
| `npm run build:dev` | `development` 模式构建 |
| `npm run preview` | 本地预览构建产物 |
| `npm run lint` | ESLint |
| `npm run test` | Vitest 单次运行 |
| `npm run test:watch` | Vitest 监听 |

---

## 4. Vite 开发服务器（`vite.config.ts`）

- **host**：`::`（IPv6 双栈监听，含本机 IPv4 访问场景）  
- **port**：`8080`  
- **HMR**：`overlay: false`  
- **路径别名**：`@` → 项目根下 `./src`  
- **插件**：`@vitejs/plugin-react-swc`；`development` 模式下附加 `lovable-tagger`

---

## 5. TypeScript（`tsconfig.json` / `tsconfig.app.json`）

- 工程为 **references** 结构：`tsconfig.app.json`（应用）、`tsconfig.node.json`（Node）  
- 应用侧：`moduleResolution: bundler`、`jsx: react-jsx`、`target: ES2020`  
- 路径：`@/*` → `./src/*`  
- 当前 **strict / noImplicitAny** 等较宽松（与 Lovable 类脚手架一致）

---

## 6. Tailwind（`tailwind.config.ts`）

- **darkMode**：`class`  
- **content**：含 `./src/**/*.{ts,tsx}` 等  
- **主题**：CSS 变量驱动的 semantic colors（sidebar、primary、destructive 等）、Inter / JetBrains Mono  
- **插件**：`tailwindcss-animate`

---

## 7. shadcn（`components.json`）

- **style**：default，`tsx`: true，`rsc`: false  
- **Tailwind 配置**：`tailwind.config.ts`，入口样式 `src/index.css`  
- **baseColor**：slate，`cssVariables`: true  
- **别名**：`@/components`、`@/components/ui`、`@/lib/utils` 等

---

## 8. 前端路由（`src/App.tsx`）

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | `Index` | 主界面（地图/监控等） |
| `/workbench` | `ConfigWorkbench` | 配置工作台（源数据、图层、关联策略等） |
| `*` | `NotFound` | 404 |

---

## 9. 环境与“后端”

- 仓库内 **无** `.env` / `.env.example`（以当前副本为准）。  
- `src/services/websocket.ts` 为 **模拟 WebSocket**：定时基于 store 与稳态仿真推送状态，**非真实物联网后端**。  
- 统一业务入口型 API 聚合见 `src/services/irrigationAPI.ts`（注释中的分类：泵曲线、选型、紧急停机、调度求解、水力模拟、监控报警、配置导入导出等）。

---

## 10. 与主系统文档的交叉引用

主仓库业务说明中已约定将 **waterflow-control** 作为项目级调度/配置驾驶舱的参考形态；详细产品边界以 `docs/系统说明` 下整体需求与总览为准。

---

## 11. 与主前端合并（lovable-working）

演示代码已并入 **`lovable-working`**，路径：`src/features/waterflow/`。管理后台路由见该目录下 `README.md`（如 `/ops/network-simulator`、`/ops/network-workbench`）。  
独立仓库 `waterflow-control` 仍可保留作对照或上游同步；以主前端内副本为后续迭代基线。

## 12. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-03-30 | 根据 `D:\Develop\houji\waterflow-control` 当前副本与 `.git/config` 固化路径与配置摘要；未修改 Demo 仓库内任何文件。 |
| 2026-03-30 | 已拉取 `main` 至 **d44bb9a** 并合并进 `lovable-working/src/features/waterflow`（含区块检测、`useProjectStore` 等）。 |
