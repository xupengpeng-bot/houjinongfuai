# LibreDWG `dwgread`（管网工作台 / 原生 DWG）

后端在解析**仅上传了二进制 `.dwg`** 时会调用 `dwgread`，将其转为 GeoJSON。若未找到可执行文件，会提示配置本目录或环境变量。

本目录默认包含 **LibreDWG 0.13.4** 官方 Windows x64 发行包中的 `dwgread.exe` 与依赖 DLL（来自 [GitHub Release 0.13.4](https://github.com/LibreDWG/libredwg/releases/tag/0.13.4)）。软件为 **GPL v3+**（GNU LibreDWG），详见上游 `LibreDWG-UPSTREAM-README.txt`。

## 一键重装 / 更新（Windows x64）

在仓库根目录执行：

```powershell
pwsh -File backend/Tools/LibreDWG/install-libredwg.ps1
```

脚本会校验 ZIP 的 SHA256，解压并覆盖本目录下的 `dwgread.exe` 与各 `*.dll`。

## 放置位置（任选其一）

1. **推荐**：使用本目录中的 `dwgread.exe`（与后端 `process.cwd()` 为 `backend` 时一致；小写 `tools/LibreDWG` 也可）。

2. **或** 在 `backend/.env` 中设置绝对路径：  
   `DWGREAD_PATH=C:\路径\dwgread.exe`

3. **或** 设系统环境变量 `DWGREAD_PATH`（重启终端/服务后生效）。

## 其他平台 / 手动安装

- 从 [LibreDWG Releases](https://github.com/LibreDWG/libredwg/releases) 下载对应平台构建，将 **`dwgread`（或 `.exe`）与依赖库** 置于本目录或任意路径并配置 `DWGREAD_PATH`。
- **WSL**：在 Linux 中安装发行版提供的 `libredwg`，仅当后端进程能直接调用该可执行文件时可用。

在 PowerShell 中可快速自检：

```powershell
Set-Location path\to\backend\Tools\LibreDWG
.\dwgread.exe --help
```

## 关于 AC1032 等较新 DWG

文件头 `AC1032`（约 AutoCAD 2018）较新，LibreDWG 可能无法完整解析。若转换失败，请用 AutoCAD / 浩辰等 **另存为「AutoCAD 2013 图形」**，或导出 **DXF / GeoJSON**，再与 DWG **同名**作为 sidecar 上传；也可上传同名的 `.import.json` / `.geojson` 辅助文件（与产品内提示一致）。
