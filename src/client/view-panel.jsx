import React from "react";
import { Button, IconCloseOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";

const axes = ["x", "y", "z"];

export function ViewPanel({ section, explode, explodeAxis, explodeAvailable, extent, onSection, onExplode, onExplodeAxis, onClose, t }) {
  const axis = section.axis;
  const index = axis ? axes.indexOf(axis) : -1;
  const coordinate = index >= 0 && extent
    ? extent.min[index] + (extent.max[index] - extent.min[index]) * section.position
    : null;
  return <section id="mc-view-panel" className="mc-view-panel mc-panel" aria-label={t("sectionView")}>
    <header className="mc-view-header">
      <strong>{t("sectionView")}</strong>
      <Button variant="ghost" size="sm" icon={<IconCloseOutlineRegular size={14} />} aria-label={t("close")} onClick={onClose} />
    </header>
    <div className="mc-view-row">
      <span className="mc-view-label">{t("sectionAxis")}</span>
      <div className="mc-view-axes" role="group" aria-label={t("sectionAxis")}>
        {axes.map(key => <Button key={key} type="button" variant="ghost" size="sm" aria-pressed={axis === key}
          aria-label={`${t("sectionAxis")} ${key.toUpperCase()}`}
          onClick={() => onSection({ axis: axis === key ? null : key })}>{key.toUpperCase()}</Button>)}
      </div>
      <Button type="button" variant="ghost" size="sm" aria-pressed={section.flip} disabled={!axis}
        onClick={() => onSection({ flip: !section.flip })}>{t("flipSection")}</Button>
    </div>
    <div className="mc-view-slider-row">
      <input className="mc-view-slider" type="range" min="0" max="1000" step="1"
        value={Math.round(section.position * 1000)} disabled={!axis} aria-label={t("sectionPosition")}
        onChange={event => onSection({ position: Number(event.target.value) / 1000 })} />
      <span className="mc-view-readout">{coordinate === null ? "—" : `${axis.toUpperCase()} ${coordinate.toFixed(1)} mm`}</span>
    </div>
    {explodeAvailable && <>
      <div className="mc-view-row">
        <span className="mc-view-label">{t("explodeView")}</span>
        <span className="mc-view-readout">{Math.round(explode * 100)}%</span>
      </div>
      <div className="mc-view-modes" role="group" aria-label={t("explodeView")}>
        <Button type="button" variant="ghost" size="sm" aria-pressed={explodeAxis === "radial"}
          onClick={() => onExplodeAxis("radial")}>{t("explodeRadial")}</Button>
        {axes.map(key => <Button key={key} type="button" variant="ghost" size="sm" aria-pressed={explodeAxis === key}
          aria-label={`${t("explodeView")} ${key.toUpperCase()}`}
          onClick={() => onExplodeAxis(key)}>{key.toUpperCase()}</Button>)}
      </div>
      <input className="mc-view-slider" type="range" min="0" max="100" step="1" value={Math.round(explode * 100)}
        aria-label={t("explodeView")} onChange={event => onExplode(Number(event.target.value) / 100)} />
    </>}
  </section>;
}
