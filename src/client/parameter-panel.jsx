import React, { useRef, useState } from "react";
import { Button, Input, Switch, SegmentedControl, StateDot, Toast, IconWarningOutlineRegular, IconCloseOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import { ErrorDetails } from "./workbench-dialog.jsx";
import { errorDetail, errorKey } from "../shared/errors.js";

export function ParameterPanel({ project, language, disabled, request, onApplied, onOperation, onClose, t }) {
  const panel = project.parameterPanel;
  const label = value => value[language === "zh" ? "zh" : "en"];
  const initial = Object.fromEntries(panel.fields.map(field => [field.key, field.value]));
  const [draft, setDraft] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const panelElement = useRef(null), inputElements = useRef(new Map());
  const submitting = useRef(false);
  const locked = disabled || busy;
  const values = Object.fromEntries(panel.fields.map(field => [field.key,
    field.type === "number" || field.type === "integer" ? draft[field.key] === "" ? null : Number(draft[field.key]) : draft[field.key],
  ]));
  const dirty = panel.fields.some(field => values[field.key] !== initial[field.key]);
  // step controls the native spinner; it is not an allowed-value grid for modeling.
  const invalidField = panel.fields.find(field => (field.type === "number" || field.type === "integer")
    && !(typeof values[field.key] === "number" && Number.isFinite(values[field.key])
      && (field.type !== "integer" || Number.isInteger(values[field.key]))
      && (field.min === undefined || values[field.key] >= field.min) && (field.max === undefined || values[field.key] <= field.max)));
  const change = (key, value) => { setDraft(current => ({ ...current, [key]: value })); setError(null); setNotice(null); };
  const apply = async event => {
    event.preventDefault();
    if (locked || !dirty || submitting.current) return;
    if (invalidField) {
      const value = values[invalidField.key];
      const key = typeof value !== "number" || !Number.isFinite(value) ? "parameterNumberRequired"
        : invalidField.type === "integer" && !Number.isInteger(value) ? "parameterIntegerRequired"
          : value < invalidField.min ? "parameterMinimum" : "parameterMaximum";
      setNotice({ id: crypto.randomUUID(), text: t(key, { name: label(invalidField.label), min: invalidField.min, max: invalidField.max }) });
      inputElements.current.get(invalidField.key)?.focus();
      return;
    }
    submitting.current = true; setBusy(true); setError(null);
    onOperation({ phase: "working" });
    let saved = false;
    try {
      const result = await request("apply_panel", { projectId: project.id, modelFile: project.modelFile,
        expectedRevision: project.head, panelId: panel.id, values, language });
      saved = true;
      onOperation({ phase: "done", revision: result.head });
      await onApplied(project);
    } catch (error) {
      if (!saved) onOperation({ phase: "error", error: errorDetail(error) });
      setError({ key: errorKey(error.message), detail: errorDetail(error) });
    } finally { submitting.current = false; setBusy(false); }
  };
  return <section ref={panelElement} id="mc-parameter-panel" className="mc-parameter-panel mc-panel" aria-label={t("parameterPanel")} aria-busy={busy}>
    <header className="mc-view-header">
      <strong>{label(panel.title)}</strong><span className="mc-parameter-version">v{project.head}</span>
      <Button variant="ghost" size="sm" icon={<IconCloseOutlineRegular size={14} />} disabled={busy} aria-label={t("close")} onClick={onClose} />
    </header>
    <div className="mc-panel-scroll"><form noValidate onSubmit={apply}>
      <fieldset disabled={locked}>
        {panel.fields.map((field, index) => {
          const id = `mc-parameter-${index}`, title = label(field.label);
          const group = field.group && label(field.group);
          const previousGroup = panel.fields[index - 1]?.group;
          return <React.Fragment key={field.key}>
            {group && group !== (previousGroup && label(previousGroup)) && <strong className="mc-parameter-group">{group}</strong>}
            <div className="mc-parameter-row">
              <label htmlFor={field.type === "number" || field.type === "integer" ? id : undefined}>{title}</label>
              {field.type === "toggle" ? <Switch checked={draft[field.key]} onChange={value => change(field.key, value)} label={title} disabled={locked} />
                : field.type === "choice" ? <div className="mc-parameter-options"><SegmentedControl id={id} label={title} disabled={locked}
                  value={String(field.options.findIndex(option => option.value === draft[field.key]))}
                  options={field.options.map((option, i) => ({ value: String(i), label: label(option.label) }))}
                  onChange={value => change(field.key, field.options[Number(value)].value)} /></div>
                  : <div className="mc-parameter-number"><Input id={id} type="number" required min={field.min} max={field.max}
                    ref={element => { if (element) inputElements.current.set(field.key, element); else inputElements.current.delete(field.key); }}
                    aria-invalid={invalidField?.key === field.key || undefined}
                    step={field.step ?? (field.type === "integer" ? 1 : "any")} value={draft[field.key]} aria-label={title}
                    onChange={event => change(field.key, event.target.value)} />{field.unit && <span>{field.unit}</span>}</div>}
            </div>
          </React.Fragment>;
        })}
      </fieldset>
      <div className="mc-parameter-actions">
        <Button type="button" variant="ghost" size="sm" disabled={locked || !dirty} onClick={() => { setDraft(initial); setError(null); setNotice(null); }}>{t("resetParameters")}</Button>
        <Button type="submit" variant="primary" size="sm" disabled={locked || !dirty}
          icon={busy ? <StateDot state="ongoing" /> : undefined}>{t(busy ? "applyingParameters" : "applyParameters")}</Button>
      </div>
    </form>
    {error && <div className="mc-geometry-error" role="alert"><p>{t(error.key)}</p><ErrorDetails detail={error.detail} t={t} /></div>}</div>
    {notice && <Toast key={notice.id} text={notice.text} icon={<IconWarningOutlineRegular />} anchor={panelElement.current} onDone={() => setNotice(null)} />}
  </section>;
}
