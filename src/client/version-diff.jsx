import React, { useEffect, useState } from "react";
import { Button, Menu, StateDot, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconCloseOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import { ErrorDetails } from "./workbench-dialog.jsx";

export function VersionDiff({ project, request, onResult, onClose, t, language }) {
  const versions = [...project.revisions].sort((a, b) => b.revision - a.revision);
  const [baseRevision, setBaseRevision] = useState(project.head);
  const [targetRevision, setTargetRevision] = useState(versions.find(item => item.revision === project.head)?.parent
    ?? versions.find(item => item.revision !== project.head)?.revision ?? project.head);
  const [menu, setMenu] = useState(null), [result, setResult] = useState(null), [error, setError] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setResult(null); setError(null); onResult(null);
    request("compare", { projectId: project.id, sourceFile: project.sourceFile, baseRevision, targetRevision }, controller.signal)
      .then(data => { if (!disposed) { setResult(data); onResult(data); } })
      .catch(error => { if (!disposed && error.name !== "AbortError") setError(error.message); });
    return () => { disposed = true; controller.abort(); onResult(null); };
  }, [project.id, project.sourceFile, baseRevision, targetRevision, request, onResult]);
  const number = new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US", { maximumSignificantDigits: 6 });
  const picker = side => {
    const value = side === "base" ? baseRevision : targetRevision;
    return <Menu className="mc-diff-version" portal open={menu === side} onClose={() => setMenu(null)} selectedIds={[String(value)]}
        anchor={<Button className="mc-diff-picker" variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={menu === side}
          aria-label={`${t(side === "base" ? "diffBase" : "diffTarget")} · v${value}`}
          onClick={() => setMenu(menu === side ? null : side)}>
          <span className="mc-diff-picker-label">{t(side === "base" ? "diffBase" : "diffTarget")}</span>
          <span className="mc-diff-picker-value">v{value}</span>
          <IconChevronDownOutlineRegular size={12} />
        </Button>}
        items={versions.map(item => ({ id: String(item.revision), label: `v${item.revision}${item.revision === project.head ? ` · ${t("current")}` : ""} · ${item.summary || t("savedVersion")}` }))}
        onSelect={id => { (side === "base" ? setBaseRevision : setTargetRevision)(Number(id)); setMenu(null); }} />;
  };
  return <section className="mc-version-diff mc-panel" aria-label={t("compareVersion")}>
    <div className="mc-diff-heading"><strong>{t("compareVersion")}</strong>
      <div className="mc-diff-versions">
        {picker("base")}<IconChevronRightOutlineRegular className="mc-diff-direction" size={14} />{picker("target")}
      </div>
      <Button className="mc-diff-close" variant="ghost" size="sm" icon={<IconCloseOutlineRegular size={16} />} aria-label={t("closeDiff")} onClick={onClose} />
    </div>
    <div className="mc-diff-legend" aria-live="polite">
      {result ? <>
        {["added", "removed", "unchanged"].map(kind => <span key={kind} data-diff-kind={kind}>
          <i aria-hidden="true" />{t(`diff.${kind}`)}<span>{number.format(result[kind]?.volume || 0)} mm³</span>
        </span>)}
      </> : !error && <span role="status"><StateDot state="ongoing" />{t("diffLoading")}</span>}
    </div>
    {error && <div className="mc-diff-error" role="alert"><span>{t("diffFailed")}</span><ErrorDetails detail={error} t={t} /></div>}
  </section>;
}
