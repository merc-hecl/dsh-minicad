# 发布 MiniCAD

用户安装说明见 [README](../README.md)。发布流程沿用 `dsh-plugin-emote-chat`：正式版本标签触发检查、生成说明、上传安装包和 npm 发布。

## 首次发布 0.1.0

1. 确认 GitHub 仓库已公开，npm 账号已验证邮箱并启用 2FA。本地完成安装包核验和用户验收后，将发布配置与文档提交、推送到 `main`。工作区应保持干净，后续标签指向同一提交。
2. 在仓库根目录检查、打包并手动创建第一个 npm 版本：

   ```powershell
   npm ci
   npm run check
   npm test
   New-Item -ItemType Directory -Force dist | Out-Null
   npm pack --pack-destination dist
   npm login --registry=https://registry.npmjs.org/
   npm publish .\dist\dsh-minicad-0.1.0.tgz --access public --registry=https://registry.npmjs.org/
   npm view dsh-minicad@0.1.0 version --registry=https://registry.npmjs.org/
   ```

3. 创建并推送首个标签：

   ```powershell
   git tag v0.1.0
   git push origin v0.1.0
   ```

   工作流检查通过后，发现 npm 已存在 `0.1.0`，会下载该版本的原始 `.tgz` 创建 GitHub Release，跳过重复 npm 发布。这样两个渠道分发的是同一安装包。

## 配置 npm 自动发布

在下一版本准备就绪时，于 npm 包页面 **Settings → Trusted publishing** 添加 GitHub Actions：

| 字段 | 值 |
| --- | --- |
| Organization or user | `merc-hecl` |
| Repository | `dsh-minicad` |
| Workflow filename | `publish.yml`，只填文件名 |
| Environment name | 留空 |
| Allowed actions | 允许直接 `npm publish` |

不需要配置 `NPM_TOKEN`。新配置必须在两天内完成首次成功发布，过期后需重新配置。首个 `0.1.0` 已手动发布，推送它的标签只会生成 GitHub Release，不会验证 OIDC；应在配置后两天内完成下一新版本的 npm 自动发布。

## 后续版本

先将本次改动提交，确保工作区干净；修复版本使用 `patch`，功能版本使用 `minor`：

```powershell
npm version patch
git push origin main
git push origin v0.1.1
```

最后一条命令的标签要替换为本次版本。`npm version` 会更新包与锁文件，创建版本提交和 `v版本号` 标签。

工作流必须已存在于标签所指向的提交。只推送 `main` 或在网页手动创建 Release 不会触发发布；只接受与 `package.json` 一致的 `v数字.数字.数字` 正式版本，预发布标签会被拒绝。

在 GitHub Actions 查看 **Publish plugin**：

1. 核对标签与包版本，使用 Node.js 24 和支持 OIDC 的 npm。
2. `npm ci`、`npm run check`、独立执行 `npm test`。`check` 本身不含内核测试。
3. 新版本本地打包；已发布的同版本复用 npm 原始安装包。
4. 生成发布说明，创建或更新 GitHub Release 并上传 `.tgz`。
5. 新版本通过 Trusted Publishing 发布同一份 `.tgz` 到 npm。

GitHub 自动生成的源码 ZIP 不包含预构建客户端和运行依赖，不能代替 `.tgz` 安装包。首次公开发布时同步更新两份 README 和使用指南中的“尚未发布”状态及安装入口。

## 发布说明

说明按 Conventional Commits 分类，使用英文分类标题，保留原提交消息、scope 和提交或 PR 链接；贡献者来自本地提交作者及 `Co-authored-by`，去重并排除机器人。

首次发布读取完整历史，后续只读取当前标签可达的上一正式版本以来的提交。脚本需要完整 Git 历史，不查询远端作者信息。

本地预览（标签须已存在）：

```powershell
node scripts/release-notes.mjs v0.1.0 .local/release-notes-v0.1.0.md
```

该命令只生成 Markdown，不创建版本、提交、标签或执行发布。

## 验证与失败恢复

- GitHub：Actions 成功，Release 存在 `dsh-minicad-版本号.tgz` 附件。
- npm：`npm view dsh-minicad@版本号 version --registry=https://registry.npmjs.org/` 返回对应版本。
- GitHub 附件先于 npm 发布；npm 授权失败时附件仍可下载。修正授权后重跑失败工作流。
- 若 npm 已发布同版本，重跑会复用 npm 安装包并跳过发布；已发布内容不可覆盖，修正源码应发新版本，不移动已有发布标签。
- 此工作流使用 GitHub 托管 runner；Trusted Publisher 的仓库与工作流文件名必须精确匹配。
- 工作流的本地检查不能证明 GitHub 权限、npm 授权或真实安装交互已通过；首次远端执行及用户验收仍需完成。

参考：[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)、[npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)。
