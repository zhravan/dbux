import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Builder, By, until } from "selenium-webdriver";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const application = path.join(root, "src-tauri", "target", "release", "dbux");
const driverUrl = "http://127.0.0.1:4444";
let tauriDriver;
let browser;

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
  await element.clear();
  await element.sendKeys(value);
}

async function waitForConnection() {
  return browser.wait(
    async () => {
      const names = await browser.findElements(By.css('[data-testid="active-connection"] .connection-entry-copy strong'));
      if (names.length) return { ok: true, detail: await names[0].getText() };

      const errors = await browser.findElements(By.css('[data-testid="connection-error"]'));
      if (errors.length) {
        const detail = await errors[0].getText();
        if (detail.trim()) return { ok: false, detail };
      }
      return false;
    },
    15_000,
    "Connection attempt neither succeeded nor returned a visible error",
  );
}

async function executeSql(statement, expectedStatus) {
  await fill('[data-testid="sql-editor"]', statement);
  await click('[data-testid="run-query"]');
  return browser.wait(
    async () => {
      const element = await browser.findElement(By.css('[data-testid="query-status"]'));
      const text = await element.getText();
      if (text.includes("Query failed")) {
        const errors = await browser.findElements(By.css('[data-testid="query-error"]'));
        const detail = errors.length ? await errors[0].getText() : text;
        throw new Error(`SQL failed: ${detail}`);
      }
      return text.includes(expectedStatus) ? text : false;
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
  await click('[data-testid="connect-database"]');

  const connection = await waitForConnection();
  assert.equal(
    connection.ok,
    true,
    `Could not connect to the PostgreSQL service: ${connection.detail}`,
  );
  assert.match(connection.detail, /CI PostgreSQL/);

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
    until.elementLocated(By.css('[data-testid="result-cell-0-1"]')),
    10_000,
  );
  assert.equal(await insertedCell.getText(), insertedLabel);

  await executeSql("SELECT id, label FROM dbux_e2e_items ORDER BY id", "Query completed");
  const selectedCell = await browser.wait(
    until.elementLocated(By.css('[data-testid="result-cell-0-1"]')),
    10_000,
  );
  assert.equal(await selectedCell.getText(), insertedLabel);
});
