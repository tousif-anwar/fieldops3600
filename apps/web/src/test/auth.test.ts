import { describe, expect, it } from "vitest";
import { rolesFromToken } from "../auth";

function tokenWith(payload: Record<string, unknown>) {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${encoded}.signature`;
}

describe("authenticated role extraction", () => {
  it("reads known Keycloak realm roles from a padded or unpadded token", () => {
    expect(
      rolesFromToken(
        tokenWith({
          realm_access: { roles: ["Technician", "offline_access", "Dispatcher"] },
        }),
      ),
    ).toEqual(["Technician", "Dispatcher"]);
  });

  it("fails closed for missing and malformed access tokens", () => {
    expect(rolesFromToken()).toEqual([]);
    expect(rolesFromToken("not-a-token")).toEqual([]);
    expect(rolesFromToken("header.not-base64.signature")).toEqual([]);
  });
});
