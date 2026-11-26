import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Switch, SegmentedControl, StateDot, Toast, IconWarningOutlineRegular, IconCloseOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import { ErrorDetails } from "./workbench-dialog.jsx";
import { errorDetail, errorKey } from "../shared/errors.js";

function sliderTicks(min, max, integer) {
  const interval = Math.max(integer ? 1 : Number.MIN_VALUE, (max - min) / 10);
  const scale = 10 ** Math.floor(Math.log10(interval));
  const step = [1, 2, 5, 10].map(multiplier => multiplier * scale).find(value => value >= interval);
  if (!Number.isFinite(step)) return [min, max];
  const first = Math.ceil(min / step);
  const decimals = Math.min(100, Math.max(0, -Math.floor(Math.log10(step))));
  const interior = Array.from({ length: 11 }, (_, offset) => Number(((first + offset) * step).toFixed(decimals)))
    .filter(value => value > min && value < max);
  return [...new Set([min, ...interior, max])];
}

function sliderValue(value, min, max, integer) {
  const number = Number(value);
  if (integer || number === min || number === max) return value;
  const decimals = Math.max(0, Math.ceil(Math.log10(10000 / (max - min))));
  if (decimals > 15) return value;
  return String(Math.min(max, Math.max(min, Number(number.toFixed(decimals)))));
}

export function ParameterPanel({ project, language, disabled, request, previewKey, previewActive, onPreview, onApplied, onOperation, onClose, t }) {
  const panel = project.parameterPanel;
  const label = value => value[language === "zh" ? "zh" : "en"];
  const tickListPrefix = useId();
  const initial = useMemo(() => Object.fromEntries(panel.fields.map(field => [field.key, field.value])), [panel.fields]);
  const fieldRanges = useMemo(() => panel.fields.map(field => {
    const integer = field.type === "integer";
    const min = integer && field.min !== undefined ? Math.ceil(field.min) : field.min;
    const max = integer && field.max !== undefined ? Math.floor(field.max) : field.max;
    const ticks = Number.isFinite(min) && Number.isFinite(max) && min < max ? sliderTicks(min, max, integer) : null;
    return { integer, min, max, ticks };
  }), [panel.fields]);
  const [draft, setDraft] = useState(initial), [error, setError] = useState(null);
  const [autoPreview, setAutoPreview] = useState(false), [previewing, setPreviewing] = useState(false), [applying, setApplying] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState(null);
  const panelElement = useRef(null), inputElements = useRef(new Map());
  const submitting = useRef(false), dragPointer = useRef(null);
  const previewJob = useRef({ input: null, started: null, frame: null, controller: null });
  const locked = disabled || applying;
  const values = useMemo(() => Object.fromEntries(panel.fields.map(field => [field.key,
    field.type === "number" || field.type === "integer" ? draft[field.key] === "" ? null : Number(draft[field.key]) : draft[field.key],
  ])), [draft, panel.fields]);
  const previewInput = useMemo(() => ({ values, interactive: dragging }), [values, dragging]);
  const dirty = panel.fields.some(field => values[field.key] !== initial[field.key]);
  const invalidField = panel.fields.find(field => (field.type === "number" || field.type === "integer")
    && !(typeof values[field.key] === "number" && Number.isFinite(values[field.key])
      && (field.type !== "integer" || Number.isInteger(values[field.key]))
      && (field.min === undefined || values[field.key] >= field.min) && (field.max === undefined || values[field.key] <= field.max)));
  const { id: projectId, modelFile, head: expectedRevision } = project;
  const panelId = panel.id;
  useEffect(() => {
    const endDrag = event => {
      if (dragPointer.current === null || (event.type !== "blur" && event.pointerId !== dragPointer.current)) return;
      dragPointer.current = null;
      setDragging(false);
    };
    window.addEventListener("pointerup", endDrag, true);
    window.addEventListener("pointercancel", endDrag, true);
    window.addEventListener("blur", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag, true);
      window.removeEventListener("pointercancel", endDrag, true);
      window.removeEventListener("blur", endDrag);
    };
  }, []);
  const stopPreview = useCallback(() => {
    const job = previewJob.current;
    job.input = null;
    cancelAnimationFrame(job.frame);
    job.frame = null;
    job.controller?.abort();
    onPreview(null);
  }, [onPreview]);
  const schedulePreview = useCallback(function schedule() {
    const job = previewJob.current;
    if (job.frame !== null || job.controller || !job.input || job.input === job.started) return;
    job.frame = requestAnimationFrame(async () => {
      job.frame = null;
      const input = job.input;
      if (!input || input === job.started) return;
      const controller = new AbortController();
      job.controller = controller;
      job.started = input;
      setPreviewing(true);
      try {
        const design = await request("preview_panel", { projectId, modelFile, expectedRevision, panelId, ...input }, controller.signal);
        if (!controller.signal.aborted && job.input) onPreview({ key: previewKey, design });
      } catch (error) {
        if (!controller.signal.aborted && job.input === input) {
          onPreview(null);
          setError({ key: error.uiKey || errorKey(error.message), detail: errorDetail(error) });
        }
      } finally {
        job.controller = null;
        if (panelElement.current) {
          setPreviewing(false);
          schedule();
        }
      }
    });
  }, [request, projectId, modelFile, expectedRevision, panelId, previewKey, onPreview]);
  useLayoutEffect(() => stopPreview, [stopPreview]);
  useLayoutEffect(() => {
    if (!autoPreview || locked || !dirty) {
      stopPreview();
      return;
    }
    previewJob.current.input = invalidField ? null : previewInput;
    schedulePreview();
  }, [autoPreview, locked, dirty, invalidField, previewInput, schedulePreview, stopPreview]);
  const change = (key, value) => {
    setDraft(current => current[key] === value ? current : { ...current, [key]: value }); setError(null); setNotice(null);
  };
  const apply = async () => {
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
    previewJob.current.started = previewInput;
    stopPreview();
    submitting.current = true; setApplying(true); setError(null);
    onOperation({ phase: "working" });
    let saved = false;
    try {
      const result = await request("apply_panel", { projectId, modelFile, expectedRevision, panelId, values, language });
      saved = true;
      onOperation({ phase: "done", revision: result.head });
      await onApplied(project);
    } catch (error) {
      if (!saved) onOperation({ phase: "error", error: errorDetail(error) });
      setError({ key: error.uiKey || errorKey(error.message), detail: errorDetail(error) });
    } finally {
      submitting.current = false;
      setApplying(false);
    }
  };
  return <section ref={panelElement} id="mc-parameter-panel" className="mc-parameter-panel mc-panel" aria-label={t("parameterPanel")} aria-busy={applying}>
    <header className="mc-view-header">
      <strong>{label(panel.title)}</strong><span className="mc-parameter-version" aria-live="polite">v{project.head}{autoPreview && (previewActive ? ` · ${t("previewParameters")}` : previewing ? ` · ${t("previewingParameters")}` : "")}</span>
      <Button variant="ghost" size="sm" icon={<IconCloseOutlineRegular size={14} />} disabled={applying} aria-label={t("close")} onClick={onClose} />
    </header>
    <div className="mc-panel-scroll"><form noValidate onSubmit={event => { event.preventDefault(); apply(); }}>
      <fieldset disabled={locked}>
        {panel.fields.map((field, index) => {
          const id = `mc-parameter-${index}`, title = label(field.label);
          const tickListId = `${tickListPrefix}-ticks-${index}`;
          const group = field.group && label(field.group);
          const { integer, min, max, ticks } = fieldRanges[index];
          const inputStep = field.step ?? (integer ? 1 : "any");
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
                  : <div className="mc-parameter-number"><Input id={id} type="number" required min={min} max={max}
                    ref={element => { if (element) inputElements.current.set(field.key, element); else inputElements.current.delete(field.key); }}
                    aria-invalid={invalidField?.key === field.key || undefined}
                    step={inputStep} value={draft[field.key]} aria-label={title}
                    onChange={event => change(field.key, event.target.value)} />{field.unit && <span>{field.unit}</span>}</div>}
              {ticks && <>
                <input className="mc-view-slider mc-parameter-slider" type="range" min={min} max={max}
                  step={integer ? 1 : "any"} list={tickListId}
                  value={values[field.key] ?? field.value} aria-label={title}
                  onPointerDown={event => {
                    if (event.button !== 0 || !event.isPrimary) return;
                    dragPointer.current = event.pointerId;
                    setDragging(true);
                  }}
                  onChange={event => change(field.key, sliderValue(event.target.value, min, max, integer))} />
                <datalist id={tickListId}>{ticks.map(value => <option key={value} value={value} />)}</datalist>
              </>}
            </div>
          </React.Fragment>;
        })}
      </fieldset>
      <div className="mc-parameter-actions">
        <div className="mc-parameter-auto-preview">
          <Switch checked={autoPreview} disabled={locked} label={t("previewParameters")} onChange={enabled => {
            previewJob.current.started = null;
            setAutoPreview(enabled);
            setError(null);
          }} />
          <span>{t("previewParameters")}</span>
        </div>
        <Button type="button" variant="ghost" size="sm" disabled={locked || !dirty} onClick={() => { setDraft(initial); setError(null); setNotice(null); }}>{t("resetParameters")}</Button>
        <Button type="submit" variant="primary" size="sm" disabled={locked || !dirty}
          icon={applying ? <StateDot state="ongoing" /> : undefined}>{t(applying ? "applyingParameters" : "applyParameters")}</Button>
      </div>
    </form>
    {error && <div className="mc-geometry-error" role="alert"><p>{t(error.key)}</p><ErrorDetails detail={error.detail} t={t} /></div>}</div>
    {notice && <Toast key={notice.id} text={notice.text} icon={<IconWarningOutlineRegular />} anchor={panelElement.current} onDone={() => setNotice(null)} />}
  </section>;
}
