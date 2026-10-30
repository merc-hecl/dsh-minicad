// Read-only inspection of the installed Desktop's ASAR; never patches the host.
import { openSync, readSync, closeSync } from "node:fs";
const archive = process.env.DSH_ASAR || "E:/DSH/resources/app.asar";
const fd = openSync(archive, "r");
const prefix = Buffer.alloc(16);
readSync(fd, prefix, 0, 16, 0);
const header = Buffer.alloc(prefix.readUInt32LE(12));
readSync(fd, header, 0, header.length, 16);
const tree = JSON.parse(header);
const base = 8 + prefix.readUInt32LE(4);
let path = process.argv[2] || "dsh/node_modules/@deepseek-ai";
let entry = tree;
for (const segment of path.split("/")) entry = entry?.files?.[segment];
if (!entry) throw new Error(`Missing ${path}`);
if (entry.files) console.log(Object.keys(entry.files).join("\n"));
else {
  const bytes = Buffer.alloc(entry.size);
  readSync(fd, bytes, 0, bytes.length, base + Number(entry.offset));
  process.stdout.write(bytes);
}
closeSync(fd);
