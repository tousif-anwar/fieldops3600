import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const playwrightCli = fileURLToPath(
  new URL("../node_modules/@playwright/test/cli.js", import.meta.url),
);
const summaryPath = new URL(
  "../test-results/live-run-summary.json",
  import.meta.url,
);
const projects = ["chromium", "mobile-chrome"];
const windowMs = 61000;
const abort = new AbortController();
let activeChild;
let interrupted = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interrupted = true;
    abort.abort();
    activeChild?.kill(signal);
  });
}

async function runProject(project) {
  console.log(
    `Waiting 61 seconds for a fresh request window before ${project}.`,
  );
  await delay(windowMs, undefined, { signal: abort.signal });
  console.log(
    `Running ${project} with two workers; application limits remain enabled.`,
  );
  return new Promise((resolve) => {
    activeChild = spawn(
      process.execPath,
      [
        playwrightCli,
        "test",
        `--project=${project}`,
        "--workers=2",
        `--output=test-results/${project}`,
        "--reporter=list",
      ],
      { cwd: webRoot, env: process.env, stdio: "inherit" },
    );
    activeChild.once("error", (error) => {
      console.error(`${project} could not start: ${error.message}`);
      activeChild = undefined;
      resolve(1);
    });
    activeChild.once("close", (code, signal) => {
      activeChild = undefined;
      resolve(
        code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1),
      );
    });
  });
}

async function main() {
  if (process.env.FIELDOPS_LIVE_E2E !== "1" || !process.env.WEB_BASE_URL) {
    throw new Error(
      "Set FIELDOPS_LIVE_E2E=1 and WEB_BASE_URL for the running authenticated application.",
    );
  }
  const target = new URL(process.env.WEB_BASE_URL);
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("WEB_BASE_URL must use HTTP or HTTPS.");
  }
  const summary = { startedAtUtc: new Date().toISOString(), projects: [] };
  let failed = false;
  await mkdir(new URL("../test-results/", import.meta.url), {
    recursive: true,
  });
  try {
    for (const project of projects) {
      const exitCode = await runProject(project);
      summary.projects.push({ project, exitCode });
      console.log(`${project} exited with status ${exitCode}.`);
      failed ||= exitCode !== 0;
      if (interrupted) break;
    }
  } finally {
    summary.finishedAtUtc = new Date().toISOString();
    summary.interrupted = interrupted;
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  }
  process.exitCode = interrupted ? 130 : failed ? 1 : 0;
}

main().catch((error) => {
  if (!interrupted) console.error(error.message);
  process.exitCode = interrupted ? 130 : 1;
});
