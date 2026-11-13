import { describe, expect, it } from "vitest";
import {
  assetIdentity,
  warrantyLabel,
  warrantyState,
} from "../asset-contracts";

const now = new Date("2026-11-05T00:00:00Z");

describe("asset warranty presentation", () => {
  it("distinguishes missing, expired, expiring and active coverage", () => {
    expect(warrantyState({ warrantyEndUtc: null }, now)).toBe("none");
    expect(warrantyState({ warrantyEndUtc: "2026-01-01T00:00:00Z" }, now)).toBe(
      "expired",
    );
    expect(warrantyState({ warrantyEndUtc: "2027-01-01T00:00:00Z" }, now)).toBe(
      "expiring",
    );
    expect(warrantyState({ warrantyEndUtc: "2028-01-01T00:00:00Z" }, now)).toBe(
      "active",
    );
    expect(warrantyLabel({ warrantyEndUtc: null }, now)).toBe(
      "No warranty recorded",
    );
  });

  it("treats an unparseable warranty date as unknown rather than active", () => {
    expect(warrantyState({ warrantyEndUtc: "not-a-date" }, now)).toBe("none");
  });

  it("builds an identity line without empty separators", () => {
    expect(
      assetIdentity({
        manufacturer: "Northwind",
        model: "RTU-24",
        serialNumber: "SN-1",
      }),
    ).toBe("Northwind · RTU-24 · Serial SN-1");
  });
});
