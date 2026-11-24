import {
  object as schema,
  text as string,
  revision as integer,
  modelFile,
  reference,
  edgeParameters,
  operationsSchema,
  measurementsSchema,
  checksSchema,
  toDshSchema,
  validate,
} from "../shared/cad-schema.js";
import { apiTopics } from "../kernel/api.js";
import { parameterPanelSchema } from "../shared/parameter-panel.js";
import { randomUUID } from "node:crypto";
import { modelingPrompt } from "./prompts.js";
export const inject = ["tools", "minicad", "systemPrompt"];
const parameters = { type: "object", additionalProperties: true };
const summary = { ...string, description: "A concise, meaningful title for this modeling change in the user's language. Visible for trials and saved changes. Describe the change, such as 'Create the plate outline and hole pattern'; keep full dimensions in source, parameters and checks. Avoid placeholder names such as probe, probe2, test or debug." };
const target = { modelFile, expectedRevision: integer };
const readTarget = { ...target, runId: string };
const buildOptions = { commit: { type: "boolean", default: true }, checks: checksSchema };
const idFormat = { ...string, description: "Exactly one numbering placeholder: {n}, or {n:1} to {n:9} for a minimum zero-padded width. Example: Face-{n:3} gives Face-001." };
const renderView = { type: "string", enum: ["isometric", "front", "top", "right"] };
const resultSchema = { type: "object", additionalProperties: true };
const textOutput = {
  schema: resultSchema,
  render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
};

export function apply(ctx) {
  const pendingPanels = new Map(), remindedPanels = new Set();
  ctx.on("agent/turn-stopping", ({ agent, signal }) => {
    if (signal.aborted) return;
    const pending = [...pendingPanels].filter(([file, head]) => !remindedPanels.has(`${file}:${head}`));
    if (!pending.length) return;
    pending.forEach(([file, head]) => remindedPanels.add(`${file}:${head}`));
    const text = `Pending parameter panels: ${JSON.stringify(pending)}. Call cad_publish_panel for these saved versions before finishing.`;
    agent.steer({ id: randomUUID(), role: "user", source: { kind: "minicad", form: "snapshot", sections: [{ name: "minicad", text }] },
      content: [{ type: "text", text }] });
  });
  ctx.systemPrompt.section({
    name: "minicad",
    order: 100,
    interpolate: false,
    text: modelingPrompt,
  });
  const register = (name, description, parameters, execute, output = textOutput) => {
    ctx.effect(
      () =>
        ctx.tools.register({
          name,
          description,
          parameters: toDshSchema(parameters),
          output,
          presentCall: () => ({
            card: "generic",
            title: name,
            kind: "other",
          }),
          execute: async (args, exec) => {
            try {
              validate(args, parameters, name);
              return await execute(
                await ctx.minicad.projectForSession(exec.agent.id),
                args,
                exec.signal,
                exec,
              );
            } catch (error) {
              const details = { phase: error.phase, code: error.code, operationIndex: error.operationIndex,
                operation: error.operation, runId: error.runId, diagnostics: error.diagnostics,
                validation: error.validation };
              const diagnostic = Object.values(details).some(value => value !== undefined)
                ? `\n${JSON.stringify(details)}` : "";
              if (error?.localized?.en !== undefined)
                error.message = `${error.localized.en}${diagnostic}`;
              else if (diagnostic)
                error.message += diagnostic;
              throw error;
            }
          },
        }),
      `minicad: ${name}`,
    );
  };
  register(
    "cad_read_project",
    "Read the saved SMP model metadata, revisions and model list without changing selection. Use cad_query and cad_measure to inspect exact geometry.",
    schema({ modelFile }, []),
    async (project, args, signal) => {
      const selected =
        args.modelFile === undefined
          ? project
          : await ctx.minicad.call(
              "get",
              {
                projectId: project.id,
                modelFile: args.modelFile,
              },
              signal,
            );
      return selected;
    },
  );
  const call = (method) => async (project, args, signal) => {
    const result = await ctx.minicad.call(
      method,
      {
        ...args,
        projectId: project.id,
        preserveSelection: true,
      },
      signal,
    );
    if (["build", "import", "edit", "commit", "set_geometry_id_format"].includes(method) && result.committed)
      pendingPanels.set(result.modelFile, result.head);
    if (method === "publish_panel" && pendingPanels.get(result.modelFile) === result.head)
      pendingPanels.delete(result.modelFile);
    if (method === "variants") for (const item of result.items) pendingPanels.set(item.modelFile, item.revision);
    if (!["build", "import", "edit", "commit"].includes(method) || !result.committed) return result;
    return { modelFile: result.modelFile, head: result.head, committed: true,
      metrics: result.design.metrics, validation: result.design.validation,
      ...(result.design.parts === undefined ? {} : { parts: result.design.parts }),
      diagnostics: result.diagnostics,
      note: "Only the listed checks are verified; valid geometry does not establish full drawing compliance." };
  };
  register(
    "cad_publish_panel",
    "Publish a parameter panel for modelFile at expectedRevision; fields:[] clears/omits the panel. Supply title and fields with unique key, type, label and initial value. Types: number, integer, choice (with options), toggle (boolean). Use zh/en titles and labels, including groups and options; keep user-provided parameter names unchanged and omit explanatory UI copy. Numeric fields may set min/max/step/unit; fields may set group. Measure initial values and justify ranges from geometry or requirements. Supply exactly one recipe: operations using {parameter:'key'} OR self-contained source defining build(parameters,cad). part scopes source to one assembly member. cad.current is the publication baseline; calculate absolute-control deltas from it. Defaults must preserve current geometry and pass checks. Include dimensional checks for adjusted dimensions and fixed requirements; preserve parts, names, colors and unrelated edits.",
    schema({ ...target, panel: parameterPanelSchema }, ["modelFile", "expectedRevision", "panel"]),
    call("publish_panel"),
  );
  register(
    "cad_build",
    "Evaluate an explicit plain JavaScript function build(parameters,cad) {...}, without import/export. Use cad.Location, cad.Box, etc.; SMLib names are not globals. cad.current is the saved exact model (null for a new model), or the selected assembly part when part is provided. Return the complete valid Part or assembly for that scope. Name a standalone solid with .named('Base plate'); create independent parts with cad.assembly([{id:'base',name:'Base',shape:base},...]) and use unique, nonempty, stable IDs. Assembly members use world coordinates and remain separate when touching. Apply Booleans to member shapes and reassemble with cad.assembly. Assembly.part(id) throws for unknown IDs; Assembly.translate moves every member and Assembly.rotate takes an angle in degrees. cad.edit applies structured operations to an exact model using only the parameters passed to that call. cad.checkpoint(part,label) records intermediate solids. Source, parameters and inputs are archived with this execution and are not replayed by later edits. Declare additional filesystem inputs in inputs; cad.readModel reads and archives exact resources. commit:false evaluates without publishing.",
    schema({ ...target, ...buildOptions, source: string, parameters, part: string, inputs: { type: "array", items: string }, summary }, [
      "modelFile",
      "expectedRevision",
      "source",
      "summary",
    ]),
    call("build"),
  );
  register(
    "cad_query",
    "Query parts, faces, edges, solids, bores or vertex coordinates without mutation. Parts/solids include color; faces include explicit color and inherited effectiveColor (#RRGGBB or null). Parts is empty for a standalone Part; copy_part can convert it to an assembly. Circular edges, spherical faces and cylindrical faces include geometricCenter; edges include endpoints and optional arc-length samples. Supports candidate runId.",
    schema(
      {
        ...readTarget,
        kind: { type: "string", enum: ["faces", "edges", "solids", "holes", "vertices", "parts"] },
        selector: reference,
        edgeParameters: { ...edgeParameters, description: "For kind:edges only. Fractions of arc length in [0,1]: 0=start, 1=end, 0.5=halfway; not raw curve parameters." },
      },
      ["modelFile", "expectedRevision", "kind"],
    ),
    call("query"),
  );
  register(
    "cad_set_geometry_id_format",
    "Change the saved model's face and/or edge display numbering and commit a new revision with the same geometry. Supply at least one format. Omitted formats are kept; an identical format does not create a revision.",
    schema({ ...target, faceFormat: idFormat, edgeFormat: idFormat, summary },
      ["modelFile", "expectedRevision", "summary"]),
    call("set_geometry_id_format"),
  );
  register(
    "cad_edit",
    "Apply one ordered operation batch to the saved exact model or create a new model. Combine solids, booleans, closed wire profiles, holes, face edits, transforms, patterns, naming and colors. Set name when creating a final solid or include rename before publishing. Use part for a stable assembly member ID. add_part, copy_part and remove_part manage independent components; when copying a standalone Part, part assigns its first ID and center translates only the copy. Parameters resolve this batch only; existing geometry is never rebuilt from source. commit:false evaluates without publishing.",
    schema(
      { ...target, ...buildOptions, operations: operationsSchema, parameters, summary },
      ["modelFile", "expectedRevision", "operations", "summary"],
    ),
    call("edit"),
  );
  register(
    "cad_commit",
    "Publish an evaluated candidate as one revision; retain the saved model on failure.",
    schema({ ...target, runId: string, checks: checksSchema, summary }, ["modelFile", "expectedRevision", "runId", "summary"]),
    call("commit"),
  );
  register(
    "cad_measure",
    "Use the workbench kernel to measure minimum/maximum distances, XYZ projections, angles, local thickness and dimensions without mutation. Each from/to/entity selector must resolve to exactly one shape. For whole-part distances use kind:solids and selector:{part:'id',one:true}, not a selection of all faces.",
    schema({ ...readTarget, measurements: measurementsSchema }, ["modelFile", "expectedRevision", "measurements"]),
    call("measure"),
  );
  register(
    "cad_check",
    "Check measured dimensions against targets and tolerances or bounds.",
    schema({ ...readTarget, checks: checksSchema }, ["modelFile", "expectedRevision", "checks"]),
    call("check"),
  );
  register(
    "cad_render",
    "Take separate PNGs of an exact model for visual inspection. Use views for several distinct views in the desired order, or view for one. If omitted, take one isometric view. Requires an image-capable model route and the design open in the MiniCAD workbench. Use modelFile and expectedRevision from cad_read_project. For an unpublished candidate, add its runId and use its base revision as expectedRevision. Use cad_query, cad_measure and cad_check for exact verification.",
    schema({ ...readTarget, view: renderView, views: { type: "array", items: renderView, minItems: 1, maxItems: renderView.enum.length } }, ["modelFile", "expectedRevision"]),
    async (project, { view, views, ...target }, signal, { agent }) => {
      if (view !== undefined && views !== undefined)
        throw new Error("Specify view or views for a model photo.");
      const requestedViews = views ?? [view ?? "isometric"];
      if (new Set(requestedViews).size !== requestedViews.length)
        throw new Error("Each requested view must be distinct.");
      const attachments = ctx.get("attachments");
      const llm = ctx.get("llm");
      const route = agent.session.requestHeader()?.config;
      const provider = route?.provider ?? agent.options.provider;
      const model = route?.model ?? agent.options.model;
      if (!attachments || !llm || !provider || !model)
        throw new Error("Taking a model photo requires a DSH attachment service and an active model route.");
      const { inputModalities = [] } = await llm.resolveModelInfo(provider, model, signal);
      if (!inputModalities.includes("image"))
        throw new Error(`Model "${model}" does not declare image input. Use an image-capable model to inspect photos.`);
      const limits = attachments.imageLimits;
      if (requestedViews.length > limits.maxImagesPerMessage)
        throw new Error(`DSH allows up to ${limits.maxImagesPerMessage} images per result. Request fewer views.`);
      const { photos, ...modelVersion } = await ctx.minicad.render(project.id, { ...target, views: requestedViews }, limits, signal);
      signal?.throwIfAborted();
      const stem = `${modelVersion.modelFile.split("/").at(-1).slice(0, -4)}-${modelVersion.revision}`;
      const refs = await attachments.saveImages(photos.map(({ view, data }) => ({
        data, mediaType: "image/png", name: `${stem}-${view}.png`,
      })));
      const images = photos.map(({ view }, index) => ({ view, attachment: refs[index] }));
      return images.length === 1 ? { ...modelVersion, ...images[0] } : { ...modelVersion, images };
    },
    {
      schema: resultSchema,
      render: (_args, { attachment, images, ...modelVersion }) => [
        { type: "text", text: JSON.stringify(modelVersion) },
        ...(images ? images.flatMap(({ view, attachment }) => [
          { type: "text", text: `View: ${view}` },
          { type: "image", attachment },
        ]) : [{ type: "image", attachment }]),
      ],
    },
  );
  register(
    "cad_inspect_sheet_metal",
    "Unfold one exact sheet metal solid read-only. Returns flat blank length, width, thickness and internal cutout count, plus each bend's angle, inside radius, length, K-factor, allowance, direction and bend line in flat XY coordinates. Dimensions use mm and angles use degrees. Supply the member ID for an assembly. Supports candidate runId; omit kFactor to use the model's bend data or the installed SMLib default.",
    schema({
      ...readTarget,
      part: { ...string, description: "Assembly member ID from cad_query with kind:parts." },
      kFactor: { type: "number", minimum: 0, maximum: 1, description: "Optional common K-factor for computing the flat pattern." },
    }, ["modelFile", "expectedRevision"]),
    call("inspect_sheet_metal"),
  );
  register(
    "cad_api",
    "Read installed SMLib JavaScript API declarations. Use topic:minicad for MiniCAD's build context and helpers: assembly, Assembly.part, current, edit, checkpoint, readModel and log. These helpers are not SMLib parts/operations exports.",
    schema(
      {
        topic: {
          type: "string",
          enum: apiTopics,
        },
        symbol: string,
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: 12000 },
      },
      ["topic"],
    ),
    (_project, args, signal) => ctx.minicad.call("api", args, signal),
  );
  register(
    "cad_import",
    "Import an exact SMP, SMB or STEP file into a model snapshot. Existing geometry is replaced only in the explicitly targeted model. Does not require source. Names must be present before publishing; use cad_build for custom naming or assembly preparation.",
    schema({ ...target, ...buildOptions, file: string, metadataFile: string, summary }, ["modelFile", "expectedRevision", "file", "summary"]),
    call("import"),
  );
  register(
    "cad_export",
    "Export a saved revision of a specified model.",
    schema({
      modelFile,
      part: string,
      revision: { type: "integer", minimum: 1 },
      format: {
        type: "string",
        enum: ["step", "stl", "smp", "smb", "zip"],
      },
    }, ["modelFile", "revision", "format"]),
    async (project, args, signal) => {
      const { name, revision, path, modelFile } = await ctx.minicad.call(
        "export",
        { ...args, projectId: project.id },
        signal,
      );
      return {
        name,
        revision,
        path,
        modelFile,
        downloadUrl: `/api/minicad/download?${new URLSearchParams({ projectId: project.id, modelFile, revision, format: args.format, ...(args.part ? { part: args.part } : {}) })}`,
        note: "File saved. Report the returned filename and path as plain text or inline code, and use the native directory button at the top right of the workbench to find it. Include file or download links only when explicitly requested by the user.",
      };
    },
  );
  register(
    "cad_fit",
    "Measure clearance and interference between named assembly parts. Reports minimum distance (mm), overlap volume (mm3), and contact/separated/interference. Does not modify geometry.",
    schema({ ...target, pairs: { type: "array", minItems: 1, maxItems: 100,
      items: schema({ from: string, to: string }) }, tolerance: { type: "number", minimum: 0 } },
      ["modelFile", "expectedRevision", "pairs"]), call("fit"),
  );
  register(
    "cad_variants",
    "Create 1–20 independent SMP models by copying the saved exact model and applying each variant's explicit operations. Keeps the original unchanged. Each output must be a new .smp path. Checks apply only to that variant. All variants are evaluated first; commits/exports are individually durable.",
    schema({ ...target, variants: { type: "array", minItems: 1, maxItems: 20,
      items: schema({ modelFile, name: string, operations: operationsSchema, parameters, checks: checksSchema }, ["modelFile", "operations"]) },
      formats: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", enum: ["step", "stl", "smp", "zip"] } } },
      ["modelFile", "expectedRevision", "variants"]), call("variants"),
  );
  register(
    "cad_restore",
    "Make an existing revision current without creating a revision. The next edit branches from the selected revision.",
    schema({ ...target, revision: { type: "integer", minimum: 1 } }),
    call("restore"),
  );
}
