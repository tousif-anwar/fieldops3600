#!/usr/bin/env node
/**
 * Guard the CSS half of the design system.
 *
 * Raw colors, gradients, spacing, radii, and type sizes belong in
 * design-system/tokens.css. Component CSS must consume semantic roles.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cssRoot = resolve(root, "src");
const tokenFile = resolve(cssRoot, "design-system/tokens.css");
const files = [];
function walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else if (name.endsWith(".css")) files.push(path);
  }
}
walk(cssRoot);

const rawColor =
  /(#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(|(?:linear|radial|conic)-gradient\()/;
const spacingProperty =
  /^(?:margin(?:-[a-z]+)?|padding(?:-[a-z]+)?|gap|row-gap|column-gap|font-size|font-weight|border-radius)$/;
const rawLength = /(^|[\s(,])-?(?:\d+|\d*\.\d+)(?:px|rem|em)\b/;
const allowedRadius =
  /^(?:0|inherit|var\(--radius-[a-z-]+\))(?:\s+(?:0|var\(--radius-[a-z-]+\)))*$/;
const failures = [];

for (const file of files) {
  if (file === tokenFile) continue;
  const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [index, raw] of source.split("\n").entries()) {
    const declaration = raw.match(/^\s*([\w-]+)\s*:\s*([^;]+);/);
    if (!declaration) continue;
    const [, property, value] = declaration;
    const line = relative(root, file) + ":" + (index + 1);
    if (rawColor.test(value)) {
      failures.push(`${line}: raw color or gradient in ${property}; use a semantic token`);
    }
    if (spacingProperty.test(property) && rawLength.test(value)) {
      failures.push(`${line}: raw length in ${property}; use a spacing or type token`);
    }
    if (property === "border-radius" && !allowedRadius.test(value.trim())) {
      failures.push(`${line}: radius must be zero, inherited, or a --radius-* token`);
    }
    if (
      /^(?:margin|padding|gap|row-gap|column-gap)$/.test(property) &&
      !value.includes("calc(") &&
      !value
        .split(/\s+/)
        .every((part) => part === "0" || part === "auto" || part.startsWith("var("))
    ) {
      failures.push(`${line}: spacing must be zero, auto, a spacing token, or calc()`);
    }
  }
}

if (failures.length) {
  console.error("Design-token CSS check failed:");
  for (const failure of failures) console.error("  - " + failure);
  process.exit(1);
}
console.log(`Design-token CSS check passed: ${files.length} stylesheet(s), ${files.length - 1} token-free component sheet(s).`);
