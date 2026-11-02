import React, { useEffect, useState } from "react";
import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import { errorKey } from "./locale.js";
import { GeometryPanel } from "./geometry-panel.jsx";

const number = value => value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const unit = value => value === "mm2" ? "mm²" : "mm";

export function MeasurementPanel({ targets, onClose, project, request, onResult, t }) {
  const [state, setState] = useState({});
  const key = targets.map(target => target.reference).join("|");
  useEffect(() => {
    onResult(null);
    if (!targets.length || targets.length > 2) { setState({ key }); return; }
    const controller = new AbortController();
    setState({ key, loading: true });
    const [first, second] = targets;
    const measurements = second
      ? ["distance", "max_distance"].map(kind => ({ kind, from: first.reference, to: second.reference }))
      : [{ kind: first.kind === "edges" ? "length" : "area", entity: { kind: first.kind, selector: first.reference } }];
    request("measure", { projectId: project.id, sourceFile: project.sourceFile, expectedRevision: project.head, measurements }, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        setState({ key, items: result.items }); onResult(second ? result.items : null);
      }).catch(error => {
        if (!controller.signal.aborted) setState({ key, error });
      });
    return () => controller.abort();
  }, [key, project.id, project.sourceFile, project.head]);
  const current = state.key === key ? state : { loading: true };
  const [minimum, maximum] = current.items || [];
  const accuracy = item => item.approximate ? t("measurementAccuracy", { accuracy: item.accuracy }) : undefined;
  const value = item => `${item.approximate ? "≈ " : ""}${number(item.value)} ${unit(item.unit)}`;
  return <GeometryPanel title={t(targets.length === 1 ? "geometryParameters" : "measureDistance")} onClose={onClose} t={t}
    error={current.error && { key: current.error.uiKey || errorKey(current.error.message), detail: current.error.message }}>
    <div aria-live="polite" aria-busy={!!current.loading}>
      {current.loading && <span className="mc-loading"><StateDot state="ongoing" />{t("measuring")}</span>}
      {minimum && <dl className="mc-measurement-values">
        {maximum ? <>
          <dt>{t("minimumDistance")}</dt><dd title={accuracy(minimum)}>{value(minimum)}</dd>
          <dt>{t("maximumDistance")}</dt><dd title={accuracy(maximum)}>{value(maximum)}</dd>
          <div className="mc-measurement-divider" />
          {["x", "y", "z"].map(axis => <React.Fragment key={axis}><dt>{t("projectionDistance")} {axis.toUpperCase()}</dt><dd>{minimum.approximate ? "≈ " : ""}{number(minimum.projections[axis])} mm</dd></React.Fragment>)}
        </> : <><dt>{t(minimum.kind)}</dt><dd title={accuracy(minimum)}>{value(minimum)}</dd></>}
      </dl>}
    </div>
  </GeometryPanel>;
}
