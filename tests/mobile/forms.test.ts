import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanAnswers,
  validateAnswers,
  visibleFields,
} from "../../apps/technician-mobile/src/offline/forms";
import type { FormField } from "../../apps/technician-mobile/src/contracts";

const fields = [
  {
    key: "travelStatus",
    label: "Travel status",
    required: true,
    options: ["Departed", "Delayed", "Arrived"],
  },
  {
    key: "delayReason",
    label: "Delay reason",
    required: true,
    options: ["Traffic", "Weather"],
    conditionField: "travelStatus",
    conditionValue: "Delayed",
  },
];

test("conditional required field is enforced only while its controlling answer matches", () => {
  assert.equal(visibleFields(fields, { travelStatus: "Arrived" }).length, 1);
  assert.deepEqual(validateAnswers(fields, { travelStatus: "Arrived" }), []);
  assert.deepEqual(validateAnswers(fields, { travelStatus: "Delayed" }), [
    "Select delay reason.",
  ]);
});

test("changing a controlling answer removes obsolete hidden values from the outgoing payload", () => {
  assert.deepEqual(
    cleanAnswers(fields, {
      travelStatus: "Arrived",
      delayReason: "Traffic",
      injected: "ignored",
    }),
    {
      travelStatus: "Arrived",
    },
  );
});

test("unknown dropdown options cannot pass client validation", () => {
  assert.match(
    validateAnswers(fields, { travelStatus: "Teleport" })[0]!,
    /invalid selection/,
  );
});

test("free text service evidence is required, trimmed and length bounded", () => {
  const evidence: FormField[] = [
    {
      key: "workPerformed",
      label: "Work performed",
      options: [],
      inputType: "text",
      required: true,
      maxLength: 20,
    },
  ];
  assert.match(
    validateAnswers(evidence, { workPerformed: "   " })[0]!,
    /Enter work performed/,
  );
  assert.match(
    validateAnswers(evidence, { workPerformed: "x".repeat(21) })[0]!,
    /at most 20/,
  );
  assert.deepEqual(
    validateAnswers(evidence, { workPerformed: "Cleaned condenser" }),
    [],
  );
  assert.deepEqual(
    cleanAnswers(evidence, {
      workPerformed: " Cleaned condenser ",
      injected: "discard",
    }),
    { workPerformed: "Cleaned condenser" },
  );
});

test("numeric labor evidence rejects nonfinite values and enforces the server-supplied range", () => {
  const labor: FormField[] = [
    {
      key: "laborMinutes",
      label: "Labor minutes",
      options: [],
      inputType: "number",
      required: true,
      minimum: 1,
      maximum: 480,
    },
  ];
  for (const invalid of ["NaN", "Infinity", "0x10", "1e2", "1,000", "ten"])
    assert.match(
      validateAnswers(labor, { laborMinutes: invalid })[0]!,
      /valid number/,
    );
  assert.match(validateAnswers(labor, { laborMinutes: "0" })[0]!, /at least 1/);
  assert.match(
    validateAnswers(labor, { laborMinutes: "481" })[0]!,
    /at most 480/,
  );
  assert.deepEqual(validateAnswers(labor, { laborMinutes: "30.5" }), []);
});

test("hidden conditional text and optional empty values do not enter the offline command", () => {
  const checklist: FormField[] = [
    {
      key: "partsStatus",
      label: "Parts status",
      options: ["Available", "Not Required"],
      required: true,
    },
    {
      key: "partsUsed",
      label: "Parts used",
      options: [],
      inputType: "text",
      required: true,
      conditionField: "partsStatus",
      conditionValue: "Available",
    },
    {
      key: "notes",
      label: "Notes",
      options: [],
      inputType: "text",
      required: false,
    },
  ];
  assert.deepEqual(
    validateAnswers(checklist, { partsStatus: "Not Required", notes: " " }),
    [],
  );
  assert.deepEqual(
    cleanAnswers(checklist, {
      partsStatus: "Not Required",
      partsUsed: "Old hidden value",
      notes: " ",
    }),
    { partsStatus: "Not Required" },
  );
});
