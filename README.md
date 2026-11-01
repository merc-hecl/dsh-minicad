# MiniCAD for DeepSeek Harness

[English](README.en.md)

面向 DSH agent 的参数化 CAD 工作台。自然语言和 PDF 参考图纸进入同一个设计任务；用户与 agent 共用源码、参数、精确实体和版本历史。

## 功能

- 自然语言建模：通过 DSH agent 使用现成建模操作或自定义 JavaScript 创建、查询和局部编辑三维模型。
- 几何测量与尺寸检查：测量距离、夹角、局部方向壁厚及模型尺寸，并按目标值、公差或上下限检查。
- 图纸参考：通过任务文件或 DSH 附件提供参考图纸。
- 参数与源码编辑：调整模型参数，或通过 agent 修改建模源码。
- 模型交互：查看模型与图纸，选择面、边添加引用注释，或直接编辑局部几何并保存到版本历史。
- 制作记录：查看建模过程、回看中间步骤、对照历史版本，并阅读完整原生会话与工具记录。
- 设计与会话管理：每个设计拥有独立工作目录，多个会话共享建模资源和版本历史。
- 导出：STEP、STL 和可编辑项目 ZIP。

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

1. 点击设计栏的「打开或新建设计」，通过 DSH 文件夹选择框选择或新建一个设计工作文件夹。该文件夹直接作为设计根目录，首次打开时以文件夹名作为设计名，并创建第一个 DSH 会话。输入尺寸、单位、特征和约束，通过 DSH 原生输入框添加文件。
2. 选择 DSH 中已经配置的模型。插件不保存自己的模型凭据。
3. 侧栏采用「文件夹 → 会话」结构，文件夹代表一个设计工作区。点击文件夹旁的新建会话按钮开始一轮修改，点击其下的会话行切换。同一设计中的会话共享工作目录、模型、参数和版本历史；新会话有独立的聊天上下文。agent 读取设计文件和当前版本并调用建模工具，画布按有效几何检查点更新过程预览，构建成功后显示已保存模型。
4. 在参数面板编辑数值，或通过 agent 修改建模源码。保存时重新构建并验证实体有效性。
5. 导出当前版本，或从版本历史恢复。恢复会生成递增的新版本，避免旧请求覆盖新状态。

输入框空闲时收纳到画布下沿，仅露出半个正式插件图标。点击图标或在画布上按 Enter 展开，按 Esc 收起并保留草稿；发送后自动收起。输入框没有文字、附件或几何引用时，点击画布也会自动收起。状态岛用紫色表示理解与规划、蓝色表示建模、青色表示检查与保存；保存成功后短暂呈现绿色，等待补充或失败时为琥珀色，停止后为静止的灰蓝色。悬停或点击状态岛可查看步骤、继续输入或停止。主题、语言和减少动态效果均沿用宿主或系统设置。

点击顶栏「制作记录」打开回看工作区。模型视口独立取景，底部步骤卷轴用于选择已保存版本与过程检查点，并可叠加旧版的虚线轮廓。完整 DSH 会话与工具记录在右侧独立阅读；工作区较窄时通过「模型回看／完整会话」切换。关闭记录页回到工作台。过程预览只供查看，面、边引用与手动编辑针对已保存版本；失败或停止仍保留有效检查点供回看。

`cad_edit` 在有效实体操作后自动记录检查点。自定义 `cad_build` 可以在关键阶段调用 `cad.checkpoint(part, "步骤名称")`，返回值仍为原实体；未调用时只有最终结果检查点。检查点要求有效、封闭且有正体积的实体，不提交版本；最终检查和保存成功后才生成新版本。快速连续操作可能在下一次画布刷新时合并显示，已记录检查点均可回看。

侧栏与 DSH 主界面一样，以可折叠的工作文件夹组织会话。DSH 主界面的工作区列表也按相同的设计工作文件夹归类这些会话；新建和分叉会话保留设计归属。主界面继续使用原生列表、搜索、排序、置顶和归档，工作台分组不变。分组来自 MiniCAD 设计索引，不改写 DSH 会话头部或额外创建目录。设计名独立于 DSH 会话标题，宿主生成或修改会话标题不会改变设计名。文件夹菜单提供重命名设计、另存为、参考图纸与移除；会话行复用 DSH 的重命名、置顶、归档和分叉操作，分叉会话仍共享当前设计文件。移除只关闭列表登记，保留文件和会话，重新打开工作文件夹即可恢复。

尺寸不完整或多视图不能唯一确定几何时，agent 应询问用户。不要把一次几何有效性检查理解为结构强度、加工可行性或尺寸语义完全正确。

MiniCAD 预设包含 DSH 标准模式的文件、搜索、脚本、技能和依赖工具能力。`@文件` 是路径引用，agent 应先实际读取文件，用可用的 PDF 渲染器将页面转为图片，再由支持图片输入的模型读取；它不等于已上传的图纸页面。PDF 解析器与渲染器需使用宿主实际可用的工具，不能假定已安装。`cad_read_project.referenceFiles` 列出任务 `resources/` 和 `references/` 中的文件，`attachments` 仅代表 MiniCAD 参考目录，不代表会话附件。

当前产品覆盖单零件/多实体参数建模，不提供装配约束求解与 CAM 刀路。

右侧工具栏的检查图标用于进入选择模式。默认同时选择面和边，靠近边线时优先选边；也可切换为仅面或仅边。点击后高亮并显示编号，展开「完整引用」可查看供 agent 工具使用的带模型与版本信息的 ID。点击空白清除选择，按 Esc 或再次点击工具栏按钮退出；拖动仍可旋转模型。

选中面或边后，点击「引用」，可填写修改要求并加入 DSH 原生输入框。可以在同一条消息中加入多个引用；引用随草稿保存，发送后显示为引用芯片及注释。agent 收到模型文件、版本、完整几何引用及该元素的几何信息。引用绑定添加时的版本，模型更新后需要重新选择，避免旧编号误指其他几何。

点击「编辑」直接修改所选元素，无需模型预先定义参数。面支持偏移、沿 XYZ 移动、删除并修复，以及移除圆角；边支持圆角和倒角，尺寸单位为 mm。点击「保存修改」后，由内核验证实体并生成新版本，画布随成功结果更新，可在版本历史中恢复。失败保留上一版；agent 正在建模时不能同时手动编辑。

点击顶栏的设置图标可修改面、边编号格式。默认 `F-{n}`、`E-{n}`，显示为 `F-1`、`E-1` 等；`{n}` 从 1 开始递增且不补零。设置保存在插件数据目录的 `settings.json`，在后续成功建模时随版本保存；已有版本保留原格式，旧模型默认使用上述格式。短编号在单个模型版本内有效，跨模型或版本定位应使用完整引用。恢复历史版本保留其编号格式。

## 存储与运行边界

每个设计直接对应一个普通工作文件夹，例如 `底板/model.js`、`底板/model.parameters.json`、`底板/model.smb`；不再要求上层设计库。也可使用 `parts/plate.js` 等设计内相对路径。在外部编辑器修改源码和参数后，下一次读取或构建使用磁盘内容。不同设计的模型和版本互相独立，同一设计中的全部会话共享这些文件，并通过版本校验防止覆盖新状态。

设计根目录的 `.cad-design.json` 保存设计名称、关联会话、当前建模文件和版本记录；`.cad-history/<源码文件名（不含扩展名）>/v0001/` 等目录保存成功构建的源码、参数、SMLib 实体和预览快照。参考 PDF 保存在 `references/` 中。复制整个设计目录即可带走模型和历史，原生聊天记录仍由 DSH 保存。通过「另存为设计」选择空文件夹，可复制当前工作文件与版本历史并开启独立会话；未提交的试算不复制。

重命名设计会同步修改工作文件夹名称，并更新全部关联会话的工作目录；同名时追加序号，避免覆盖。设计正在运行会话或构建时不允许重命名，已有运行进程不会被强行迁移。文件移动或目录更新失败时回退到原位置。

已打开设计的路径保存在 `$DSH_HOME/storages/minicad/designs.json`；未配置 DSH_HOME 时使用 `~/.dsh/storages/minicad/designs.json`。`dataDir` 可覆盖此设置目录的位置。旧版 `libraries.json` 和各设计库 `minicad.json` 在首次启动时迁移为独立设计记录，已有设计目录、模型、历史和会话绑定原地保留，旧索引只读保留；迁移后每个设计作为工作文件夹显示，其下列出关联会话。

目录、状态和已保存预览的读取在宿主内完成，不启动建模进程，也不加载 SMLib。需要计算真实几何或刷新旧版预览时才启动隔离进程；建模写入共用串行队列，已发布的过程状态和预览可在构建期间读取。版本目录中的 `summary.json` 是不含网格与视图的轻量读取缓存，可自动重建；删除或损坏不会删除模型或改变版本。资源文件指纹采用分块读取，避免将大文件整体读入内存。

过程检查点按模型保存在任务目录的 `.cad-process/`，与 `.cad-history/` 中的已提交版本分开。轮询只读取当前过程元数据，预览二进制按需加载，记录页最多缓存六份预览。完成标记与最终模型在同一事务中提交。

只读几何请求遇到进程启动内存分配等瞬时故障时，最多等待后重试一次；用户取消、超时、参数错误和建模写入不自动重试。

预览网格和实体边线独立保存在版本目录的 `preview.bin`，按需以二进制读取；模型摘要不携带大数组。旧预览或损坏的预览缓存会从该版本的精确实体重建，不改动源码、参数和版本记录。实体有效性检查、精确模型保存和版本提交仍在每次成功构建时执行。

进入工作台时才加载三维视图等较大的前端模块。前端复用当前模型的预览缓冲区，切换任务会取消旧预览读取；视口只在模型、视角或显示状态变化时重绘，不可见时暂停绘制。

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

对现成操作能直接表达的几何，鼓励 agent 优先使用 `cad_edit` 并合并相关操作；复杂算法、自定义几何或现成操作难以表达时使用 `cad_build`，也可混用。这是工具选择建议，不禁止任何一种路径。两条路径共用精确实体、参数、试算、尺寸检查、版本、失败保留和导出流程。

| 工具 | 用途 |
| --- | --- |
| `cad_read_project` | 读取源码、参数、模型列表、版本和几何摘要；可指定 `sourceFile`，读取不切换 UI 选中的模型 |
| `cad_build` | 执行自定义源码；省略 `source` 时重建磁盘上的源码 |
| `cad_edit` | 按顺序执行 1～100 个现成操作，全部成功后只提交一个版本 |
| `cad_query` | 查询面、边、实体或圆柱孔段（`kind: "holes"`），含轴线、孔径和贯穿性；可查询试算候选 |
| `cad_commit` | 原子保存已试算的候选，检查版本与工作文件未变化，并运行随附尺寸检查 |
| `cad_measure` | 批量测量几何，不修改模型 |
| `cad_check` | 批量检查测量结果是否满足目标与公差或上下限，不修改模型 |
| `cad_update_parameters` | 默认合并顶层参数并重建；`mode: "replace"` 替换完整参数对象 |
| `cad_api` | 按符号或 `Class.member` 定位安装版本的声明，支持 `offset` / `limit` 分页 |
| `cad_export` | 导出指定建模文件的已保存版本 |
| `cad_restore` | 恢复指定文件的历史版本，并创建新的递增版本 |

先用 `cad_read_project` 获取建模文件名和版本。除读取和 API 查询外，agent 的工具调用必须明确提供任务内相对路径 `sourceFile`；修改、查询、测量和检查还需提供该文件的 `expectedRevision`。这些显式目标调用不会改变 UI 当前选中的模型；不同文件的版本分别计算。新建文件从版本 0 开始。

### 试算、检查与发布

`cad_build`、`cad_edit` 和 `cad_update_parameters` 默认保留直接提交行为；设置 `commit: false` 时只生成候选与过程检查点，不修改已保存的源码、参数、实体或版本。结果返回 `runId` 和当前 `head`。随后用同一 `sourceFile`、`expectedRevision: head`、`runId` 调用查询、测量和检查工具，检查的是该候选，而不是画布中已保存的模型。候选引用仅在该候选中有效。

确认后用 `cad_commit` 传入该 `runId`、原始 `expectedRevision`、`summary` 和完整 `checks`，将同一候选一次保存成一个新版本，不重复执行建模代码。候选保存在 `.cad-process/` 中，可在重启后继续检查与发布；已保存版本或建模工作文件变化后，需要重新试算。试算隔离的是 CAD 提交，不回滚自定义 JavaScript 自行写入的其他文件。

所有建模提交均可附带 `checks`，不通过就保留上一版。`cad_commit` 会保留试算时已有的检查并合并新检查，不能靠空清单抹掉候选已失败的检查；需要修正检查定义时重新试算。每项检查可写 `name` 和 `basis`，记录尺寸名称及图纸视图、标注、单位等依据；检查定义和结果随版本保存，并进入 ZIP 的 `project.json`。`cad_check` 本身只读，不会自动把检查结果记入待发布版本，发布时应传入完整检查清单。未附检查的成功构建只代表实体有效，不代表符合图纸。不得为了通过检查而把图纸目标改成当前测量值。

自定义代码用 `cad.log(...)` 或 `console.log(...)` 输出诊断；日志和检查点说明随工具结果返回，失败还包含阶段、操作和源文件堆栈。不要用提交测试方块或故意抛异常来读取诊断。

### 孔与尺寸检查

`cad_query(kind: "holes")` 返回向内的圆柱孔壁段，包括轴线、孔径、轴向跨度、完整孔壁 `closedWall` 和贯穿性 `through`。贯穿性检查要求完整圆柱孔壁，并检验略小于孔径的圆柱沿整件的轴向通道没有材料阻挡；结果给出 `clearanceTolerance`。沉孔、阶梯孔可能包含多个孔段，孔段数不直接等于独立孔数；侧边开口会标为非完整孔壁。

选择器支持 `radius`、可选 `tolerance`、`axisDirection`、`through` 和 `closedWall`。普通面查询的 `center` 是面积重心；孔轴位置应使用 `axis` 或孔段的 `hole.center`。

- `distance` 是表面最短距离；`center_distance` 是圆、球、圆柱的几何中心或显式点之间的距离；`axis_distance` 是无限轴线之间的最短距离。检查孔中心距通常应选轴距，而不是孔壁间隙。
- `coordinate` 读取几何中心的 X/Y/Z 坐标；圆柱中心取该孔壁轴向范围的中点。`span` 读取所选几何沿世界 X/Y/Z 的包围尺寸。
- `count` 按 `entityKind: "faces" | "edges" | "solids" | "holes"` 和可选选择器统计数量。配合孔径、贯穿性、孔轴位置和局部板厚检查，可识别少孔、开口孔和半厚台阶。

`cad_api` 可查询 `Part.volume`、`Face.axis`、`Sketch.extrude` 等，默认返回最多 6000 字符，`limit` 最大 12000；按 `nextOffset` 继续读取同一 topic/symbol，避免把截断声明当作完整 API。实体基本体默认居中，XY 轮廓拉伸从其平面向正向延伸；`center` 是平移，不是统一的中心对齐方式。

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

内核测试按文件串行运行，避免多个 WebAssembly 内核同时加载造成内存峰值。只对建模内核服务编写自动化测试，并由 agent 自行验证；其余改动交由用户验收。见 [AGENTS.md](AGENTS.md)。`check` 检查主机语法并构建客户端，不是 UI 测试。

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
