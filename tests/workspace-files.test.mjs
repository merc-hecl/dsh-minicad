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
  const changed=await worker.call("build",{projectId:branch.id,expectedRevision:1,parameters:{width:30}});
  near(changed.design.metrics.volume,1500);
  near((await worker.call("get",{projectId:task.id})).design.metrics.volume,1000);
  await worker.call("close_design",{projectId:task.id});
  assert.equal(await readFile(join(directory,"model.js"),"utf8"),box);
  const reopened=await worker.call("open_design",{path:directory});
  assert.equal(reopened.id,task.id); assert.equal(reopened.activeSessionId,"discussion-a");
  assert.equal((await worker.call("reference_file",{projectId:task.id,attachmentId:attached.attachments[0].id})).data,referencePdf);
  const exported=await worker.call("export",{projectId:task.id,revision:built.head,format:"step"});
  near(cad.fromStep(await readFile(exported.path,"utf8")).volume,1000);
}));

test("current STEP models preserve exact geometry and file scope with unsaved working files", { timeout: 90000 }, () => setup(async (worker, root) => {
  const directory = join(root, "revision handoff"); await mkdir(directory);
  const task = await worker.call("open_design", { path: directory });
  const target = { projectId: task.id, sourceFile: "models/plate.js" };
  await worker.call("build", { ...target, expectedRevision: 0, source: box, parameters: { width: 8 } });
  await worker.call("build", { ...target, expectedRevision: 1, parameters: { width: 16 } });
  await worker.call("build", { projectId: task.id, sourceFile: "other.js", expectedRevision: 0,
    source: box, parameters: { width: 24 } });
  await worker.call("select_model", { projectId: task.id, sourceFile: "other.js" });
  const dirtySource = 'throw new Error("unsaved source must not be used for a saved revision");';
  await writeFile(join(directory, target.sourceFile), dirtySource);
  const before = await worker.call("get", { projectId: task.id });
  for (const [sourceFile, volume] of [[target.sourceFile, 800], ["other.js", 1200]]) {
    const current = await worker.call("get", { projectId: task.id, sourceFile });
    const exported = await worker.call("export", { projectId: task.id, sourceFile, revision: current.head, format: "step" });
    assert.equal(exported.sourceFile, sourceFile);
    assert.equal(exported.revision, current.head);
    const shape = cad.fromStep(await readFile(exported.path, "utf8"));
    try { assert.ok(shape.isValid()); near(shape.volume, volume); }
    finally { shape.dispose(); }
  }
  const after = await worker.call("get", { projectId: task.id });
  assert.equal(after.sourceFile, before.sourceFile);
  assert.equal(after.head, before.head);
  assert.deepEqual(after.revisions, before.revisions);
  assert.equal(await readFile(join(directory, target.sourceFile), "utf8"), dirtySource);
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
          if (path.endsWith("model.parameters.json") && !failed) {
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
      const original = await readFile(join(task.directory, "model.js"));
      atomicWrite(
        store.journal,
        jsonBytes({
          phase: "prepared",
          files: [
            {
              path: join(task.directory, "model.js"),
              before: original.toString("base64"),
            },
          ],
        }),
      );
      await writeFile(join(task.directory, "model.js"), "interrupted write");
      worker = createWorker({ dataDir: temporary });
      const recovered = await worker.call("get", { projectId: task.id });
      assert.equal(recovered.head, 1);
      assert.equal(recovered.parameters.width, 20);
      assert.equal(
        await readFile(join(task.directory, "model.js"), "utf8"),
        box,
      );
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
