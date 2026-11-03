// Adapted from this author's dsh-plugin-emote-chat release workflow.
/**
 * [INPUT]: 完整 Git 历史、正式版本标签、包元数据与 changelogen
 * [OUTPUT]: 两个版本间按 Conventional Commits 分类的英文 Release Markdown 与贡献者列表
 * [POS]: 只生成发布说明；不修改版本、提交、标签或执行发布
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateMarkDown, getGitDiff, getRepoConfig, parseCommits } from "changelogen";

const stableTag = /^v\d+\.\d+\.\d+$/;
const types = Object.fromEntries(Object.entries({
  feat: "Enhancements",
  perf: "Performance",
  fix: "Fixes",
  refactor: "Refactors",
  docs: "Documentation",
  build: "Build",
  types: "Types",
  chore: "Chore",
  examples: "Examples",
  test: "Tests",
  style: "Styles",
  ci: "CI",
}).map(([type, title]) => [type, { title }]));

function contributors(raw) {
  const people = new Map();
  const authors = raw.flatMap((commit) => [
    commit.author,
    ...Array.from(commit.body.matchAll(/^Co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/gim),
      (match) => ({ name: match[1], email: match[2] })),
  ]);
  for (const author of authors) {
    const name = author?.name?.trim();
    if (!name || name.includes("[bot]")) continue;
    const email = author.email?.trim().toLowerCase() ?? "";
    const username = email.match(/(?:^|\+)([a-z\d-]+)@users\.noreply\.github\.com$/i)?.[1];
    const key = username ? `github:${username}` : email || name;
    const label = name.replace(/[\\`*_[\]<>]/g, "\\$&");
    people.set(key, username
      ? `- ${label} ([@${username}](https://github.com/${username}))`
      : `- ${label}`);
  }
  return [...people.values()];
}

export async function releaseNotes(tag, cwd = process.cwd()) {
  if (!stableTag.test(tag ?? "")) throw new Error("Expected a stable release tag, e.g. v0.1.0");
  const git = (...args) => execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (git("rev-parse", "--is-shallow-repository") === "true")
    throw new Error("Release notes require full Git history (fetch-depth: 0)");

  const pkg = JSON.parse(git("show", `${tag}:package.json`));
  if (tag !== `v${pkg.version}`) throw new Error("Release tag must match package.json version");
  // 只取当前标签的祖先版本；忽略预发布标签及同一提交上的更高版本。
  const tags = git("tag", "--merged", tag, "--sort=-version:refname", "--list", "v*")
    .split("\n").filter((entry) => stableTag.test(entry));
  const previous = tags[tags.indexOf(tag) + 1] ?? "";
  const config = {
    from: previous,
    to: tag,
    newVersion: pkg.version,
    types,
    scopeMap: {},
    repo: getRepoConfig(typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url),
    templates: { tagBody: "v{{newVersion}}" },
    noAuthors: true,
  };
  const raw = await getGitDiff(previous || undefined, tag, cwd);
  const parsed = parseCommits(raw, config);
  const commits = parsed
    .map((commit) => ({ ...commit, type: commit.type.toLowerCase(), author: undefined }))
    .filter((commit) => types[commit.type]);
  // 本地收集作者和 Co-authored-by，避免依赖 changelogen 的远端作者查询。
  const markdown = await generateMarkDown(commits, config);
  const body = markdown
    .replace(/^## [^\n]+\n*/, "")
    .replace(/^#### ⚠️ Breaking Changes$/m, "#### Breaking Changes")
    .trim();
  const people = contributors(raw);
  return [body, ...(people.length ? ["### Contributors", people.join("\n")] : [])]
    .filter(Boolean).join("\n\n") + "\n";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tag, output, ...extra] = process.argv.slice(2);
  if (!output || extra.length) throw new Error("Usage: node scripts/release-notes.mjs <tag> <output.md>");
  const markdown = await releaseNotes(tag);
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(output, markdown, "utf8");
}
