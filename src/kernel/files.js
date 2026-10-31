import fs from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
export const jsonBytes = (value) =>
  Buffer.from(
    JSON.stringify(
      value,
      (_key, v) => {
        if (typeof v === "number" && !Number.isFinite(v))
          throw new Error("JSON 不能包含非有限数字");
        return v;
      },
      2,
    ) + "\n",
  );
export const fileBytes = (file) =>
  fs.existsSync(file) ? fs.readFileSync(file) : null;
export const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
export function atomicWrite(file, value) {
  if (value === null) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const descriptor = fs.openSync(temporary, "wx");
    try {
      fs.writeFileSync(descriptor, value);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
export function inside(root, name) {
  const base = resolve(root),
    target = resolve(base, name),
    rel = relative(base, target);
  const outside = (path) =>
    path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
  if (!rel || outside(rel)) throw new Error("项目文件路径超出工作目录");
  if (fs.existsSync(base)) {
    let parent = target;
    while (!fs.existsSync(parent)) parent = dirname(parent);
    if (outside(relative(fs.realpathSync(base), fs.realpathSync(parent))))
      throw new Error("项目文件路径超出工作目录");
  }
  return target;
}
