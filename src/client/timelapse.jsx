import React, { useEffect, useRef, useState } from "react";
import {
  Button,
  StateDot,
  Tooltip,
  IconBranchOutlineRegular,
  IconCloseOutlineRegular,
  IconPauseOutlineRegular,
  IconPlayOutlineRegular,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { encodeGif } from "./gif.js";

const HOLD = 720;
const CAPTURE_WIDTH = 1280;
const GIF_WIDTH = 640;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function canvasElement() {
  return document.querySelector("#mc-view-model-panel > canvas");
}

function fileName(project, extension) {
  const base = String(project?.title || "minicad").replace(/[\\/:*?"<>|]+/g, "_").trim() || "minicad";
  return `${base}-timelapse.${extension}`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let low = 0, high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, middle)}…`).width <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return `${text.slice(0, low)}…`;
}

// Paint the live viewport plus the version title into a plain 2D canvas so the
// shared video or GIF does not depend on the app background.
function paintFrame(ctx, source, frame, width, height) {
  const dark = document.body.hasAttribute("data-ds-dark-theme");
  ctx.fillStyle = dark ? "#15181d" : "#f6f7f9";
  ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / source.width, height / source.height);
  const scaledWidth = source.width * scale, scaledHeight = source.height * scale;
  ctx.drawImage(source, (width - scaledWidth) / 2, (height - scaledHeight) / 2, scaledWidth, scaledHeight);
  if (!frame) return;
  const padding = Math.round(width * 0.03);
  const versionSize = Math.max(11, Math.round(width / 48));
  const summarySize = Math.max(16, Math.round(width / 24));
  const summary = frame.summary || "";
  ctx.textBaseline = "top";
  ctx.shadowColor = dark ? "rgba(0,0,0,.7)" : "rgba(255,255,255,.85)";
  ctx.shadowBlur = Math.round(width / 140);
  ctx.font = `600 ${versionSize}px "Segoe UI", system-ui, "Microsoft YaHei", sans-serif`;
  ctx.fillStyle = dark ? "#8fb8ff" : "#2456a6";
  ctx.fillText(`v${frame.revision}`, padding, padding);
  ctx.font = `600 ${summarySize}px "Segoe UI", system-ui, "Microsoft YaHei", sans-serif`;
  ctx.fillStyle = dark ? "#f2f5f9" : "#1b2027";
  ctx.fillText(fitText(ctx, summary, width - padding * 2), padding, padding + versionSize * 1.6);
  ctx.shadowBlur = 0;
}

export function Timelapse({ project, frames, index, onIndex, loading, error, onBack, onClose, t }) {
  const [playing, setPlaying] = useState(true);
  const [exporting, setExporting] = useState(null);
  const frameRef = useRef(null);
  frameRef.current = frames[index] || null;
  const canRecord = typeof MediaRecorder !== "undefined"
    && typeof HTMLCanvasElement !== "undefined" && Boolean(HTMLCanvasElement.prototype.captureStream);
  const busy = Boolean(exporting) || loading || !frames.length;

  useEffect(() => {
    if (!playing || exporting || frames.length < 2) return;
    if (index >= frames.length - 1) { setPlaying(false); return; }
    const timer = setTimeout(() => onIndex(index + 1), HOLD);
    return () => clearTimeout(timer);
  }, [playing, exporting, index, frames.length, onIndex]);

  const exportWebm = async () => {
    const source = canvasElement();
    if (!source || typeof MediaRecorder === "undefined" || !source.captureStream) return;
    setPlaying(false);
    setExporting("webm");
    try {
      const width = Math.min(CAPTURE_WIDTH, source.width);
      const height = Math.max(1, Math.round(source.height * width / source.width));
      const target = document.createElement("canvas");
      target.width = width;
      target.height = height;
      const ctx = target.getContext("2d");
      onIndex(0);
      await wait(240);
      paintFrame(ctx, source, frameRef.current, width, height);
      await nextPaint();
      const stream = target.captureStream(30);
      const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
        .find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 4000000 } : undefined);
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.start(250);
      let painting = true;
      const loop = () => {
        if (!painting) return;
        paintFrame(ctx, source, frameRef.current, width, height);
        requestAnimationFrame(loop);
      };
      loop();
      for (let position = 0; position < frames.length; position++) {
        onIndex(position);
        await wait(200);
        await wait(HOLD);
      }
      painting = false;
      await wait(150);
      recorder.stop();
      await stopped;
      download(new Blob(chunks, { type: "video/webm" }), fileName(project, "webm"));
    } finally {
      setExporting(null);
    }
  };

  const exportGif = async () => {
    const source = canvasElement();
    if (!source) return;
    setPlaying(false);
    setExporting("gif");
    try {
      const width = Math.min(GIF_WIDTH, source.width);
      const height = Math.max(1, Math.round(source.height * width / source.width));
      const target = document.createElement("canvas");
      target.width = width;
      target.height = height;
      const ctx = target.getContext("2d", { willReadFrequently: true });
      const pixels = [];
      for (let position = 0; position < frames.length; position++) {
        onIndex(position);
        await wait(240);
        paintFrame(ctx, source, frames[position], width, height);
        pixels.push(ctx.getImageData(0, 0, width, height).data);
      }
      const encoded = encodeGif(pixels, { width, height, delay: 70 });
      download(new Blob([encoded], { type: "image/gif" }), fileName(project, "gif"));
    } finally {
      setExporting(null);
    }
  };

  const frame = frames[index];
  const togglePlay = () => {
    if (!playing && index >= frames.length - 1) onIndex(0);
    setPlaying(value => !value);
  };
  return <section className="mc-timelapse mc-panel" aria-label={t("timelapse")}>
    <div className="mc-timelapse-head">
      <div className="mc-timelapse-title">
        <span className="mc-timelapse-version">{frame ? `v${frame.revision}` : "—"}</span>
        <span className="mc-timelapse-summary" title={frame?.summary}>{frame?.summary || t("savedVersion")}</span>
      </div>
      <Tooltip label={t("versionLibrary")} portal>
        <Button className="mc-timelapse-back" variant="ghost" size="sm" icon={<IconBranchOutlineRegular size={16} />}
          aria-label={t("versionLibrary")} disabled={Boolean(exporting)} onClick={onBack} />
      </Tooltip>
      <Button className="mc-timelapse-close" variant="ghost" size="sm" icon={<IconCloseOutlineRegular size={16} />}
        aria-label={t("close")} disabled={Boolean(exporting)} onClick={onClose} />
    </div>
    <div className="mc-timelapse-controls">
      <Button variant="ghost" size="sm" icon={playing ? <IconPauseOutlineRegular size={16} /> : <IconPlayOutlineRegular size={16} />}
        aria-label={t(playing ? "pause" : "play")} disabled={busy} onClick={togglePlay} />
      <input className="mc-timelapse-slider" type="range" min="0" max={Math.max(0, frames.length - 1)}
        value={Math.min(index, Math.max(0, frames.length - 1))} disabled={busy} aria-label={t("timelapsePosition")}
        onPointerDown={() => setPlaying(false)} onChange={event => onIndex(Number(event.target.value))} />
      <span className="mc-timelapse-count">{frames.length ? `${index + 1} / ${frames.length}` : "—"}</span>
      <span className="mc-timelapse-export">
        <Button variant="outline" size="sm" disabled={busy || !canRecord} onClick={exportWebm} aria-label={t("exportFile", { format: "WebM" })}>WebM</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={exportGif} aria-label={t("exportFile", { format: "GIF" })}>GIF</Button>
      </span>
    </div>
    {(loading || error) && <div className="mc-timelapse-status" role="status">
      {loading ? <><StateDot state="ongoing" />{t("loading")}</> : <span role="alert" title={error || undefined}>{t("previewUnavailable")}</span>}
    </div>}
  </section>;
}
