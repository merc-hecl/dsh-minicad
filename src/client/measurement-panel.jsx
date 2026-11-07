import React, { useEffect, useState } from "react";
import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import { errorDetail, errorKey } from "../shared/errors.js";
import { GeometryPanel } from "./geometry-panel.jsx";

const number = value => value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const axes = ["x", "y", "z"];
const centerLabels = { circle: "circleCenter", sphere: "sphereCenter", cylinder: "axisMidpoint" };

function CoordinateRow({ label, point }) {
  return <><dt>{label} (mm)</dt><dd className="mc-measurement-coordinates">
    {axes.map((axis, i) => <span key={axis}>
      <span>{axis.toUpperCase()}</span><span>{number(point[i])}</span>
    </span>)}
  </dd></>;
}

function DistanceRow({ label, value, unit, approximate, title }) {
  return <><dt>{label}</dt><dd className="mc-measurement-distance" title={title}>
    <span>{approximate ? "≈" : ""}</span><span>{number(value)}</span><span>{unit}</span>
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
  return <GeometryPanel title={t(targets.length === 1 ? "geometryParameters" : "measureDistance")} onClose={onClose} t={t}
    error={current.error && { key: current.error.uiKey || errorKey(current.error.message), detail: errorDetail(current.error) }}>
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
        <DistanceRow label={t("minimumDistance")} value={minimum.value} unit={minimum.unit} approximate={minimum.approximate} title={accuracy(minimum)} />
        <DistanceRow label={t("maximumDistance")} value={maximum.value} unit={maximum.unit} approximate={maximum.approximate} title={accuracy(maximum)} />
        <div className="mc-measurement-divider" />
        {axes.map(axis => <DistanceRow key={axis} label={`${t("projectionDistance")} ${axis.toUpperCase()}`}
          value={minimum.projections[axis]} unit={minimum.unit} approximate={minimum.approximate} />)}
      </dl>}
    </div>
  </GeometryPanel>;
}
