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

// macOS tints the template itself; Windows gets a white glyph for a dark taskbar and a black one for a light one.
const outputs: [svg: string, size: number, file: string][] = [
  [traySvg("#000000"), 16, "resources/trayTemplate.png"],
  [traySvg("#000000"), 32, "resources/trayTemplate@2x.png"],
  [traySvg("#ffffff"), 16, "resources/tray-white.png"],
  [traySvg("#ffffff"), 32, "resources/tray-white@2x.png"],
  [traySvg("#000000"), 16, "resources/tray-black.png"],
  [traySvg("#000000"), 32, "resources/tray-black@2x.png"],
  [appSvg, 1024, "build/icon.png"],
];

for (const [svg, size, file] of outputs) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } })
    .render()
    .asPng();

  writeFileSync(path.join(root, file), png);
}
