import fs from "node:fs";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";
import {
  atomicWrite,
  fileBytes,
  hashFile,
  inside,
  jsonBytes,
  readJson,
} from "./files.js";
import { drawingPdf, drawingSvg } from "./drawing.js";
import { encodePreview, previewInfo } from "../shared/preview.js";
const kernel = () => import("./model.js");
const now = () => Date.now() / 1000;
const id = () => randomUUID().replaceAll("-", "");
const portable = (path) => path.split(sep).join("/");
const stem = (name) => name.slice(0, -extname(name).length);
const cleanName = (name) =>
  String(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[ .]+$/g, "")
    .trim()
    .slice(0, 100) || "design";
const equalBytes = (a, b) =>
  a === null ? b === null : b !== null && a.equals(b);
const summaryOf = ({ mesh, edges, drawing, views, ...state }) => state;
const stateStamp = (file) => {
  const info = fs.statSync(file, { bigint: true });
  return `${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
};
export class KernelRequired extends Error {
  constructor() {
    super("此操作需要独立建模进程 / isolated kernel process required");
    this.code = "KERNEL_REQUIRED";
  }
}
export class Conflict extends Error {
  constructor(message = "设计已更新，请重新读取当前版本后再修改") {
    super(message);
    this.status = 409;
  }
}
function modelPath(root, name) {
  if (
    typeof name !== "string" ||
    isAbsolute(name) ||
    !name.endsWith(".js") ||
    name.split(/[/\\]/).some((part) => part.startsWith("."))
  )
    throw new Error("建模文件必须是工作目录内的 JavaScript 文件");
  return inside(root, name);
}
function paths(root, name) {
  const source = modelPath(root, name),
    base = stem(source);
  return [source, `${base}.parameters.json`, `${base}.smb`];
}
function availableDirectory(root, title) {
  let name = cleanName(title).slice(0, 80);
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))
    name = `_${name}`;
  let target = inside(root, name),
    number = 2;
  while (fs.existsSync(target)) target = inside(root, `${name}-${number++}`);
  return target;
}
function entries(root) {
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      if (entry.isSymbolicLink()) throw new Error("任务目录无法安全迁移");
      return { path, directory: entry.isDirectory() };
    });
}
export class Store {
  constructor(root, { write = atomicWrite, allowKernel = true } = {}) {
    this.root = resolve(root);
    this.write = write;
    this.kernel = () => {
      if (!allowKernel) throw new KernelRequired();
      return kernel();
    };
    fs.mkdirSync(this.root, { recursive: true });
    this.registry = join(this.root, "libraries.json");
    this.journal = join(this.root, "pending-files.json");
    this.recover();
    if (!fs.existsSync(this.registry)) {
      this.write(this.registry, jsonBytes({ version: 1, paths: [] }));
      const folder = join(this.root, "default");
      fs.mkdirSync(folder, { recursive: true });
      this.openLibrary(folder, "");
    }
  }
  recover() {
    if (!fs.existsSync(this.journal)) return;
    const pending = readJson(this.journal);
    if (pending.phase !== "committed")
      for (const item of pending.files.reverse())
        atomicWrite(
          item.path,
          item.before === null ? null : Buffer.from(item.before, "base64"),
        );
    fs.unlinkSync(this.journal);
  }
  commit(changes) {
    this.recover();
    const pending = {
      phase: "prepared",
      files: [...changes].map(([path]) => ({
        path,
        before: fileBytes(path)?.toString("base64") ?? null,
      })),
    };
    this.write(this.journal, jsonBytes(pending));
    try {
      for (const [path, bytes] of changes) this.write(path, bytes);
      pending.phase = "committed";
      this.write(this.journal, jsonBytes(pending));
    } catch (error) {
      this.recover();
      throw error;
    }
    fs.unlinkSync(this.journal);
  }
  registered() {
    this.recover();
    return readJson(this.registry).paths.map((p) => resolve(p));
  }
  readWorkspace(root) {
    const data = readJson(join(root, "minicad.json"));
    if (
      data.version !== 2 ||
      !data.projects ||
      typeof data.projects !== "object"
    )
      throw new Error("设计库元数据无效");
    return data;
  }
  workspaces() {
    return this.registered()
      .filter((p) => fs.existsSync(p))
      .map((p) => [p, this.readWorkspace(p)]);
  }
  findLibrary(key) {
    const found = this.workspaces().find(([, data]) => data.id === key);
    if (!found) throw new Error("设计库不存在");
    return found;
  }
  libraryInfo(root, data) {
    return {
      id: data.id,
      title: data.title,
      path: root,
      created: data.created,
      updated: data.updated,
    };
  }
  locate(key) {
    for (const [root, data] of this.workspaces())
      if (Object.hasOwn(data.projects, key))
        return [root, data, data.projects[key]];
    throw new Error("设计任务不存在");
  }
  taskRoot(root, task) {
    return inside(root, task.directory);
  }
  row(root, data, task) {
    const model = task.models[task.sourceFile] || {};
    return {
      id: task.id,
      title: task.title,
      library_id: data.id,
      session_id: task.session_id,
      head: model.head || 0,
      created: task.created,
      updated: Math.max(task.updated, model.updated || 0),
      directory: this.taskRoot(root, task),
      sourceFile: task.sourceFile,
      has_messages: Boolean(task.started),
    };
  }
  saveWorkspace(root, data) {
    data.updated = now();
    this.write(join(root, "minicad.json"), jsonBytes(data));
  }
  openLibrary(path, title) {
    if (!isAbsolute(path)) throw new Error("请选择设计库文件夹");
    let root;
    try {
      root = fs.realpathSync(path);
      if (!fs.statSync(root).isDirectory()) throw new Error();
    } catch {
      throw new Error("设计库文件夹不存在或无法访问");
    }
    const known = this.registered();
    if (known.includes(root))
      return this.libraryInfo(root, this.readWorkspace(root));
    const time = now(),
      data = fs.existsSync(join(root, "minicad.json"))
        ? this.readWorkspace(root)
        : {
            version: 2,
            id: id(),
            title: title ?? basename(root),
            created: time,
            updated: time,
            projects: {},
          };
    if (this.workspaces().some(([, other]) => other.id === data.id)) {
      data.id = id();
      data.projects = Object.fromEntries(
        Object.values(data.projects).map((task) => {
          const key = id();
          return [key, { ...task, id: key, session_id: null }];
        }),
      );
    }
    this.commit(
      new Map([
        [join(root, "minicad.json"), jsonBytes(data)],
        [this.registry, jsonBytes({ version: 1, paths: [...known, root] })],
      ]),
    );
    return this.libraryInfo(root, data);
  }
  cacheSummary(folder, state, stamp) {
    try {
      stamp ??= stateStamp(join(folder, "state.json"));
      this.write(
        join(folder, "summary.json"),
        jsonBytes({ stamp, state: summaryOf(state) }),
      );
    } catch {
      // This is a disposable read cache. Failure must not turn a committed build
      // into an apparent failure, or prevent opening an otherwise readable design.
    }
  }
  snapshot(key, revision, sourceFile, geometry = true) {
    const [root, , task] = this.locate(key),
      model = task.models[sourceFile || task.sourceFile] || {},
      number = revision === undefined ? model.head || 0 : Number(revision);
    if (!number) return null;
    const entry = (model.revisions || []).find(
      (item) => item.revision === number,
    );
    if (!entry) throw new Error("版本不存在");
    const folder = inside(this.taskRoot(root, task), entry.folder);
    const file = join(folder, "state.json"),
      stamp = stateStamp(file);
    if (!geometry) {
      try {
        const cached = readJson(join(folder, "summary.json"));
        if (
          cached.stamp === stamp &&
          cached.state &&
          typeof cached.state === "object" &&
          !Array.isArray(cached.state) &&
          cached.state.revision === number &&
          !["mesh", "edges", "drawing", "views"].some((key) =>
            Object.hasOwn(cached.state, key),
          )
        )
          return { folder, state: cached.state };
      } catch {
        // Older revisions and missing/corrupt caches are read from their source.
      }
    }
    const state = readJson(file);
    if (stateStamp(file) === stamp) this.cacheSummary(folder, state, stamp);
    return { folder, state: geometry ? state : summaryOf(state) };
  }
  project(key, geometry = true, sourceFile, savedSnapshot) {
    const [root, data, storedTask] = this.locate(key),
      task =
        sourceFile === undefined
          ? storedTask
          : {
              ...storedTask,
              sourceFile: portable(
                relative(
                  this.taskRoot(root, storedTask),
                  modelPath(this.taskRoot(root, storedTask), sourceFile),
                ),
              ),
            },
      result = this.row(root, data, task),
      directory = result.directory,
      saved =
        savedSnapshot === undefined
          ? this.snapshot(key, undefined, task.sourceFile, false)
          : savedSnapshot,
      state = saved?.state || null;
    const [source, parameter] = paths(directory, task.sourceFile),
      sourceData = fileBytes(source),
      parameterData = fileBytes(parameter);
    result.workspaceDirectory = directory;
    result.selectedSourceFile = storedTask.sourceFile;
    result.modelSelection = task.model_selection || "";
    result.models = Object.entries(task.models).map(([sourceFile, model]) => ({
      sourceFile,
      head: model.head,
    }));
    result.source = sourceData?.toString("utf8") ?? state?.source ?? "";
    try {
      result.parameters = parameterData
        ? JSON.parse(parameterData)
        : state?.parameters || {};
      if (
        !result.parameters ||
        Array.isArray(result.parameters) ||
        typeof result.parameters !== "object"
      )
        throw new Error();
    } catch {
      result.parameters = null;
      result.workingError = "parameters 必须是 JSON 对象";
    }
    result.sourceVersion = createHash("sha256")
      .update(sourceData || "")
      .update("\0")
      .update(parameterData || "")
      .digest("hex");
    result.workingTreeChanged = Boolean(
      state &&
      (!sourceData ||
        !parameterData ||
        result.source !== state.source ||
        JSON.stringify(result.parameters) !== JSON.stringify(state.parameters)),
    );
    for (const name of state?.assets || []) {
      const digest = hashFile(inside(directory, name));
      result.sourceVersion += digest ?? createHash("sha256").digest("hex");
      if (digest !== hashFile(inside(saved.folder, name)))
        result.workingTreeChanged = true;
    }
    if (state) {
      state.source = result.source;
      if (result.parameters !== null) state.parameters = result.parameters;
    }
    result.design = state;
    result.revisions = [
      ...(task.models[task.sourceFile]?.revisions || []),
    ].sort((a, b) => b.revision - a.revision);
    result.attachments = (task.attachments || []).map(
      ({ path, ...entry }) => entry,
    );
    result.messages = task.messages || [];
    return result;
  }
  expect(head, args) {
    if (args.expectedRevision !== head) throw new Conflict();
  }
  async shape(saved) {
    return (await this.kernel()).readShape(
      fs.readFileSync(join(saved.folder, "model.smb")),
      "model.smb",
    );
  }
  prepareInputs(directory, sourceFile) {
    return new Map(
      paths(directory, sourceFile).map((path) => [path, fileBytes(path)]),
    );
  }
  record(
    key,
    sourceFile,
    state,
    binary,
    summary,
    expected,
    inputs,
    assets = new Map(),
    selectModel = true,
  ) {
    const [root, data, task] = this.locate(key),
      directory = this.taskRoot(root, task);
    const model = task.models[sourceFile] || { head: 0, revisions: [] };
    this.expect(model.head, { expectedRevision: expected });
    if (inputs)
      for (const [path, bytes] of inputs)
        if (!equalBytes(fileBytes(path), bytes)) throw new Conflict();
    const revision = expected + 1,
      time = now(),
      history = inside(directory, `.cad-history/${portable(stem(sourceFile))}`);
    let folder = join(history, `v${String(revision).padStart(4, "0")}`),
      suffix = 2;
    while (fs.existsSync(folder))
      folder = join(
        history,
        `v${String(revision).padStart(4, "0")}-${suffix++}`,
      );
    model.head = revision;
    model.updated = time;
    model.revisions.push({
      revision,
      parent: expected || null,
      folder: portable(relative(directory, folder)),
      summary: String(summary || "更新设计").slice(0, 200),
      created: time,
    });
    task.models[sourceFile] = model;
    if (selectModel) task.sourceFile = sourceFile;
    task.started = true;
    task.updated = data.updated = time;
    state.revision = revision;
    state.parent = expected || null;
    state.sourceFile = sourceFile;
    const preview = encodePreview(state.preview);
    state.preview = {
      ...previewInfo(preview),
      digest: createHash("sha256").update(preview).digest("hex"),
    };
    const [source, parameters, solid] = paths(directory, sourceFile),
      changes = new Map([
        [join(folder, "preview.bin"), preview],
        [join(folder, "model.js"), Buffer.from(state.source)],
        [join(folder, "parameters.json"), jsonBytes(state.parameters)],
        [join(folder, "model.smb"), binary],
        [join(folder, "state.json"), jsonBytes(state)],
        [source, Buffer.from(state.source)],
        [parameters, jsonBytes(state.parameters)],
        [solid, binary],
      ]);
    for (const name of state.assets || []) {
      const target = inside(directory, name),
        bytes = assets.get(name) || fs.readFileSync(target);
      changes.set(target, bytes);
      changes.set(inside(folder, name), bytes);
    }
    changes.set(join(root, "minicad.json"), jsonBytes(data));
    this.commit(changes);
    this.cacheSummary(folder, state);
  }
  async build(key, args, edit = false) {
    const [root, , task] = this.locate(key),
      directory = this.taskRoot(root, task),
      sourceFile = portable(
        relative(
          directory,
          modelPath(directory, args.sourceFile || task.sourceFile),
        ),
      );
    const head = task.models[sourceFile]?.head || 0;
    this.expect(head, args);
    const inputs = this.prepareInputs(directory, sourceFile),
      [sourcePath, parameterPath] = paths(directory, sourceFile),
      api = await this.kernel();
    let source = args.source ?? inputs.get(sourcePath)?.toString("utf8") ?? "",
      parameters;
    if (
      args.parameterMode !== undefined &&
      !["merge", "replace"].includes(args.parameterMode)
    )
      throw new Error("不支持的参数更新模式 / unsupported parameter mode");
    try {
      const previous =
        args.parameterMode === "replace" ||
        (args.parameterMode !== "merge" && args.parameters !== undefined)
          ? {}
          : JSON.parse(inputs.get(parameterPath) || "{}");
      if (!previous || typeof previous !== "object" || Array.isArray(previous))
        throw new Error("parameters 必须是 JSON 对象");
      if (
        args.parameters !== undefined &&
        (!args.parameters ||
          typeof args.parameters !== "object" ||
          Array.isArray(args.parameters))
      )
        throw new Error("parameters 必须是 JSON 对象");
      parameters =
        args.parameterMode === "merge"
          ? { ...previous, ...args.parameters }
          : (args.parameters ?? previous);
    } catch {
      throw new Error("parameters 必须是 JSON 对象");
    }
    if (
      !parameters ||
      typeof parameters !== "object" ||
      Array.isArray(parameters)
    )
      throw new Error("parameters 必须是 JSON 对象");
    jsonBytes(parameters);
    const saved = this.snapshot(key, undefined, sourceFile, false),
      assets = new Map();
    let shape,
      target = sourceFile,
      operations;
    if (edit) {
      if (saved && this.project(key, false, sourceFile).workingTreeChanged)
        throw new Conflict("源码或参数已修改，请先构建工作文件再进行局部编辑");
      shape = saved ? await this.shape(saved) : null;
      if (saved)
        for (const name of saved.state.assets || [])
          assets.set(name, fs.readFileSync(inside(directory, name)));
      operations = api.normalizeOperations(
        args.operations,
        shape,
        head,
        api.modelScope(key, sourceFile),
      );
      source = api.editSource(source, operations, head);
    } else {
      if (!source.trim() || source.length > 2 * 1024 * 1024)
        throw new Error(
          "需要定义 build(parameters, cad) 函数的 JavaScript 建模源码",
        );
      if (saved?.state.assets)
        for (const name of saved.state.assets)
          assets.set(name, fs.readFileSync(inside(directory, name)));
    }
    const resources = Object.fromEntries(assets);
    for (const [name, bytes] of assets)
      inputs.set(inside(directory, name), bytes);
    shape = await api.buildShape(
      source,
      parameters,
      inside(directory, target),
      resources,
      (name, bytes) => {
        const path = inside(directory, name);
        if (paths(directory, target).includes(path))
          throw new Error("模型资源不能引用当前建模输出文件");
        if (!inputs.has(path)) inputs.set(path, bytes);
      },
      directory,
    );
    for (const [name, bytes] of Object.entries(resources))
      assets.set(name, bytes);
    const state = {
      ...api.describeShape(shape),
      source,
      parameters,
      operations: operations || [],
      assets: [...assets.keys()],
    };
    this.record(
      key,
      target,
      state,
      api.saveShape(shape),
      args.summary,
      head,
      inputs,
      assets,
      !args.preserveSelection,
    );
    return this.project(key, args.geometry !== false, sourceFile);
  }
  async export(key, args) {
    const saved = this.snapshot(key, args.revision, args.sourceFile, false);
    if (!saved) throw new Error("请先完成建模");
    const api = await this.kernel(),
      shape = await this.shape(saved),
      state = saved.state,
      [root, , task] = this.locate(key),
      name = `${cleanName(task.title)}-v${Number(args.revision)}`;
    let bytes,
      mediaType = "application/octet-stream";
    let views;
    if (["svg", "pdf"].includes(args.format)) {
      const cache = join(saved.folder, "views.json");
      try {
        const data = readJson(cache);
        if (data.version === api.projectionVersion && Array.isArray(data.views))
          views = data.views;
      } catch {
        /* Rebuild a missing or invalid projection cache. */
      }
      if (!views) {
        views = api.projectShape(shape);
        try {
          this.write(
            cache,
            jsonBytes({ version: api.projectionVersion, views }),
          );
        } catch {
          /* Exports do not require a writable projection cache. */
        }
      }
    }
    switch (args.format) {
      case "step":
      case "stl":
      case "smb":
        bytes = api.exportShape(shape, args.format);
        break;
      case "svg":
        bytes = Buffer.from(
          drawingSvg(views, state.metrics, task.title, args.locale),
        );
        mediaType = "image/svg+xml";
        break;
      case "pdf":
        bytes = drawingPdf(
          views,
          state.metrics,
          task.title,
          args.revision,
          args.locale,
        );
        mediaType = "application/pdf";
        break;
      case "zip": {
        const sourceFile = state.sourceFile || task.sourceFile;
        const archive = {
          [sourceFile]: strToU8(state.source),
          [`${stem(sourceFile)}.parameters.json`]: jsonBytes(state.parameters),
          [`${stem(sourceFile)}.smb`]: fs.readFileSync(
            join(saved.folder, "model.smb"),
          ),
          "project.json": jsonBytes({
            title: task.title,
            revision: Number(args.revision),
            unit: "mm",
            kernel: state.kernel,
          }),
        };
        for (const asset of state.assets || [])
          archive[asset] = fs.readFileSync(inside(saved.folder, asset));
        bytes = Buffer.from(zipSync(archive));
        mediaType = "application/zip";
        break;
      }
      default:
        throw new Error("不支持的导出格式");
    }
    const path = inside(
      this.taskRoot(root, task),
      `exports/${portable(stem(state.sourceFile || task.sourceFile))}/${name}.${args.format}`,
    );
    this.write(path, bytes);
    return {
      name: `${name}.${args.format}`,
      path,
      mediaType,
      data: bytes.toString("base64"),
      revision: Number(args.revision),
      sourceFile: state.sourceFile || task.sourceFile,
    };
  }
  async dispatch(method, args = {}) {
    if (method === "api") {
      if (
        ![
          "parts",
          "shapes",
          "curves",
          "sketches",
          "operations",
          "surfaces",
          "sheetmetal",
          "geometry",
          "exporters",
        ].includes(args.topic)
      )
        throw new Error("不支持的 API 分类");
      const root = fileURLToPath(
        new URL(
          "./dist/",
          import.meta.resolve("@classcad/smlibwasm/package.json"),
        ),
      );
      const text = fs.readFileSync(join(root, `${args.topic}.d.ts`), "utf8");
      const index = args.symbol ? text.indexOf(args.symbol) : 0;
      if (index < 0) throw new Error("API 符号不存在");
      const start = Math.max(0, index - 600),
        end = Math.min(text.length, start + 18000);
      return {
        kernel: "@classcad/smlibwasm 0.6.2",
        declarations: text.slice(start, end),
        truncated: end < text.length,
      };
    }
    if (method === "health")
      return {
        ready: true,
        kernel: (await this.kernel()).kernelName,
        node: process.versions.node,
      };
    if (method === "list")
      return this.workspaces()
        .flatMap(([root, data]) =>
          Object.values(data.projects).map((task) =>
            this.row(root, data, task),
          ),
        )
        .sort((a, b) => b.updated - a.updated);
    if (method === "libraries")
      return this.workspaces().map(([root, data]) =>
        this.libraryInfo(root, data),
      );
    if (method === "create_library") {
      if (typeof args.path !== "string" || !args.path.trim())
        throw new Error("请选择设计库文件夹");
      return this.openLibrary(args.path);
    }
    if (method === "rename_library") {
      const [root, data] = this.findLibrary(args.libraryId),
        title = String(args.title || "")
          .trim()
          .slice(0, 100);
      if (!title) throw new Error("请输入设计库名称");
      data.title = title;
      this.saveWorkspace(root, data);
      return this.libraryInfo(root, data);
    }
    if (method === "remove_library") {
      const [root] = this.findLibrary(args.libraryId);
      this.commit(
        new Map([
          [
            this.registry,
            jsonBytes({
              version: 1,
              paths: this.registered().filter((p) => p !== root),
            }),
          ],
        ]),
      );
      return { removed: true };
    }
    if (method === "create") {
      const libraries = await this.dispatch("libraries"),
        [root, data] = this.findLibrary(args.libraryId || libraries[0]?.id),
        key = id(),
        time = now();
      const title = String(args.title || "未命名设计")
          .trim()
          .slice(0, 100),
        directory = availableDirectory(root, title),
        sourceFile = portable(
          relative(
            directory,
            modelPath(directory, args.sourceFile || "model.js"),
          ),
        );
      fs.mkdirSync(directory);
      data.projects[key] = {
        id: key,
        title,
        directory: basename(directory),
        models: {},
        session_id: null,
        sourceFile,
        created: time,
        updated: time,
        started: false,
        attachments: [],
      };
      this.saveWorkspace(root, data);
      return this.project(key);
    }
    if (method === "by_session") {
      for (const [, data] of this.workspaces())
        for (const task of Object.values(data.projects))
          if (task.session_id === args.sessionId)
            return this.project(task.id, false);
      throw new Error("当前会话未绑定 MiniCAD 设计任务");
    }
    if (method === "discard_empty") {
      const found = (await this.dispatch("list")).find(
        (p) => p.id === args.projectId,
      );
      if (!found) return { discarded: false };
      const [root, data, task] = this.locate(found.id);
      if (
        task.started ||
        Object.keys(task.models).length ||
        task.attachments?.length ||
        task.messages?.length
      )
        return { discarded: false };
      const directory = this.taskRoot(root, task);
      try {
        fs.rmdirSync(directory);
      } catch (error) {
        if (error.code !== "ENOENT") return { discarded: false };
      }
      delete data.projects[task.id];
      try {
        this.saveWorkspace(root, data);
      } catch (error) {
        fs.mkdirSync(directory, { recursive: true });
        throw error;
      }
      return { discarded: true };
    }
    const key = String(args.projectId),
      [root, data, task] = this.locate(key),
      directory = this.taskRoot(root, task),
      sourceFile =
        args.sourceFile === undefined
          ? task.sourceFile
          : portable(
              relative(directory, modelPath(directory, args.sourceFile)),
            ),
      row = this.row(root, data, { ...task, sourceFile });
    if (method === "get") return this.project(key, false, sourceFile);
    if (method === "preview_file") {
      const saved = this.snapshot(key, args.revision, sourceFile, false);
      if (!saved) throw new Error("请先完成建模 / build a model first");
      const path = join(saved.folder, "preview.bin");
      let valid = false;
      try {
        valid =
          saved.state.previewVersion === 2 &&
          fs.statSync(path).size === saved.state.preview?.byteLength &&
          hashFile(path) === saved.state.preview.digest;
      } catch {
        /* Generate the preview from the revision's exact solid. */
      }
      if (!valid) {
        const api = await this.kernel();
        const bytes = encodePreview(api.previewShape(await this.shape(saved)));
        const state = {
          ...summaryOf(saved.state),
          previewVersion: 2,
          preview: {
            ...previewInfo(bytes),
            digest: createHash("sha256").update(bytes).digest("hex"),
          },
        };
        this.commit(
          new Map([
            [path, bytes],
            [join(saved.folder, "state.json"), jsonBytes(state)],
          ]),
        );
        this.cacheSummary(saved.folder, state);
      }
      return {
        path,
        byteLength: fs.statSync(path).size,
        sourceFile,
        revision: args.revision ?? row.head,
      };
    }
    if (method === "select_model") {
      task.sourceFile = portable(
        relative(directory, modelPath(directory, args.sourceFile)),
      );
      this.saveWorkspace(root, data);
      return this.project(key, args.geometry !== false);
    }
    if (method === "build" || method === "edit")
      return this.build(key, args, method === "edit");
    if (method === "update_parameters")
      return this.build(key, { ...args, parameterMode: args.mode ?? "merge" });
    if (["query", "measure", "check"].includes(method)) {
      this.expect(row.head, args);
      const saved = this.snapshot(key, undefined, sourceFile, false);
      if (!saved) {
        if (method === "query") return { sourceFile, revision: 0, items: [] };
        throw new Error("请先完成建模 / build a model first");
      }
      const api = await this.kernel(),
        shape = await this.shape(saved),
        scope = api.modelScope(key, sourceFile);
      const result = { sourceFile, revision: row.head };
      if (method === "measure")
        return {
          ...result,
          items: api.measureShape(
            shape,
            api.values(args.measurements, saved.state.parameters),
            scope,
            row.head,
          ),
        };
      if (method === "check")
        return {
          ...result,
          ...api.checkShape(
            shape,
            api.values(args.checks, saved.state.parameters),
            scope,
            row.head,
          ),
        };
      return {
        ...result,
        kind: args.kind || "faces",
        items: api.queryShape(
          shape,
          row.head,
          args.kind,
          api.values(args.selector, saved.state.parameters),
          scope,
        ),
      };
    }
    if (method === "restore") {
      this.expect(row.head, args);
      const saved = this.snapshot(key, args.revision, sourceFile, false);
      if (!saved) throw new Error("版本不存在");
      const inputs = this.prepareInputs(directory, sourceFile),
        shape = await this.shape(saved),
        api = await this.kernel(),
        assets = new Map(
          (saved.state.assets || []).map((name) => [
            name,
            fs.readFileSync(inside(saved.folder, name)),
          ]),
        );
      const state = {
        ...api.describeShape(shape),
        source: saved.state.source,
        parameters: saved.state.parameters,
        assets: [...assets.keys()],
        restoredFrom: Number(args.revision),
      };
      this.record(
        key,
        sourceFile,
        state,
        api.saveShape(shape),
        args.summary || `Restore v${args.revision}`,
        row.head,
        inputs,
        assets,
        !args.preserveSelection,
      );
      return this.project(key, args.geometry !== false, sourceFile);
    }
    if (method === "export") return this.export(key, { ...args, sourceFile });
    if (method === "fork_project" || method === "move_project") {
      if (
        method === "fork_project" &&
        (await this.dispatch("list")).some(
          (p) => p.session_id === args.sessionId,
        )
      )
        throw new Conflict("任务已绑定另一个会话");
      const [destination, other] =
        method === "fork_project"
          ? [root, data]
          : this.findLibrary(args.libraryId);
      if (method === "move_project" && destination === root)
        return this.project(key, false);
      if (method === "move_project" && other.projects[key])
        throw new Error("目标任务已存在");
      const target = availableDirectory(
        destination,
        method === "fork_project"
          ? args.title || task.title
          : basename(directory),
      );
      if (
        !relative(directory, target).startsWith("..") ||
        !relative(target, directory).startsWith("..")
      )
        throw new Error("任务目录无法安全迁移");
      const all = entries(directory),
        changes = new Map();
      fs.mkdirSync(target);
      for (const entry of all) {
        const path = join(target, relative(directory, entry.path));
        if (entry.directory) fs.mkdirSync(path, { recursive: true });
        else changes.set(path, fs.readFileSync(entry.path));
      }
      const branch = structuredClone(task),
        branchKey = method === "fork_project" ? id() : key;
      branch.id = branchKey;
      branch.directory = basename(target);
      branch.updated = now();
      if (method === "fork_project") {
        branch.session_id = String(args.sessionId);
        branch.created = now();
        branch.title = String(args.title || task.title).slice(0, 100);
      } else {
        delete data.projects[key];
        for (const entry of all.filter((e) => !e.directory))
          changes.set(entry.path, null);
      }
      other.projects[branchKey] = branch;
      data.updated = other.updated = now();
      changes.set(join(root, "minicad.json"), jsonBytes(data));
      changes.set(join(destination, "minicad.json"), jsonBytes(other));
      this.commit(changes);
      if (method === "move_project")
        for (const path of [
          ...all
            .filter((e) => e.directory)
            .map((e) => e.path)
            .sort((a, b) => b.length - a.length),
          directory,
        ])
          try {
            fs.rmdirSync(path);
          } catch {
            /* Keep files added by external editors. */
          }
      return this.project(branchKey);
    }
    if (method === "attach") {
      const content = Buffer.from(args.data, "base64");
      if (
        content.length > 20 * 1024 * 1024 ||
        !content.subarray(0, 5).equals(Buffer.from("%PDF-"))
      )
        throw new Error("请选择不超过 20 MB 的 PDF 文件");
      const name = cleanName(String(args.name).split(/[/\\]/).at(-1)),
        original = inside(directory, `references/${name}`);
      let target = original,
        number = 2;
      while (fs.existsSync(target) && !fs.readFileSync(target).equals(content))
        target = `${stem(original)}_${number++}${extname(original)}`;
      task.attachments ||= [];
      task.attachments.push({
        id: id(),
        name,
        bytes: content.length,
        path: portable(relative(directory, target)),
      });
      task.updated = data.updated = now();
      this.commit(
        new Map([
          [target, content],
          [join(root, "minicad.json"), jsonBytes(data)],
        ]),
      );
      return this.project(key, false);
    }
    if (method === "reference_file") {
      const entry = task.attachments?.find(
        (item) => item.id === args.attachmentId,
      );
      if (!entry) throw new Error("参考文件不存在");
      return {
        name: entry.name,
        mediaType: "application/pdf",
        data: fs.readFileSync(inside(directory, entry.path)).toString("base64"),
      };
    }
    if (method === "rename") {
      const title = String(args.title || "")
        .trim()
        .slice(0, 100);
      if (!title) throw new Error("请输入设计名称");
      task.title = title;
    } else if (method === "bind") {
      if (
        (task.session_id && task.session_id !== args.sessionId) ||
        (await this.dispatch("list")).some(
          (p) => p.id !== key && p.session_id === args.sessionId,
        )
      )
        throw new Conflict("任务已绑定另一个会话");
      task.session_id = args.sessionId;
    } else if (method === "model_selection")
      task.model_selection = args.selection;
    else if (method === "message") task.started ||= args.role === "user";
    else throw new Error("不支持的操作");
    task.updated = now();
    this.saveWorkspace(root, data);
    return ["message", "model_selection"].includes(method)
      ? { saved: true }
      : this.project(key, false);
  }
}
