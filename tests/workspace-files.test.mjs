import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createWorker } from "../src/host/worker.js";

const pythonProject = fileURLToPath(new URL("../python/", import.meta.url));
const runPython = (script, args) => promisify(execFile)("uv", ["run", "--project", pythonProject, "--frozen", "python", "-c", script, pythonProject, ...args], { windowsHide: true });
const box = 'from build123d import Box\ndef build(p):\n return Box(p["width"],10,5)\n';

test("library removal preserves project files; task forks copy independent models, history and resources", { timeout: 90000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), "minicad-library-"));
  const directory = join(temporary, "library");
  let worker = createWorker({ dataDir: join(temporary, "settings") });
  try {
    await mkdir(directory);
    const defaults = await worker.call("libraries");
    const library = await worker.call("create_library", { path: directory });
    const task = await worker.call("create", { libraryId: library.id, title: "plate" });
    await worker.call("bind", { projectId: task.id, sessionId: "source-session" });
    await worker.call("build", { projectId: task.id, expectedRevision: 0, source: box, parameters: { width: 20 } });
    const pdf = await worker.call("export", { projectId: task.id, revision: 1, format: "pdf" });
    const referenced = await worker.call("attach", { projectId: task.id, name: "reference.pdf", data: pdf.data });
    const referenceId = referenced.attachments[0].id;
    await writeFile(join(task.directory, "notes.txt"), "editable project note");
    const branch = await worker.call("fork_project", { projectId: task.id, sessionId: "fork-session", title: "plate (2)" });
    assert.notEqual(branch.id, task.id);
    assert.notEqual(branch.directory, task.directory);
    assert.equal(branch.head, 1);
    assert.equal(branch.revisions.length, 1);
    assert.equal(await readFile(join(branch.directory, "notes.txt"), "utf8"), "editable project note");
    assert.equal((await worker.call("reference_file", { projectId: branch.id, attachmentId: referenceId })).data, pdf.data);
    const edited = await worker.call("build", { projectId: branch.id, expectedRevision: 1, parameters: { width: 30 } });
    assert.equal(edited.head, 2);
    assert.ok(Math.abs(edited.design.metrics.volume - 1500) < 1e-6);
    const original = await worker.call("get", { projectId: task.id });
    assert.equal(original.head, 1);
    assert.equal(original.parameters.width, 20);
    assert.ok(Math.abs(original.design.metrics.volume - 1000) < 1e-6);
    await assert.rejects(worker.call("fork_project", { projectId: task.id, sessionId: "source-session" }), /已绑定/);
    await worker.call("remove_library", { libraryId: library.id });
    assert.ok(!(await worker.call("list")).some((row) => row.id === task.id || row.id === branch.id));
    assert.equal(await readFile(join(task.directory, "model.py"), "utf8"), box);
    assert.equal(await readFile(join(branch.directory, "notes.txt"), "utf8"), "editable project note");
    for (const other of defaults) await worker.call("remove_library", { libraryId: other.id });
    assert.deepEqual(await worker.call("libraries"), []);
    await worker.dispose();
    worker = createWorker({ dataDir: join(temporary, "settings") });
    assert.deepEqual(await worker.call("libraries"), []);
    await worker.call("create_library", { path: directory });
    assert.equal((await worker.call("by_session", { sessionId: "source-session" })).head, 1);
    assert.equal((await worker.call("by_session", { sessionId: "fork-session" })).head, 2);
    assert.ok((await worker.call("export", { projectId: branch.id, revision: 1, format: "step" })).data.length > 100);
  } finally {
    await worker.dispose();
    await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});

test("discarding abandoned tasks removes only empty, unused designs and survives restart", { timeout: 60000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), "minicad-empty-"));
  let worker = createWorker({ dataDir: temporary });
  try {
    const blank = await worker.call("create", { title: "abandoned draft" });
    await worker.call("bind", { projectId: blank.id, sessionId: "empty-session" });
    await worker.call("model_selection", { projectId: blank.id, selection: "provider\nmodel" });
    assert.equal((await worker.call("discard_empty", { projectId: blank.id })).discarded, true);
    await assert.rejects(readdir(blank.directory), { code: "ENOENT" });
    await assert.rejects(worker.call("by_session", { sessionId: "empty-session" }), /未绑定/);
    assert.equal((await worker.call("discard_empty", { projectId: blank.id })).discarded, false);

    const spoken = await worker.call("create", {});
    // A submitted user message counts even without plain text or a successful build.
    await worker.call("message", { projectId: spoken.id, role: "user", text: "" });
    assert.equal((await worker.call("discard_empty", { projectId: spoken.id })).discarded, false);
    const external = await worker.call("create", {});
    await writeFile(join(external.directory, "notes.txt"), "keep this resource");
    assert.equal((await worker.call("discard_empty", { projectId: external.id })).discarded, false);
    assert.equal(await readFile(join(external.directory, "notes.txt"), "utf8"), "keep this resource");

    const modeled = await worker.call("create", {});
    const built = await worker.call("build", { projectId: modeled.id, expectedRevision: 0, source: box, parameters: { width: 20 } });
    assert.equal((await worker.call("discard_empty", { projectId: modeled.id })).discarded, false);
    const pdf = await worker.call("export", { projectId: modeled.id, revision: built.head, format: "pdf" });
    const referenced = await worker.call("create", {});
    const attachment = await worker.call("attach", { projectId: referenced.id, name: "reference.pdf", data: pdf.data });
    assert.equal((await worker.call("discard_empty", { projectId: referenced.id })).discarded, false);
    assert.equal((await worker.call("reference_file", { projectId: referenced.id, attachmentId: attachment.attachments[0].id })).data, pdf.data);

    await worker.dispose();
    worker = createWorker({ dataDir: temporary });
    assert.deepEqual(new Set((await worker.call("list")).map((task) => task.id)), new Set([spoken.id, external.id, modeled.id, referenced.id]));
    assert.ok(Math.abs((await worker.call("get", { projectId: modeled.id })).design.metrics.volume - 1000) < 1e-6);
    await assert.rejects(readdir(blank.directory), { code: "ENOENT" });
  } finally {
    await worker.dispose();
    await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});

test("task folders: empty new designs, isolated files, editor changes, portable history and moves", { timeout: 90000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), "minicad-files-"));
  const catalog = join(temporary, "settings"), workspace = join(temporary, "parts"), copied = join(temporary, "copied");
  let worker = createWorker({ dataDir: catalog });
  try {
    await mkdir(workspace);
    const library = await worker.call("create_library", { path: workspace });
    assert.equal((await worker.call("create_library", { path: workspace + "/." })).id, library.id);
    const task = await worker.call("create", { libraryId: library.id, title: "底板" });
    await worker.call("bind", { projectId: task.id, sessionId: "plate-session" });
    const directory = task.directory;
    assert.equal(directory, join(workspace, "底板"));
    assert.deepEqual(await readdir(directory), []);
    const built = await worker.call("build", { projectId: task.id, expectedRevision: 0, source: box, parameters: { width: 20 } });
    assert.equal(await readFile(join(directory, "model.py"), "utf8"), box);
    assert.equal(JSON.parse(await readFile(join(directory, "model.parameters.json"), "utf8")).width, 20);
    const brep = await readFile(join(directory, "model.brep"));
    assert.ok(brep.length > 100);
    const second = await worker.call("create", { libraryId: library.id, title: "底板" });
    assert.equal(second.directory, join(workspace, "底板-2"));
    assert.equal(second.head, 0);
    assert.equal(second.design, null);
    assert.equal(second.source, "");
    assert.deepEqual(second.parameters, {});
    assert.deepEqual(second.revisions, []);
    assert.equal((await worker.call("list")).find((item) => item.id === second.id).has_messages, false);
    const independent = await worker.call("build", { projectId: second.id, expectedRevision: 0, source: box, parameters: { width: 7 } });
    assert.ok(Math.abs(independent.design.metrics.volume - 350) < 1e-6);
    assert.equal((await worker.call("get", { projectId: task.id })).head, built.head);
    assert.deepEqual(await readFile(join(directory, "model.brep")), brep);
    await assert.rejects(worker.call("build", { projectId: task.id, expectedRevision: 0, parameters: { width: 30 } }), /已更新/);
    const edited = 'from build123d import Box\r\ndef build(p):\r\n return Box(p["width"],12,5)\r\n';
    await writeFile(join(directory, "model.py"), edited);
    await writeFile(join(directory, "model.parameters.json"), JSON.stringify({ width: 30 }));
    const read = await worker.call("get", { projectId: task.id });
    assert.equal(read.source, edited);
    assert.equal(read.parameters.width, 30);
    assert.equal(read.workingTreeChanged, true);
    const rebuilt = await worker.call("build", { projectId: task.id, expectedRevision: 1 });
    assert.ok(Math.abs(rebuilt.design.metrics.volume - 1800) < 1e-6);
    assert.equal(await readFile(join(directory, ".cad-history", "model", "v0002", "model.py"), "utf8"), edited);
    assert.equal(JSON.parse(await readFile(join(directory, ".cad-history", "model", "v0002", "state.json"), "utf8")).source, edited);
    assert.equal((await worker.call("get", { projectId: task.id })).head, 2);
    await worker.call("select_model", { projectId: second.id, sourceFile: "parts/bracket.py" });
    const bracket = await worker.call("build", { projectId: second.id, expectedRevision: 0, source: box, parameters: { width: 8 } });
    assert.equal(bracket.head, 1);
    assert.equal((await worker.call("get", { projectId: task.id })).head, 2);
    assert.equal(await readFile(join(second.directory, "parts", "bracket.py"), "utf8"), box);
    await worker.call("select_model", { projectId: second.id, sourceFile: "model.py" });
    assert.ok(Math.abs((await worker.call("get", { projectId: second.id })).design.metrics.volume - 350) < 1e-6);
    const pdf = await worker.call("export", { projectId: task.id, revision: 2, format: "pdf" });
    const attached = await worker.call("attach", { projectId: task.id, name: "drawing.pdf", data: pdf.data });
    const referenceId = attached.attachments[0].id;
    await assert.rejects(worker.call("reference_file", { projectId: second.id, attachmentId: referenceId }), /参考文件不存在/);
    await assert.rejects(worker.call("select_model", { projectId: task.id, sourceFile: "../outside.py" }), /工作目录|Python 文件/);
    await worker.dispose();
    await cp(workspace, copied, { recursive: true });
    await rm(catalog, { recursive: true, force: true });
    worker = createWorker({ dataDir: join(temporary, "fresh-settings") });
    await worker.call("create_library", { path: copied });
    const portable = await worker.call("by_session", { sessionId: "plate-session" });
    const copiedTask = join(copied, basename(directory));
    assert.equal(portable.directory, copiedTask);
    assert.equal(portable.head, 2);
    assert.ok(Math.abs(portable.design.metrics.volume - 1800) < 1e-6);
    const restored = await worker.call("restore", { projectId: task.id, expectedRevision: 2, revision: 1 });
    assert.equal(restored.head, 3);
    assert.equal(JSON.parse(await readFile(join(copiedTask, "model.parameters.json"), "utf8")).width, 20);
    assert.ok((await worker.call("export", { projectId: task.id, revision: 3, format: "step" })).data.length > 100);
    assert.ok(!(await readdir(workspace)).includes(".minicad"));
    assert.ok(!(await readdir(copied)).includes(task.id));
    // A library move carries ordinary files, references and all model revisions together.
    const destinationPath = join(temporary, "another-workspace");
    await mkdir(destinationPath);
    const destination = await worker.call("create_library", { path: destinationPath });
    await writeFile(join(copiedTask, "notes.txt"), "part notes");
    await mkdir(join(destinationPath, basename(directory)));
    await worker.call("move_project", { projectId: task.id, libraryId: destination.id });
    const moved = await worker.call("by_session", { sessionId: "plate-session" });
    assert.equal(moved.directory, join(destinationPath, basename(directory) + "-2"));
    assert.equal(moved.head, 3);
    assert.equal(moved.revisions.length, 3);
    assert.equal(await readFile(join(moved.directory, "model.py"), "utf8"), box);
    assert.equal(await readFile(join(moved.directory, "notes.txt"), "utf8"), "part notes");
    await assert.rejects(readFile(join(copiedTask, "model.py")), { code: "ENOENT" });
    assert.equal((await worker.call("reference_file", { projectId: task.id, attachmentId: referenceId })).data, pdf.data);
    assert.ok((await worker.call("export", { projectId: task.id, revision: 2, format: "step" })).data.length > 100);
  } finally {
    await worker.dispose();
    await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});

test("file publication rolls back partial writes and recovers an interrupted transaction", { timeout: 60000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), "minicad-atomic-"));
  let worker = createWorker({ dataDir: temporary });
  try {
    const task = await worker.call("create", {});
    await worker.call("build", { projectId: task.id, expectedRevision: 0, source: box, parameters: { width: 20 } });
    const before = await readFile(join(task.directory, "model.brep"));
    await worker.dispose();
    const script = [
      "import base64,json,sys",
      "from pathlib import Path",
      "from unittest.mock import patch",
      "sys.path.insert(0, sys.argv[1])",
      "import worker as kernel",
      "store=kernel.Store(sys.argv[2])",
      "key=sys.argv[3]",
      "root=store.directory(key)",
      "write=kernel.atomic_write",
      "failed=False",
      "def fail_write(path, content):",
      "    global failed",
      '    if Path(path).name == "model.parameters.json" and not failed:',
      "        failed=True",
      '        raise OSError("injected write failure")',
      "    return write(path,content)",
      'with patch.object(kernel,"atomic_write",fail_write):',
      "    try:",
      '        store.dispatch("build",{"projectId":key,"expectedRevision":1,"source":"from build123d import Box\\ndef build(p):\\n return Box(5,6,7)","parameters":{"width":30}})',
      "    except OSError: pass",
      '    else: raise AssertionError("failure was not raised")',
      'assert store.row(key)["head"] == 1',
      'original=(root/"model.py").read_bytes()',
      'write(store.journal,kernel.json_bytes({"phase":"prepared","files":[{"path":str(root/"model.py"),"before":base64.b64encode(original).decode()}]}))',
      'write(root/"model.py",b"interrupted write")',
    ].join("\n");
    await runPython(script, [temporary, task.id]);
    worker = createWorker({ dataDir: temporary });
    const recovered = await worker.call("get", { projectId: task.id });
    assert.equal(recovered.head, 1);
    assert.equal(recovered.parameters.width, 20);
    assert.equal(await readFile(join(task.directory, "model.py"), "utf8"), box);
    assert.deepEqual(await readFile(join(task.directory, "model.brep")), before);
    assert.ok(!((await readdir(temporary)).includes("pending-files.json")));
  } finally {
    await worker.dispose();
    await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
