# MiniCAD for DeepSeek Harness

本项目采用 [MIT 许可证](LICENSE)。第三方依赖保留各自许可证，见 [NOTICE.md](NOTICE.md)。

[English](#english)

面向 DSH agent 的参数化 CAD 工作台。自然语言和 PDF 参考图纸进入同一个设计任务；用户与 agent 共用源码、参数、精确实体和版本历史。

## 功能

- DSH 侧栏入口、沉浸式 Three.js 画布、正交视图、旋转/平移/缩放、线框显示。
- 独立设计目录与 DSH 会话绑定；通过 DSH 当前配置的模型进行真实工具调用。
- build123d / OCCT 参数化实体建模；源码与参数可直接编辑。
- PDF 文本提取、逐页渲染、预览和 agent 读取。扫描图纸的理解需要支持视觉输入的模型；文本模型只能使用提取到的文本。
- 保存前检查实体有效性、体积、包围盒和指定尺寸。失败保留上一版；过期版本写入被拒绝。
- 参数关联的尺寸表达式、版本恢复和重启后恢复。
- STEP（导出后回读校验）、STL、SVG、PDF、可编辑项目 ZIP。
- 中文 / English 与浅色 / 暗色跟随 DSH 设置。

## 本地安装

需要 Node.js 22.19+、[uv](https://docs.astral.sh/uv/getting-started/installation/)、pnpm，以及 DSH。当前开发兼容目标为 DSH **0.2.1-rc.3**。DSH 插件 API 仍在快速变化，其他版本需重新验证。

```powershell
npm install
npm run setup
```

`setup` 通过 `uv sync --project python --frozen` 安装锁定的 Python 环境，再构建客户端。运行时使用 `uv run --project python --frozen python`；不要用 pip 或 `python -m venv` 手工修改环境。

若 pnpm 尚未安装：`npm install -g pnpm`。

桌面版的插件管理由 Electron 应用独占：在 DSH 的「插件」页选择安装本地插件，输入 `link:F:/Projects/dsh-minicad`（替换成本地仓库绝对路径），查看安装预览并启用。若宿主提示需要重启，重启后从侧栏进入 MiniCAD。不要通过 CLI 修改 `desktop` profile。

Web 配置使用 CLI：

```powershell
npx @deepseek-ai/dsh@0.2.1-rc.3 plugin --profile web add link:F:/Projects/dsh-minicad -w
```

已有全局 dsh 时可用 `dsh plugin --profile web add link:F:/Projects/dsh-minicad -w`。安装后重启 Web 宿主，从侧栏点击 MiniCAD。本仓库尚未发布到 npm，不要使用不存在的 npm 安装包名。

Web 配置没有 pnpm 时，可把仓库放到目标 profile 的 `node_modules/dsh-minicad`，完成依赖安装和构建，再把本仓库 `cordis.patch.yml` 的完整条目合并到该 profile 的补丁数组；不要在已有 `[]` 后直接追加 YAML。此手动方式不适用于桌面独占配置。

## 使用

1. 新建设计，输入尺寸、单位、特征和约束；可附加不超过 20 MB 的 PDF。
2. 选择 DSH 中已经配置的模型。插件不保存自己的模型凭据。
3. agent 读取当前版本并调用建模工具，成功后画布显示真实模型。
4. 在参数面板编辑数值，或在源码面板编辑 `build(parameters)`。保存时重新构建并校验。
5. 导出当前版本，或从版本历史恢复。恢复会生成递增的新版本，避免旧请求覆盖新状态。

尺寸不完整或多视图不能唯一确定几何时，agent 应询问用户。不要把一次几何有效性检查理解为结构强度、加工可行性或尺寸语义完全正确。

SVG / PDF 当前为三视图参考图，包含外形尺寸说明；尚不包含完整孔位尺寸链、形位公差、表面粗糙度和制造工艺标注。需要可直接投产的图纸时仍须工程审核和补充标注。当前产品覆盖单零件/多实体参数建模，不提供装配约束求解与 CAM 刀路。

## 存储与运行边界

默认保存于 `$DSH_HOME/storages/minicad`，未配置 DSH_HOME 时使用 `~/.dsh/storages/minicad`。SQLite 保存目录和版本头；每次成功构建保留独立的源码、参数、BREP 和预览状态。PDF 按任务保存，跨任务的附件读取会被拒绝。DSH 原生会话保存模型对话。

建模源码以当前用户权限在独立 Python 服务进程执行；**进程隔离不等于安全沙箱**。仅运行可信来源的设计代码。PDF 和文档内容在 agent 指令中明确作为参考数据处理。默认单次任务超时 120 秒，停止操作会终止正在执行的建模进程，已提交版本保留。

可通过 profile 补丁覆盖：

```yaml
- id: minicad
  config:
    dataDir: F:/CAD/MiniCAD
    timeout: 120000
```

配置覆盖为整行配置替换。不要让多个 DSH 进程同时写入同一个 MiniCAD 数据目录。

## 开发与验证

```powershell
npm run dev
npm run check
npm test
```

`dev` 使用真实 DSH 的 `minicad-dev` profile，端口 3079，项目数据放在 `.local/designs`。它复用当前 DSH_HOME 中的凭据和 DSH 设置。也可用环境变量 `DSH_ELECTRON` 和 `DSH_CLI` 指向已安装桌面版的可执行文件和内置 `dsh/lib/bin.js`，避免另装宿主。`PORT` 可覆盖端口。

只对建模内核编写自动化测试；UI 用实际运行、操作、截图检查。见 [AGENTS.md](AGENTS.md)。`check` 检查主机语法并构建客户端，不是 UI 测试。

源码结构：`src/client` 为工作台，`src/host` 为 DSH 服务和 agent 工具，`python/worker.py` 为持久化/建模服务。UI 与 agent 共用同一服务接口，所有设计修改都带 `expectedRevision`。

## 排障与移除

| 现象 | 检查 |
|---|---|
| 找不到侧栏 MiniCAD | 确认正确的 profile 已安装插件，并重启 DSH |
| Python 服务无法启动 | 确认 uv 在 DSH 的 PATH 中，运行 `npm run setup` |
| 模型认证失败 | 在 DSH 配置模型或选择已登录账号提供的模型 |
| HTTP 401 | 先从宿主启动链接登录；401 不能证明插件路由已注册 |
| HTTP 404 | 确认 bundle、主机服务与正确端口 |
| 版本冲突 | 重新读取当前版本后再修改 |
| 图形不显示 | 检查 WebGL/图形加速；确认已有成功模型版本 |

更新本地代码后运行 `npm run build`；客户端支持 DSH HMR，主机代码改动需重启。

```powershell
npx @deepseek-ai/dsh@0.2.1-rc.3 plugin --profile web remove dsh-minicad -w
```

桌面版通过应用的「插件」页面移除。宿主应用安装变更或重启后入口消失。卸载不删除设计数据。

## English

Licensed under the [MIT License](LICENSE). Third-party dependencies retain their own licenses; see [NOTICE.md](NOTICE.md).

MiniCAD is an agent-first parametric CAD workbench for DeepSeek Harness. It uses JavaScript / React / Three.js for the workbench and Python / build123d / OCCT for exact solids. The user and the DSH agent share a persistent project, editable source and parameters, references, and immutable revisions.

Install Node.js 22.19+, uv and pnpm. Run `npm install` then `npm run setup`. Desktop installations must use DSH's Plugins page with `link:/absolute/path/to/dsh-minicad`; the Electron app exclusively manages its profile. For Web use `npx @deepseek-ai/dsh@0.2.1-rc.3 plugin --profile web add link:/absolute/path/to/dsh-minicad -w`. Restart if requested and open MiniCAD in the sidebar. Python 3.12 dependencies and runtime are managed by uv with the committed lockfile.

Describe a part, attach a PDF if needed, and select a configured DSH model. The agent builds actual BREP geometry. Invalid builds and stale revisions cannot overwrite the last saved design. Edit parameters or source, restore revisions, and export STEP (round-trip validated), STL, SVG, PDF, or an editable ZIP. Language and theme follow DSH settings.

PDF reading combines extracted text with rendered page images. Scanned drawings need a vision-capable model. Missing dimensions require clarification. SVG/PDF outputs are orthographic reference sheets with overall dimensions, not fully dimensioned manufacturing drawings. Assembly constraint solving and CAM toolpaths are outside the current implementation.

Model code runs locally with the user's privileges in a separate worker process; it is not an OS security sandbox. Use trusted code. Data defaults to `$DSH_HOME/storages/minicad`. Do not run multiple DSH hosts against the same data directory.

`npm run dev` starts a real DSH development profile with `.local/designs`. `npm run check` checks host syntax and builds the client. `npm test` tests only the modeling kernel. UI verification is performed through actual use and screenshots, without UI test suites. Remove the package through Desktop's Plugins page, or through the plugin CLI for Web; design data is retained.
