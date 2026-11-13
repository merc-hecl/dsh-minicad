# MiniCAD for DeepSeek Harness

[English](README.en.md) · [安装](#安装) · [使用指南](docs/guide.md) · [反馈](https://github.com/merc-hecl/dsh-minicad/issues)

**用自然语言做 CAD，在三维画布里核验结果。**

描述零件或提供参考图纸，让 DSH agent 建模、改尺寸、导出文件。你负责提出要求、查看模型和确认结果。

**AI 编写声明：** 本项目代码 100% 由 AI 编写。

![MiniCAD 实机工作台：孔板模型与画布对话输入框](docs/images/workbench.png)

## 能做什么

- **建模与修改** — 精确实体直接编辑、独立多零件模型、多规格生成、PDF 图纸参考；通过 agent 生成的动态参数面板直接调整模型。
- **测量与引用** — 按零件显隐，选中面或边测量并引用给 agent 修改；剖切查看内部，装配体可爆炸展开。
- **版本与回退** — 在树状版本库中切换版本，回看建模过程并对比几何变化；逐版回放设计延时摄影并导出 WebM/GIF。
- **继续设计** — 多个会话共享一个设计；另存为独立方案。
- **交付模型** — 整组或按零件导出 STEP、STL，导出项目 ZIP，或在 FreeCAD 中打开。

![版本对比实机画面：绿色为新增体积，红色为删除体积](docs/images/version-diff.png)

## 安装

适配 **DSH 0.2.2-rc.1**。使用 DSH 中已配置的模型，无需另配 API Key。

**桌面版**

1. 在 DSH 中打开「插件」→「添加插件」。
2. 输入 `dsh-minicad`，点击「安装」并启用。
3. 按提示重启，从侧栏打开 **MiniCAD**。

[最新发布：离线安装包与发布说明](https://github.com/merc-hecl/dsh-minicad/releases/latest)

**Web**（Node.js 22.19+、[pnpm](docs/guide.md#web-安装)）

从 npm 安装，完成后重启 DSH：

```sh
npx @deepseek-ai/dsh@0.2.2-rc.1 plugin --profile web add dsh-minicad -w
```

## 开始做一个零件

1. **选文件夹** — 在 MiniCAD 中打开或新建设计。
2. **说需求** — 描述尺寸和特征，或添加图纸。
3. **看结果** — 测量、引用修改、对比版本；满意后让 agent 导出。

> 做一个 80 × 50 × 6 mm 的底板，四角各加一个直径 5 mm 的通孔，孔中心距相邻边均为 8 mm。

支持单零件与多实体建模；暂不包含装配约束和 CAM。建模源码以当前用户权限执行，仅运行可信来源的设计代码。

[详细操作与排障](docs/guide.md) · [建模接口](docs/modeling-api.md) · [开发与打包](docs/guide.md#从源码运行)

[MIT](LICENSE) · [第三方声明](NOTICE.md)
