# 项目协作约定

- 用中文交流。保留已有工作，关键判断以实际代码和运行结果为依据。
- 本项目是完整的 DSH MiniCAD 插件，不以示例、模拟 agent 或固定模型模板代替实际功能。
- JavaScript 实现 DSH 插件和工作台，Python 实现建模内核服务。用户和 agent 操作同一份持久化设计状态。
- 复用 DSH UI 原语。浅色/暗色和中英双语均跟随 DSH 设置，不在工作台维护独立的主题或语言开关。
- 产品文案必须支持中文和英文。用户输入、项目名称和模型参数名称保持原文。
- Python 环境与依赖统一使用 uv 管理，维护 `python/pyproject.toml` 和 `python/uv.lock`，通过 `uv sync --project python --frozen` 同步。不要使用 `python -m venv` 或 pip 手工管理环境。uv 创建的 `.venv` 目录属于 uv 管理的环境。
- **不要为 UI 界面相关内容编写测试。只对建模内核相关部分编写测试。** UI 通过实际运行、操作与截图检查验证；不要新增 UI 单元测试、组件测试、快照测试或浏览器自动化测试用例。
- 内核测试重点覆盖真实几何、尺寸校验、失败保留上一版、版本冲突、持久化和模型导出回读。避免只镜像实现的测试。
- DSH 插件开发遵循用户指定的 `F:/Projects/dsh-plugin-stickers/.agents/skills/dsh-plugin-dev-notes/SKILL.md`；API 以当前安装的 DSH 源码为准。
- 完成后明确报告验证范围与未验证部分。不要将可打开的界面等同于建模和 agent 链路已完成。

## 提交规范

- 使用 Conventional Commits：`<type>(<scope>): <description>`，`scope` 可省略。常用类型：`feat`、`fix`、`docs`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`。
- 标题简洁准确地描述本次变更；需要时在正文解释原因、影响和验证结果。破坏性变更使用 `!`，并在正文末尾添加 `BREAKING CHANGE:` 说明迁移要求。
- 一次提交围绕一个完整目的，提交前检查暂存差异和文件清单。不要提交凭据、运行数据、依赖目录、构建产物或被忽略的本地调研资料。
- `docs/research/` 仅保存本地调研文档，由 Git 忽略；不要强制加入提交。
- 用户要求“提交”仅授权本地 commit；只有明确要求推送时才 push。
