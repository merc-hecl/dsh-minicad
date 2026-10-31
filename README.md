# MiniCAD for DeepSeek Harness

[English](README.en.md)

面向 DSH agent 的参数化 CAD 工作台。自然语言和 PDF 参考图纸进入同一个设计任务；用户与 agent 共用源码、参数、精确实体和版本历史。

## 功能

- 自然语言建模：通过 DSH agent 创建和修改参数化三维模型。
- 图纸参考：导入、预览 PDF 图纸，并供 agent 读取。
- 参数与源码编辑：调整模型参数，或通过 agent 修改建模源码。
- 模型查看：查看三维模型和参考图纸。
- 设计库与任务管理：按设计库组织零件任务，各任务拥有独立会话、建模资源和版本历史。
- 导出：STEP、STL、SVG、PDF 和可编辑项目 ZIP。

## 本地安装

需要 Node.js 22.19+、[uv](https://docs.astral.sh/uv/getting-started/installation/)、pnpm，以及 DSH。当前开发兼容目标为 DSH **0.2.1-rc.5**。DSH 插件 API 仍在快速变化，其他版本需重新验证。

```powershell
npm install
npm run setup
```

`setup` 通过 `uv sync --project python --frozen` 安装锁定的 Python 环境，再构建客户端。运行时使用 `uv run --project python --frozen python`；不要用 pip 或 `python -m venv` 手工修改环境。

若 pnpm 尚未安装：`npm install -g pnpm`。

桌面版的插件管理由 Electron 应用独占：在 DSH 的「插件」页选择安装本地插件，输入 `link:F:/Projects/dsh-minicad`（替换成本地仓库绝对路径），查看安装预览并启用。若宿主提示需要重启，重启后从侧栏进入 MiniCAD。不要通过 CLI 修改 `desktop` profile。

Web 配置使用 CLI：

```powershell
npx @deepseek-ai/dsh@0.2.1-rc.5 plugin --profile web add link:F:/Projects/dsh-minicad -w
```

已有全局 dsh 时可用 `dsh plugin --profile web add link:F:/Projects/dsh-minicad -w`。安装后重启 Web 宿主，从侧栏点击 MiniCAD。本仓库尚未发布到 npm，不要使用不存在的 npm 安装包名。

Web 配置没有 pnpm 时，可把仓库放到目标 profile 的 `node_modules/dsh-minicad`，完成依赖安装和构建，再把本仓库 `cordis.patch.yml` 的完整条目合并到该 profile 的补丁数组；不要在已有 `[]` 后直接追加 YAML。此手动方式不适用于桌面独占配置。

## 使用

1. 点击设计库栏的文件夹按钮，通过 DSH 文件夹选择框选取设计目录。设计库以该目录命名，可在库内新建零件设计任务，输入尺寸、单位、特征和约束，通过 DSH 原生输入框添加文件。每个任务绑定独立的 DSH 会话，标题由宿主根据初始意图生成，也可以手动重命名。首次打开且没有设计时会自动准备一个默认库中的空白任务及其 DSH 会话。
2. 选择 DSH 中已经配置的模型。插件不保存自己的模型凭据。
3. 每个任务使用设计库内独立的子文件夹作为工作目录，新任务从空白开始。agent 读取任务内的建模文件和当前版本并调用建模工具，成功后画布显示真实模型。
4. 在参数面板编辑数值，或通过 agent 修改建模源码。保存时重新构建并验证实体有效性。
5. 导出当前版本，或从版本历史恢复。恢复会生成递增的新版本，避免旧请求覆盖新状态。

侧栏按「设计库 → 零件设计任务」组织。可新建或重命名设计库，通过任务菜单重命名任务、将其移至其他设计库或查看当前任务的参考图纸；搜索和排序用于查找任务。

尺寸不完整或多视图不能唯一确定几何时，agent 应询问用户。不要把一次几何有效性检查理解为结构强度、加工可行性或尺寸语义完全正确。

扫描图纸的理解需要支持视觉输入的模型；文本模型只能使用 PDF 中提取到的文本。

SVG / PDF 当前为三视图参考图，包含外形尺寸说明；尚不包含完整孔位尺寸链、形位公差、表面粗糙度和制造工艺标注。需要可直接投产的图纸时仍须工程审核和补充标注。当前产品覆盖单零件/多实体参数建模，不提供装配约束求解与 CAM 刀路。

## 存储与运行边界

文件按「设计库 / 设计任务 / 建模资源」组织。每个任务使用以创建时名称命名的普通子文件夹，同名时追加序号；后续修改显示标题不会更改文件夹名称。源码、参数和实体放在任务内，例如 `底板/model.py`、`底板/model.parameters.json`、`底板/model.brep`。也可使用 `parts/plate.py` 等任务内相对路径。可以在外部编辑器修改源码和参数，下一次读取、构建使用磁盘上的内容。各任务的模型和版本互相独立。

设计库的 `minicad.json` 保存任务目录、会话绑定、当前建模文件和版本记录；任务内的 `.cad-history/<源码文件名（不含扩展名）>/v0001/` 等目录保存成功构建的源码、参数、BREP 和预览快照。参考 PDF 保存在各任务的 `references/` 中。复制整个设计库即可带走模型和历史，重新通过文件夹选择框打开。对话记录由 DSH 原生会话保存。前端列表显示「设计库 → 零件设计任务」。

将任务移至其他设计库时，其整个文件夹随之迁移，包含源码、参考文件和历史；目标目录已有同名文件夹时使用新的序号，避免覆盖。重命名设计库只改显示名称，不改磁盘文件夹名称。

已打开目录的路径保存在 `$DSH_HOME/storages/minicad/libraries.json`；未配置 DSH_HOME 时使用 `~/.dsh/storages/minicad/libraries.json`。默认设计库位于同级的 `default/` 目录。`dataDir` 可覆盖此设置目录的位置。

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

只对建模内核服务编写自动化测试，并由 agent 自行验证；其余改动交由用户验收。见 [AGENTS.md](AGENTS.md)。`check` 检查主机语法并构建客户端，不是 UI 测试。

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
npx @deepseek-ai/dsh@0.2.1-rc.5 plugin --profile web remove dsh-minicad -w
```

桌面版通过应用的「插件」页面移除。宿主完成卸载或重启后入口消失。卸载不删除设计数据。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。第三方依赖保留各自许可证，见 [NOTICE.md](NOTICE.md)。
