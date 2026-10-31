const labels = { TOP: "俯视", FRONT: "前视", RIGHT: "右视" };
const positions = [
  [55, 85],
  [55, 320],
  [480, 320],
];
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
function bounds(view) {
  const points = view.paths.flatMap((p) => p.points);
  if (!points.length)
    return [
      [0, 0],
      [1, 1],
    ];
  return [0, 1].map((side) =>
    [0, 1].map((axis) =>
      points.reduce(
        (v, p) => (side ? Math.max(v, p[axis]) : Math.min(v, p[axis])),
        side ? -Infinity : Infinity,
      ),
    ),
  );
}
function transforms(views) {
  const boxes = views.map(bounds);
  const scale = Math.min(
    360 / Math.max(1, ...boxes.map(([a, b]) => b[0] - a[0])),
    170 / Math.max(1, ...boxes.map(([a, b]) => b[1] - a[1])),
  );
  return boxes.map(([lo, hi], i) => (p) => [
    positions[i][0] + 180 + (p[0] - (lo[0] + hi[0]) / 2) * scale,
    positions[i][1] + 85 - (p[1] - (lo[1] + hi[1]) / 2) * scale,
  ]);
}
const dimensions = (metrics) =>
  ["sizeX", "sizeY", "sizeZ"].map((k) => metrics[k].toFixed(3)).join(" × ");
export function drawingSvg(views, metrics, title, locale = "en") {
  const fit = transforms(views);
  const out = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600"><rect width="900" height="600" fill="white"/>',
    `<text x="40" y="42" font-family="sans-serif" font-size="18" fill="#353638">${escape(title)}</text>`,
  ];
  views.forEach((view, i) => {
    for (const path of [...view.paths].sort(
      (a, b) => Number(b.hidden) - Number(a.hidden),
    ))
      out.push(
        `<polyline points="${path.points
          .map(fit[i])
          .map((p) => p.map((v) => v.toFixed(3)).join(","))
          .join(
            " ",
          )}" fill="none" stroke="${path.hidden ? "#adb2b8" : "#353638"}" stroke-width="1"${path.hidden ? ' stroke-dasharray="4 3"' : ""}/>`,
      );
    out.push(
      `<text x="${positions[i][0] + 180}" y="${positions[i][1] + 195}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#61666b">${locale === "zh" ? labels[view.name] : view.name}</text>`,
    );
  });
  const note =
    locale === "zh"
      ? "正投影视图 · 仅含外形尺寸"
      : "Orthographic views · Overall dimensions only";
  out.push(
    `<path d="M40 548H860" stroke="#e1e5ee"/><text x="40" y="575" font-family="sans-serif" font-size="12" fill="#61666b">${dimensions(metrics)} mm · ${note}</text></svg>`,
  );
  return out.join("");
}

// Vector-only PDF. The standard predefined CJK font/CMap preserves Chinese text
// without requiring a system font, an installed PDF renderer or Python.
export function drawingPdf(views, metrics, title, revision, locale = "en") {
  const fit = transforms(views),
    commands = [];
  const text = (value, x, y, size) => {
    const bytes = Buffer.from(value, "utf16le");
    bytes.swap16();
    commands.push(
      `BT /F1 ${size} Tf 1 0 0 1 ${x} ${600 - y} Tm <${bytes.toString("hex")}> Tj ET`,
    );
  };
  text(`${title} · v${revision}`, 40, 42, 18);
  views.forEach((view, i) => {
    for (const path of [...view.paths].sort(
      (a, b) => Number(b.hidden) - Number(a.hidden),
    )) {
      commands.push(
        `${path.hidden ? ".65" : ".2"} G ${path.hidden ? "[4 3]" : "[]"} 0 d`,
      );
      path.points
        .map(fit[i])
        .forEach(([x, y], n) =>
          commands.push(
            `${x.toFixed(4)} ${(600 - y).toFixed(4)} ${n ? "l" : "m"}`,
          ),
        );
      commands.push("S");
    }
    text(
      locale === "zh" ? labels[view.name] : view.name,
      positions[i][0] + 165,
      positions[i][1] + 195,
      12,
    );
  });
  text(
    `${dimensions(metrics)} mm · ${locale === "zh" ? "正投影视图 · 仅含外形尺寸" : "Orthographic views · Overall dimensions only"}`,
    40,
    575,
    12,
  );
  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 600] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 7 0 R /DW 1000 >>",
    "<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>",
  ];
  let output = "%PDF-1.4\n",
    offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(output));
    output += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}
