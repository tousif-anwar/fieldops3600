// Real PKCE identities + a live WebSocket notification through YARP.
// No tokens/passwords are persisted or printed. Creates labeled synthetic records.
import { HubConnectionBuilder, HttpTransportType, LogLevel } from "@microsoft/signalr";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const python = process.env.PYTHON ?? "python";
const code = [
  "import importlib.util,json,pathlib",
  "root=pathlib.Path.cwd()",
  "spec=importlib.util.spec_from_file_location('auth',root/'scripts/local-auth.py')",
  "auth=importlib.util.module_from_spec(spec)",
  "spec.loader.exec_module(auth)",
  "print(json.dumps({role:auth.login(root,role) for role in ['supervisor','technician','dispatcher','analyst']}))",
].join(";");
const tokens = JSON.parse(execFileSync(python, ["-c", code], { cwd: root, encoding: "utf8", windowsHide: true }));
const base = process.env.WEB_BASE_URL ?? "http://localhost:8088";
const hub = new HubConnectionBuilder()
  .withUrl(base + "/hubs/notifications", {
    accessTokenFactory: () => tokens.supervisor,
    transport: HttpTransportType.WebSockets,
    skipNegotiation: true,
  }).configureLogging(LogLevel.None).build();
const call = async (path, role, data) => {
  const response = await fetch(base + path, {
    method: data ? "POST" : "GET",
    headers: { Authorization: "Bearer " + tokens[role], ...(data ? { "Content-Type": "application/json" } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  assert.ok(response.ok, path + ": HTTP " + response.status);
  return response.json();
};
let expectedOrder;
let resolveNotice;
const observed = new Promise((resolve) => { resolveNotice = resolve; });
hub.on("notification", (notice) => {
  if (notice.workOrderId === expectedOrder && notice.title === "Technician requested assistance") resolveNotice(notice);
});
try {
  for (const [role, expected] of [["analyst", 403], [undefined, 401]]) {
    const response = await fetch(base + "/hubs/notifications/negotiate?negotiateVersion=1", {
      method: "POST", headers: role ? { Authorization: "Bearer " + tokens[role] } : {},
    });
    assert.equal(response.status, expected);
  }
  await hub.start();
  const order = await call("/api/work-orders", "dispatcher", {
    title: "Synthetic live SignalR verification", customerName: "Synthetic Customer",
    siteAddress: "100 Demonstration Avenue", serviceCategory: "HVAC", priority: "Normal", teamId: "north",
  });
  expectedOrder = order.id;
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 100 + parseInt(randomUUID().slice(0, 4), 16) % 3000);
  start.setUTCHours(15, 0, 0, 0);
  await call("/api/bookings", "dispatcher", {
    workOrderId: order.id, technicianId: "tech-01", startUtc: start.toISOString(),
    endUtc: new Date(start.getTime() + 3600000).toISOString(),
  });
  const until = Date.now() + 30000;
  while ((await call("/api/work-orders/" + order.id, "dispatcher")).technicianId !== "tech-01") {
    assert.ok(Date.now() < until, "Timed out waiting for assignment");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const workflow = await call("/api/workflows", "technician", { workOrderId: order.id });
  await call("/api/workflows/" + workflow.id + "/assistance", "technician", {
    expectedVersion: workflow.version, reason: "Synthetic real-time notification verification",
  });
  let timer;
  const notice = await Promise.race([
    observed,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("No live notification received")), 30000); }),
  ]).finally(() => clearTimeout(timer));
  assert.equal(notice.teamId, "north");
  const retained = await call("/api/notifications", "supervisor");
  assert.ok(retained.some((item) => item.id === notice.id));
  console.log("PASS: authenticated live WebSocket notice matches persisted history; analyst and anonymous hub access denied.");
} finally {
  await hub.stop();
}

