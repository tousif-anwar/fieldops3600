import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "../../..");
// Measured production assets before cleanup, commit 20ee7d00. Durable values keep
// this gate runnable from a clean checkout without private screenshot artifacts.
const baseline = [
  { name: "baseline.js", bytes: 1337484, gzipBytes: 402969 },
  { name: "baseline.css", bytes: 93611, gzipBytes: 19391 },
];
const current = readdirSync(resolve(import.meta.dirname, "../dist/assets")).map(
  (name) => {
    const body = readFileSync(
      resolve(import.meta.dirname, "../dist/assets", name),
    );
    return { name, bytes: body.length, gzipBytes: gzipSync(body).length };
  },
);
function size(items, extension, key) {
  return items
    .filter((x) => x.name.endsWith(extension))
    .reduce((n, x) => n + x[key], 0);
}
const checks = [];
for (const extension of [".js", ".css"]) {
  for (const key of ["bytes", "gzipBytes"]) {
    const before = size(baseline, extension, key),
      after = size(current, extension, key);
    // A 5% budget plus 1 KiB permits small correctness changes while catching unexplained growth.
    checks.push({
      extension,
      metric: key,
      before,
      after,
      limit: Math.ceil(before * 1.05) + 1024,
      pass: after <= Math.ceil(before * 1.05) + 1024,
    });
  }
}
const out = `${root}/artifacts/frontend-cleanup/after`;
mkdirSync(out, { recursive: true });
writeFileSync(
  `${out}/bundle-budget.json`,
  JSON.stringify({ checks, assets: current }, null, 2),
);
console.log(JSON.stringify(checks));
if (checks.some((x) => !x.pass)) process.exitCode = 1;
