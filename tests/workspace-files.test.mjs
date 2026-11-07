import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import * as cad from "@classcad/smlibwasm";
import { createWorker } from "../src/host/worker.js";
import { Store } from "../src/kernel/store.js";
import { atomicWrite, jsonBytes } from "../src/kernel/files.js";
const referencePdf = (await readFile(new URL("./fixtures/reference.pdf", import.meta.url))).toString("base64");
const box = "function build(p, cad) { return cad.Box(p.width,10,5).named('底板'); }";
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-5, `${a} != ${b}`);
async function setup(fn) {
  const root = await mkdtemp(join(tmpdir(), "minicad-documents-")), settings = join(root, "settings");
  const worker = createWorker({ dataDir: settings });
  try { await fn(worker, root, settings); }
  finally { await worker.dispose(); assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));
    await rm(root, { recursive:true, force:true, maxRetries:3, retryDelay:200 }); }
}

test("empty folders initialize new designs regardless of previous registration", { timeout: 60000 }, () => setup(async (worker, root, settings) => {
  const existing = await worker.call("create", { title: "Existing" });
  const registryFile = join(settings, "designs.json");
  for (const mode of ["fresh", "registered", "cleared"]) {
    const directory = join(root, mode), metadataFile = join(directory, ".cad-design.json");
    await mkdir(directory);
    let previousId;
    if (mode === "registered") {
      const registry = JSON.parse(await readFile(registryFile, "utf8"));
      registry.paths.unshift(directory);
      await writeFile(registryFile, JSON.stringify(registry));
    } else if (mode === "cleared") {
      const previous = await worker.call("open_design", { path: directory });
      previousId = previous.id;
      await worker.call("bind", { projectId: previousId, sessionId: "previous-session" });
      await rm(metadataFile);
    }
    assert.deepEqual(await readdir(directory), []);
    const opened = await worker.call("open_design", { path: directory });
    assert.equal(opened.directory, directory);
    assert.equal(opened.head, 0);
    assert.deepEqual(opened.sessions, []);
    if (previousId) assert.notEqual(opened.id, previousId);
    assert.equal(JSON.parse(await readFile(metadataFile, "utf8")).id, opened.id);
    const sessionId = `session-${mode}`;
    await worker.call("bind", { projectId: opened.id, sessionId });
    const reopened = await worker.call("open_design", { path: directory });
    assert.equal(reopened.id, opened.id);
    assert.equal(reopened.activeSessionId, sessionId);
    assert.equal(JSON.parse(await readFile(registryFile, "utf8")).paths.filter(path => path === directory).length, 1);
    const built = await worker.call("edit", { projectId: opened.id, modelFile: "model.smp", expectedRevision: 0,
      operations: [{ op: "box", size: [10, 20, 3], name: "底板" }] });
    near(built.design.metrics.volume, 600);
    const shape = cad.fromSmp(await readFile(join(directory, "model.smp")));
    try { near(shape.volume, 600); assert.ok(shape.isValid()); }
    finally { shape.dispose(); }
  }
  assert.equal((await worker.call("get", { projectId: existing.id })).head, 0);
}));

test("unreadable registered designs do not block listing, accessing or creating valid designs", { timeout: 60000 }, () => setup(async (worker, root, settings) => {
  const first = await worker.call("create", { title: "First" });
  const second = await worker.call("create", { title: "Second" });
  await worker.call("bind", { projectId: first.id, sessionId: "healthy-session" });
  const invalid = [
    { name: "unsupported-format", content: JSON.stringify({ version: 1, id: "old-design", models: {}, sessions: [] }) },
    { name: "corrupt-json", content: "{broken" },
    { name: "missing-metadata", content: null },
  ];
  for (const item of invalid) {
    item.directory = join(root, item.name);
    await mkdir(item.directory);
    if (item.content !== null) await writeFile(join(item.directory, ".cad-design.json"), item.content);
  }
  const registered = [invalid[0].directory, first.directory, invalid[1].directory, second.directory, invalid[2].directory];
  const registryFile = join(settings, "designs.json");
  await writeFile(registryFile, JSON.stringify({ version: 1, paths: registered }));
  assert.deepEqual((await worker.call("list")).map(item => item.id), [first.id, second.id]);
  assert.equal((await worker.call("get", { projectId: second.id })).id, second.id);
  assert.equal((await worker.call("by_session", { sessionId: "healthy-session" })).id, first.id);
  assert.deepEqual(JSON.parse(await readFile(registryFile, "utf8")).paths, registered);

  const created = await worker.call("create", { title: "New" });
  const built = await worker.call("build", { projectId: created.id, expectedRevision: 0,
    source: box, parameters: { width: 12 } });
  near(built.design.metrics.volume, 600);
  assert.deepEqual((await worker.call("list")).map(item => item.id), [created.id, first.id, second.id]);
  assert.deepEqual(JSON.parse(await readFile(registryFile, "utf8")).paths, [created.directory, ...registered]);
  for (const item of invalid) {
    if (item.content !== null) assert.equal(await readFile(join(item.directory, ".cad-design.json"), "utf8"), item.content);
    else assert.deepEqual(await readdir(item.directory), []);
  }
}));

test("design folders own shared model history across conversations; save as is independent and reopening preserves bindings", {timeout:90000}, () => setup(async(worker, root) => {
  const directory=join(root,"plate"); await mkdir(directory);
  const task=await worker.call("open_design",{path:directory});
  assert.equal(task.directory,directory);
  await worker.call("bind",{projectId:task.id,sessionId:"discussion-a"});
  await worker.call("bind",{projectId:task.id,sessionId:"discussion-b"});
  const fromA=await worker.call("by_session",{sessionId:"discussion-a"});
  assert.deepEqual(fromA.sessions,["discussion-a","discussion-b"]);
  const built=await worker.call("build",{projectId:fromA.id,expectedRevision:0,source:box,parameters:{width:20}});
  const fromB=await worker.call("by_session",{sessionId:"discussion-b"});
  assert.equal(fromB.head,1); near(fromB.design.metrics.volume,1000);
  await assert.rejects(worker.call("build",{projectId:fromB.id,expectedRevision:0,parameters:{width:30}}),/更新/);
  await worker.call("select_session",{projectId:task.id,sessionId:"discussion-a"});
  const attached=await worker.call("attach",{projectId:task.id,name:"reference.pdf",data:referencePdf});
  await writeFile(join(directory,"notes.txt"),"shared design note");
  const copy=join(root,"variant"); await mkdir(copy);
  const branch=await worker.call("fork_project",{projectId:task.id,path:copy});
  assert.notEqual(branch.id,task.id); assert.deepEqual(branch.sessions,[]);
  assert.equal(branch.head,1); assert.equal(await readFile(join(copy,"notes.txt"),"utf8"),"shared design note");
  const changed=await worker.call("build",{projectId:branch.id,expectedRevision:1,source:box,parameters:{width:30}});
  near(changed.design.metrics.volume,1500);
  near((await worker.call("get",{projectId:task.id})).design.metrics.volume,1000);
  await worker.call("close_design",{projectId:task.id});
  near(cad.fromSmp(await readFile(join(directory,"model.smp"))).volume,1000);
  const reopened=await worker.call("open_design",{path:directory});
  assert.equal(reopened.id,task.id); assert.equal(reopened.activeSessionId,"discussion-a");
  assert.equal((await worker.call("reference_file",{projectId:task.id,attachmentId:attached.attachments[0].id})).data,referencePdf);
  const exported=await worker.call("export",{projectId:task.id,revision:built.head,format:"step"});
  near(cad.fromStep(await readFile(exported.path,"utf8")).volume,1000);
}));

test("current STEP models preserve exact geometry and file scope with unsaved working files", { timeout: 90000 }, () => setup(async (worker, root) => {
  const directory = join(root, "revision handoff"); await mkdir(directory);
  const task = await worker.call("open_design", { path: directory });
  const target = { projectId: task.id, modelFile: "models/plate.smp" };
  await worker.call("build", { ...target, expectedRevision: 0, source: box, parameters: { width: 8 } });
  await worker.call("build", { ...target, expectedRevision: 1, source: box, parameters: { width: 16 } });
  await worker.call("build", { projectId: task.id, modelFile: "other.smp", expectedRevision: 0,
    source: box, parameters: { width: 24 } });
  await worker.call("select_model", { projectId: task.id, modelFile: "other.smp" });
  const dirtySource = 'throw new Error("unsaved source must not be used for a saved revision");';
  await writeFile(join(directory, target.modelFile), dirtySource);
  const before = await worker.call("get", { projectId: task.id });
  for (const [modelFile, volume] of [[target.modelFile, 800], ["other.smp", 1200]]) {
    const current = await worker.call("get", { projectId: task.id, modelFile });
    const exported = await worker.call("export", { projectId: task.id, modelFile, revision: current.head, format: "step" });
    assert.equal(exported.modelFile, modelFile);
    assert.equal(exported.revision, current.head);
    const shape = cad.fromStep(await readFile(exported.path, "utf8"));
    try { assert.ok(shape.isValid()); near(shape.volume, volume); }
    finally { shape.dispose(); }
  }
  const after = await worker.call("get", { projectId: task.id });
  assert.equal(after.modelFile, before.modelFile);
  assert.equal(after.head, before.head);
  assert.deepEqual(after.revisions, before.revisions);
  assert.equal(await readFile(join(directory, target.modelFile), "utf8"), dirtySource);
}));

test("workspace rename preserves all sessions and geometry; metadata failures and interrupted moves roll back",{timeout:90000},()=>setup(async(worker,root,settings)=>{
  const task=await worker.call("create",{title:"original"});
  await worker.call("bind",{projectId:task.id,sessionId:"chat-a"}); await worker.call("bind",{projectId:task.id,sessionId:"chat-b"});
  await worker.call("build",{projectId:task.id,expectedRevision:0,source:box,parameters:{width:12}});
  const before=await readFile(join(task.directory,"model.smp"));
  const renamed=await worker.call("rename",{projectId:task.id,title:"plate-renamed"});
  assert.equal(renamed.title,"plate-renamed"); assert.ok(renamed.directory.endsWith("plate-renamed"));
  for(const sessionId of ["chat-a","chat-b"]) assert.equal((await worker.call("by_session",{sessionId})).directory,renamed.directory);
  assert.deepEqual(await readFile(join(renamed.directory,"model.smp")),before);
  await worker.dispose();
  let fail=true;
  const store=new Store(settings,{write:(file,bytes)=>{
    if(fail&&file.endsWith(".cad-design.json")){fail=false;throw new Error("injected rename metadata failure");}
    atomicWrite(file,bytes);
  }});
  await assert.rejects(store.dispatch("rename",{projectId:task.id,title:"failed-name"}),/injected/);
  assert.equal((await store.dispatch("get",{projectId:task.id})).directory,renamed.directory);
  const metaPath=join(renamed.directory,".cad-design.json"), original=await readFile(metaPath), target=join(root,"designs-moved");
  assert.ok(resolve(renamed.directory).startsWith(resolve(root)+sep)&&resolve(target).startsWith(resolve(root)+sep));
  atomicWrite(store.journal,jsonBytes({phase:"prepared",moves:[{from:renamed.directory,to:target}],files:[{path:join(target,".cad-design.json"),rollbackPath:metaPath,before:original.toString("base64")}]}));
  await rename(renamed.directory,target); await writeFile(join(target,".cad-design.json"),'{"broken":true}');
  const recovered=new Store(settings);
  const state=await recovered.dispatch("get",{projectId:task.id});
  assert.equal(state.title,"plate-renamed"); near(state.design.metrics.volume,600);
  assert.deepEqual(await readFile(join(state.directory,"model.smp")),before);
}));

test(
  "file publication rolls back partial writes and recovers an interrupted transaction",
  { timeout: 60000 },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), "minicad-atomic-"));
    let worker = createWorker({ dataDir: temporary });
    try {
      const task = await worker.call("create", {});
      await worker.call("build", {
        projectId: task.id,
        expectedRevision: 0,
        source: box,
        parameters: { width: 20 },
      });
      const before = await readFile(join(task.directory, "model.smp"));
      await worker.dispose();
      let failed = false;
      const store = new Store(temporary, {
        write: (path, bytes) => {
          if (path.endsWith("model.state.json") && !failed) {
            failed = true;
            throw new Error("injected write failure");
          }
          atomicWrite(path, bytes);
        },
      });
      await assert.rejects(
        store.dispatch("build", {
          projectId: task.id,
          expectedRevision: 1,
          source: box,
          parameters: { width: 30 },
        }),
        /injected/,
      );
      assert.equal(
        (await store.dispatch("get", { projectId: task.id })).head,
        1,
      );
      const original = await readFile(join(task.directory, "model.smp"));
      atomicWrite(
        store.journal,
        jsonBytes({
          phase: "prepared",
          moves: [],
          files: [
            {
              path: join(task.directory, "model.smp"),
              rollbackPath: join(task.directory, "model.smp"),
              before: original.toString("base64"),
            },
          ],
        }),
      );
      await writeFile(join(task.directory, "model.smp"), "interrupted write");
      worker = createWorker({ dataDir: temporary });
      const recovered = await worker.call("get", { projectId: task.id });
      assert.equal(recovered.head, 1);
      near(recovered.design.metrics.sizeX, 20);
      assert.deepEqual(
        await readFile(join(task.directory, "model.smp")),
        before,
      );
      assert.ok(!(await readdir(temporary)).includes("pending-files.json"));
    } finally {
      await worker.dispose();
      await rm(temporary, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 200,
      });
    }
  },
);
