import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { countdown } from "../format";
import { Status, ErrorState } from "../components/common";
import { ApiError } from "../api";
import { visibleFields } from "../pages/Workflow";
import type { FormField } from "../types";
import { answerError, WorkflowAnswer } from "../components/WorkflowAnswer";

vi.mock("../auth", () => ({ manager: { getUser: vi.fn() }, useAuth: vi.fn() }));
describe("guided service forms", () => {
  it("captures bounded service notes and labor while retaining dropdown templates", () => {
    const notes: FormField = {
      key: "notes",
      label: "Work performed",
      options: [],
      required: true,
      inputType: "text",
      maxLength: 1000,
    };
    const labor: FormField = {
      key: "labor",
      label: "Labor minutes",
      options: [],
      required: true,
      inputType: "number",
      minimum: 1,
      maximum: 480,
    };
    render(
      <>
        <WorkflowAnswer
          field={notes}
          value="Replaced filter"
          editable
          onChange={() => {}}
        />
        <WorkflowAnswer field={labor} value="45" editable onChange={() => {}} />
      </>,
    );
    expect(screen.getByRole("textbox", { name: /Work performed/ })).toHaveValue(
      "Replaced filter",
    );
    expect(
      screen.getByRole("spinbutton", { name: /Labor minutes/ }),
    ).toHaveAttribute("max", "480");
    expect(answerError(notes, " ")).toMatch(/required/);
    expect(answerError(labor, "0")).toMatch(/at least 1/);
    expect(answerError(labor, "481")).toMatch(/at most 480/);
    expect(answerError(labor, "invalid")).toMatch(/number/);
    expect(answerError(labor, "45")).toBeNull();
  });
  it("only requires conditional answers when the controlling answer matches", () => {
    const fields: FormField[] = [
      {
        key: "travelStatus",
        label: "Travel status",
        options: ["Departed", "Delayed", "Arrived"],
        required: true,
      },
      {
        key: "delayReason",
        label: "Delay reason",
        options: ["Traffic", "Weather"],
        required: true,
        conditionField: "travelStatus",
        conditionValue: "Delayed",
      },
    ];
    expect(
      visibleFields(fields, { travelStatus: "Arrived" }).map((f) => f.key),
    ).toEqual(["travelStatus"]);
    expect(
      visibleFields(fields, { travelStatus: "Delayed" }).map((f) => f.key),
    ).toEqual(["travelStatus", "delayReason"]);
  });
  it("keeps approved pause display fixed at the recorded pause timestamp", () => {
    expect(
      countdown(
        "2026-11-04T13:30:00Z",
        Date.parse("2026-11-04T14:00:00Z"),
        "2026-11-04T13:20:00Z",
      ),
    ).toBe("10:00");
    expect(
      countdown("2026-11-04T13:30:00Z", Date.parse("2026-11-04T13:31:05Z")),
    ).toBe("−01:05");
  });
  it("communicates SLA severity through text as well as color", () => {
    render(<Status value="StageSLABreached" />);
    expect(screen.getByText("Stage SLABreached")).toBeInTheDocument();
  });
  it("shows authorization errors without exposing a misleading retry action", () => {
    render(
      <ErrorState
        error={new ApiError(403, "This work order belongs to another team.")}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Access is restricted");
    expect(
      screen.getByText("This work order belongs to another team."),
    ).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
