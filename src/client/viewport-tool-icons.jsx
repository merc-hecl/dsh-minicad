import React from "react";
import { ICON_REGULAR_STROKE } from "@deepseek-ai/dsh-client-ui-primitives";

function ViewportIcon({ size = 16, children, ...props }) {
  return <svg width={size} height={size} viewBox="1 1 22 22" fill="none" stroke="currentColor" strokeWidth={ICON_REGULAR_STROKE * 22 / 16} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>;
}

export function SolidViewIcon(props) {
  return <ViewportIcon {...props}>
    <path d="m12 2.5 9 5v9l-9 5-9-5v-9Z" />
    <path d="m3 7.5 9 5 9-5M12 12.5v9" />
    <path d="m12 12.5 9-5v9l-9 5Z" fill="currentColor" fillOpacity=".24" stroke="none" />
    <path d="m3 7.5 9 5v9l-9-5Z" fill="currentColor" fillOpacity=".1" stroke="none" />
  </ViewportIcon>;
}

export function WireframeViewIcon(props) {
  return <ViewportIcon {...props}>
    <path d="m12 2.5 9 5v9l-9 5-9-5v-9ZM3 7.5l9 5 9-5M12 12.5v9" />
    <path d="M12 2.5v9l-9 5m9-5 9 5" strokeDasharray="2 2.5" strokeOpacity=".55" />
  </ViewportIcon>;
}

export function SelectGeometryIcon(props) {
  return <ViewportIcon {...props}>
    <path d="M10 3H3v7m0 5v6h6M15 3h6v7" strokeDasharray="2.5 3" />
    <path d="m10 9 3.2 12 2.7-4.3 5.1-.6Z" fill="currentColor" fillOpacity=".1" />
  </ViewportIcon>;
}
