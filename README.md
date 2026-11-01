# MiniCAD for DeepSeek Harness

[English](README.en.md)

面向 DSH agent 的参数化 CAD 工作台。自然语言和 PDF 参考图纸进入同一个设计任务；用户与 agent 共用源码、参数、精确实体和版本历史。

## 功能

- 自然语言建模：通过 DSH agent 使用现成建模操作或自定义 JavaScript 创建、查询和局部编辑三维模型。
- 几何测量与尺寸检查：测量距离、夹角、局部方向壁厚及模型尺寸，并按目标值、公差或上下限检查。
- 图纸参考：通过 DSH 附件提供 PDF 图纸，供 agent 结合宿主能力读取。
- 参数与源码编辑：调整模型参数，或通过 agent 修改建模源码。
- 模型查看：查看三维模型和参考图纸。
- 设计库与任务管理：按设计库组织零件任务，各任务拥有独立会话、建模资源和版本历史。
- 导出：STEP、STL、SVG、PDF 和可编辑项目 ZIP。

## 本地安装

当前开发兼容目标为 DSH **0.2.1-rc.5**。DSH 插件 API 仍在快速变化，其他版本需重新验证。

### 安装预构建包

解压 `dsh-minicad-<版本>.tgz`，使用其中包含 `package.json` 的 `package` 目录。包内已包含预构建客户端、SMLib WebAssembly 内核和其他运行依赖，无需手工执行 `npm install` 或构建。请保留包内的 `node_modules` 目录。

桌面版由 Electron 应用独占管理插件：在 DSH 的「插件」页安装解压后的本地目录，例如 `link:F:/MiniCAD/package`，查看安装预览并启用。若宿主提示需要重启，重启后从侧栏进入 MiniCAD。不要通过 CLI 修改 `desktop` profile。

Web 配置需要 Node.js 22.19+ 和 pnpm（尚未安装时可执行 `npm install -g pnpm`），使用 CLI 安装解压目录：

```powershell
npx @deepseek-ai/dsh@0.2.1-rc.5 plugin --profile web add link:F:/MiniCAD/package -w
```

已有全局 dsh 时可用 `dsh plugin --profile web add link:F:/MiniCAD/package -w`。安装后重启 Web 宿主，从侧栏点击 MiniCAD。本仓库尚未发布到 npm，不要使用不存在的 npm 安装包名。

Web 配置没有 pnpm 时，可把解压后的 `package` 目录放到目标 profile 的 `node_modules/dsh-minicad`，再把本仓库 `cordis.patch.yml` 的完整条目合并到该 profile 的补丁数组；不要在已有 `[]` 后直接追加 YAML。此手动方式不适用于桌面独占配置。

### 从源码开发与打包

源码开发需要 Node.js 22.19+，在仓库目录执行：

```powershell
npm install
npm run setup
```

`setup` 构建客户端，运行依赖通过 npm 安装。随后可在桌面插件页安装 `link:F:/Projects/dsh-minicad`，或通过 Web CLI 安装这个仓库路径。SMLib 内核在独立 Node 进程中运行，不需要 Python 环境。

生成可分发的预构建包：

```powershell
New-Item -ItemType Directory -Force dist | Out-Null
npm pack --pack-destination dist
```

`npm pack` 会自动构建客户端，并携带声明的运行依赖及其传递依赖；开发依赖、设计数据和本地配置不会打入安装包。

## 使用

1. 点击设计库栏的文件夹按钮，通过 DSH 文件夹选择框选取设计目录。设计库以该目录命名，可在库内新建零件设计任务，输入尺寸、单位、特征和约束，通过 DSH 原生输入框添加文件。每个任务绑定独立的 DSH 会话，标题由宿主根据初始意图生成，也可以手动重命名。首次打开且没有设计时会自动准备一个默认库中的空白任务及其 DSH 会话。
2. 选择 DSH 中已经配置的模型。插件不保存自己的模型凭据。
3. 每个任务使用设计库内独立的子文件夹作为工作目录，新任务从空白开始。agent 读取任务内的建模文件和当前版本并调用建模工具，成功后画布显示真实模型。
4. 在参数面板编辑数值，或通过 agent 修改建模源码。保存时重新构建并验证实体有效性。
5. 导出当前版本，或从版本历史恢复。恢复会生成递增的新版本，避免旧请求覆盖新状态。

侧栏按「设计库 → 零件设计任务」组织。可新建或重命名设计库，通过任务菜单重命名任务、将其移至其他设计库或查看当前任务的参考图纸；搜索和排序用于查找任务。

尺寸不完整或多视图不能唯一确定几何时，agent 应询问用户。不要把一次几何有效性检查理解为结构强度、加工可行性或尺寸语义完全正确。

PDF 解析与扫描图纸理解使用 DSH 的附件、脚本或多模态能力，取决于当前宿主工具与模型。

SVG / PDF 当前为三视图参考图，包含外形尺寸说明；尚不包含完整孔位尺寸链、形位公差、表面粗糙度和制造工艺标注。需要可直接投产的图纸时仍须工程审核和补充标注。当前产品覆盖单零件/多实体参数建模，不提供装配约束求解与 CAM 刀路。

## 存储与运行边界

文件按「设计库 / 设计任务 / 建模资源」组织。每个任务使用以创建时名称命名的普通子文件夹，同名时追加序号；后续修改显示标题不会更改文件夹名称。源码、参数和实体放在任务内，例如 `底板/model.js`、`底板/model.parameters.json`、`底板/model.smb`。也可使用 `parts/plate.js` 等任务内相对路径。可以在外部编辑器修改源码和参数，下一次读取、构建使用磁盘上的内容。各任务的模型和版本互相独立。

设计库的 `minicad.json` 保存任务目录、会话绑定、当前建模文件和版本记录；任务内的 `.cad-history/<源码文件名（不含扩展名）>/v0001/` 等目录保存成功构建的源码、参数、SMLib 实体和预览快照。参考 PDF 保存在各任务的 `references/` 中。复制整个设计库即可带走模型和历史，重新通过文件夹选择框打开。对话记录由 DSH 原生会话保存。前端列表显示「设计库 → 零件设计任务」。

将任务移至其他设计库时，其整个文件夹随之迁移，包含源码、参考文件和历史；目标目录已有同名文件夹时使用新的序号，避免覆盖。重命名设计库只改显示名称，不改磁盘文件夹名称。

已打开目录的路径保存在 `$DSH_HOME/storages/minicad/libraries.json`；未配置 DSH_HOME 时使用 `~/.dsh/storages/minicad/libraries.json`。默认设计库位于同级的 `default/` 目录。`dataDir` 可覆盖此设置目录的位置。

建模源码以当前用户权限在独立 Node 服务进程执行；**进程隔离不等于安全沙箱**。仅运行可信来源的设计代码。PDF 和文档内容在 agent 指令中明确作为参考数据处理。默认单次任务超时 120 秒，停止操作会终止正在执行的建模进程，已提交版本保留。

可通过 profile 补丁覆盖：

```yaml
- id: minicad
  config:
    dataDir: F:/CAD/MiniCAD
    timeout: 120000
```

配置覆盖为整行配置替换。不要让多个 DSH 进程同时写入同一个 MiniCAD 数据目录。

## 建模接口

agent 可以自由选择现成的结构化建模操作，或用 `cad_build` 编写自定义 JavaScript，也可以混用。`cad_build` 相当于用户自定义函数（UDF）入口；两条路径共用精确实体、参数、版本、失败保留和导出流程。

| 工具 | 用途 |
| --- | --- |
| `cad_read_project` | 读取源码、参数、模型列表、版本和几何摘要；可指定 `sourceFile`，读取不切换 UI 选中的模型 |
| `cad_build` | 执行自定义源码；省略 `source` 时重建磁盘上的源码 |
| `cad_edit` | 按顺序执行 1～100 个现成操作，全部成功后只提交一个版本 |
| `cad_query` | 查询面、边或独立实体及其带作用域的引用 |
| `cad_measure` | 批量测量几何，不修改模型 |
| `cad_check` | 批量检查测量结果是否满足目标与公差或上下限，不修改模型 |
| `cad_update_parameters` | 默认合并顶层参数并重建；`mode: "replace"` 替换完整参数对象 |
| `cad_api` | 读取当前安装的 SMLib JavaScript API 声明 |
| `cad_export` | 导出指定建模文件的已保存版本 |
| `cad_restore` | 恢复指定文件的历史版本，并创建新的递增版本 |

先用 `cad_read_project` 获取建模文件名和版本。除读取和 API 查询外，agent 的工具调用必须明确提供任务内相对路径 `sourceFile`；修改、查询、测量和检查还需提供该文件的 `expectedRevision`。这些显式目标调用不会改变 UI 当前选中的模型；不同文件的版本分别计算。新建文件从版本 0 开始。

### 现成操作与自定义代码

`cad_edit` 支持基本体、拉伸、布尔运算、圆角、倒角、抽壳、偏移、面编辑和变换，并提供以下操作：

| 操作 | 主要参数与语义 |
| --- | --- |
| `revolve` | `profile`、世界坐标 `axis`、`angle`，可选 `origin`；角度为 -360～360 度且不能为零 |
| `loft` | 两个以上依次排列的 `sections`，可选 `ruled`、`smooth`、`closed` |
| `sweep` | `profile` 与 `path`；路径支持 line、polyline、spline、arc、helix，可选 `orient`、`translational`、`twist` |
| `linear_pattern` | `step`、`count`；按位移步长复制实体或 `tool` |
| `circular_pattern` | `axis`、每份之间的 `angle`、`count`，可选 `origin`；角度是步进角，不是总角度 |
| `import` | 从任务内 `file` 读取精确资源，如 `resources/input.step`、`.brep`、`.smb`；资源随版本快照和 ZIP 保存 |

轮廓 `profile` 支持 rectangle、circle、polygon，默认在 XY 平面；可用 `plane: "XZ"` / `"YZ"`、`rotate`、`center` 放置轮廓。整体生成结果也可用 `rotate`、`center` 放置。阵列 `count` 包含原始份，范围 2～100；有 `tool` 时把工具阵列按 `mode: "fuse" | "cut" | "intersect"` 作用于实体，没有 `tool` 时复制目标实体。

例如，创建底板并一次切出三个孔：

```json
{
  "sourceFile": "model.js",
  "expectedRevision": 0,
  "parameters": { "length": 40 },
  "summary": "创建三孔底板",
  "operations": [
    { "op": "box", "size": [{ "parameter": "length" }, 20, 8] },
    { "op": "linear_pattern", "step": [8, 0, 0], "count": 3, "mode": "cut",
      "tool": { "shape": "cylinder", "radius": 1, "height": 10 } }
  ]
}
```

每个操作可用 `target` 指定一个独立实体，例如 `target: { nearest: [10, 0, 0], one: true }` 或当前查询返回的实体 ID。只修改选中实体，再与未修改实体做并集；移动后接触或重叠的实体可能合并。省略 `target` 时作用于整个 Part。操作的必填参数、数值范围、向量长度和未知字段均由内核校验；失败错误包含从 0 开始的 `operationIndex`，批次失败保留上一版。

自定义代码定义 `build(parameters, cad)` 并返回有效、正体积的 `cad.Part`。`cad` 提供 SMLib 函数、同一套 `cad.edit(part, operations, parameters)`，以及任务内资源读取：

```javascript
function build(parameters, cad) {
  return cad.Box(parameters.length, 40, 8).cut(cad.Cylinder(4, 10));
}
```

`cad.readModel("resources/input.step")` 也可导入精确资源。局部编辑会记录在源码中，参数重算重新执行整个模型。`cad_update_parameters` 默认只合并顶层键，嵌套对象整体替换；完整替换或删除参数可用 `mode: "replace"`。`cad_build` / `cad_edit` 的 `parameters` 若提供则为完整对象，省略则沿用工作参数。

### 测量、检查和几何引用

`cad_measure` 的 `measurements` 与 `cad_check` 的 `checks` 均接受 1～100 项。测量支持：

- `distance`：`from`、`to` 可为查询 ID、`{ kind, selector }` 或 `{ point: [x,y,z] }`。计算有界几何之间的最小距离，支持点、面、实体及两条直线边；当前不支持两条曲边之间的精确距离，会返回明确错误。点在实体内部时返回到表面的间距；嵌套实体测量壁间距，相交或接触的实体返回 0。
- `angle`：两个平面的法向、直线方向、圆/圆柱等旋转轴，或 `{ direction: [x,y,z] }` 的夹角，范围 0～180 度。
- `thickness`：给定实体内或表面的 `point` 和非零 `direction`，返回穿过该点的一段连续材料厚度及出入口点。它是局部方向测厚，不是全模型最小壁厚；空腔中的点、切向或无法判定的测量会被拒绝。
- `size`：沿 `axis: "x" | "y" | "z"` 的包围盒尺寸；`volume`、`area`、`length`、`radius`、`diameter` 返回相应几何量。单实体尺寸、体积和壁厚可指定 `target`；面/边属性通过 `entity: { kind, selector }` 定位。

尺寸检查示例：

```json
{
  "sourceFile": "model.js",
  "expectedRevision": 1,
  "checks": [
    { "measurement": { "kind": "size", "axis": "x" }, "expected": 40, "tolerance": 0.01 },
    { "measurement": { "kind": "thickness", "point": [-10, 5, 4], "direction": [0, 0, -1] }, "min": 2 }
  ]
}
```

检查返回整体 `passed` 和各项实测值、单位及通过情况。可使用 `expected` ± `tolerance`（默认 1e-6），或 `min` / `max`（可单独指定，边界包含在内）。长度、面积、体积、角度分别使用 mm、mm²、mm³、度，公差使用对应测量单位。

几何 ID 绑定设计任务、建模文件和版本；旧版本或其他模型的引用会被拒绝。`faces` / `edges` 可接受多个 ID。ID 通过拓扑位置和内核派生关系解析，不按最近中心猜测；前序操作导致引用消失、拆分或失去派生关系时会拒绝。修改后重新查询；同批次后续步骤可使用几何选择器。参数重放要求引用所在拓扑保持一致，预期会改变拓扑的参数化编辑宜使用几何选择器。

导出文件写入任务的 `exports/<建模文件路径（不含 .js）>/`，不同文件的同号版本不会互相覆盖。旧的导出文件仍保留。

## 开发与验证

```powershell
npm run dev
npm run check
npm test
```

`dev` 使用真实 DSH 的 `minicad-dev` profile，端口 3079，项目数据放在 `.local/designs`。它复用当前 DSH_HOME 中的凭据和 DSH 设置。也可用环境变量 `DSH_ELECTRON` 和 `DSH_CLI` 指向已安装桌面版的可执行文件和内置 `dsh/lib/bin.js`，避免另装宿主。`PORT` 可覆盖端口。

只对建模内核服务编写自动化测试，并由 agent 自行验证；其余改动交由用户验收。见 [AGENTS.md](AGENTS.md)。`check` 检查主机语法并构建客户端，不是 UI 测试。

源码结构：`src/client` 为工作台，`src/host` 为 DSH 服务和 agent 工具，`src/kernel` 为 SMLib 建模与文件存储服务。UI 与 agent 共用同一服务接口，所有设计修改都带 `expectedRevision`。

## 排障与移除

| 现象 | 检查 |
|---|---|
| 找不到侧栏 MiniCAD | 确认正确的 profile 已安装插件，并重启 DSH |
| 建模服务无法启动 | 确认依赖已安装，运行 `npm install` 和 `npm run setup` |
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
