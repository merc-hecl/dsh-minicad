import React, { useEffect, useState } from "react";
import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import { errorKey } from "./locale.js";
import { GeometryPanel } from "./geometry-panel.jsx";

const number = value => value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const axes = ["x", "y", "z"];
const centerLabels = { circle: "circleCenter", sphere: "sphereCenter", cylinder: "axisMidpoint" };

function CoordinateRow({ label, point }) {
  return <><dt>{label} (mm)</dt><dd className="mc-measurement-coordinates">
    {axes.map((axis, i) => <span key={axis}>{axis.toUpperCase()} {number(point[i])}</span>)}
  </dd></>;
}

export function MeasurementPanel({ targets, onClose, project, request, onResult, t }) {
  const [state, setState] = useState({});
  const key = targets.map(target => target.reference).join("|");
  useEffect(() => {
    onResult(null);
    if (!targets.length || targets.length > 2) { setState({ key }); return; }
    const controller = new AbortController();
    const measurementId = crypto.randomUUID();
    let settled = false;
    setState({ key, loading: true });
    const [first, second] = targets;
    const target = { projectId: project.id, sourceFile: project.sourceFile, expectedRevision: project.head, measurementId };
    const pending = second
      ? request("measure", { ...target, measurements: ["distance", "max_distance"].map(kind => ({ kind, from: first.reference, to: second.reference })) }, controller.signal)
      : request("query", { ...target, kind: first.kind, selector: first.reference }, controller.signal);
    pending.then(({ items }) => {
      if (controller.signal.aborted) return;
      if (second) {
        setState({ key, items });
        onResult(items);
      } else setState({ key, geometry: items[0] });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ key, error });
    }).finally(() => { settled = true; });
    return () => {
      controller.abort();
      if (!settled) void request("cancel_measurement", { measurementId }).catch(() => {});
    };
  }, [key, project.id, project.sourceFile, project.head]);
  const current = state.key === key ? state : { loading: true };
  const { geometry } = current;
  const [minimum, maximum] = current.items || [];
  const accuracy = item => item.approximate ? t("measurementAccuracy", { accuracy: item.accuracy }) : undefined;
  const value = item => `${item.approximate ? "≈ " : ""}${number(item.value)} ${item.unit}`;
  return <GeometryPanel title={t(targets.length === 1 ? "geometryParameters" : "measureDistance")} onClose={onClose} t={t}
    error={current.error && { key: current.error.uiKey || errorKey(current.error.message), detail: current.error.message }}>
    <div aria-live="polite" aria-busy={!!current.loading}>
      {current.loading && <span className="mc-loading"><StateDot state="ongoing" />{t("measuring")}</span>}
      {geometry && <dl className="mc-measurement-values mc-measurement-properties">
        {geometry.area !== undefined ? <>
          <dt>{t("area")}</dt><dd>{number(geometry.area)} mm²</dd>
          <CoordinateRow label={t("areaCentroid")} point={geometry.center} />
        </> : <>
          <dt>{t("length")}</dt><dd>{number(geometry.length)} mm</dd>
          <CoordinateRow label={t("edgeStart")} point={geometry.start} />
          <CoordinateRow label={t("edgeEnd")} point={geometry.end} />
        </>}
        {geometry.geometricCenter && <>
          <CoordinateRow label={t(centerLabels[geometry.type])} point={geometry.geometricCenter} />
          <dt>{t("radius")}</dt><dd>{number(geometry.radius)} mm</dd>
        </>}
      </dl>}
      {minimum && maximum && <dl className="mc-measurement-values">
        <dt>{t("minimumDistance")}</dt><dd title={accuracy(minimum)}>{value(minimum)}</dd>
        <dt>{t("maximumDistance")}</dt><dd title={accuracy(maximum)}>{value(maximum)}</dd>
        <div className="mc-measurement-divider" />
        {axes.map(axis => <React.Fragment key={axis}><dt>{t("projectionDistance")} {axis.toUpperCase()}</dt><dd>{minimum.approximate ? "≈ " : ""}{number(minimum.projections[axis])} mm</dd></React.Fragment>)}
      </dl>}
    </div>
  </GeometryPanel>;
}
