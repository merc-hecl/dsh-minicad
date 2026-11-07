import { appendErrorDetail, localizedError } from "../shared/errors.js";
import { defaultIdFormats, validateIdFormat } from "../shared/geometry-ids.js";
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
import { zipSync } from "fflate";
import {
  atomicWrite,
  fileBytes,
  hashFile,
  inside,
  jsonBytes,
  readJson,
} from "./files.js";
import { encodePreview, previewInfo, PREVIEW_VERSION } from "../shared/preview.js";
import { ProcessJournal } from "./process.js";
import { readApi } from "./api.js";
import { format, isDeepStrictEqual } from "node:util";
const kernel = () => import("./model.js");
const now = () => Date.now() / 1000;
const id = () => randomUUID().replaceAll("-", "");
const portable = (path) => path.split(sep).join("/");
const stem = (name) => name.slice(0, -extname(name).length);
const nextRevision = (model) => (model?.revisions.at(-1)?.revision ?? 0) + 1;
const cleanName = (name) =>
  String(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[ .]+$/g, "")
    .trim()
    .slice(0, 100) || "design";
const equalBytes = (a, b) =>
  a === null ? b === null : b !== null && a.equals(b);
export class KernelRequired extends Error {
  constructor() {
    super("此操作需要独立建模进程 / isolated kernel process required");
    this.code = "KERNEL_REQUIRED";
  }
}
export class Conflict extends Error {
  constructor(zh = "设计已更新，请重新读取当前版本后再修改", en = "The design has changed. Reload the current revision before editing.") {
    super(zh);
    this.localized = { zh, en };
    this.status = 409;
  }
}
function modelPath(root, name) {
  if (
    typeof name !== "string" ||
    isAbsolute(name) ||
    !name.endsWith(".smp") ||
    name.split(/[/\\]/).some((part) => part.startsWith("."))
  )
    throw localizedError("模型文件必须是工作目录内的 SMP 文件", "Choose an SMP model file within the working directory");
  return inside(root, name);
}
function paths(root, name) {
  const solid = modelPath(root, name);
  return [solid, `${stem(solid)}.state.json`];
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
      if (entry.isSymbolicLink()) throw localizedError("任务目录无法安全迁移", "The design folder cannot be safely moved");
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
    if (!fs.existsSync(this.registry)) this.write(this.registry, jsonBytes({ version: 1, paths: [] }));
  }
  designFile(root) { return join(root, ".cad-design.json"); }
  workspaceBytes(data) { return jsonBytes(Object.values(data.projects)[0]); }
  recover() {
    if (!fs.existsSync(this.journal)) return;
    const pending = readJson(this.journal);
    if (pending.phase !== "committed") {
      for (const move of pending.moves.toReversed())
        if (fs.existsSync(move.to) && (!fs.existsSync(move.from) ||
          (process.platform === "win32" && move.from !== move.to && move.from.toLowerCase() === move.to.toLowerCase())))
          fs.renameSync(move.to, move.from);
      for (const item of pending.files.reverse())
        atomicWrite(
          item.rollbackPath,
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
    if (task.version !== 2 || !task.id || !task.models || !Array.isArray(task.sessions))
      throw localizedError("设计元数据无效", "invalid design metadata");
    return { id: task.id, updated: task.updated, projects: { [task.id]: task } };
  }
  workspaces() {
    return this.registered().flatMap(root => {
      try { return [[root, this.readWorkspace(root)]]; }
      catch { return []; } // One unreadable design must not block the other registered designs.
    });
  }
  locate(key) {
    for (const [root, data] of this.workspaces())
      if (Object.hasOwn(data.projects, key)) return [root, data, data.projects[key]];
    throw localizedError("设计任务不存在", "Design not found");
  }
  row(root, task) {
    const model = task.models[task.modelFile] || {};
    return { id: task.id, title: task.title, activeSessionId: task.activeSessionId, sessions: task.sessions,
      head: model.head || 0, created: task.created, updated: Math.max(task.updated, model.updated || 0),
      directory: root, modelFile: task.modelFile, has_messages: Boolean(task.started) };
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
    if (typeof path !== "string" || !isAbsolute(path)) throw localizedError("请选择设计工作文件夹", "choose a design workspace folder");
    const root = fs.realpathSync(path);
    if (!fs.statSync(root).isDirectory()) throw localizedError("设计工作文件夹不存在", "design workspace folder does not exist");
    const known = this.registered();
    if (known.includes(root)) return this.project(Object.values(this.readWorkspace(root).projects)[0].id);
    const file = this.designFile(root), time = now();
    const task = fs.existsSync(file) ? Object.values(this.readWorkspace(root).projects)[0] : {
      version: 2, id: id(), title: title || basename(root), created: time, updated: time,
      models: {}, modelFile: "model.smp", sessions: [], activeSessionId: null, started: false, attachments: [],
    };
    if (this.workspaces().some(([, other]) => other.id === task.id)) {
      task.id = id(); task.sessions = []; task.activeSessionId = null;
    }
    this.commit(new Map([[file, jsonBytes(task)],
      [this.registry, jsonBytes({ version: 1, paths: [root, ...known] })]]));
    return this.project(task.id);
  }
  snapshot(key, revision, modelFile) {
    const [root, , task] = this.locate(key),
      model = task.models[modelFile || task.modelFile] || {},
      number = revision === undefined ? model.head || 0 : Number(revision);
    if (!number) return null;
    const entry = (model.revisions || []).find(
      (item) => item.revision === number,
    );
    if (!entry) throw localizedError("版本不存在", "Version not found");
    const folder = inside(root, entry.folder);
    return { folder, state: readJson(join(folder, "state.json")) };
  }
  project(key, modelFile) {
    const [root, , storedTask] = this.locate(key),
      task =
        modelFile === undefined
          ? storedTask
          : {
              ...storedTask,
              modelFile: portable(
                relative(
                  root,
                  modelPath(root, modelFile),
                ),
              ),
            },
      result = this.row(root, task),
      directory = result.directory,
      saved = this.snapshot(key, undefined, task.modelFile),
      state = saved?.state || null;
    const working = paths(directory, task.modelFile);
    result.workspaceDirectory = directory;
    result.selectedModelFile = storedTask.modelFile;
    result.models = Object.entries(task.models).map(([modelFile, model]) => ({ modelFile, head: model.head }));
    result.modelVersion = working.map(path => hashFile(path) || "missing").join(":");
    result.workingTreeChanged = Boolean(saved && working.some((path, index) =>
      hashFile(path) !== hashFile(join(saved.folder, ["model.smp", "state.json"][index]))));
    if (state) {
      state.geometryScope = createHash("sha256").update(`${key}\0${task.modelFile}`).digest("hex").slice(0, 24);
    }
    result.design = state;
    result.revisions = [
      ...(task.models[task.modelFile]?.revisions || []),
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
    return result;
  }
  expect(head, args) {
    if (args.expectedRevision !== head) throw new Conflict();
  }
  async shape(saved) {
    return (await this.kernel()).readShape(
      fs.readFileSync(join(saved.folder, "model.smp")),
      "model.smp", saved.state.parts, saved.state.entities,
    );
  }
  prepareInputs(directory, modelFile) {
    return new Map(
      paths(directory, modelFile).map((path) => [path, fileBytes(path)]),
    );
  }
  record(
    key,
    modelFile,
    state,
    binary,
    summary,
    expected,
    inputs,
    materials = new Map(),
    {
      selectModel = true,
      extraFiles = new Map(),
      writeWorkingFiles = true,
      previewBytes,
    } = {},
  ) {
    const [root, data, task] = this.locate(key),
      directory = root;
    const model = task.models[modelFile] || { head: 0, revisions: [] };
    this.expect(model.head, { expectedRevision: expected });
    if (inputs)
      for (const [path, bytes] of inputs)
        if (!equalBytes(fileBytes(path), bytes)) throw new Conflict();
    const revision = nextRevision(model),
      time = now(),
      history = inside(directory, `.cad-history/${portable(stem(modelFile))}`);
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
    task.models[modelFile] = model;
    if (selectModel) task.modelFile = modelFile;
    task.started = true;
    task.updated = data.updated = time;
    state.revision = revision;
    state.parent = expected || null;
    state.modelFile = modelFile;
    const preview = previewBytes ?? encodePreview(state.preview);
    state.preview = {
      ...previewInfo(preview),
      digest: createHash("sha256").update(preview).digest("hex"),
    };
    const [solid, metadata] = paths(directory, modelFile),
      changes = new Map([
        [join(folder, "preview.bin"), preview],
        [join(folder, "model.smp"), binary],
        [join(folder, "state.json"), jsonBytes(state)],
      ]);
    if (writeWorkingFiles) {
      changes.set(solid, binary);
      changes.set(metadata, jsonBytes(state));
    } else if (equalBytes(fileBytes(metadata), jsonBytes(this.snapshot(key, expected, modelFile).state))) {
      changes.set(metadata, jsonBytes(state));
    }
    for (const [name, bytes] of materials) changes.set(inside(folder, name), bytes);
    changes.set(this.designFile(root), this.workspaceBytes(data));
    for (const [path, bytes] of extraFiles) changes.set(path, bytes);
    this.commit(changes);
    return revision;
  }
  async build(key, args, edit = false) {
    const [root, , task] = this.locate(key);
    const directory = root;
    const modelFile = portable(relative(directory, modelPath(directory, args.modelFile || task.modelFile)));
    const head = task.models[modelFile]?.head || 0;
    this.expect(head, args);
    const saved = this.snapshot(key, undefined, modelFile);
    const journal = new ProcessJournal(directory, modelFile);
    const run = journal.begin(modelFile, head, nextRevision(task.models[modelFile]), args.summary, saved ? saved.state.geometryIds : defaultIdFormats);
    try {
      const result = await this.executeBuild(key, args, edit, journal, run, saved);
      return result;
    } catch (error) {
      error.phase ||= run.phase;
      error.runId = run.id;
      error.diagnostics = { logs: run.logs || [], checkpoints: run.steps.map(step => step.label).filter(Boolean) };
      try { journal.finish(run, "error", { error: String(error.message || error) }); }
      catch (storageError) {
        appendErrorDetail(error, "过程记录保存失败", "Process log save failed", `: ${storageError.message}`);
      }
      throw error;
    }
  }
  async executeBuild(key, args, edit, journal, run, saved) {
    const [directory, , task] = this.locate(key);
    const modelFile = portable(relative(directory, modelPath(directory, args.modelFile || task.modelFile)));
    const head = task.models[modelFile]?.head || 0;
    this.expect(head, args);
    if (saved && !args.file && this.project(key, modelFile).workingTreeChanged)
      throw new Conflict("模型工作文件已修改，请先导入或保存修改", "Import or save the modified model working files first.");
    const api = await this.kernel(), inputs = this.prepareInputs(directory, modelFile);
    const parameters = args.parameters ?? {};
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters))
      throw localizedError("parameters 必须是 JSON 对象", "parameters must be a JSON object");
    jsonBytes(parameters);
    const base = args.baseModelFile ? this.snapshot(key, args.baseRevision, args.baseModelFile) : saved;
    const resources = {}, materials = new Map();
    const operation = { tool: args.file ? "cad_import" : edit ? "cad_edit" : "cad_build", kernel: api.kernelName,
      inputModel: args.baseModelFile || modelFile, inputRevision: base?.state.revision || 0,
      ...(args.part ? { part: args.part } : {}),
      ...(edit ? { operations: args.operations, ...(args.parameters !== undefined ? { parameters } : {}) } : {}),
      ...(args.file ? { file: args.file, ...(args.metadataFile ? { metadataFile: args.metadataFile } : {}) } : {}),
      ...(args.checks ? { checks: api.values(args.checks, parameters) } : {}) };
    materials.set("operations.json", jsonBytes(operation));
    if (!edit && !args.file) {
      if (typeof args.source !== "string" || !args.source.trim() || args.source.length > 2 * 1024 * 1024)
        throw localizedError("请提供定义 build(parameters, cad) 的建模源码", "Provide source defining build(parameters, cad)");
      materials.set("build/source.js", Buffer.from(args.source));
      if (args.parameters !== undefined) materials.set("build/parameters.json", jsonBytes(parameters));
      if (base) {
        materials.set("build/base.smp", fs.readFileSync(join(base.folder, "model.smp")));
        materials.set("build/base.state.json", jsonBytes(base.state));
      }
    }
    journal.saveMaterials(run, materials);
    const resourceRead = (name, bytes) => {
      const path = inside(directory, name);
      if (!inputs.has(path)) inputs.set(path, bytes);
      const nameInArchive = `${operation.tool === "cad_build" ? "build/" : ""}inputs/${portable(relative(directory, path))}`;
      if (materials.has(nameInArchive)) return;
      materials.set(nameInArchive, bytes);
      journal.saveMaterials(run, new Map([[nameInArchive, bytes]]));
    };
    for (const name of args.inputs || []) resourceRead(name, fs.readFileSync(inside(directory, name)));
    const checkpoint = (part, label, operation) => {
      journal.capture(run, api.describeShape(part), label, operation);
      return part;
    };
    let shape = base ? await this.shape(base) : null;
    if (args.file) {
      const bytes = fs.readFileSync(inside(directory, args.file));
      resourceRead(args.file, bytes);
      let metadata;
      if (args.metadataFile) {
        const bytes = fs.readFileSync(inside(directory, args.metadataFile));
        resourceRead(args.metadataFile, bytes);
        metadata = JSON.parse(bytes);
      }
      shape = api.readShape(bytes, args.file, metadata?.parts, metadata?.entities);
      if (metadata?.geometryIds) run.geometryIds = metadata.geometryIds;
    } else if (edit) {
      const operations = api.normalizeOperations(api.values(args.operations, parameters), shape,
        base?.state.revision || 0, api.modelScope(key, args.baseModelFile || modelFile));
      shape = api.editShape(shape, operations, {}, {
        readModel: name => api.readModel(directory, name, resources, resourceRead), checkpoint,
      });
    } else {
      const current = args.part ? shape.part(args.part).shape : shape;
      const result = await api.buildShape(args.source, parameters, inside(directory, "build.js"), resources,
        resourceRead, directory, checkpoint, (...args) => journal.log(run, format(...args)), current);
      shape = args.part ? api.replacePart(shape, args.part, result) : result;
    }
    const state = { ...api.describeShape(shape), formatVersion: 2, unit: "mm", geometryIds: run.geometryIds };
    if (args.commit !== false) api.requireNames(shape);
    journal.capture(run, state, "", "result");
    journal.finish(run, "validating");
    const scope = api.modelScope(key, args.commit === false ? `${modelFile}@${run.id}` : modelFile);
    const checks = api.values(args.checks || [], parameters);
    state.validation = checks.length ? { checks, ...api.checkShape(shape, checks, scope, run.candidateRevision) }
      : { passed: null, checks: [], results: [] };
    const diagnostics = { logs: run.logs || [], checkpoints: run.steps.map(step => step.label).filter(Boolean) };
    if (args.commit === false) {
      journal.saveCandidate(run, state, api.saveShape(shape), inputs);
      return { modelFile, head, committed: false, runId: run.id, metrics: state.metrics, validation: state.validation, diagnostics };
    }
    if (state.validation.passed === false)
      throw Object.assign(localizedError("尺寸检查未通过，当前版本未被覆盖", "dimensional checks failed; saved revision retained"), { validation: state.validation });
    const finishedRun = { ...run, phase: "done", committedRevision: run.candidateRevision, updated: now() };
    this.record(key, modelFile, state, api.saveShape(shape), args.summary, head, inputs, materials, {
      selectModel: !args.preserveSelection, extraFiles: new Map([[journal.manifest(run.id), jsonBytes(finishedRun)]]),
    });
    return { ...this.project(key, modelFile), committed: true, diagnostics };
  }
  async commitCandidate(key, args) {
    const [root, , task] = this.locate(key), directory = root;
    const journal = new ProcessJournal(directory, args.modelFile);
    const candidate = journal.candidate(args.runId), { run, state, folder, inputs, materials } = candidate;
    const model = task.models[args.modelFile];
    this.expect(model?.head || 0, args);
    this.expect(run.baseRevision, args);
    if (run.phase !== "preview") throw new Conflict();
    const api = await this.kernel();
    const checks = [...new Map([...(state.validation?.checks || []), ...(args.checks || [])]
      .map(check => [JSON.stringify(check), check])).values()];
    const shape = api.readShape(fs.readFileSync(join(folder, "model.smp")), "model.smp", state.parts, state.entities);
    api.requireNames(shape);
    state.validation = checks.length ? { checks, ...api.checkShape(
      shape,
      checks, api.modelScope(key, `${args.modelFile}@${run.id}`), run.candidateRevision,
    ) } : { passed: null, checks: [], results: [] };
    if (state.validation.passed === false)
      throw Object.assign(localizedError("尺寸检查未通过，当前版本未被覆盖", "dimensional checks failed; saved revision retained"), { validation: state.validation });
    state.preview = api.previewShape(shape);
    const finished = { ...run, phase: "done", committedRevision: nextRevision(model), updated: now() };
    this.record(key, args.modelFile, state, fs.readFileSync(join(folder, "model.smp")),
      args.summary || run.summary, run.baseRevision, inputs, materials, {
        selectModel: !args.preserveSelection,
        extraFiles: new Map([[journal.manifest(run.id), jsonBytes(finished)], [journal.index, jsonBytes({ id: run.id })]]),
      });
    return { ...this.project(key, args.modelFile), committed: true,
      diagnostics: { logs: run.logs || [], checkpoints: run.steps.map(step => step.label).filter(Boolean) } };
  }
  async setGeometryIdFormat(key, modelFile, head, args) {
    this.expect(head, args);
    const saved = this.snapshot(key, head, modelFile);
    if (!saved) throw localizedError("请先完成建模", "build a model first");
    if (args.faceFormat === undefined && args.edgeFormat === undefined)
      throw localizedError("请提供面或边的编号格式", "supply a face or edge ID format");
    const current = saved.state.geometryIds;
    const geometryIds = { ...current };
    for (const name of ["faceFormat", "edgeFormat"]) {
      if (args[name] === undefined) continue;
      validateIdFormat(args[name]);
      geometryIds[name] = args[name];
    }
    if (isDeepStrictEqual(geometryIds, current)) return { modelFile, head, committed: false, geometryIds };

    const { path } = await this.dispatch("preview_file", { projectId: key, modelFile, revision: head });
    // Preview regeneration may have refreshed the cache metadata.
    const state = this.snapshot(key, head, modelFile).state;
    state.geometryIds = geometryIds;
    const materials = new Map([["operations.json", jsonBytes({ tool: "cad_set_geometry_id_format", inputRevision: head, geometryIds })]]);
    const revision = this.record(key, modelFile, state, fs.readFileSync(join(saved.folder, "model.smp")),
      args.summary, head, undefined, materials, {
        selectModel: false,
        writeWorkingFiles: false,
        previewBytes: fs.readFileSync(path),
      });
    return { modelFile, head: revision, committed: true, geometryIds };
  }
  async export(key, args) {
    const saved = this.snapshot(key, args.revision, args.modelFile);
    if (!saved) throw localizedError("请先完成建模", "Build a model first");
    const api = await this.kernel(),
      fullShape = await this.shape(saved),
      shape = args.part ? fullShape.part(args.part).shape : fullShape,
      state = saved.state,
      [root, , task] = this.locate(key),
      name = `${cleanName(task.title)}-v${Number(args.revision)}${args.part ? "-" + cleanName(fullShape.part(args.part).name) + "-" + createHash("sha256").update(args.part).digest("hex").slice(0, 8) : ""}`;
    let bytes,
      mediaType = "application/octet-stream";
    switch (args.format) {
      case "step":
      case "stl":
      case "smp":
      case "smb":
        bytes = api.exportShape(shape, args.format);
        break;
      case "zip": {
        if (args.part) throw localizedError("零件导出请选择 STEP、STL 或 SMP", "use STEP, STL or SMP for a part");
        const archive = {};
        for (const entry of fs.readdirSync(saved.folder, { recursive: true, withFileTypes: true })) {
          if (!entry.isFile()) continue;
          const file = join(entry.parentPath, entry.name);
          archive[portable(relative(saved.folder, file))] = fs.readFileSync(file);
        }
        bytes = Buffer.from(zipSync(archive));
        mediaType = "application/zip";
        break;
      }
      default:
        throw localizedError("不支持的导出格式", "Unsupported export format");
    }
    const path = inside(
      root,
      `exports/${portable(stem(state.modelFile))}/${name}.${args.format}`,
    );
    this.write(path, bytes);
    return {
      name: `${name}.${args.format}`,
      path,
      mediaType,
      data: bytes.toString("base64"),
      revision: Number(args.revision),
      modelFile: state.modelFile,
    };
  }
  async variants(key, args) {
    const base = this.snapshot(key, undefined, args.modelFile);
    this.expect(base?.state.revision || 0, args);
    if (!base) throw localizedError("请先完成建模", "build a model first");
    if (this.project(key, args.modelFile).workingTreeChanged)
      throw new Conflict("模型工作文件已修改，请先保存或导入修改", "Save or import the modified model working files first.");
    if (!Array.isArray(args.variants) || !args.variants.length || args.variants.length > 20)
      throw localizedError("请提供 1 至 20 个规格", "provide 1–20 variants");
    const [root, , task] = this.locate(key), directory = root, seen = new Set();
    for (const variant of args.variants) {
      const name = portable(relative(directory, modelPath(directory, variant.modelFile)));
      const normalized = process.platform === "win32" ? name.toLowerCase() : name;
      if (seen.has(normalized) || task.models[name] || paths(directory, name).some(path => fs.existsSync(path)))
        throw localizedError("规格文件已存在或重复", "variant file exists or is duplicated", `: ${name}`);
      seen.add(normalized);
    }
    // Evaluate every specification before publishing any. Commits and optional exports
    // remain individually durable; errors report which files were already saved.
    const candidates = [];
    for (const variant of args.variants) {
      const result = await this.build(key, { modelFile: variant.modelFile, expectedRevision: 0,
        baseModelFile: args.modelFile, baseRevision: args.expectedRevision, operations: variant.operations, parameters: variant.parameters,
        checks: variant.checks, summary: variant.name || variant.modelFile, commit: false, preserveSelection: true }, true);
      if (result.validation.passed === false) throw localizedError("规格检查失败", "variant checks failed", `: ${variant.modelFile}`);
      candidates.push({ ...variant, runId: result.runId });
    }
    const items = [];
    try {
      for (const variant of candidates) {
        const result = await this.commitCandidate(key, { modelFile: variant.modelFile, expectedRevision: 0,
          runId: variant.runId, summary: variant.name || variant.modelFile, preserveSelection: true });
        const item = { modelFile: variant.modelFile, revision: result.head, name: variant.name,
          metrics: result.design.metrics, exports: [] };
        items.push(item);
        for (const format of args.formats || []) {
          const { path, name } = await this.export(key, { modelFile: variant.modelFile, revision: result.head, format });
          item.exports.push({ path, name, format });
        }
      }
    } catch (error) {
      appendErrorDetail(error, "已保存规格", "Saved variants", `: ${JSON.stringify(items)}`);
      throw error;
    }
    return { modelFile: args.modelFile, revision: args.expectedRevision, items };
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
            this.row(root, task),
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
            return this.project(task.id);
      throw localizedError("当前会话未绑定 MiniCAD 设计任务", "This session is not bound to a MiniCAD design");
    }
    const key = String(args.projectId),
      [root, data, task] = this.locate(key),
      directory = root,
      modelFile =
        args.modelFile === undefined
          ? task.modelFile
          : portable(
              relative(directory, modelPath(directory, args.modelFile)),
            ),
      row = this.row(root, { ...task, modelFile });
    if (method === "process_location") return { directory, modelFile };
    if (["process_state", "process_history", "checkpoint_file"].includes(method)) {
      const journal = new ProcessJournal(directory, modelFile);
      if (method === "process_state") return journal.latest();
      if (method === "process_history") return journal.runs().toReversed();
      if (method === "checkpoint_file") return journal.preview(args.runId, args.sequence);
    }
    if (method === "variants") return this.variants(key, { ...args, modelFile });
    if (method === "get") return this.project(key, modelFile);
    if (method === "compare") {
      const base = this.snapshot(key, args.baseRevision, modelFile);
      const target = this.snapshot(key, args.targetRevision, modelFile);
      if (!base || !target) throw localizedError("版本不存在", "Version not found");
      const api = await this.kernel(), shapes = [];
      try {
        shapes.push(await this.shape(base));
        shapes.push(await this.shape(target));
        const regions = api.compareShapes(...shapes);
        return {
          projectId: key, modelFile, baseRevision: base.state.revision, targetRevision: target.state.revision,
          ...Object.fromEntries(Object.entries(regions).map(([name, region]) => [name, region ? {
            volume: region.metrics.volume,
            preview: Buffer.from(encodePreview(region.preview)).toString("base64"),
          } : null])),
        };
      } finally {
        shapes.forEach(shape => shape.dispose());
      }
    }
    if (method === "preview_file") {
      const saved = this.snapshot(key, args.revision, modelFile);
      if (!saved) throw localizedError("请先完成建模", "build a model first");
      const path = join(saved.folder, "preview.bin");
      let valid = false;
      try {
        valid =
          saved.state.previewVersion === PREVIEW_VERSION &&
          fs.statSync(path).size === saved.state.preview?.byteLength &&
          hashFile(path) === saved.state.preview.digest;
      } catch {
        /* Generate the preview from the revision's exact solid. */
      }
      if (!valid) {
        const api = await this.kernel();
        const bytes = encodePreview(api.previewShape(await this.shape(saved)));
        const state = {
          ...saved.state,
          previewVersion: PREVIEW_VERSION,
          preview: {
            ...previewInfo(bytes),
            digest: createHash("sha256").update(bytes).digest("hex"),
          },
        };
        const changes = new Map([
            [path, bytes],
            [join(saved.folder, "state.json"), jsonBytes(state)],
          ]);
        const metadata = paths(directory, modelFile)[1];
        if (saved.state.revision === row.head && equalBytes(fileBytes(metadata), jsonBytes(saved.state)))
          changes.set(metadata, jsonBytes(state));
        this.commit(changes);
      }
      return {
        path,
        byteLength: fs.statSync(path).size,
        modelFile,
        revision: args.revision ?? row.head,
      };
    }
    if (method === "select_model") {
      task.modelFile = portable(
        relative(directory, modelPath(directory, args.modelFile)),
      );
      this.saveWorkspace(root, data);
      return this.project(key);
    }
    if (method === "build" || method === "edit" || method === "import")
      return this.build(key, args, method === "edit");
    if (method === "commit") {
      try { return await this.commitCandidate(key, { ...args, modelFile }); }
      catch (error) { error.phase ||= "publishing"; error.runId = args.runId; throw error; }
    }
    if (method === "set_geometry_id_format")
      return this.setGeometryIdFormat(key, modelFile, row.head, args);
    if (method === "fit") {
      this.expect(row.head, args);
      const saved = this.snapshot(key, undefined, modelFile);
      if (!saved) throw localizedError("请先完成建模", "build a model first");
      const api = await this.kernel(), shape = await this.shape(saved);
      try { return { modelFile, revision: row.head, items: api.inspectFit(shape, args.pairs, args.tolerance) }; }
      finally { shape.dispose(); }
    }
    if (["query", "measure", "check", "geometry_annotation"].includes(method)) {
      this.expect(row.head, args);
      const candidate = args.runId ? new ProcessJournal(directory, modelFile).candidate(args.runId) : null;
      if (candidate) this.expect(candidate.run.baseRevision, args);
      const saved = candidate ? { folder: candidate.folder, state: candidate.state } : this.snapshot(key, undefined, modelFile);
      if (!saved) {
        if (method === "query") return { modelFile, revision: 0, items: [] };
        throw localizedError("请先完成建模", "build a model first");
      }
      const api = await this.kernel(),
        shape = await this.shape(saved),
        scope = api.modelScope(key, candidate ? `${modelFile}@${args.runId}` : modelFile);
      const revision = candidate ? candidate.run.candidateRevision : row.head;
      const result = { modelFile, revision, ...(candidate ? { runId: args.runId, committed: false } : {}) };
      if (method === "query" && args.kind === "parts")
        return { ...result, kind: "parts", items: saved.state.parts || [] };
      if (method === "geometry_annotation") {
        const describe = reference => {
          const { kind, geometry: item } = api.describeReference(
            shape, reference, scope, row.head, saved.state.geometryIds,
          );
          return { projectId: key, modelFile, expectedRevision: row.head,
            reference: item.id, kind, label: item.displayId, note: String(args.note || ""), geometry: item };
        };
        return args.references ? { ...result, items: args.references.map(describe) } : describe(args.reference);
      }
      if (method === "measure")
        return {
          ...result,
          items: api.measureShape(
            shape,
            args.measurements,
            scope,
            revision,
          ),
        };
      if (method === "check")
        return {
          ...result,
          ...api.checkShape(
            shape,
            args.checks,
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
          args.selector,
          scope,
          saved.state.geometryIds,
          args.edgeParameters,
        ),
      };
    }
    if (method === "restore") {
      this.expect(row.head, args);
      const saved = this.snapshot(key, args.revision, modelFile);
      if (!saved) throw localizedError("版本不存在", "Version not found");
      const revision = saved.state.revision;
      if (revision !== row.head) {
        if (this.project(key, modelFile).workingTreeChanged)
          throw new Conflict("模型工作文件已修改，请先保存或导入修改", "Save or import the modified model working files first.");
        const changes = new Map(paths(directory, modelFile).map((file, index) => [
          file, fs.readFileSync(join(saved.folder, ["model.smp", "state.json"][index])),
        ]));
        const model = task.models[modelFile];
        model.head = revision;
        model.updated = task.updated = now();
        if (!args.preserveSelection) task.modelFile = modelFile;
        changes.set(this.designFile(root), this.workspaceBytes(data));
        this.commit(changes);
      }
      return this.project(key, modelFile);
    }
    if (method === "export") return this.export(key, { ...args, modelFile });
    if (method === "fork_project") {
      if (args.sessionId && (await this.dispatch("list")).some(project => project.sessions.includes(args.sessionId)))
        throw new Conflict("会话已绑定另一个设计", "This conversation is bound to another design.");
      const target = args.path ? fs.realpathSync(args.path) : this.managedDirectory(args.title || task.title);
      if (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length)
        throw localizedError("另存为需要一个空文件夹", "save as requires an empty folder");
      if (!relative(directory, target).startsWith("..") || !relative(target, directory).startsWith(".."))
        throw localizedError("任务目录无法安全迁移", "The design folder cannot be safely moved");
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
      return this.project(branch.id);
    }
    if (method === "attach") {
      const content = Buffer.from(args.data, "base64");
      if (
        content.length > 20 * 1024 * 1024 ||
        !content.subarray(0, 5).equals(Buffer.from("%PDF-"))
      )
        throw localizedError("请选择不超过 20 MB 的 PDF 文件", "Choose a PDF file no larger than 20 MB");
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
      return this.project(key);
    }
    if (method === "reference_file") {
      const entry = task.attachments?.find(
        (item) => item.id === args.attachmentId,
      );
      if (!entry) throw localizedError("参考文件不存在", "Reference file not found");
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
      if (!title) throw localizedError("请输入设计名称", "Enter a design name");
      const parent = dirname(root), target = availableDirectory(parent, args.directoryName || title, root);
      // Check the absolute source and destination before moving the workspace.
      const settingsRelative = relative(root, this.root);
      if (parent === root || dirname(target) !== parent || !settingsRelative ||
          (!settingsRelative.startsWith(`..${sep}`) && settingsRelative !== ".." && !isAbsolute(settingsRelative)))
        throw localizedError("任务目录无法安全迁移", "The design folder cannot be safely moved");
      task.title = title; task.updated = now();
      const known = this.registered();
      this.commit(new Map([[this.designFile(target), this.workspaceBytes(data)],
        [this.registry, jsonBytes({ version: 1, paths: known.map(path => path === root ? target : path) })]]),
        target === root ? [] : [{ from: root, to: target }]);
      return this.project(key);
    } else if (method === "bind") {
      if (
        (await this.dispatch("list")).some(
          (p) => p.id !== key && p.sessions.includes(args.sessionId),
        )
      )
        throw new Conflict("会话已绑定另一个设计", "This conversation is bound to another design.");
      if (!task.sessions.includes(args.sessionId)) task.sessions.push(args.sessionId);
      task.activeSessionId = args.sessionId;
    } else if (method === "select_session") {
      if (!task.sessions.includes(args.sessionId)) throw localizedError("会话不属于当前设计", "session does not belong to this design");
      task.activeSessionId = args.sessionId;
    } else if (method === "message") task.started ||= args.role === "user";
    else throw localizedError("不支持的操作", "Unsupported operation");
    task.updated = now();
    this.saveWorkspace(root, data);
    return method === "message"
      ? { saved: true }
      : this.project(key);
  }
}
