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

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function captureScreenshot(filename) {
  await mkdir(screenshotDirectory, { recursive: true });
  const screenshot = await withTimeout(browser.takeScreenshot(), 8_000, `Screenshot ${filename}`);
  await writeFile(path.join(screenshotDirectory, filename), Buffer.from(screenshot, "base64"));
  console.log(`[e2e] Screenshot saved: ${filename}`);
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
  await element.clear();
  await element.sendKeys(value);
  await browser.wait(
    async () => (await readDom(selector, "value")) === value,
    Math.max(3_000, Math.min(10_000, value.length * 15)),
    `Input ${selector} did not retain the requested value (${value.length} characters)`,
  );
}

async function waitForConnection() {
  const deadline = Date.now() + 15_000;
  let lastDiagnostic = {};

  while (Date.now() < deadline) {
    const active = await browser.findElements(By.css('[data-testid="active-connection"]'));
    const name = ((await readDom('[data-testid="active-connection"] .connection-entry-copy strong')) ?? "").trim();
    const error = ((await readDom('[data-testid="connection-error"]')) ?? "").trim();

    lastDiagnostic = {
      active: active.length > 0,
      name,
      error,
      activeHtml: active.length ? await readDom('[data-testid="active-connection"]', "innerHTML") : "",
    };

    if (name) return { ok: true, detail: name };
    if (error) return { ok: false, detail: error };
    await delay(200);
  }

  throw new Error(`Connection did not finish. UI diagnostic: ${JSON.stringify(lastDiagnostic)}`);
}

async function executeSql(statement, expectedStatus) {
  await fill('[data-testid="sql-editor"]', statement);
  await click('[data-testid="run-query"]');
  console.log(`[e2e] Executed SQL: ${statement.split("\n")[0].slice(0, 100)}`);

  return browser.wait(
    async () => {
      const status = ((await readDom('[data-testid="query-status"]')) ?? "").trim();
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
      await withTimeout(browser.quit(), 8_000, "Closing WebDriver session");
    } catch {
      // Preserve the test failure if the WebDriver session already exited or hangs.
    }
  }
  if (tauriDriver && !tauriDriver.killed) tauriDriver.kill("SIGTERM");
});

test(
  "connects to PostgreSQL and inserts/reads a row through the desktop UI",
  { timeout: 150_000 },
  async () => {
    try {
      await browser.wait(until.elementLocated(By.css(".app-shell")), 15_000);
      console.log("[e2e] Desktop shell loaded");
      console.log("[e2e] Desktop shell loaded");
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
      console.log("[e2e] Submitted PostgreSQL connection");
      console.log("[e2e] Submitted PostgreSQL connection");

      const connection = await waitForConnection();
      assert.equal(connection.ok, true, `Could not connect to PostgreSQL: ${connection.detail}`);
      assert.equal(connection.detail, "CI PostgreSQL", "Connected database name should match the submitted name");
      await captureScreenshot("01-connected.png");

      await executeSql(
        "CREATE TABLE IF NOT EXISTS dbux_e2e_items (id BIGSERIAL PRIMARY KEY, label TEXT NOT NULL UNIQUE, CONSTRAINT dbux_e2e_items_label_check CHECK (length(label) > 0))",
        "Statement completed",
      );
      await executeSql(
        "CREATE TABLE IF NOT EXISTS dbux_e2e_items_child (id BIGSERIAL PRIMARY KEY, item_id BIGINT NOT NULL REFERENCES dbux_e2e_items(id), CONSTRAINT dbux_e2e_items_child_item_id_check CHECK (item_id > 0))",
        "Statement completed",
      );
      await executeSql("TRUNCATE TABLE dbux_e2e_items_child, dbux_e2e_items RESTART IDENTITY", "Statement completed");

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

      await click('[data-testid="schema-explorer-nav"]');
      await browser.wait(
        async () =>
          (await readDom('[data-testid="schema-toggle-public"]')) !== null &&
          (await readDom('[data-testid="schema-loading"]')) === null,
        15_000,
        "Schema explorer did not load the public schema",
      );
      await click('[data-testid="schema-toggle-public"]');
      await browser.wait(
        async () => (await readDom('[data-testid="schema-object-public-dbux_e2e_items"]')) !== null,
        10_000,
        "The integration table was not listed by the schema explorer",
      );
      await click('[data-testid="schema-object-public-dbux_e2e_items"]');
      const idColumn = await browser.wait(
        async () => {
          const value = await readDom('[data-testid="schema-column-public-dbux_e2e_items-id"]');
          return value || false;
        },
        10_000,
        "The table ID column was not shown",
      );
      assert.match(idColumn, /id.*bigint/i);
      assert.match(idColumn, /PK/);
      assert.match(idColumn, /NOT NULL/);
      const labelColumn = await readDom('[data-testid="schema-column-public-dbux_e2e_items-label"]');
      assert.match(labelColumn, /label.*text/i);
      assert.match(labelColumn, /NOT NULL/);

      const primaryIndex = await readDom('[data-testid="schema-index-public-dbux_e2e_items-dbux_e2e_items_pkey"]');
      assert.match(primaryIndex, /PRIMARY KEY/);
      const uniqueIndex = await readDom('[data-testid="schema-index-public-dbux_e2e_items-dbux_e2e_items_label_key"]');
      assert.match(uniqueIndex, /UNIQUE/);
      const primaryConstraint = await readDom('[data-testid="schema-constraint-public-dbux_e2e_items-dbux_e2e_items_pkey"]');
      assert.match(primaryConstraint, /Primary key/);
      const uniqueConstraint = await readDom('[data-testid="schema-constraint-public-dbux_e2e_items-dbux_e2e_items_label_key"]');
      assert.match(uniqueConstraint, /Unique/);
      const checkConstraint = await readDom('[data-testid="schema-constraint-public-dbux_e2e_items-dbux_e2e_items_label_check"]');
      assert.match(checkConstraint, /Check/);
      await click('[data-testid="schema-object-public-dbux_e2e_items_child"]');
      const foreignKeyConstraint = await browser.wait(
        async () => {
          const value = await readDom('[data-testid="schema-constraint-public-dbux_e2e_items_child-dbux_e2e_items_child_item_id_fkey"]');
          return value || false;
        },
        10_000,
        "The foreign-key constraint was not shown for the child table",
      );
      assert.match(foreignKeyConstraint, /Foreign key/);
      await captureScreenshot("04-schema-explorer.png");
      await click('[data-testid="preview-table-public-dbux_e2e_items"]');
      await browser.wait(
        async () => {
          const status = ((await readDom('[data-testid="query-status"]')) ?? "").trim();
          const editorValue = await readDom('[data-testid="sql-editor"]', "value");
          const previewLabel = await readDom('[data-testid="result-cell-0-1"]');
          return status.includes("Query completed") &&
            editorValue === 'SELECT * FROM "public"."dbux_e2e_items" LIMIT 1001;' &&
            previewLabel === insertedLabel;
        },
        15_000,
        "Table preview did not load the inserted row in the query results",
      );
      assert.equal(
        await readDom('[data-testid="result-cell-0-1"]'),
        insertedLabel,
        "Table preview should read the real PostgreSQL row",
      );
      assert.match(
        await readDom('[data-testid="sql-editor"]', "value"),
        /LIMIT 1001;/,
        "Table preview must use a fixed server-side LIMIT above the 1,000-row display cap",
      );
      await captureScreenshot("05-table-preview.png");

      const typedValuesSql = `SELECT NULL::TEXT AS actual_null, ''::TEXT AS empty_text, 9223372036854775807::BIGINT AS big_integer, 12345678901234567890.123456789::NUMERIC AS exact_decimal, '{"pet":"dog","count":2}'::JSONB AS document, '2026-10-26 12:34:56'::TIMESTAMP AS local_timestamp, '2026-10-26 12:34:56+00'::TIMESTAMPTZ AS utc_timestamp, '550e8400-e29b-41d4-a716-446655440000'::UUID AS identifier, decode('00ff10', 'hex')::BYTEA AS payload`;
      await executeSql(typedValuesSql, "Query completed");

      assert.equal(await readDom('[data-testid="result-cell-0-0"]'), "NULL");
      assert.equal(await readDom('[data-testid="result-cell-0-0"]', "className"), "null-cell");
      assert.equal(await readDom('[data-testid="result-cell-0-1"]'), "");
      assert.notEqual(await readDom('[data-testid="result-cell-0-1"]', "className"), "null-cell");
      assert.equal(
        await readDom('[data-testid="result-cell-0-2"]'),
        "9223372036854775807",
        "BIGINT values must not lose precision in the JavaScript UI",
      );
      assert.equal(
        await readDom('[data-testid="result-cell-0-3"]'),
        "12345678901234567890.123456789000",
        "NUMERIC values should retain every decimal digit returned by PostgreSQL",
      );
      const jsonValue = await readDom('[data-testid="result-cell-0-4"]');
      assert.match(jsonValue, /"count":2/);
      assert.match(jsonValue, /"pet":"dog"/);
      assert.equal(await readDom('[data-testid="result-cell-0-5"]'), "2026-10-26 12:34:56");
      assert.equal(await readDom('[data-testid="result-cell-0-6"]'), "2026-10-26T12:34:56+00:00");
      assert.equal(
        await readDom('[data-testid="result-cell-0-7"]'),
        "550e8400-e29b-41d4-a716-446655440000",
      );
      assert.equal(await readDom('[data-testid="result-cell-0-8"]'), "00ff10");
      await captureScreenshot("06-type-fidelity.png");

      await executeSql("SELECT generate_series(1, 1001) AS n", "result truncated at 1000");
      const visibleRows = await browser.executeScript(
        "return document.querySelectorAll('.result-grid tbody tr').length;",
      );
      assert.equal(visibleRows, 1000, "The result grid should render no more than 1,000 rows");
      const truncationNotice = ((await readDom('[data-testid="result-truncation"]')) ?? "").replaceAll(",", "");
      assert.match(
        truncationNotice,
        /Showing the first 1000 rows/,
        "The UI should explain that results have been truncated",
      );
      await captureScreenshot("07-result-limit.png");

      await executeSql(
        `SELECT 'plain'::TEXT AS plain, 'with,comma'::TEXT AS comma_value, 'say "hi"'::TEXT AS quoted_value, E'line1\\nline2'::TEXT AS multiline_value, '=1+1'::TEXT AS spreadsheet_formula, NULL::TEXT AS null_value, ''::TEXT AS empty_text`,
        "Query completed",
      );
      await browser.executeScript(`
        window.__dbuxOriginalCreateObjectURL = URL.createObjectURL.bind(URL);
        window.__dbuxCsvExportText = null;
        URL.createObjectURL = (blob) => {
          blob.text().then((text) => { window.__dbuxCsvExportText = text; });
          return window.__dbuxOriginalCreateObjectURL(blob);
        };
      `);
      await click('[data-testid="export-results-csv"]');
      const exportedCsv = await browser.wait(
        async () => {
          const value = await browser.executeScript("return window.__dbuxCsvExportText;");
          return typeof value === "string" ? value : false;
        },
        10_000,
        "CSV export did not produce a downloadable file payload",
      );
      const csv = exportedCsv.replace(/^\uFEFF/, "");
      assert.ok(
        csv.startsWith('"plain","comma_value","quoted_value","multiline_value","spreadsheet_formula","null_value","empty_text"\r\n'),
        "CSV should include all result column headers in order",
      );
      const expectedRow = `"plain","with,comma","say ""hi""","line1\nline2","'=1+1","",""\r\n`;
      assert.ok(csv.includes(expectedRow), `CSV row should correctly escape commas, quotes, newlines, and formula-like text: ${JSON.stringify(csv)}`);
      assert.ok(exportedCsv.startsWith("\uFEFF"), "CSV downloads should include a UTF-8 BOM for spreadsheet compatibility");
      await captureScreenshot("08-csv-export.png");

      await executeSql("SELECT 1 AS connection_still_usable", "Query completed");
      assert.equal(
        await readDom('[data-testid="result-cell-0-0"]'),
        "1",
        "The PostgreSQL connection should remain usable after stopping a result stream early",
      );
    } catch (error) {
      if (browser) {
        try {
          await captureScreenshot("failure.png");
        } catch (screenshotError) {
          console.warn(`[e2e] Could not capture failure screenshot: ${String(screenshotError)}`);
        }
      }
      throw error;
    }
  },
);
