import { object, text, operationsSchema, checksSchema, validate } from "./cad-schema.js";
import { localizedError } from "./errors.js";

const label = object({ zh: text, en: text });
const keyLabel = { key: text, label, group: label };
const numeric = type => object({ ...keyLabel, type: { const: type }, value: { type },
  min: { type: "number" }, max: { type: "number" }, step: { type: "number", exclusiveMinimum: 0 }, unit: text }, ["key", "label", "type", "value"]);
const choice = { anyOf: [{ type: "string" }, { type: "number" }] };
export const parameterPanelSchema = object({
  title: label,
  fields: { type: "array", minItems: 0, items: { anyOf: [
    numeric("number"), numeric("integer"),
    object({ ...keyLabel, type: { const: "toggle" }, value: { type: "boolean" } }, ["key", "label", "type", "value"]),
    object({ ...keyLabel, type: { const: "choice" }, value: choice,
      options: { type: "array", minItems: 2, maxItems: 8, items: object({ value: choice, label }) } }, ["key", "label", "type", "value", "options"]),
  ] } },
  operations: operationsSchema,
  source: { ...text, description: "Self-contained build(parameters,cad) function; cad.current is the pinned baseline." },
  part: { ...text, description: "For source only: stable assembly part ID. For operations, put part on each operation." },
  checks: checksSchema,
}, ["title", "fields"]);

export function panelValues(panel, values) {
  validate(values, object(Object.fromEntries(panel.fields.map(field => [field.key,
    field.type === "choice" ? { enum: field.options.map(option => option.value) }
      : field.type === "toggle" ? { type: "boolean" }
        : { type: field.type, minimum: field.min, maximum: field.max },
  ]))), "values");
  return { ...values };
}

export function definePanel(panel) {
  validate(panel, parameterPanelSchema, "panel");
  if (!panel.fields.length) return null;
  if (new Set(panel.fields.map(field => field.key)).size !== panel.fields.length)
    throw localizedError("调整项名称重复", "Duplicate adjustment keys");
  if (Boolean(panel.operations) === Boolean(panel.source) || !panel.checks?.length)
    throw localizedError("参数面板需要一种执行方式和尺寸检查", "A parameter panel needs exactly one execution recipe and dimensional checks");
  for (const field of panel.fields) {
    if (field.type === "choice" && new Set(field.options.map(option => option.value)).size !== field.options.length)
      throw localizedError("调整选项重复", "Duplicate adjustment options");
  }
  return { ...panel, values: panelValues(panel, Object.fromEntries(panel.fields.map(field => [field.key, field.value]))) };
}

// Only controls and their current values cross the browser boundary. Recipes stay in the kernel service.
export function panelView(panel, revision) {
  return panel ? { id: panel.id, revision, title: panel.title,
    fields: panel.fields.map(field => ({ ...field, value: panel.values[field.key] })) } : null;
}

export function panelChanges(panel, before, after) {
  return panel.fields.filter(field => before[field.key] !== after[field.key]).map(field => ({
    key: field.key, label: field.label, from: before[field.key], to: after[field.key],
    ...(field.unit ? { unit: field.unit } : {}),
    ...(field.options?.find(option => option.value === before[field.key]) ? { fromLabel: field.options.find(option => option.value === before[field.key]).label } : {}),
    ...(field.options?.find(option => option.value === after[field.key]) ? { toLabel: field.options.find(option => option.value === after[field.key]).label } : {}),
  }));
}

export function panelChangeSummary(changes, language) {
  const lang = language === "zh" ? "zh" : "en";
  const value = (raw, label, unit) => label ? label[lang]
    : typeof raw === "boolean" ? (lang === "zh" ? raw ? "开" : "关" : raw ? "On" : "Off")
      : `${raw}${unit ? ` ${unit}` : ""}`;
  return changes.map(change => `${change.label[lang]}: ${value(change.from, change.fromLabel, change.unit)} → ${value(change.to, change.toLabel, change.unit)}`)
    .join(lang === "zh" ? "；" : "; ");
}
