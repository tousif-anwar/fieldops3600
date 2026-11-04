import { test, expect } from "@playwright/test";
test("protected routes show secure sign-in before rendering operational data", async ({
  page,
}) => {
  await page.goto("/replay?workOrderId=private-record");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue to secure sign-in" }),
  ).toBeVisible();
  await expect(
    page.getByText("Event timeline", { exact: true }),
  ).not.toBeVisible();
});
test("login remains usable with keyboard and mobile-sized screens", async ({
  page,
}) => {
  await page.goto("/");
  const login = page.getByRole("button", {
    name: "Continue to secure sign-in",
  });
  await login.focus();
  await expect(login).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
