import fs from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
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
/** Bound the temporary buffer even for large imported STEP/SMB resources. */
export function hashFile(file) {
  const hash = createHash("sha256");
  let descriptor;
  try {
    descriptor = fs.openSync(file, "r");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let length;
    while ((length = fs.readSync(descriptor, buffer, 0, buffer.length, null)))
      hash.update(buffer.subarray(0, length));
    return hash.digest("hex");
  } finally {
    fs.closeSync(descriptor);
  }
}
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
    // Windows readers/scanners can briefly deny replacing a process manifest.
    // Retry only replacement errors; never replay modeling work.
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(temporary, file); break; }
      catch (error) {
        if (process.platform !== "win32" || attempt >= 3 || !fs.existsSync(file) ||
          !["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * 2 ** attempt);
      }
    }
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
