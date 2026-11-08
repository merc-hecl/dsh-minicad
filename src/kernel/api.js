import { localizedError } from "../shared/errors.js";
import fs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const apiTopics = ["parts", "shapes", "curves", "sketches", "operations", "surfaces",
  "sheetmetal", "geometry", "exporters", "align", "locations", "profiles", "face_edit", "deformations", "minicad"];

// Locate declarations, not the first mention in an import or a comment.
export function readApi({ topic, symbol, offset = 0, limit = 6000 }) {
  if (!apiTopics.includes(topic)) throw localizedError("不支持的 API 分类", "unsupported API topic");
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 12000)
    throw localizedError("API 分页范围无效", "invalid API page range");
  const root = fileURLToPath(new URL("./dist/", import.meta.resolve("@classcad/smlibwasm/package.json")));
  const text = fs.readFileSync(topic === "minicad" ? new URL("./minicad.d.ts", import.meta.url) : join(root, `${topic}.d.ts`), "utf8");
  const declarations = [...text.matchAll(/^export (?:declare )?(?:abstract )?(?:class|interface|function|type|const|enum) (\w+)/gm)];
  let start = 0, end = text.length, header = "";
  if (symbol) {
    const [owner, member] = symbol.split(".");
    const found = declarations.findIndex(item => item[1] === owner);
    if (found < 0 && !member) {
      const escaped = owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = [...text.matchAll(new RegExp(`^    (?:static )?(?:get )?${escaped}(?=[(:<])`, "gm"))];
      const owners = [...new Set(matches.map(match => declarations.findLast(item => item.index < match.index)?.[1]).filter(Boolean))];
      if (owners.length === 1) return readApi({ topic, symbol: `${owners[0]}.${owner}`, offset, limit });
      if (owners.length > 1) throw localizedError("API 成员不唯一，请指定类名", "Qualify the API member", `: ${owners.map(name => `${name}.${owner}`).join(", ")}`);
    }
    if (found < 0) {
      const available = [...new Set(declarations.map(item => item[1]))].join(", ");
      throw localizedError(`API 符号不存在：${symbol}。可用符号：${available}`, `API symbol not found: ${symbol}. Available: ${available}`);
    }
    start = declarations[found].index;
    end = declarations.slice(found + 1).find(item => item[1] !== owner)?.index ?? text.length;
    if (member) {
      const escaped = member.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const block = text.slice(start, end), match = new RegExp(`^    (?:static )?(?:get )?${escaped}(?=[(:<])`, "m").exec(block);
      if (!match) throw localizedError("API 成员不存在", "API member not found", `: ${symbol}`);
      header = block.slice(0, block.indexOf("\n"));
      const memberStart = start + match.index;
      start = text.lastIndexOf("    /**", memberStart);
      if (start < declarations[found].index || text.slice(start, memberStart).includes(";")) start = memberStart;
      const nextMember = /^    (?:\/\*\*|(?:static )?(?:get )?[\w$]+[(:<])/m.exec(text.slice(memberStart + match[0].length, end));
      end = nextMember ? memberStart + match[0].length + nextMember.index : end;
    } else {
      const documentation = /\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*$/.exec(text.slice(0, start));
      if (documentation) start = documentation.index;
    }
  }
  const selected = text.slice(start, end), page = selected.slice(offset, offset + limit);
  return { kernel: "@classcad/smlibwasm 0.6.2", topic, symbol: symbol || null,
    ...(header ? { declaration: header } : {}),
    declarations: page, offset, totalCharacters: selected.length,
    line: text.slice(0, start + offset).split("\n").length,
    nextOffset: offset + page.length < selected.length ? offset + page.length : null,
    truncated: offset + page.length < selected.length,
    symbols: [...new Set(declarations.map(item => item[1]))],
    usage: "Use Class.member (e.g. Part.volume, Sketch.extrude, Face.axis) or a top-level declaration; follow nextOffset for the same topic and symbol.",
  };
}
