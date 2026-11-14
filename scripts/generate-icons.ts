import { writeFileSync } from "node:fs";
import path from "node:path";

import { PinIcon } from "@hugeicons/core-free-icons";
import { Resvg } from "@resvg/resvg-js";

const root = path.resolve(import.meta.dirname, "..");
const sky = "#0284c7";

const glyph = (color: string, strokeWidth: number) =>
  PinIcon.map(
    ([, { d }]) =>
      `<path d="${String(d)}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
  ).join("");

const traySvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${glyph(color, 2)}</svg>`;

const appSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
<rect x="64" y="64" width="896" height="896" rx="200" fill="${sky}"/>
<g transform="translate(232 232) scale(23.333)">${glyph("#ffffff", 1.5)}</g>
</svg>`;

const FONT =
  "Inter, -apple-system, Helvetica Neue, Helvetica, Arial, sans-serif";

/** One table row: a label, its quote, its cap and the difference, red when over. */
const row = (
  y: number,
  cells: readonly string[],
  over: boolean,
  bold = false
) => {
  const weight = bold ? 700 : 400;
  const [item, quote, cap, diff] = cells;

  return `<text x="28" y="${y}" font-weight="${weight}">${item}</text>
<text x="262" y="${y}" text-anchor="end" font-weight="${weight}">${quote}</text>
<text x="342" y="${y}" text-anchor="end" font-weight="${weight}">${cap}</text>
<text x="436" y="${y}" text-anchor="end" font-weight="${over ? 700 : weight}" fill="${over ? "#c4271b" : "#1d1d1f"}">${diff}</text>`;
};

/**
 * The tutorial's example captures' image (src/main/pin-tutorial.ts): a
 * budget table, 480 × 300 points at 2 pixels per point, in a plain title
 * bar that belongs to no system. Its numbers sit where the examples' pins
 * point.
 */
const exampleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 300" font-family="${FONT}" font-size="14" fill="#1d1d1f">
<rect width="480" height="300" fill="#ffffff"/>
<rect width="480" height="34" fill="#f1f1f3"/>
<rect y="34" width="480" height="1" fill="#dedee2"/>
<text x="16" y="21.5" font-size="12" font-weight="600" fill="#555555">Office move budget</text>
<rect x="16" y="50" width="448" height="26" fill="#fafafb"/>
<g font-size="12" font-weight="600" fill="#6e6e73">
<text x="28" y="68">Item</text><text x="262" y="68" text-anchor="end">Quote</text><text x="342" y="68" text-anchor="end">Cap</text><text x="436" y="68" text-anchor="end">Diff</text>
</g>
${row(104, ["Desks (12)", "9,840", "10,000", "−160"], false)}
${row(138, ["Chairs (12)", "5,280", "5,000", "+280"], true)}
${row(172, ["Shelving", "2,160", "3,000", "−840"], false)}
${row(206, ["Delivery", "980", "0", "+980"], true)}
<rect x="16" y="222" width="448" height="34" fill="#fff4f2"/>
${row(244, ["Total", "18,260", "18,000", "+260"], true, true)}
${[118, 152, 186, 220].map((y) => `<rect x="16" y="${y}" width="448" height="1" fill="#e6e6ea"/>`).join("")}
</svg>`;

// macOS tints the template itself; Windows gets a white glyph for a dark taskbar and a black one for a light one.
const outputs: [svg: string, size: number, file: string][] = [
  [traySvg("#000000"), 16, "resources/trayTemplate.png"],
  [traySvg("#000000"), 32, "resources/trayTemplate@2x.png"],
  [traySvg("#ffffff"), 16, "resources/tray-white.png"],
  [traySvg("#ffffff"), 32, "resources/tray-white@2x.png"],
  [traySvg("#000000"), 16, "resources/tray-black.png"],
  [traySvg("#000000"), 32, "resources/tray-black@2x.png"],
  [appSvg, 1024, "build/icon.png"],
  [exampleSvg, 960, "resources/example-capture.png"],
];

for (const [svg, size, file] of outputs) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } })
    .render()
    .asPng();

  writeFileSync(path.join(root, file), png);
}
