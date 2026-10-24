import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Builder, By, Key, until } from "selenium-webdriver";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const application = path.join(root, "src-tauri", "target", "release", "dbux");
const screenshotDirectory = path.join(root, "artifacts", "screenshots");
const driverUrl = "http://127.0.0.1:4444";
let tauriDriver;
let browser;

async function captureScreenshot(filename) {
  await mkdir(screenshotDirectory, { recursive: true });
  const screenshot = await browser.takeScreenshot();
  await writeFile(path.join(screenshotDirectory, filename), Buffer.from(screenshot, "base64"));
}

async function readDom(selector, property = "textContent") {
  return browser.executeScript(
    "const element = document.querySelector(arguments[0]); return element ? element[arguments[1]] : null;",
    selector,
    property,
  );
}

async function waitForDriver() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(driverUrl + "/status");
      if (response.ok) return;
    } catch {
      // The driver process may need a moment to bind its port.
    }
    await delay(250);
  }
  throw new Error("tauri-driver did not start within 20 seconds");
}

async function click(selector) {
  const element = await browser.wait(until.elementLocated(By.css(selector)), 10_000);
  await browser.wait(until.elementIsVisible(element), 5_000);
  await element.click();
}

async function fill(selector, value) {
  const element = await browser.wait(until.elementLocated(By.css(selector)), 10_000);
  await browser.wait(until.elementIsVisible(element), 5_000);
  await element.click();
  await element.sendKeys(Key.chord(Key.CONTROL, "a"));
  await element.sendKeys(value);
  await browser.wait(
    async () => (await element.getDomProperty("value")) === value,
    3_000,
    `Input ${selector} did not retain the requested value`,
  );
}

async function waitForConnection() {
  const deadline = Date.now() + 15_000;
  let lastDiagnostic = {};

  while (Date.now() < deadline) {
    lastDiagnostic = await browser.executeScript(() => {
      const active = document.querySelector('[data-testid="active-connection"]');
      const name = active?.querySelector(".connection-entry-copy strong")?.textContent?.trim() ?? "";
      const error = document.querySelector('[data-testid="connection-error"]')?.textContent?.trim() ?? "";
      return {
        active: Boolean(active),
        name,
        error,
        activeHtml: active?.innerHTML ?? "",
      };
    });

    if (lastDiagnostic.name) return { ok: true, detail: lastDiagnostic.name };
    if (lastDiagnostic.error) return { ok: false, detail: lastDiagnostic.error };
    await delay(200);
  }

  throw new Error(`Connection did not finish. UI diagnostic: ${JSON.stringify(lastDiagnostic)}`);
}

async function executeSql(statement, expectedStatus) {
  await fill('[data-testid="sql-editor"]', statement);
  await click('[data-testid="run-query"]');

  return browser.wait(
    async () => {
      const status = (await readDom('[data-testid="query-status"]')) ?? "";
      if (status.includes("Query failed")) {
        const detail = (await readDom('[data-testid="query-error"]')) ?? status;
        throw new Error(`SQL failed: ${detail}`);
      }
      return status.includes(expectedStatus) ? status : false;
    },
    15_000,
    `Query did not reach status: ${expectedStatus}`,
  );
}

before(async () => {
  tauriDriver = spawn("tauri-driver", [], { stdio: ["ignore", "pipe", "pipe"] });
  tauriDriver.stdout.on("data", (chunk) => process.stdout.write(`[tauri-driver] ${chunk}`));
  tauriDriver.stderr.on("data", (chunk) => process.stderr.write(`[tauri-driver] ${chunk}`));
  await waitForDriver();

  browser = await new Builder()
    .usingServer(driverUrl)
    .withCapabilities({
      browserName: "wry",
      "tauri:options": { application },
    })
    .build();
});

after(async () => {
  if (browser) {
    try {
      await browser.quit();
    } catch {
      // Preserve the test failure if the WebDriver session already exited.
    }
  }
  if (tauriDriver && !tauriDriver.killed) tauriDriver.kill("SIGTERM");
});

test("connects to PostgreSQL and inserts/reads a row through the desktop UI", async () => {
  try {
    await browser.wait(until.elementLocated(By.css(".app-shell")), 15_000);
    await click(".workspace-toolbar .primary-button");
    await browser.wait(until.elementLocated(By.css('[data-testid="connect-database"]')), 5_000);

    await fill('input[aria-label="Connection name"]', "CI PostgreSQL");
    await fill('input[aria-label="Host"]', process.env.DBUX_TEST_DB_HOST ?? "127.0.0.1");
    await fill('input[aria-label="Port"]', process.env.DBUX_TEST_DB_PORT ?? "5432");
    await fill('input[aria-label="Database"]', process.env.DBUX_TEST_DB_NAME ?? "dbux_test");
    await fill('input[aria-label="Username"]', process.env.DBUX_TEST_DB_USER ?? "dbux_test");
    await fill('input[aria-label="Password"]', process.env.DBUX_TEST_DB_PASSWORD ?? "dbux_test");

    const sslMode = await browser.findElement(By.css('select[aria-label="SSL mode"]'));
    await sslMode.sendKeys("Disable (local only)");
    assert.equal(await readDom('select[aria-label="SSL mode"]', "value"), "disable");
    await click('[data-testid="connect-database"]');

    const connection = await waitForConnection();
    assert.equal(connection.ok, true, `Could not connect to PostgreSQL: ${connection.detail}`);
    assert.equal(connection.detail, "CI PostgreSQL", "Connected database name should match the submitted name");
    await captureScreenshot("01-connected.png");

    await executeSql(
      "CREATE TABLE IF NOT EXISTS dbux_e2e_items (id BIGSERIAL PRIMARY KEY, label TEXT NOT NULL)",
      "Statement completed",
    );
    await executeSql("TRUNCATE TABLE dbux_e2e_items RESTART IDENTITY", "Statement completed");

    const insertedLabel = `inserted-through-ui-${Date.now()}`;
    await executeSql(
      `INSERT INTO dbux_e2e_items (label) VALUES ('${insertedLabel}') RETURNING id, label`,
      "Query completed",
    );
    const insertedCell = await browser.wait(
      async () => {
        const value = await readDom('[data-testid="result-cell-0-1"]');
        return value === insertedLabel ? value : false;
      },
      10_000,
      "Inserted row was not shown in the results grid",
    );
    assert.equal(insertedCell, insertedLabel);
    await captureScreenshot("02-insert-returning.png");

    await executeSql("SELECT id, label FROM dbux_e2e_items ORDER BY id", "Query completed");
    const selectedCell = await browser.wait(
      async () => {
        const value = await readDom('[data-testid="result-cell-0-1"]');
        return value === insertedLabel ? value : false;
      },
      10_000,
      "Inserted row could not be read back from PostgreSQL",
    );
    assert.equal(selectedCell, insertedLabel);
    await captureScreenshot("03-select-readback.png");
  } catch (error) {
    if (browser) {
      try {
        await captureScreenshot("failure.png");
      } catch {
        // Preserve the original failure if a screenshot cannot be captured.
      }
    }
    throw error;
  }
});
