import { expect, test } from "@playwright/test";

test("asset edits and finding state update shared risk and survive reload", async ({
  page,
}) => {
  await page.goto("/#/assets");
  await page
    .getByRole("textbox", { name: "Search assets", exact: true })
    .fill("web-prod-01");
  await page
    .getByRole("combobox", { name: "Filter asset type" })
    .selectOption("Server");
  await page
    .getByRole("combobox", { name: "Filter asset exposure" })
    .selectOption("Internet");
  await expect(page.locator(".asset-table tbody tr")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Open web-prod-01", exact: true })
    .click();
  const asset = page.getByRole("dialog", { name: "Asset details" });
  await expect(asset.locator(".drawer-risk strong")).toHaveText("94/100");
  await asset.getByRole("button", { name: "Edit demo asset" }).click();
  await asset
    .getByRole("textbox", { name: "Owner", exact: true })
    .fill("Local Review Team");
  await asset
    .getByRole("combobox", { name: "Criticality", exact: true })
    .selectOption("Low");
  await asset
    .getByRole("combobox", { name: "Exposure", exact: true })
    .selectOption("Isolated");
  await asset
    .getByRole("textbox", { name: "Analyst notes", exact: true })
    .fill(
      "Synthetic review record updated during the integrated local workflow.",
    );
  await asset
    .getByRole("button", { name: "Save local changes", exact: true })
    .click();
  await expect(asset.locator(".drawer-risk strong")).toHaveText("69/100");
  await expect(asset).toContainText("Local Review Team");
  await asset.getByRole("button", { name: "Close details" }).click();
  await expect(
    page.getByText("No matching assets", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search assets", exact: true })
    .fill("Local Review Team");
  await expect(page.locator(".asset-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".asset-table tbody")).toContainText("web-prod-01");
  await page.goto("/#/risk");
  await page
    .getByRole("textbox", { name: "Search findings", exact: true })
    .fill("logging component");
  await page
    .getByRole("button", {
      name: "Inspect Illustrative vulnerable logging component",
      exact: true,
    })
    .click();
  const finding = page.getByRole("dialog", { name: "Finding intelligence" });
  await expect(finding.locator(".formula-total strong")).toHaveText("69");
  await expect(finding.locator(".evidence")).toContainText(
    "No package inventory was collected",
  );
  await finding
    .getByRole("combobox", { name: "Finding status", exact: true })
    .selectOption("Resolved");
  await expect(finding.locator(".formula-total strong")).toHaveText("0");
  await finding.getByRole("button", { name: "Close details" }).click();
  await page
    .getByRole("combobox", { name: "Filter finding status" })
    .selectOption("Resolved");
  await expect(page.locator(".data-table tbody tr")).toHaveCount(1);
  await page.goto("/#/assets");
  await page.reload();
  await page
    .getByRole("textbox", { name: "Search assets", exact: true })
    .fill("web-prod-01");
  await expect(page.locator(".asset-table tbody")).toContainText(
    "Local Review Team",
  );
  await expect(page.locator(".asset-table .risk-value")).toHaveText("0/100");
  await page.goto("/#/twin");
  await page
    .getByRole("button", {
      name: "Open web-prod-01, low modeled risk",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Asset details" }),
  ).toContainText("Local Review Team");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("scope, seeded refresh, and local preferences are usable and persisted", async ({
  page,
}) => {
  await page.goto("/#/scope");
  await page
    .getByRole("textbox", { name: "Workspace name", exact: true })
    .fill("Local Security Review");
  await page
    .getByRole("textbox", { name: "Authorized demo scope", exact: true })
    .fill(
      "Authorized synthetic assets on documentation IP addresses and example domains only. This workspace performs no external network operations.",
    );
  await page
    .getByRole("button", { name: "Save workspace", exact: true })
    .click();
  await page.goto("/#/command");
  await expect(page.locator(".overview-strip")).toContainText(
    "Local Security Review",
  );
  await page.goto("/#/discovery");
  await page
    .getByRole("button", { name: "Refresh seeded inventory", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Seeded inventory refreshed." }),
  ).toBeVisible();
  await expect(page.locator(".data-table tbody tr")).toHaveCount(12);
  await page.goto("/#/settings");
  await page
    .getByRole("textbox", { name: "Analyst display name", exact: true })
    .fill("Demo Reviewer");
  await page.getByRole("checkbox", { name: /Compact layout/ }).check();
  await page.getByRole("checkbox", { name: /Reduce motion/ }).check();
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Analyst display name", exact: true }),
  ).toHaveValue("Demo Reviewer");
  await expect(
    page.getByRole("checkbox", { name: /Compact layout/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /Reduce motion/ }),
  ).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-compact", "true");
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  await page.goto("/#/audit");
  await page
    .getByRole("searchbox", { name: "Search audit history" })
    .fill("Demo inventory refreshed");
  await expect(page.locator(".audit-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".audit-table tbody")).toContainText(
    "No network discovery or traffic occurred",
  );
});

test("all workspace routes render truthful module states without runtime errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const routes = [
    ["command", "Command Center"],
    ["scope", "Scope & workspace"],
    ["discovery", "Discovery"],
    ["assets", "Asset Inventory"],
    ["risk", "Risk Intelligence"],
    ["threat", "Threat intelligence"],
    ["twin", "Digital Twin"],
    ["paths", "Attack Path Explorer"],
    ["simulation", "Attack Simulation"],
    ["advisor", "Defense Advisor"],
    ["guardian", "Guardian Gate"],
    ["agents", "AI Agent Center"],
    ["models", "ML Model Center"],
    ["reports", "Reports"],
    ["audit", "Audit Logs"],
    ["settings", "Settings"],
  ];
  for (const [route, title] of routes) {
    await page.goto(`/#/${route}`);
    await expect(
      page.getByRole("heading", { name: title, exact: true, level: 1 }),
    ).toBeVisible();
  }
  await page.goto("/#/models");
  await expect(
    page.getByText("No trained models", { exact: true }),
  ).toBeVisible();
  await page.goto("/#/agents");
  await expect(
    page.getByText("LLM agents unavailable", { exact: true }),
  ).toBeVisible();
  await page.goto("/#/threat");
  await expect(page.getByText("CISA KEV FEED", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
