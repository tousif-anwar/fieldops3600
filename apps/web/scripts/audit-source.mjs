import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import ts from "typescript";
import postcss from "postcss";

const root = resolve(import.meta.dirname, "../../..");
const baseline = process.env.UI_AUDIT_PHASE !== "after";
const phase = baseline ? "before" : "after";
const out = resolve(root, "artifacts/frontend-cleanup", phase);
mkdirSync(out, { recursive: true });
const files = execFileSync(
  "git",
  [
    ...(baseline
      ? ["ls-tree", "-r", "--name-only", "HEAD"]
      : ["ls-files", "--cached", "--others", "--exclude-standard", "--"]),
    "apps/web/src",
    "apps/technician-mobile/app",
    "apps/technician-mobile/src",
  ],
  { cwd: root, encoding: "utf8" },
)
  .trim()
  .split("\n");
const result = {
  phase,
  basis: baseline ? "git HEAD before frontend cleanup" : "working tree",
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  files: [],
};
for (const file of files.filter((x) => /\.(?:tsx?|css)$/.test(x))) {
  let body;
  try {
    body = baseline
      ? execFileSync("git", ["show", `HEAD:${file}`], {
          cwd: root,
          encoding: "utf8",
        })
      : readFileSync(resolve(root, file), "utf8");
  } catch {
    continue;
  }
  const row = {
    file,
    bytes: Buffer.byteLength(body),
    divs: 0,
    views: 0,
    fragments: 0,
    elements: 0,
  };
  if (file.endsWith("css")) {
    const selectors = new Map();
    const tree = postcss.parse(body, { from: file });
    tree.walkRules((rule) =>
      selectors.set(rule.selector, (selectors.get(rule.selector) ?? 0) + 1),
    );
    let declarations = 0,
      important = 0;
    tree.walkDecls((decl) => {
      declarations++;
      if (decl.important) important++;
    });
    Object.assign(row, {
      rules: [...selectors.values()].reduce((a, b) => a + b, 0),
      declarations,
      important,
      repeatedSelectors: [...selectors].filter(([, n]) => n > 1),
      gradients: (body.match(/(?:linear|radial|conic)-gradient\(/g) ?? [])
        .length,
      hexadecimalColors: [...new Set(body.match(/#[\da-fA-F]{3,8}\b/g) ?? [])]
        .length,
    });
  } else {
    const tree = ts.createSourceFile(
      file,
      body,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        row.elements++;
        const tag = node.tagName.getText(tree);
        if (tag === "div") row.divs++;
        if (tag === "View") row.views++;
      }
      if (ts.isJsxFragment(node)) row.fragments++;
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  result.files.push(row);
}
result.totals = Object.fromEntries(
  [
    "bytes",
    "divs",
    "views",
    "fragments",
    "elements",
    "gradients",
    "important",
  ].map((key) => [key, result.files.reduce((n, x) => n + (x[key] ?? 0), 0)]),
);
// Deployed asset sizes are independent from concurrent working-tree edits.
const base = process.env.WEB_BASE_URL ?? "http://localhost:8088";
const html = await (await fetch(base)).text();
const assets = [
  ...new Set(
    [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map((m) => m[1]),
  ),
];
result.deployedEntryAssets = await Promise.all(
  assets.map(async (path) => {
    const body = Buffer.from(
      await (await fetch(new URL(path, base))).arrayBuffer(),
    );
    return { path, bytes: body.length, gzipBytes: gzipSync(body).length };
  }),
);
writeFileSync(`${out}/source-metrics.json`, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    phase,
    files: result.files.length,
    ...result.totals,
    cssBytes: result.files
      .filter((x) => x.file.endsWith("css"))
      .reduce((n, x) => n + x.bytes, 0),
    deployedEntryAssets: result.deployedEntryAssets,
  }),
);
