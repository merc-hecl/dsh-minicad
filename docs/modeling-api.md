# 建模接口

[返回首页](../README.md) · [English](modeling-api.en.md)

新建模型和增量修改都先评估 `cad_edit` 的现有操作；能通过一组操作清楚、可靠地完成时，优先使用 `cad_edit` 并合并相关操作。标准实体、布尔、轮廓、孔、圆角、阵列、命名和上色的组合通常适合这条路径，计算坐标或重复特征本身也不需要转为代码建模。缺少所需几何或操作，或专用算法在可靠性、效率上有明确收益时，再选择 `cad_build`；以具体能力差距或实现收益为依据，无需先尝试已知不适用的 `cad_edit` 调用。两种工具仍可按任务需要组合，共用精确实体、试算、尺寸检查、版本、失败保留和导出流程。

| 工具 | 用途 |
| --- | --- |
| `cad_read_project` | 读取 SMP 模型元数据、模型列表、版本和几何摘要；可指定 `modelFile`，读取不切换 UI 选中的模型 |
| `cad_build` | 执行本次显式提供的源码；通过 `cad.current` 访问当前精确实体 |
| `cad_import` | 将精确模型文件导入为新快照；可提供 `metadataFile` 恢复零件身份与名称 |
| `cad_edit` | 从空模型创建或直接增量修改当前实体，顺序执行 1～100 个现成操作，成功后只提交一个版本 |
| `cad_publish_panel` | 为当前已保存版本发布动态参数面板；定义直接执行的操作或脚本及检查，发布本身不创建版本 |
| `cad_query` | 查询面、边、实体、圆柱孔段或顶点坐标；边含端点和可选沿边取点，孔段含轴线与贯穿性；可查询试算候选 |
| `cad_set_geometry_id_format` | 修改面和边的显示编号格式，保存为一个新版本 |
| `cad_commit` | 原子保存已试算的候选，检查版本与工作文件未变化，并运行随附尺寸检查 |
| `cad_measure` | 批量测量几何，不修改模型 |
| `cad_check` | 批量检查测量结果是否满足目标与公差或上下限，不修改模型 |
| `cad_api` | 按符号或 `Class.member` 定位安装版本的声明；`topic:"minicad"` 查询插件辅助 API，支持 `offset` / `limit` 分页 |
| `cad_fit` | 检查两个零件的间隙与干涉，不修改模型 |
| `cad_variants` | 复制当前 SMP 并执行各规格的独立操作，可逐个导出 |
| `cad_export` | 导出指定建模文件的已保存版本，可指定零件 |
| `cad_restore` | 将指定文件的已有版本设为当前版本，不产生新版本 |

先用 `cad_read_project` 获取建模文件名和版本。除读取和 API 查询外，agent 的工具调用必须明确提供任务内 SMP 相对路径 `modelFile`；修改、查询、测量和检查还需提供该文件的 `expectedRevision`。这些显式目标调用不会改变 UI 当前选中的模型；不同文件的版本分别计算。新建文件从版本 0 开始。

### 面和边的编号

对已保存的模型调用 `cad_set_geometry_id_format`，传入 `modelFile`、`expectedRevision`、`summary` 和至少一个格式字段 `faceFormat` 或 `edgeFormat`。模板必须包含一个编号占位符。`{n}` 从 1 开始编号，`{n:1}` 到 `{n:9}` 指定最小位数并在左侧补零。例如 `Face-{n:3}` 生成 `Face-001`。省略的格式沿用当前值，可用 `F-{n}` 和 `E-{n}` 恢复默认格式。

格式实际变化时直接提交一个新版本，工作台和 `cad_query` 的 `displayId` 都使用该格式。后续建模继承当前版本的格式，恢复历史版本时也恢复其格式。查询、测量和编辑仍使用各自版本的完整 `id` 引用。

### 试算、检查与发布

版本条目和制作过程的 `actor` 记录操作发起者：`agent` 表示 agent 工具提交，`user` 表示用户直接应用参数面板。实体仍由同一内核执行。旧版本从 `operations.json` 识别来源；缺少可追溯材料时返回 `null`，不影响模型恢复。

已提交版本通过 `processRunId` 绑定实际执行记录，不用预期的 `candidateRevision` 推断归属。过程的 `baseRevision` 是提交父版本，`inputModel` / `inputRevision` 是实际读取的模型和版本，两者在固定基准面板或跨模型构建时可以不同。版本制作过程只展示该版本实际提交的执行；当前版本另列基于它的未提交试算、失败和停止记录。面板发布的初值验证单独记录，不计入模型制作步骤。尺寸检查和保存失败原因随执行保留；尚未生成检查点的失败也保留记录。

`head` 是当前版本，可用 `cad_restore` 切换。每次提交把当前版本记录为 `parent`，编号在该文件的所有已保存版本中递增。切换版本前，先保存或导入模型工作文件的改动。

`cad_build`、`cad_edit` 和 `cad_import` 默认保留直接提交行为；设置 `commit: false` 时只生成候选与过程检查点，不修改已保存的实体、元数据或版本。结果返回 `runId` 和当前 `head`。随后用同一 `modelFile`、`expectedRevision: head`、`runId` 调用查询、测量和检查工具，检查的是该候选，而不是画布中已保存的模型。候选引用仅在该候选中有效。

确认后用 `cad_commit` 传入该 `runId`、原始 `expectedRevision`、`summary` 和完整 `checks`，将同一候选一次保存成一个新版本，不重复执行建模代码。候选保存在 `.cad-process/` 中，可在重启后继续检查与发布；提交时当前版本、建模工作文件和记录的输入文件必须与试算输入一致。试算隔离的是 CAD 提交，不回滚自定义 JavaScript 自行写入的其他文件。

所有建模提交均可附带 `checks`，不通过就保留上一版。`cad_commit` 会保留试算时已有的检查并合并新检查，不能靠空清单抹掉候选已失败的检查；需要修正检查定义时重新试算。每项检查可写 `name` 和 `basis`，记录尺寸名称及图纸视图、标注、单位等依据；检查定义和结果随版本保存，并进入 ZIP 的 `state.json`。`cad_check` 本身只读，不会自动把检查结果记入待发布版本，发布时应传入完整检查清单。未附检查的成功构建只代表实体有效，不代表符合图纸。不得为了通过检查而把图纸目标改成当前测量值。

每次试算和保存的 `summary` 都应是用户语言中的简短变更标题，例如“生成底板轮廓与安装孔”或“调整中心孔直径”。制作过程直接显示该摘要；完整尺寸放在源码、参数和检查中，不要使用 `probe`、`probe2`、`test` 等占位名称。

`cad_build` 包含多个值得核验的建模阶段时，用 `cad.checkpoint(实体, "阶段描述")` 记录真实的中间实体，步骤卡片优先显示这个描述。简单修改无需刻意拆分；没有单独标签的最终检查点显示本次摘要。例如：

```javascript
function build(parameters, cad) {
  let plate = cad.Box(80, 50, 6).named("底板");
  cad.checkpoint(plate, "创建底板");
  plate = plate.cut(cad.Cylinder(3, 10));
  cad.checkpoint(plate, "切出中心通孔");
  return plate;
}
```

连续相同的几何与零件元数据只保留一个检查点，后补的显式阶段描述仍会保留。指定 `part` 的构建在回放时保留完整装配体和其它零件。

查询内核 API 使用 `cad_api`。实际建模中的诊断用 `cad.log(...)` 或 `console.log(...)` 输出；日志和检查点说明随工具结果返回，失败还包含阶段、操作和源文件堆栈。不要为查看 API 或读取日志而创建测试实体或故意抛异常。

### 孔与尺寸检查

`cad_query(kind: "vertices")` 返回真实拓扑顶点的 `point: [x,y,z]` 和版本限定的 `id`。`kind: "edges"` 返回 `start`、`end`、`isClosed`；闭合边的起点和终点可以重合。所有坐标均为世界坐标，单位 mm；顶点不等于包围盒角点，边的 `center` 是沿边长走到一半的点（`centerMeaning: "arc_length_midpoint"`），不一定是曲线重心或圆心。

查询边时可附带 `edgeParameters: [0,0.5,1]`，每条边增加 `samples: [{t,point}]`。`t` 是 0～1 的边长比例，不是曲线方程的原始参数；0 为起点，1 为终点，0.5 为沿边长的中点。`selector` 可传筛选对象，也可直接传本文件当前版本或指定候选的完整查询 ID；跨文件、过期或其他候选的引用会被拒绝。例如：

```json
{
  "modelFile": "model.smp",
  "expectedRevision": 1,
  "kind": "edges",
  "selector": { "geomType": "circle" },
  "edgeParameters": [0, 0.25, 0.5, 0.75, 1]
}
```

`cad_query(kind: "holes")` 返回向内的圆柱孔壁段，包括轴线、孔径、轴向跨度、完整孔壁 `closedWall` 和贯穿性 `through`。贯穿性检查要求完整圆柱孔壁，并检验略小于孔径的圆柱沿整件的轴向通道没有材料阻挡；结果给出 `clearanceTolerance`。沉孔、阶梯孔可能包含多个孔段，孔段数不直接等于独立孔数；侧边开口会标为非完整孔壁。

选择器支持 `radius`、可选 `tolerance`、`axisDirection`、`through` 和 `closedWall`。圆边、球面和圆柱面的查询结果包含 `geometricCenter: [x,y,z]`，分别表示圆心、球心和圆柱面轴向范围在轴线上的中点。面的 `center` 表示面积重心。孔段还通过 `hole.center` 返回轴向中点。

`parts` 和 `solids` 查询返回工件的 `color`；`faces`（包括孔壁查询）返回面本身的 `color` 和包含工件继承色的 `effectiveColor`。颜色统一为 `#RRGGBB`，未设置时为 `null`。核验颜色可直接查询已保存模型或 `runId` 候选，无需为读取颜色重新执行建模。

- `distance` 是表面最短距离；`center_distance` 是圆、球、圆柱的几何中心或显式点之间的距离；`axis_distance` 是无限轴线之间的最短距离。检查孔中心距通常应选轴距，而不是孔壁间隙。
- `coordinate` 读取 `geometricCenter` 的指定 X、Y 或 Z 分量，可用于尺寸检查。`span` 读取所选几何沿世界 X/Y/Z 的包围尺寸。
- `count` 按 `entityKind: "faces" | "edges" | "solids" | "holes"` 和可选选择器统计数量。配合孔径、贯穿性、孔轴位置和局部板厚检查，可识别少孔、开口孔和半厚台阶。

`cad_api` 可查询 `Part.volume`、`Face.axis`、`Sketch.extrude` 等，默认返回最多 6000 字符，`limit` 最大 12000；按 `nextOffset` 继续读取同一 topic/symbol，避免把截断声明当作完整 API。实体基本体默认居中，XY 轮廓拉伸从其平面向正向延伸；`center` 是平移，不是统一的中心对齐方式。

`assembly`、`Assembly.part`、`current`、`edit`、`checkpoint`、`readModel` 和 `log` 是 MiniCAD 的辅助 API，使用 `cad_api({topic:"minicad",symbol:"assembly"})` 查询；它们不在 SMLib 的 `parts` / `operations` 分类中。

### 现成操作与自定义代码

`cad_edit` 按零件管理、生成与组合、局部修改、变换与复制、外观五组展示操作。一次调用可以混用各组操作，按数组顺序执行。

| 操作 | 主要参数与语义 |
| --- | --- |
| `add_part` | `id`、`name`、`tool`；向零件集合添加独立实体，空模型可直接创建集合 |
| `copy_part` | `part`、新 `id`、`name`，可选 `center` 平移与 `rotate`；已有集合中 `part` 指定源零件 ID，普通 Part 则用它为原件分配首个稳定 ID 并转成集合；保留原件并增加独立副本 |
| `remove_part` | `part`；删除指定零件，发布时模型仍需有有效实体 |
| `revolve` | `profile`、世界坐标 `axis`、`angle`，可选 `origin`；角度为 -360～360 度且不能为零 |
| `loft` | 两个以上依次排列的 `sections`，可选 `ruled`、`smooth`、`closed` |
| `sweep` | `profile` 与 `path`；路径支持 line、polyline、spline、arc、helix，可选 `orient`、`translational`、`twist` |
| `linear_pattern` | `step`、`count`；按位移步长复制实体或 `tool` |
| `circular_pattern` | `axis`、每份之间的 `angle`、`count`，可选 `origin`；角度是步进角，不是总角度 |
| `rotate_faces` | `faces`、世界坐标 `axis`、`angle`，可选 `origin`；旋转选中面并重建相邻面 |
| `scale` | 正数 `factor` 或三个正数的 XYZ 比例，可选缩放中心 `origin` |
| `color` | `color` 接受 `"#RRGGBB"` 或 `null`。省略 `faces` 修改工件颜色，提供 `faces` 修改指定面的覆盖色。多零件模型用 `part` 指定零件 ID |
| `rename` | `name` 为实体的非空用途名称。单实体可直接命名，装配成员用 `part` 指定；普通 Part 内含多个独立实体时用 `target` 指定一个。命名不改变几何或编号 |
| `import` | 从任务内 `file` 读取精确资源，如 `resources/input.step`、`.brep`、`.smb`；资源随版本快照和 ZIP 保存 |

轮廓 `profile` 支持 `rectangle`、`circle`、`polygon` 和 `wire`。默认在 XY 平面，可用 `plane: "XZ"` / `"YZ"`、`rotate`、`center` 放置轮廓。整体生成结果也可用 `rotate`、`center` 放置。

`wire` 的 `segments` 由按顺序闭合的边组成，点坐标用截面局部的 `[x,y]`。每段的终点应与下一段的起点重合，最后一段回到起点。可混用下列三种边：

| `shape` | 参数 |
| --- | --- |
| `line` | `start`、`end` |
| `arc` | `start`、弧上的 `through`、`end` |
| `center_arc` | `center`、`radius`、`startAngle`、`arcSize`。角度从局部 +X 轴量起，单位为度。负 `arcSize` 表示顺时针，取值范围为 -360～360 且不能为零 |

下面的操作拉伸一个 D 形截面：

```json
{
  "op": "extrude",
  "name": "D 形支座",
  "amount": 8,
  "profile": {
    "shape": "wire",
    "segments": [
      { "shape": "line", "start": [-5, 0], "end": [5, 0] },
      { "shape": "arc", "start": [5, 0], "through": [0, 5], "end": [-5, 0] }
    ]
  }
}
```

扫掠轨迹 `sweep.path` 的三点圆弧用空间坐标 `[x,y,z]`。阵列 `count` 包含原始份，范围 2～100。有 `tool` 时把工具阵列按 `mode: "fuse" | "cut" | "intersect"` 作用于实体，省略 `tool` 时复制目标实体。

初始建模从空模型开始，批次中先创建或导入实体，再执行切孔、倒角等操作。已有版本的普通编辑直接读取当前版本保存的精确实体，只执行本次新增操作；不需要重复提供旧操作，制作过程也只记录本次操作。初始实体只由本次操作生成，不自动执行磁盘上的代码。

编辑直接作用于当前 SMP，不追加源码、不重放历史操作。`parameters` 仅供本次调用中的 `{parameter:"name"}` 数值引用使用；省略时为空对象，不继承旧调用参数。源码和参考资源的后续变化不影响已经保存的模型。

例如，`{"op":"color","part":"lid","color":"#4682B4"}` 给盖板上色。再执行 `{"op":"color","part":"lid","faces":{"position":"top"},"color":"#FF8000"}` 将顶面设为橙色。传入 `null` 清除该范围的颜色，清除单面覆盖色后该面继承工件颜色。颜色随版本保存，并可通过 SMP 和 STEP 导出。

例如，创建底板并一次切出三个孔：

```json
{
  "modelFile": "model.smp",
  "expectedRevision": 0,
  "parameters": { "length": 40 },
  "summary": "创建三孔底板",
  "operations": [
    { "op": "box", "size": [{ "parameter": "length" }, 20, 8], "name": "孔板" },
    { "op": "linear_pattern", "step": [8, 0, 0], "count": 3, "mode": "cut",
      "tool": { "shape": "cylinder", "radius": 1, "height": 10 } }
  ]
}
```

每个操作可用 `target` 指定一个独立实体，例如 `target: { nearest: [10, 0, 0], one: true }` 或当前查询返回的实体 ID。只修改选中实体，再与未修改实体做并集；移动后接触或重叠的实体可能合并。省略 `target` 时作用于整个 Part。操作的必填参数、数值范围、向量长度和未知字段均由内核校验；失败错误包含从 0 开始的 `operationIndex`，批次失败保留上一版。

自定义代码定义 `build(parameters, cad)` 并返回有效、正体积的 `cad.Part` 或 `cad.assembly` 多零件集合。`cad` 提供 SMLib 函数、同一套 `cad.edit(part, operations, parameters)`，以及任务内资源读取：

`source` 是普通 JavaScript 脚本，不含 `import` / `export`。SMLib 符号通过 `cad.Box`、`cad.Location` 等访问，或在函数内从 `cad` 解构；它们不是全局变量。

```javascript
function build(parameters, cad) {
  return cad.Box(parameters.length, 40, 8).cut(cad.Cylinder(4, 10)).named("孔板");
}
```

`cad.readModel("resources/input.step")` 导入并归档精确资源。`cad_build` 每次必须显式提供 `source`；`cad.current` 是当前已保存的精确模型，新模型为 `null`。提供 `part:"lid"` 时，`cad.current` 仅为该零件，返回值也只替换该零件。参数仅属于本次执行。相对 `require` 与 `__dirname` 从设计根目录解析；本地 CommonJS 模块和通过 `cad.readModel` 读取的文件自动归档，其他文件输入通过 `inputs:["resources/table.json"]` 显式声明。

所有最终独立实体必须按用途命名，装配体集合不需要整体名称。创建独立实体时可在生成操作上填写 `name`，或在同一批次最后使用 `rename`；已有装配成员用 `{op:"rename",part:"lid",name:"检修盖板"}` 重命名。中间构造和 `commit:false` 试算可以暂不命名，但 `cad_build`、`cad_edit` 和 `cad_commit` 发布时会拒绝未命名实体，并保留上一版。编辑延续可明确继承的名称，拆分、合并产生无法确定名称的实体时需显式命名。名称随版本、查询和工作台预览保存；STEP、SMP 导出保留实体名称，SMB 和 STL 不保存这些名称。


对当前零件执行自定义切孔，无需重建已有特征：

```javascript
function build(parameters, cad) {
  return cad.current.cut(cad.Cylinder(4, 100));
}
```

### 测量、检查和几何引用

工作台单选时使用与 `cad_query` 相同的几何查询，双选时使用与 `cad_measure` 相同的距离计算。`distance` 返回最小距离 `value`、最近点 `point` / `otherPoint` 及世界轴投影 `projections: { x, y, z }`；界面直接显示这些投影值。`projected_distance` 可用于单轴读取和尺寸检查，不另行选取点对。数值近似结果的 `accuracy` 表示求解/离散精度，`cad_check` 的 `tolerance` 表示目标值的允许公差，两者独立。

`cad_measure` 的 `measurements` 与 `cad_check` 的 `checks` 均接受 1～100 项。测量支持：

- `max_distance`：使用相同的 `from`、`to`，求两几何上任意点对之间的最大距离。曲面采用独立细化网格，数值近似结果带 `approximate`、`method`、`accuracy`（mm）。
- `projected_distance`：在 `from`、`to` 外指定 `axis: "x" | "y" | "z"`，返回其中一组最近点连线在世界轴上的绝对分量。最近点不唯一时分量可能随所选点对变化；同一次批量请求与 `distance` 共用同一组最近点。
- `distance`：`from`、`to` 可为查询 ID、`{ kind, selector }` 或 `{ point: [x,y,z] }`。计算有界几何之间的最小距离，支持点、面、实体及边对；曲边采用解析计算或数值求解。点在实体内部时返回到表面的间距；嵌套实体测量壁间距，相交或接触的实体返回 0。
- `angle`：两个平面的法向、直线方向、圆/圆柱等旋转轴，或 `{ direction: [x,y,z] }` 的夹角，范围 0～180 度。
- `thickness`：给定实体内或表面的 `point` 和非零 `direction`，返回穿过该点的一段连续材料厚度及出入口点。它是局部方向测厚，不是全模型最小壁厚；空腔中的点、切向或无法判定的测量会被拒绝。
- `size`：沿 `axis: "x" | "y" | "z"` 的包围盒尺寸；`volume`、`area`、`length`、`radius`、`diameter` 返回相应几何量。单实体尺寸、体积和壁厚可指定 `target`；面/边属性通过 `entity: { kind, selector }` 定位。

每个 `from` / `to` / `entity` 必须定位一个几何。测量两个整件之间的距离时，分别使用 `{kind:"solids",selector:{part:"base",one:true}}` 与另一零件的选择器；选择一个零件的全部面不能代表单个测量对象。含多个实体的零件应进一步筛选到目标实体。

尺寸检查示例：

```json
{
  "modelFile": "model.smp",
  "expectedRevision": 1,
  "checks": [
    { "measurement": { "kind": "size", "axis": "x" }, "expected": 40, "tolerance": 0.01 },
    { "measurement": { "kind": "thickness", "point": [-10, 5, 4], "direction": [0, 0, -1] }, "min": 2 }
  ]
}
```

检查返回整体 `passed` 和各项实测值、单位及通过情况。可使用 `expected` ± `tolerance`（默认 1e-6），或 `min` / `max`（可单独指定，边界包含在内）。长度、面积、体积、角度分别使用 mm、mm²、mm³、度，公差使用对应测量单位。

几何 ID 绑定设计任务、建模文件和版本；旧版本或其他模型的引用会被拒绝。`faces` / `edges` 可接受多个 ID。ID 通过拓扑位置和内核派生关系解析，不按最近中心猜测；前序操作导致引用消失、拆分或失去派生关系时会拒绝。修改后重新查询；同批次后续步骤可使用几何选择器。不把面、边编号当作跨版本永久身份。

导出文件写入任务的 `exports/<建模文件路径（不含 .smp）>/`，不同文件的同号版本不会互相覆盖。旧的导出文件仍保留。


## 多零件模型

`cad_build` 可返回 `cad.assembly([{ id, name, shape }])`。`id` 是设计内稳定且唯一的零件标识，`name` 是显示名，`shape` 是放置在世界坐标中的有效 `cad.Part`。零件接触或重叠不会自动合并；整体体积为各零件体积之和，包含重叠材料。重复实例可复用构造代码，但每个放置实例必须有自己的 ID。

```javascript
function build(p, cad) {
  return cad.assembly([
    { id: "base", name: "底座", shape: cad.Box(p.length, 40, 8) },
    { id: "lid", name: "盖板", shape: cad.Box(p.length, 40, 2).translate(0, 0, 5) }
  ]);
}
```

普通 Part 的 `parts` 查询为空；可直接用 `copy_part` 保留原模型并创建独立复制件。例如下列批次把 Y 向尺寸为 20 mm 的孔板沿 +Y 复制，留下 5 mm 间隙，并将复制件工件色设为赤红色：

```json
[
  { "op": "copy_part", "part": "base", "id": "copy", "name": "孔板CP", "center": [0, 25, 0] },
  { "op": "color", "part": "copy", "color": "#DC143C" }
]
```

`part:"base"` 为原件分配稳定 ID，原件名称、位置、几何和颜色保持不变。复制保留面覆盖色；如需覆盖这些面色，用 `color` 的 `faces` 指定范围修改或清除。

- `cad_query(kind: "parts")` 返回 ID、名称、颜色、尺寸、体积和预览几何范围。
- 查询面、边或实体时，选择器可加 `part: "lid"`。查询结果包含所属零件 `part` 和 `partName`，几何 ID 仍绑定整个模型文件和版本。
- `cad_edit` 的每个操作用 `part: "lid"` 指定零件，例如 `{op:"translate",part:"lid",by:[0,0,10]}`。零件内仍使用原有布尔、面编辑等操作，其他零件保持独立。使用 `add_part`、`copy_part`、`remove_part` 管理零件；复杂修改也可通过 `cad_build` 的 `cad.current` 完成。
- 测量指定零件可用 `target: {part:"lid",one:true}`；测厚必须定位一个实体。
- `cad_fit` 接收 `modelFile`、`expectedRevision`、`pairs:[{from:"base",to:"lid"}]` 和可选 `tolerance`（默认 0.001 mm）。返回最小表面距离、干涉体积和 `contact` / `separated` / `interference`。它不是装配约束求解器，也不修改零件。
- `cad_export` 可加 `part:"lid"` 导出一个零件，省略则导出整组。整组支持 STEP、STL、SMP、项目 ZIP；SMB 只用于单体导出。单件导出保留装配中的世界位置。STEP 回读检查实体数量、体积和包围尺寸/位置；不宣称保留装配约束或层级树。
- 版本对比仍显示占据空间的体积变化；仅重命名、改 ID 或重新分组不会产生体积差异。

内置 `cad.assembly` 可使用 `translate`、`rotate` 整体放置，以及 `parts`、`part(id)` 读取成员；它不是 SMLib 的 `cad.Part`。自定义布尔运算作用于成员的 `shape`，再重新组成 assembly。

## 多规格生成

`cad_variants` 复制指定版本的精确 SMP，并为每个规格执行各自的 `operations`，不会执行历史脚本。原模型和 UI 当前选中模型不变，输出必须是新的 `.smp` 路径。

```json
{
  "modelFile": "model.smp",
  "expectedRevision": 1,
  "variants": [
    { "name": "加长版", "modelFile": "sizes/long.smp", "operations": [{ "op": "scale", "factor": [1.5, 1, 1] }] },
    { "name": "加厚版", "modelFile": "sizes/thick.smp", "operations": [{ "op": "offset_faces", "faces": { "position": "top" }, "distance": 2 }] }
  ],
  "formats": ["step"]
}
```

一次 1～20 个规格，每个规格可附带本次 `parameters` 和 `checks`，不会继承旧版检查。所有规格先试算和检查，再逐个保存与导出；保存或导出失败会报告已保存的规格，各输出独立，不自动跟随原模型变化。

## 动态参数面板

保存版本后，用 `cad_publish_panel` 发布少量与当前需求相关、能可靠执行的后续调整。综合当前几何、当前版本的父链、最近和更早的用户要求；不要混入其他分支或已被替代的要求。固定要求写进检查，不当作建议调整项。没有合适项目时发布 `fields: []`，明确结束本版的面板生成。

面板由双语 `title`、最多八个 `fields`、一种执行方式，以及必需的 `checks` 组成。字段有稳定的 `key`、双语 `label`、初始 `value`，可选双语 `group`：

| `type` | 其他字段 |
| --- | --- |
| `number` / `integer` | 可选 `min`、`max`、`step`、`unit`；初值必须是当前模型的真实数值 |
| `choice` | `options: [{ value, label: { zh, en } }]`，2～8 个字符串或数值选项 |
| `toggle` | 布尔 `value` |

执行方式二选一：`operations` 使用与 `cad_edit` 相同的操作和 `{ parameter: "key" }`；或 `source` 显式定义 `build(parameters,cad)`，适合联动、差值、选项和开关。`part` 仅用于脚本选择装配体成员，操作模式在每个操作中指定 `part`。脚本必须自包含，以捕获的实体为输入，不依赖会变化的外部文件。标题、字段、分组和选项标签均提供 `zh`、`en`；用户给出的参数名称保持原文，不生成说明性 UI 文案。

例如，当前底板厚 6 mm，沿顶部面调整总厚度：

```json
{
  "modelFile": "model.smp",
  "expectedRevision": 3,
  "panel": {
    "title": { "zh": "底板厚度", "en": "Plate thickness" },
    "fields": [{ "key": "thickness", "type": "number", "label": { "zh": "厚度", "en": "Thickness" }, "value": 6, "unit": "mm" }],
    "source": "function build(p,cad) { if(p.thickness===6) return cad.current; return cad.edit(cad.current,[{op:'offset_faces',faces:{position:'top',one:true},distance:p.thickness-6}]); }",
    "checks": [{ "measurement": { "kind": "size", "axis": "z" }, "expected": { "parameter": "thickness" }, "tolerance": 0.000001 }]
  }
}
```

面板必须针对实际零件选择正确的面，并附带需要保留的孔距、尺寸等检查；示例不是任意零件的通用模板。范围根据几何和明确需求设置，不把猜测当作工程限值。`step` 是输入步长，不代表范围内的几何都能成功。

发布时试算初值，要求尺寸检查通过且实体占据的空间保持一致，不创建模型版本；失败不替换已存在的面板。用户点击「应用」后，服务只接受面板 ID、目标模型、版本与字段值，从保存的执行定义直接建模，不请求语言模型。每次应用重新执行原面板的检查，失败保留原模型；成功保存一个新版本，同时保留面板和当前值。相同值不创建版本。

面板应用的制作过程记录相对父版本的字段变化及一个最终检查点；固定基准重算的内部操作不拆成用户步骤。字段名称、前后值、选项标签和单位随执行保存。

面板捕获独立的精确基准实体。无论已经应用多少次，`cad.current` 和操作输入始终是该基准，参数始终表示一整组目标值，不在上次结果上重复叠加。新版本的父版仍是应用前的当前版本。面板绑定具体模型与版本；切换历史版本会恢复对应面板，agent 后续修改模型不会继承旧面板。`cad_read_project` 返回控件与当前值，执行源码不发送到浏览器。

版本目录中的 `panel.json` 保存面板定义、当前值和基准引用信息，`panel/model.smp` 与 `panel/state.json` 保存独立基准。完整设计复制和 ZIP 导出包含这些材料；只导入 SMP 与模型元数据不恢复交互面板。

## 快照与脚本归档

每个版本位于 `.cad-history/<模型路径，不含 .smp>/vNNNN/`。恢复、查询、继续编辑只需要 `model.smp` 与 `state.json`，不需要原始脚本或资源。

| 文件 | 职责 |
| --- | --- |
| `model.smp` | 必须；精确几何、拓扑和颜色 |
| `state.json` | 必须；格式版本、单位、零件身份和名称、实体对应关系，以及几何摘要和本版检查记录 |
| `preview.bin` | 可重建的工作台网格缓存 |
| `process/run.json`、`process/*.bin` | 已提交的执行记录与过程预览，供制作过程回放 |
| `operations.json` | 本版工具调用、输入模型与版本、内核版本、操作和检查；用于追溯，不用于恢复几何 |
| `build/source.js` | 本版执行 cad_build 时必须归档的实际源码 |
| `build/base.smp`、`build/base.state.json` | 对已有模型执行脚本时归档的输入快照，可结合操作记录定位输入零件 |
| `build/parameters.json` | cad_build 本次提供的参数，有则归档 |
| `build/inputs/` | cad_build 使用的资源、辅助模块和声明输入，有则归档 |
| `inputs/` | 导入或结构化编辑本次读取的文件，有则归档 |

工作目录中的当前模型为 `<名称>.smp` 与 `<名称>.state.json`。`.cad-design.json` 管理模型列表、版本关系和当前版本指针。ZIP 导出包含该版本快照及其执行材料，不依赖原始工作目录；导入时指定 SMP 的 `file` 和元数据的 `metadataFile` 即可恢复零件身份。检查只记录该版本的核验，不是持续约束。

后续 cad_edit 不改写或复制旧版源码。显式重跑脚本产生新的候选；对已有模型编程修改时使用 `cad.current`，避免无意重建而丢失后续编辑。失败和未提交的源码、参数及输入保存在 `.cad-process/` 对应运行记录中。

已提交过程随版本归档，因此「另存为」和版本 ZIP 保留其回放材料；旧版仅存于 `.cad-process/` 的已提交过程会在复制或导出时补入归档，原设计记录不改写。未提交试算不随「另存为」复制。

外部 SMB 支持单体交换。
