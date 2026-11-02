import { defaultIdFormats } from "../shared/geometry-ids.js";
import fs from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import {
  atomicWrite,
  fileBytes,
  hashFile,
  inside,
  jsonBytes,
  readJson,
} from "./files.js";
import { encodePreview, previewInfo } from "../shared/preview.js";
import { ProcessJournal } from "./process.js";
import { readApi } from "./api.js";
import { format } from "node:util";
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
function availableDirectory(root, title, current) {
  let name = cleanName(title).slice(0, 80);
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))
    name = `_${name}`;
  let target = inside(root, name),
    number = 2;
  const same = path => process.platform === "win32" ? path.toLowerCase() === current?.toLowerCase() : path === current;
  while (fs.existsSync(target) && !same(target)) target = inside(root, `${name}-${number++}`);
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
    this.registry = join(this.root, "designs.json");
    this.journal = join(this.root, "pending-files.json");
    this.recover();
    if (!fs.existsSync(this.registry)) this.migrateDesigns();
  }
  designFile(root) { return join(root, ".cad-design.json"); }
  workspaceBytes(data) { return jsonBytes(Object.values(data.projects)[0]); }
  migrateDesigns() {
    const legacy = join(this.root, "libraries.json"), paths = [], changes = new Map();
    if (fs.existsSync(legacy)) for (const root of readJson(legacy).paths.filter(path => fs.existsSync(path))) {
      const library = readJson(join(root, "minicad.json"));
      if (![2, 3].includes(library.version) || !library.projects) throw new Error("已有设计数据需要迁移为项目文件");
      for (const old of Object.values(library.projects)) {
        const directory = inside(root, old.directory);
        const task = { ...old, version: 1,
          sessions: old.sessions || (old.session_id ? [old.session_id] : []),
          activeSessionId: old.activeSessionId || old.session_id || null };
        delete task.directory; delete task.session_id;
        const file = this.designFile(directory);
        if (fs.existsSync(file)) {
          if (readJson(file).id !== task.id) throw new Error(`设计元数据冲突 / design metadata conflict: ${file}`);
        } else changes.set(file, jsonBytes(task));
        paths.push(directory);
      }
    }
    changes.set(this.registry, jsonBytes({ version: 1, paths: [...new Set(paths)] }));
    this.commit(changes);
  }

  recover() {
    if (!fs.existsSync(this.journal)) return;
    const pending = readJson(this.journal);
    if (pending.phase !== "committed") {
      for (const move of (pending.moves || []).toReversed())
        if (fs.existsSync(move.to) && (!fs.existsSync(move.from) ||
          (process.platform === "win32" && move.from !== move.to && move.from.toLowerCase() === move.to.toLowerCase())))
          fs.renameSync(move.to, move.from);
      for (const item of pending.files.reverse())
        atomicWrite(
          item.rollbackPath || item.path,
          item.before === null ? null : Buffer.from(item.before, "base64"),
        );
    }
    fs.unlinkSync(this.journal);
  }
  commit(changes, moves = []) {
    this.recover();
    const pending = {
      phase: "prepared",
      moves,
      files: [...changes].map(([path]) => {
        const move = moves.find(move => { const rel = relative(move.to, path); return rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); });
        const rollbackPath = move ? join(move.from, relative(move.to, path)) : path;
        return { path, rollbackPath, before: fileBytes(rollbackPath)?.toString("base64") ?? null };
      }),
    };
    this.write(this.journal, jsonBytes(pending));
    try {
      for (const move of moves) fs.renameSync(move.from, move.to);
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
    const task = readJson(this.designFile(root));
    if (task.version !== 1 || !task.id || !task.models || !Array.isArray(task.sessions))
      throw new Error("设计元数据无效 / invalid design metadata");
    return { id: task.id, updated: task.updated, projects: { [task.id]: task } };
  }
  workspaces() {
    return this.registered().filter(path => fs.existsSync(path)).map(root => [root, this.readWorkspace(root)]);
  }
  locate(key) {
    for (const [root, data] of this.workspaces())
      if (Object.hasOwn(data.projects, key)) return [root, data, data.projects[key]];
    throw new Error("设计任务不存在");
  }
  taskRoot(root) { return root; }
  row(root, data, task) {
    const model = task.models[task.sourceFile] || {};
    return { id: task.id, title: task.title, activeSessionId: task.activeSessionId, sessions: task.sessions,
      head: model.head || 0, created: task.created, updated: Math.max(task.updated, model.updated || 0),
      directory: root, sourceFile: task.sourceFile, has_messages: Boolean(task.started) };
  }
  saveWorkspace(root, data) { this.write(this.designFile(root), this.workspaceBytes(data)); }
  managedDirectory(title) {
    const parent = join(this.root, "designs");
    fs.mkdirSync(parent, { recursive: true });
    const target = availableDirectory(parent, title || "未命名设计");
    fs.mkdirSync(target);
    return target;
  }
  openDesign(path, title) {
    if (typeof path !== "string" || !isAbsolute(path)) throw new Error("请选择设计工作文件夹 / choose a design workspace folder");
    const root = fs.realpathSync(path);
    if (!fs.statSync(root).isDirectory()) throw new Error("设计工作文件夹不存在 / design workspace folder does not exist");
    const known = this.registered();
    if (known.includes(root)) return this.project(Object.values(this.readWorkspace(root).projects)[0].id, false);
    const file = this.designFile(root), time = now();
    const task = fs.existsSync(file) ? Object.values(this.readWorkspace(root).projects)[0] : {
      version: 1, id: id(), title: title || basename(root), created: time, updated: time,
      models: {}, sourceFile: "model.js", sessions: [], activeSessionId: null, started: false, attachments: [],
    };
    if (this.workspaces().some(([, other]) => other.id === task.id)) {
      task.id = id(); task.sessions = []; task.activeSessionId = null;
    }
    this.commit(new Map([[file, jsonBytes(task)],
      [this.registry, jsonBytes({ version: 1, paths: [root, ...known] })]]));
    return this.project(task.id, false);
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
      state.geometryIds ||= { ...defaultIdFormats };
      state.geometryScope = createHash("sha256")
        .update(`${key}\0${task.sourceFile}`)
        .digest("hex")
        .slice(0, 24);
    }
    result.design = state;
    result.revisions = [
      ...(task.models[task.sourceFile]?.revisions || []),
    ].sort((a, b) => b.revision - a.revision);
    result.attachments = (task.attachments || []).map(
      ({ path, ...entry }) => entry,
    );
    result.referenceFiles = ["resources", "references"].flatMap(folder => {
      const directoryPath = join(directory, folder);
      return fs.existsSync(directoryPath) ? fs.readdirSync(directoryPath, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => ({ path: portable(relative(directory, join(entry.parentPath, entry.name))),
          bytes: fs.statSync(join(entry.parentPath, entry.name)).size })) : [];
    });
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
    extraFiles = new Map(),
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
    changes.set(this.designFile(root), this.workspaceBytes(data));
    for (const [path, bytes] of extraFiles) changes.set(path, bytes);
    this.commit(changes);
    this.cacheSummary(folder, state);
  }
  async build(key, args, edit = false) {
    const [root, , task] = this.locate(key);
    const directory = this.taskRoot(root, task);
    const sourceFile = portable(relative(directory, modelPath(directory, args.sourceFile || task.sourceFile)));
    const head = task.models[sourceFile]?.head || 0;
    this.expect(head, args);
    const journal = new ProcessJournal(directory, sourceFile);
    const run = journal.begin(sourceFile, head, args.summary, defaultIdFormats);
    try {
      const result = await this.executeBuild(key, args, edit, journal, run);
      return result;
    } catch (error) {
      error.phase ||= run.phase;
      error.runId = run.id;
      error.diagnostics = { logs: run.logs || [], checkpoints: run.steps.map(step => step.label).filter(Boolean) };
      try { journal.finish(run, "error", { error: String(error.message || error) }); }
      catch (storageError) { error.message += `; 过程记录保存失败 / process log save failed: ${storageError.message}`; }
      throw error;
    }
  }
  async executeBuild(key, args, edit, journal, run) {
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
    const checkpoint = (part, label, operation) => {
      // Invalid/open intermediate construction is never shown as a valid solid.
      const description = api.describeShape(part);
      journal.capture(run, description, label, operation);
      return part;
    };
    const resourceRead = (name, bytes) => {
      const path = inside(directory, name);
      if (paths(directory, target).includes(path))
        throw new Error("模型资源不能引用当前建模输出文件");
      if (!inputs.has(path)) inputs.set(path, bytes);
    };
    shape = await api.buildShape(
      source,
      parameters,
      inside(directory, target),
      resources,
      resourceRead,
      directory,
      checkpoint,
      (...args) => journal.log(run, format(...args)),
    );
    for (const [name, bytes] of Object.entries(resources))
      assets.set(name, bytes);
    const state = {
      ...api.describeShape(shape),
      geometryIds: defaultIdFormats,
      source,
      parameters,
      operations: operations || [],
      assets: [...assets.keys()],
    };
    journal.capture(run, state, "", "result");
    journal.finish(run, "validating");
    const scope = args.commit === false ? api.modelScope(key, `${sourceFile}@${run.id}`) : api.modelScope(key, sourceFile);
    state.validation = args.checks?.length ? {
      checks: args.checks,
      ...api.checkShape(shape, api.values(args.checks, parameters), scope, head + 1),
    } : { passed: null, checks: [], results: [] };
    const diagnostics = { logs: run.logs || [], checkpoints: run.steps.map(step => step.label).filter(Boolean) };
    if (args.commit === false) {
      journal.saveCandidate(run, state, api.saveShape(shape), inputs, assets);
      return { sourceFile, head, committed: false, runId: run.id, metrics: state.metrics,
        validation: state.validation, diagnostics };
    }
    if (state.validation.passed === false)
      throw Object.assign(new Error("尺寸检查未通过，当前版本未被覆盖 / dimensional checks failed; saved revision retained"), { validation: state.validation });
    const finishedRun = { ...run, phase: "done", committedRevision: head + 1, updated: Date.now() / 1000 };
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
      new Map([[journal.manifest(run.id), jsonBytes(finishedRun)]]),
    );
    return { ...this.project(key, args.geometry !== false, sourceFile), committed: true, diagnostics };
  }
  async commitCandidate(key, args) {
    const [root, , task] = this.locate(key), directory = this.taskRoot(root, task);
    const journal = new ProcessJournal(directory, args.sourceFile);
    const candidate = journal.candidate(args.runId), { run, state, folder, inputs, assets } = candidate;
    this.expect(task.models[args.sourceFile]?.head || 0, args);
    this.expect(run.baseRevision, args);
    const api = await this.kernel();
    const checks = [...new Map([...(state.validation?.checks || []), ...(args.checks || [])]
      .map(check => [JSON.stringify(check), check])).values()];
    state.validation = checks.length ? { checks, ...api.checkShape(
      api.readShape(fs.readFileSync(join(folder, "model.smb")), "model.smb"),
      api.values(checks, state.parameters), api.modelScope(key, `${args.sourceFile}@${run.id}`), run.baseRevision + 1,
    ) } : { passed: null, checks: [], results: [] };
    if (state.validation.passed === false)
      throw Object.assign(new Error("尺寸检查未通过，当前版本未被覆盖 / dimensional checks failed; saved revision retained"), { validation: state.validation });
    state.preview = candidate.preview();
    const finished = { ...run, phase: "done", committedRevision: run.baseRevision + 1, updated: now() };
    this.record(key, args.sourceFile, state, fs.readFileSync(join(folder, "model.smb")),
      args.summary || run.summary, run.baseRevision, inputs, assets, !args.preserveSelection,
      new Map([[journal.manifest(run.id), jsonBytes(finished)], [journal.index, jsonBytes({ id: run.id })]]));
    return { ...this.project(key, false, args.sourceFile), committed: true,
      diagnostics: { logs: run.logs || [], checkpoints: run.steps.map(step => step.label).filter(Boolean) } };
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
    switch (args.format) {
      case "step":
      case "stl":
      case "smb":
        bytes = api.exportShape(shape, args.format);
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
            geometryIds: state.geometryIds || defaultIdFormats,
            validation: state.validation || null,
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
    if (method === "api") return readApi(args);
    if (method === "health")
      return {
        ready: true,
        kernel: (await this.kernel()).kernelName,
        node: process.versions.node,
      };
    // Match DSH's workspace registry: activity never changes folder order.
    if (method === "list")
      return this.workspaces()
        .flatMap(([root, data]) =>
          Object.values(data.projects).map((task) =>
            this.row(root, data, task),
          ),
        );
    if (method === "open_design") return this.openDesign(args.path);
    if (method === "create") return this.openDesign(args.path || this.managedDirectory(args.title), args.title);
    if (method === "close_design") {
      const [root] = this.locate(args.projectId);
      this.commit(new Map([[this.registry, jsonBytes({ version: 1, paths: this.registered().filter(path => path !== root) })]]));
      return { closed: true };
    }
    if (method === "by_session") {
      for (const [, data] of this.workspaces())
        for (const task of Object.values(data.projects))
          if (task.sessions.includes(args.sessionId))
            return this.project(task.id, false);
      throw new Error("当前会话未绑定 MiniCAD 设计任务");
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
    if (method === "process_location") return { directory, sourceFile };
    if (["process_state", "process_history", "checkpoint_file"].includes(method)) {
      const journal = new ProcessJournal(directory, sourceFile);
      if (method === "process_state") return journal.latest();
      if (method === "process_history") return journal.runs().toReversed();
      if (method === "checkpoint_file") return journal.preview(args.runId, args.sequence);
    }
    if (method === "get") return this.project(key, false, sourceFile);
    if (method === "preview_file") {
      const saved = this.snapshot(key, args.revision, sourceFile, false);
      if (!saved) throw new Error("请先完成建模 / build a model first");
      const path = join(saved.folder, "preview.bin");
      let valid = false;
      try {
        valid =
          saved.state.previewVersion === 3 &&
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
          previewVersion: 3,
          geometryIds: saved.state.geometryIds || { ...defaultIdFormats },
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
    if (method === "commit") {
      try { return await this.commitCandidate(key, { ...args, sourceFile }); }
      catch (error) { error.phase ||= "publishing"; error.runId = args.runId; throw error; }
    }
    if (method === "update_parameters")
      return this.build(key, { ...args, parameterMode: args.mode ?? "merge" });
    if (["query", "measure", "check", "geometry_annotation"].includes(method)) {
      this.expect(row.head, args);
      const candidate = args.runId ? new ProcessJournal(directory, sourceFile).candidate(args.runId) : null;
      if (candidate) this.expect(candidate.run.baseRevision, args);
      const saved = candidate ? { folder: candidate.folder, state: candidate.state } : this.snapshot(key, undefined, sourceFile, false);
      if (!saved) {
        if (method === "query") return { sourceFile, revision: 0, items: [] };
        throw new Error("请先完成建模 / build a model first");
      }
      const api = await this.kernel(),
        shape = await this.shape(saved),
        scope = api.modelScope(key, candidate ? `${sourceFile}@${args.runId}` : sourceFile);
      const revision = candidate ? candidate.run.baseRevision + 1 : row.head;
      const result = { sourceFile, revision, ...(candidate ? { runId: args.runId, committed: false } : {}) };
      if (method === "geometry_annotation") {
        const describe = reference => {
          const { kind, geometry: item } = api.describeReference(
            shape, reference, scope, row.head, saved.state.geometryIds || defaultIdFormats,
          );
          return { projectId: key, sourceFile, expectedRevision: row.head,
            reference: item.id, kind, label: item.displayId, note: String(args.note || ""), geometry: item };
        };
        return args.references ? { ...result, items: args.references.map(describe) } : describe(args.reference);
      }
      if (method === "measure")
        return {
          ...result,
          items: api.measureShape(
            shape,
            api.values(args.measurements, saved.state.parameters),
            scope,
            revision,
          ),
        };
      if (method === "check")
        return {
          ...result,
          ...api.checkShape(
            shape,
            api.values(args.checks, saved.state.parameters),
            scope,
            revision,
          ),
        };
      return {
        ...result,
        kind: args.kind || "faces",
        items: api.queryShape(
          shape,
          revision,
          args.kind,
          api.values(args.selector, saved.state.parameters),
          scope,
          saved.state.geometryIds || defaultIdFormats,
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
        geometryIds: saved.state.geometryIds || { ...defaultIdFormats },
        source: saved.state.source,
        parameters: saved.state.parameters,
        assets: [...assets.keys()],
        restoredFrom: Number(args.revision),
        validation: saved.state.validation || null,
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
    if (method === "fork_project") {
      if (args.sessionId && (await this.dispatch("list")).some(project => project.sessions.includes(args.sessionId)))
        throw new Conflict("会话已绑定另一个设计");
      const target = args.path ? fs.realpathSync(args.path) : this.managedDirectory(args.title || task.title);
      if (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length)
        throw new Error("另存为需要一个空文件夹 / save as requires an empty folder");
      if (!relative(directory, target).startsWith("..") || !relative(target, directory).startsWith(".."))
        throw new Error("任务目录无法安全迁移");
      const all = entries(directory).filter(entry => !relative(directory, entry.path).split(sep).includes(".cad-process"));
      const changes = new Map();
      for (const entry of all) {
        const path = join(target, relative(directory, entry.path));
        if (entry.directory) fs.mkdirSync(path, { recursive: true });
        else changes.set(path, fs.readFileSync(entry.path));
      }
      const branch = { ...structuredClone(task), id: id(), title: args.title || basename(target),
        sessions: args.sessionId ? [args.sessionId] : [], activeSessionId: args.sessionId || null,
        created: now(), updated: now() };
      changes.set(this.designFile(target), jsonBytes(branch));
      changes.set(this.registry, jsonBytes({ version: 1, paths: [target, ...this.registered()] }));
      this.commit(changes);
      return this.project(branch.id, false);
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
          [this.designFile(root), this.workspaceBytes(data)],
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
      const parent = dirname(root), target = availableDirectory(parent, args.directoryName || title, root);
      // Check the absolute source and destination before moving the workspace.
      const settingsRelative = relative(root, this.root);
      if (parent === root || dirname(target) !== parent || !settingsRelative ||
          (!settingsRelative.startsWith(`..${sep}`) && settingsRelative !== ".." && !isAbsolute(settingsRelative)))
        throw new Error("任务目录无法安全迁移");
      task.title = title; task.updated = now();
      const known = this.registered();
      this.commit(new Map([[this.designFile(target), this.workspaceBytes(data)],
        [this.registry, jsonBytes({ version: 1, paths: known.map(path => path === root ? target : path) })]]),
        target === root ? [] : [{ from: root, to: target }]);
      return this.project(key, false);
    } else if (method === "bind") {
      if (
        (await this.dispatch("list")).some(
          (p) => p.id !== key && p.sessions.includes(args.sessionId),
        )
      )
        throw new Conflict("会话已绑定另一个设计");
      if (!task.sessions.includes(args.sessionId)) task.sessions.push(args.sessionId);
      task.activeSessionId = args.sessionId;
    } else if (method === "select_session") {
      if (!task.sessions.includes(args.sessionId)) throw new Error("会话不属于当前设计 / session does not belong to this design");
      task.activeSessionId = args.sessionId;
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
