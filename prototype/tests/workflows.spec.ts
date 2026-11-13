import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("simulation, ranked review, audit, and a downloadable report share persisted data", async ({
  page,
}) => {
  const errors: string[] = [];
  const remoteRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.protocol.startsWith("http") &&
      !["127.0.0.1", "localhost"].includes(url.hostname)
    )
      remoteRequests.push(url.href);
  });
  await page.goto("/#/simulation");
  await expect(
    page.getByRole("heading", { name: "Attack Simulation", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Run safe simulation", exact: true })
    .click();
  await expect(
    page.getByText("Potential exposure", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Assumptions recorded with this run", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review recommendations", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Defense Advisor", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".notice").filter({ hasText: "Simulation context:" }),
  ).toContainText("Perimeter to customer data");
  await page
    .getByRole("combobox", { name: "Filter recommendations", exact: true })
    .selectOption("Related to simulation");
  await expect(page.locator(".recommendation-panel")).toHaveCount(3);
  await page
    .getByRole("combobox", { name: "Filter recommendations", exact: true })
    .selectOption("All recommendations");
  const recommendation = page.locator(".recommendation-panel").nth(1);
  const title = await recommendation.locator(".panel-heading h2").innerText();
  await recommendation
    .getByRole("button", { name: "Review recommendation", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Recommendation", exact: true }),
  ).toHaveValue(/REC-/);
  await expect(
    page
      .getByRole("combobox", { name: "Recommendation", exact: true })
      .locator("option:checked"),
  ).toContainText(title);
  await page
    .getByRole("button", { name: "Record approval", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("review notes");
  const notes =
    "Reviewed the modeled path and accepted the operational tradeoff for demo planning.";
  await page.getByRole("textbox", { name: /^Review notes/ }).fill(notes);
  await page
    .getByRole("button", { name: "Record approval", exact: true })
    .click();
  await expect(page.locator(".decision-history")).toContainText(notes);
  await page.getByRole("radio", { name: /Reject recommendation/ }).check();
  const revisedNotes =
    "Revised review: defer until the planned maintenance window and independent validation.";
  await page.getByRole("textbox", { name: /^Review notes/ }).fill(revisedNotes);
  await page
    .getByRole("button", { name: "Record rejection", exact: true })
    .click();
  await expect(page.locator(".guardian-review-heading")).toContainText(
    "Rejected",
  );
  await expect(page.locator(".decision-history")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".guardian-review-heading")).toContainText(
    "Rejected",
  );
  await expect(page.locator(".decision-history")).toHaveCount(2);
  await page.goto("/#/audit");
  await page
    .getByRole("searchbox", { name: "Search audit history" })
    .fill("Recommendation rejected");
  await expect(page.locator(".audit-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".audit-table tbody")).toContainText(revisedNotes);
  await page.goto("/#/reports");
  await page
    .getByRole("button", { name: "Generate workspace report", exact: true })
    .click();
  await expect(page.locator(".report-document")).toContainText(notes);
  await expect(page.locator(".report-document")).toContainText(revisedNotes);
  await expect(page.locator(".report-document")).toContainText(
    "Potential exposure",
  );
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download Markdown", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^aegis-workspace-report-.*\.md$/,
  );
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(await readFile(path!, "utf8")).toContain(revisedNotes);
  expect(errors).toEqual([]);
  expect(remoteRequests).toEqual([]);
});

test("path explorer validates distinct assets and shows shared modeled relationships", async ({
  page,
}) => {
  await page.goto("/#/paths");
  await expect(
    page.getByRole("heading", { name: "Attack Path Explorer", exact: true }),
  ).toBeVisible();
  const start = page.getByRole("combobox", {
    name: "Starting asset",
    exact: true,
  });
  const destination = page.getByRole("combobox", {
    name: "Destination asset",
    exact: true,
  });
  const initialDestination = await destination.inputValue();
  await destination.selectOption(await start.inputValue());
  await page
    .getByRole("button", { name: "Analyze paths", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("two different assets");
  await destination.selectOption(initialDestination);
  await page
    .getByRole("button", { name: "Analyze paths", exact: true })
    .click();
  await expect(page.locator(".path-chain").first()).toBeVisible();
  await expect(page.locator(".path-relations").first()).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Simulate this scenario", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("combobox", { name: "Scenario", exact: true }),
  ).toHaveValue("perimeter-to-data");
  await page.goto("/#/simulation/identity-to-files");
  await expect(
    page.getByRole("combobox", { name: "Scenario", exact: true }),
  ).toHaveValue("identity-to-files");
  await page
    .getByRole("combobox", { name: "Scenario", exact: true })
    .selectOption("build-to-vault");
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Scenario", exact: true }),
  ).toHaveValue("build-to-vault");
});
