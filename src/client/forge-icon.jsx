import React from "react";

// Approved four-stroke mark: Figma node 33:13 in dsh-minicad.
// The anvil reference and adaptation are credited in NOTICE.md.
export function ForgeIcon({ size = 16, className, style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9.5999 1.30005L7.3999 5.70005" strokeWidth={1.3} />
      <path d="M8.5 3.5L14 6.25" />
      <path d="M1.5 9.5H14.5C12 9.5 10.5 11 10.5 12.5L12 14.5H5L6.5 12.5C4.5 12.5 3 11.5 1.5 9.5Z" />
    </svg>
  );
}
