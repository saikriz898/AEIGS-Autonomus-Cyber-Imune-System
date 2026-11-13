import { expect, test } from "@playwright/test";

test("desktop workspace layout and asset-to-finding keyboard flow", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/command");
  await expect(
    page.getByRole("heading", { name: "Command Center", level: 1 }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("aegis-desktop.png"),
    fullPage: true,
  });
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Open web-prod-01, critical modeled risk",
      exact: true,
    })
    .click();
  const asset = page.getByRole("dialog", { name: "Asset details" });
  await expect(asset).toBeVisible();
  await asset.locator(".drawer-finding").click();
  const finding = page.getByRole("dialog", { name: "Finding intelligence" });
  await expect(finding).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.keyboard.press("Shift+Tab");
  await expect(
    finding.getByRole("button", { name: "Evaluate defenses" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    finding.getByRole("button", { name: "Close details" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("textbox", { name: "Search workspace", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("textbox", { name: "Search workspace", exact: true })
    .fill("customer");
  await page.locator(".search-popover").getByRole("button").first().click();
  await expect(
    page.getByRole("dialog", { name: "Asset details" }),
  ).toContainText("db-customer-01");
});

test("mobile navigation and all modules fit the viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/command");
  await page.screenshot({
    path: testInfo.outputPath("aegis-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Asset Inventory", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Asset Inventory", level: 1 }),
  ).toBeVisible();
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
    const dimensions = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      overflow: [...document.querySelectorAll("body *")]
        .filter(
          (el) => el.getBoundingClientRect().right > window.innerWidth + 1,
        )
        .map(
          (el) =>
            `${el.tagName}.${el.className}: ${Math.round(el.getBoundingClientRect().right)}`,
        )
        .slice(0, 12),
    }));
    expect(
      dimensions.page,
      `${route} must avoid page-level horizontal scrolling: ${dimensions.overflow.join("; ")}`,
    ).toBeLessThanOrEqual(dimensions.viewport);
  }
  await page.goto("/#/twin");
  await page.screenshot({
    path: testInfo.outputPath("aegis-mobile-twin.png"),
    fullPage: true,
  });
});

test("malformed local data recovers visibly without crashing", async ({
  page,
}) => {
  await page.goto("/#/command");
  await page.evaluate(() =>
    localStorage.setItem("aegis.workspace.v1", "{broken-json"),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Command Center", level: 1 }),
  ).toBeVisible();
  await expect(page.locator(".storage-warning")).toBeVisible();
  await expect(page.locator(".overview-metric").first()).toContainText("12");
});
