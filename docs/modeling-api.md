# 建模接口

[返回首页](../README.md) · [English](modeling-api.en.md)

对现成操作能直接表达的几何，鼓励 agent 优先使用 `cad_edit` 并合并相关操作；复杂算法、自定义几何或现成操作难以表达时使用 `cad_build`，也可混用。这是工具选择建议，不禁止任何一种路径。两条路径共用精确实体、参数、试算、尺寸检查、版本、失败保留和导出流程。

| 工具 | 用途 |
| --- | --- |
| `cad_read_project` | 读取源码、参数、模型列表、版本和几何摘要；可指定 `sourceFile`，读取不切换 UI 选中的模型 |
| `cad_build` | 执行自定义源码；省略 `source` 时重建磁盘上的源码 |
| `cad_edit` | 从空模型创建或直接增量修改当前实体，顺序执行 1～100 个现成操作，成功后只提交一个版本 |
| `cad_query` | 查询面、边、实体、圆柱孔段或顶点坐标；边含端点和可选沿边取点，孔段含轴线与贯穿性；可查询试算候选 |
| `cad_set_geometry_id_format` | 修改面和边的显示编号格式，保存为一个新版本 |
| `cad_commit` | 原子保存已试算的候选，检查版本与工作文件未变化，并运行随附尺寸检查 |
| `cad_measure` | 批量测量几何，不修改模型 |
| `cad_check` | 批量检查测量结果是否满足目标与公差或上下限，不修改模型 |
| `cad_update_parameters` | 默认合并顶层参数并重建；`mode: "replace"` 替换完整参数对象 |
| `cad_api` | 按符号或 `Class.member` 定位安装版本的声明，支持 `offset` / `limit` 分页 |
| `cad_fit` | 检查两个零件的间隙与干涉，不修改模型 |
| `cad_variants` | 从已保存源码生成独立参数规格，可逐个导出 |
| `cad_export` | 导出指定建模文件的已保存版本，可指定零件 |
| `cad_restore` | 将指定文件的已有版本设为当前版本，不产生新版本 |

先用 `cad_read_project` 获取建模文件名和版本。除读取和 API 查询外，agent 的工具调用必须明确提供任务内相对路径 `sourceFile`；修改、查询、测量和检查还需提供该文件的 `expectedRevision`。这些显式目标调用不会改变 UI 当前选中的模型；不同文件的版本分别计算。新建文件从版本 0 开始。

### 面和边的编号

对已保存的模型调用 `cad_set_geometry_id_format`，传入 `sourceFile`、`expectedRevision`、`summary` 和至少一个格式字段 `faceFormat` 或 `edgeFormat`。模板必须包含一个编号占位符。`{n}` 从 1 开始编号，`{n:1}` 到 `{n:9}` 指定最小位数并在左侧补零。例如 `Face-{n:3}` 生成 `Face-001`。省略的格式沿用当前值，可用 `F-{n}` 和 `E-{n}` 恢复默认格式。

格式实际变化时直接提交一个新版本，工作台和 `cad_query` 的 `displayId` 都使用该格式。后续建模继承当前版本的格式，恢复历史版本时也恢复其格式。查询、测量和编辑仍使用各自版本的完整 `id` 引用。

### 试算、检查与发布

`head` 是当前版本，可用 `cad_restore` 切换。每次提交把当前版本记录为 `parent`，编号在该文件的所有已保存版本中递增。切换版本前，先构建工作文件中的改动。

`cad_build`、`cad_edit` 和 `cad_update_parameters` 默认保留直接提交行为；设置 `commit: false` 时只生成候选与过程检查点，不修改已保存的源码、参数、实体或版本。结果返回 `runId` 和当前 `head`。随后用同一 `sourceFile`、`expectedRevision: head`、`runId` 调用查询、测量和检查工具，检查的是该候选，而不是画布中已保存的模型。候选引用仅在该候选中有效。

确认后用 `cad_commit` 传入该 `runId`、原始 `expectedRevision`、`summary` 和完整 `checks`，将同一候选一次保存成一个新版本，不重复执行建模代码。候选保存在 `.cad-process/` 中，可在重启后继续检查与发布；已保存版本或建模工作文件变化后，需要重新试算。试算隔离的是 CAD 提交，不回滚自定义 JavaScript 自行写入的其他文件。

所有建模提交均可附带 `checks`，不通过就保留上一版。`cad_commit` 会保留试算时已有的检查并合并新检查，不能靠空清单抹掉候选已失败的检查；需要修正检查定义时重新试算。每项检查可写 `name` 和 `basis`，记录尺寸名称及图纸视图、标注、单位等依据；检查定义和结果随版本保存，并进入 ZIP 的 `project.json`。`cad_check` 本身只读，不会自动把检查结果记入待发布版本，发布时应传入完整检查清单。未附检查的成功构建只代表实体有效，不代表符合图纸。不得为了通过检查而把图纸目标改成当前测量值。

自定义代码用 `cad.log(...)` 或 `console.log(...)` 输出诊断；日志和检查点说明随工具结果返回，失败还包含阶段、操作和源文件堆栈。不要用提交测试方块或故意抛异常来读取诊断。

### 孔与尺寸检查

`cad_query(kind: "vertices")` 返回真实拓扑顶点的 `point: [x,y,z]` 和版本限定的 `id`。`kind: "edges"` 返回 `start`、`end`、`isClosed`；闭合边的起点和终点可以重合。所有坐标均为世界坐标，单位 mm；顶点不等于包围盒角点，边的 `center` 是沿边长走到一半的点（`centerMeaning: "arc_length_midpoint"`），不一定是曲线重心或圆心。

查询边时可附带 `edgeParameters: [0,0.5,1]`，每条边增加 `samples: [{t,point}]`。`t` 是 0～1 的边长比例，不是曲线方程的原始参数；0 为起点，1 为终点，0.5 为沿边长的中点。`selector` 可传筛选对象，也可直接传本文件当前版本或指定候选的完整查询 ID；跨文件、过期或其他候选的引用会被拒绝。例如：

```json
{
  "sourceFile": "model.js",
  "expectedRevision": 1,
  "kind": "edges",
  "selector": { "geomType": "circle" },
  "edgeParameters": [0, 0.25, 0.5, 0.75, 1]
}
```

`cad_query(kind: "holes")` 返回向内的圆柱孔壁段，包括轴线、孔径、轴向跨度、完整孔壁 `closedWall` 和贯穿性 `through`。贯穿性检查要求完整圆柱孔壁，并检验略小于孔径的圆柱沿整件的轴向通道没有材料阻挡；结果给出 `clearanceTolerance`。沉孔、阶梯孔可能包含多个孔段，孔段数不直接等于独立孔数；侧边开口会标为非完整孔壁。

选择器支持 `radius`、可选 `tolerance`、`axisDirection`、`through` 和 `closedWall`。圆边、球面和圆柱面的查询结果包含 `geometricCenter: [x,y,z]`，分别表示圆心、球心和圆柱面轴向范围在轴线上的中点。面的 `center` 表示面积重心。孔段还通过 `hole.center` 返回轴向中点。

- `distance` 是表面最短距离；`center_distance` 是圆、球、圆柱的几何中心或显式点之间的距离；`axis_distance` 是无限轴线之间的最短距离。检查孔中心距通常应选轴距，而不是孔壁间隙。
- `coordinate` 读取 `geometricCenter` 的指定 X、Y 或 Z 分量，可用于尺寸检查。`span` 读取所选几何沿世界 X/Y/Z 的包围尺寸。
- `count` 按 `entityKind: "faces" | "edges" | "solids" | "holes"` 和可选选择器统计数量。配合孔径、贯穿性、孔轴位置和局部板厚检查，可识别少孔、开口孔和半厚台阶。

`cad_api` 可查询 `Part.volume`、`Face.axis`、`Sketch.extrude` 等，默认返回最多 6000 字符，`limit` 最大 12000；按 `nextOffset` 继续读取同一 topic/symbol，避免把截断声明当作完整 API。实体基本体默认居中，XY 轮廓拉伸从其平面向正向延伸；`center` 是平移，不是统一的中心对齐方式。

### 现成操作与自定义代码

`cad_edit` 按生成与组合、局部修改、变换与复制、外观四组展示操作。一次调用可以混用各组操作，按数组顺序执行。

| 操作 | 主要参数与语义 |
| --- | --- |
| `revolve` | `profile`、世界坐标 `axis`、`angle`，可选 `origin`；角度为 -360～360 度且不能为零 |
| `loft` | 两个以上依次排列的 `sections`，可选 `ruled`、`smooth`、`closed` |
| `sweep` | `profile` 与 `path`；路径支持 line、polyline、spline、arc、helix，可选 `orient`、`translational`、`twist` |
| `linear_pattern` | `step`、`count`；按位移步长复制实体或 `tool` |
| `circular_pattern` | `axis`、每份之间的 `angle`、`count`，可选 `origin`；角度是步进角，不是总角度 |
| `rotate_faces` | `faces`、世界坐标 `axis`、`angle`，可选 `origin`；旋转选中面并重建相邻面 |
| `scale` | 正数 `factor` 或三个正数的 XYZ 比例，可选缩放中心 `origin` |
| `color` | `color` 接受 `"#RRGGBB"` 或 `null`。省略 `faces` 修改工件颜色，提供 `faces` 修改指定面的覆盖色。多零件模型用 `part` 指定零件 ID |
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

初始建模从空模型开始，批次中先创建或导入实体，再执行切孔、倒角等操作。已有版本的普通编辑直接读取当前版本保存的精确实体，只执行本次新增操作；不需要重复提供旧操作，制作过程也只记录本次操作。若没有已保存版本但磁盘上已有建模源码，则先执行该源码作为初始实体。

编辑同时追加到源码中，供 `cad_update_parameters` 或显式 `cad_build` 完整重算。`cad_edit` 若传入与已保存版本不同的参数，会先用新参数重算已有特征，再执行新增操作；已有特征的重算不重复记录为本次编辑步骤。源码、参数或导入资源存在未构建的工作文件改动时，仍需先构建工作文件再局部编辑。

例如，`{"op":"color","part":"lid","color":"#4682B4"}` 给盖板上色。再执行 `{"op":"color","part":"lid","faces":{"position":"top"},"color":"#FF8000"}` 将顶面设为橙色。传入 `null` 清除该范围的颜色，清除单面覆盖色后该面继承工件颜色。颜色随版本保存，并可通过 SMP 和 STEP 导出。

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

自定义代码定义 `build(parameters, cad)` 并返回有效、正体积的 `cad.Part` 或 `cad.assembly` 多零件集合。`cad` 提供 SMLib 函数、同一套 `cad.edit(part, operations, parameters)`，以及任务内资源读取：

```javascript
function build(parameters, cad) {
  return cad.Box(parameters.length, 40, 8).cut(cad.Cylinder(4, 10));
}
```

`cad.readModel("resources/input.step")` 也可导入精确资源。局部编辑会记录在源码中，参数重算重新执行整个模型。`cad_update_parameters` 默认只合并顶层键，嵌套对象整体替换；完整替换或删除参数可用 `mode: "replace"`。`cad_build` / `cad_edit` 的 `parameters` 若提供则为完整对象，省略则沿用工作参数。

### 测量、检查和几何引用

工作台单选时使用与 `cad_query` 相同的几何查询，双选时使用与 `cad_measure` 相同的距离计算。`distance` 返回最小距离 `value`、最近点 `point` / `otherPoint` 及世界轴投影 `projections: { x, y, z }`；界面直接显示这些投影值。`projected_distance` 可用于单轴读取和尺寸检查，不另行选取点对。数值近似结果的 `accuracy` 表示求解/离散精度，`cad_check` 的 `tolerance` 表示目标值的允许公差，两者独立。

`cad_measure` 的 `measurements` 与 `cad_check` 的 `checks` 均接受 1～100 项。测量支持：

- `max_distance`：使用相同的 `from`、`to`，求两几何上任意点对之间的最大距离。曲面采用独立细化网格，数值近似结果带 `approximate`、`method`、`accuracy`（mm）。
- `projected_distance`：在 `from`、`to` 外指定 `axis: "x" | "y" | "z"`，返回其中一组最近点连线在世界轴上的绝对分量。最近点不唯一时分量可能随所选点对变化；同一次批量请求与 `distance` 共用同一组最近点。
- `distance`：`from`、`to` 可为查询 ID、`{ kind, selector }` 或 `{ point: [x,y,z] }`。计算有界几何之间的最小距离，支持点、面、实体及边对；曲边采用解析计算或数值求解。点在实体内部时返回到表面的间距；嵌套实体测量壁间距，相交或接触的实体返回 0。
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

- `cad_query(kind: "parts")` 返回 ID、名称、尺寸、体积和预览几何范围。
- 查询面、边或实体时，选择器可加 `part: "lid"`。查询结果包含所属零件 `part` 和 `partName`，几何 ID 仍绑定整个模型文件和版本。
- `cad_edit` 的每个操作用 `part: "lid"` 指定零件，例如 `{op:"translate",part:"lid",by:[0,0,10]}`。零件内仍使用原有布尔、面编辑等操作，其他零件保持独立。新增/删除零件或更改零件列表用 `cad_build` 更新源码。
- 测量指定零件可用 `target: {part:"lid",one:true}`；测厚必须定位一个实体。
- `cad_fit` 接收 `sourceFile`、`expectedRevision`、`pairs:[{from:"base",to:"lid"}]` 和可选 `tolerance`（默认 0.001 mm）。返回最小表面距离、干涉体积和 `contact` / `separated` / `interference`。它不是装配约束求解器，也不修改零件。
- `cad_export` 可加 `part:"lid"` 导出一个零件，省略则导出整组。整组支持 STEP、STL、SMP、项目 ZIP；SMB 只用于单体导出。单件导出保留装配中的世界位置。STEP 回读检查实体数量、体积和包围尺寸/位置；不宣称保留装配约束或层级树。
- 版本对比仍显示占据空间的体积变化；仅重命名、改 ID 或重新分组不会产生体积差异。

内置 `cad.assembly` 可使用 `translate`、`rotate` 整体放置，以及 `parts`、`part(id)` 读取成员；它不是 SMLib 的 `cad.Part`。自定义布尔运算作用于成员的 `shape`，再重新组成 assembly。

## 多规格生成

`cad_variants` 读取指定模型的已保存源码，按规格合并顶层参数，生成独立模型文件。原模型、当前选中的文件和原版本不变。输出文件必须是新的任务内 `.js` 路径。

```json
{
  "sourceFile": "model.js",
  "expectedRevision": 1,
  "variants": [
    { "name": "60 mm", "sourceFile": "sizes/box-60.js", "parameters": { "length": 60 } },
    { "name": "80 mm", "sourceFile": "sizes/box-80.js", "parameters": { "length": 80 } },
    { "name": "100 mm", "sourceFile": "sizes/box-100.js", "parameters": { "length": 100 } }
  ],
  "formats": ["step", "stl"]
}
```

一次 1～20 个规格，每个规格可携带自己的 `checks`；不会自动继承旧版本检查。可选 `formats` 为 STEP、STL、SMP、ZIP。所有规格先完成试算与随附检查，再逐个保存与导出；保存/导出阶段失败会报告已经保存的规格，不承诺整批回滚。各规格源码独立，之后不会自动跟随原模型变化。源码应通过 `cad.readModel` 使用任务内资源；复制到不同目录时，自定义 `require` 的相对路径由源码负责。

工作台「模型查看」可切换模型与规格，并显示、隐藏或单独查看零件；透明查看只影响显示，所有查看操作均不修改几何、版本或导出内容。

## 原生存储

工作文件、历史快照和试算候选统一保存为 `.smp` 多实体容器，零件名称和 ID 随版本状态保存。已移除旧设计注册迁移，不读取旧 `.smb` 历史快照；旧源码需要重新构建，旧历史不会自动迁移。外部 SMB 仍是可导入/导出的单体交换格式。
