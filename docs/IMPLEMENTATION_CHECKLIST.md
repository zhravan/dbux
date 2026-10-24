# DBUX Implementation Checklist

A developer-first, database-agnostic desktop workbench. Keep it fast, predictable, keyboard-friendly, local-first, and intentionally free of AI features, chat panels, and unnecessary product clutter.

## Product principles
- [ ] Focus the UI on connections, SQL, schemas, and results.
- [ ] Prefer explicit behavior over hidden automation.
- [ ] Make common workflows fast with keyboard navigation and shortcuts.
- [ ] Keep core functionality local; no account or cloud service required.
- [ ] Treat credentials, query history, result data, and logs as sensitive.
- [ ] Keep engine-specific behavior inside drivers/dialect modules.
- [ ] Represent unsupported capabilities honestly.
- [ ] No AI chat, generated SQL, AI agents, telemetry by default, or decorative dashboards.
- [ ] Use restrained visual hierarchy, consistent spacing, typography, focus states, and useful empty/error/loading states.
- [ ] Ship fewer features reliably rather than exposing incomplete controls.

## Phase 0 — Scope and architecture
- [ ] Define v1: desktop SQL workbench with PostgreSQL and SQLite.
- [ ] Plan MySQL/MariaDB and DuckDB next; evaluate SQL Server, Oracle, ClickHouse, and non-SQL systems later.
- [ ] Document that NoSQL systems may need native query/document experiences rather than a SQL editor.
- [ ] Compare Tauri 2 + Rust with Electron + Node.js using a short driver feasibility spike.
- [ ] Verify PostgreSQL TLS, authentication, parameterized queries, cancellation, transactions, and type fidelity before locking the runtime/driver approach.
- [ ] Record decisions for runtime, driver boundary, persistence, secrets, UI state, and packaging in `docs/decisions/`.
- [ ] Define OS support and minimum versions.
- [ ] Define v1 scope and explicit non-goals.
- [ ] Review dependency licenses; preserve the repository's MIT license and notices.

**Exit:** architecture decisions are documented, and a working prototype connects to PostgreSQL and executes a query.

## Phase 1 — Repository and DX foundation
- [ ] Establish workspace layout for desktop app, shared UI, driver API, drivers, and tests.
- [ ] Pin Node.js, package manager, Rust, and toolchain versions.
- [ ] Add lockfiles and reproducible setup instructions.
- [ ] Enable TypeScript strict mode and consistent import conventions.
- [ ] Configure formatting/linting for TypeScript, styles, and Rust.
- [ ] Add unit, integration, and end-to-end test commands.
- [ ] Add CI for formatting, lint, type-check, tests, and production build.
- [ ] Add concise contribution guide and issue templates.
- [ ] Replace placeholder README with purpose, status, setup, and known limitations.
- [ ] Ensure secrets and local environment files are ignored.
- [ ] Verify clean checkout → install → test → build.

**Exit:** a new contributor can run the app using documented commands and CI is green.

## Phase 2 — Desktop shell and UX
- [ ] Build application window and native menu.
- [ ] Implement connection/schema sidebar, central workspace, results area, and status bar.
- [ ] Support resizable panes and sensible minimum sizes.
- [ ] Add light/dark themes and shared design tokens.
- [ ] Build connection, editor, results, settings, loading, empty, error, and disconnected states.
- [ ] Add a command palette only for useful actions.
- [ ] Define and expose keyboard shortcuts.
- [ ] Ensure keyboard navigation and visible focus.
- [ ] Make active connection and destructive actions obvious.
- [ ] Avoid fake metrics, unnecessary onboarding, decorative charts, and dead controls.
- [ ] Check high-DPI and common window sizes; audit contrast and labels.

**Exit:** the primary workflow is understandable without a tutorial and all visible controls work.

## Phase 3 — Driver API and shared core
- [ ] Define typed connection config, validation, and structured errors.
- [ ] Define driver registration, identity, version, and compatibility metadata.
- [ ] Define connect/test/close lifecycle and safe reconnect semantics.
- [ ] Define query request, parameters, execution status, duration, affected rows, and error model.
- [ ] Preserve typed values: nulls, large integers, decimals, timestamps, binary and structured values where supported.
- [ ] Define catalog/schema/table/view/column/index/constraint metadata.
- [ ] Define capabilities: transactions, explain, cancellation, editable rows, schemas, SSH tunnelling.
- [ ] Define transaction state and behavior.
- [ ] Define bounded fetching, pagination/streaming, cancellation, and backpressure.
- [ ] Add mock driver and driver conformance suite.
- [ ] Version and document the internal driver API.

**Exit:** shared UI uses interfaces rather than concrete drivers; a second driver can be added without rewriting UI features.

## Phase 4 — Connections and local security
- [ ] Add, edit, duplicate, test, connect, disconnect, and delete profiles.
- [ ] Support host, port, database, user, auth options, TLS, and driver-specific settings.
- [ ] Store secrets in the OS credential store where available.
- [ ] Keep secrets out of renderer state, logs, crash reports, and exported settings.
- [ ] Persist non-secret preferences locally.
- [ ] Add read-only mode where supported.
- [ ] Handle timeouts, network loss, server restart, expired credentials, and closed sessions.
- [ ] Add SSH tunnelling after the basic lifecycle is stable.
- [ ] Export profiles without secrets by default.
- [ ] Document local data storage and deletion.

**Exit:** failed connections leave no hanging sessions; displayed connection state matches backend state; credentials do not appear in ordinary logs.

## Phase 5 — PostgreSQL vertical slice
- [ ] Implement connect/disconnect, TLS, and supported authentication.
- [ ] Implement parameterized query execution and structured results.
- [ ] Return column metadata, command status, affected rows, duration, and useful server errors.
- [ ] Implement cancellation and test races between completion and cancellation.
- [ ] Implement begin/commit/rollback and transaction-state reporting.
- [ ] Discover schemas, tables, columns, indexes, and constraints.
- [ ] Test common types: arrays, JSON/JSONB, UUID, numeric, timestamps, bytea, and large integers.
- [ ] Test invalid credentials, TLS failures, timeouts, query errors, server restarts, and disconnections.
- [ ] Run integration tests against a real PostgreSQL instance.
- [ ] Verify the complete flow: create connection → connect → execute SQL → inspect results → disconnect.

**Exit:** the full flow works against real PostgreSQL; type handling, cancellation, and transactions are tested.

## Phase 6 — SQL editor
- [ ] Integrate Monaco Editor and SQL syntax support.
- [ ] Add dialect-aware highlighting.
- [ ] Support multiple tabs and unsaved-change indicators.
- [ ] Execute current statement or selection.
- [ ] Show running/completed/cancelled/failed states.
- [ ] Display duration, row count, affected rows, and actionable errors.
- [ ] Add query cancellation.
- [ ] Add metadata-backed autocomplete without blocking the UI.
- [ ] Add searchable local query history and replay.
- [ ] Redact likely secrets and provide history deletion controls.
- [ ] Add saved queries/snippets and useful shortcuts.
- [ ] Define unsaved-query recovery behavior.
- [ ] Make dialect-specific behavior visible.

**Exit:** multiple tabs are reliable, execution does not freeze the UI, and errors are linked to their query/location when available.

## Phase 7 — Results grid
- [ ] Build a virtualized grid for large result sets.
- [ ] Render null, boolean, numeric, date/time, JSON, binary, and long text clearly.
- [ ] Distinguish null from empty string and zero.
- [ ] Support scrolling, column resizing, and clear type labels.
- [ ] Support sorting/filtering; distinguish server-side from local operations.
- [ ] Use bounded fetching/pagination rather than loading every row.
- [ ] Add copy cell/row/selection and CSV/JSON export.
- [ ] Handle empty results, command-only results, multiple result sets where supported, and errors.
- [ ] Indicate truncation, row limits, and loading.
- [ ] Test wide tables, long values, binary data, and large row counts.

**Exit:** results remain responsive within documented limits and partial/truncated results are clearly identified.

## Phase 8 — Schema explorer and editing
- [ ] Browse databases/catalogs, schemas, tables, views, and supported objects.
- [ ] Show columns, types, nullability, defaults, keys, indexes, and constraints.
- [ ] Refresh metadata and handle schema changes.
- [ ] Browse tables with bounded fetching, filters, and ordering.
- [ ] Enable edits only when rows can be identified safely.
- [ ] Make insert/update/delete explicit and reviewable.
- [ ] Show pending changes with save/discard controls.
- [ ] Use transactions where appropriate and report conflicts.
- [ ] Handle tables without primary keys without assuming row identity.
- [ ] Confirm destructive operations with connection and target details.
- [ ] Never silently change a read-only session to writable.

**Exit:** browsing is bounded, edits target intended rows, and pending changes can be discarded.

## Phase 9 — Import, export, and productivity
- [ ] Export results to CSV and JSON.
- [ ] Handle quoting, delimiters, newlines, encodings, nulls, dates, and large files.
- [ ] Import CSV with preview, column mapping, type validation, and row-level errors.
- [ ] Use transactions/batches where supported and explain partial failure.
- [ ] Add saved query organization and search.
- [ ] Add history management and clear-history controls.
- [ ] Add explain-plan retrieval where supported, with engine-specific presentation.
- [ ] Add optional dialect-aware SQL formatting.
- [ ] Defer ER diagrams, schema diff, and migration orchestration until core workflows are reliable.

**Exit:** import/export handles real-world CSV edge cases and reports exactly what succeeded or failed.

## Phase 10 — Additional drivers
### SQLite
- [ ] Open local files; support read-only mode.
- [ ] Handle paths, locking, file errors, metadata, and transactions.
- [ ] Test concurrent access and file movement/replacement scenarios.

### MySQL/MariaDB
- [ ] Implement connection, TLS/auth, execution, metadata, and cancellation where supported.
- [ ] Test quoting, transactions, time zones, decimal, JSON, and server-version differences.
- [ ] Document MySQL/MariaDB differences.

### DuckDB
- [ ] Support file-backed and in-memory sessions.
- [ ] Test analytical queries, nested values, large results, and external-file behavior.
- [ ] Document extension and file-access implications.

### Future engines
- [ ] Evaluate SQL Server, Oracle, ClickHouse, MongoDB, Redis, and warehouses based on demand and driver feasibility.
- [ ] Define native query/document experiences for non-SQL systems.
- [ ] Require contract tests, documentation, compatibility notes, and a maintained owner for every officially supported driver.

**Exit:** each driver passes applicable contract tests and engine-specific branches do not spread through shared UI.

## Phase 11 — Security, resilience, performance
- [ ] Threat-model secrets, untrusted database content, query execution, plugins, and updates.
- [ ] Apply least-privilege Tauri capabilities and narrow privileged APIs.
- [ ] Use restrictive CSP; avoid unsafe dynamic script execution.
- [ ] Treat database values/metadata as untrusted UI input.
- [ ] Review secret storage, deletion, logs, diagnostics, and crash reporting.
- [ ] Keep telemetry off by default unless separately designed, disclosed, and consented to.
- [ ] Add dependency/license and vulnerability checks.
- [ ] Stress-test large results, wide rows, slow queries, repeated cancellation, and concurrent connections.
- [ ] Test timeouts, backpressure, network loss, server restarts, expired credentials, and database locks.
- [ ] Verify close/disconnect behavior with active queries.
- [ ] Profile startup, idle memory, query overhead, and result rendering.
- [ ] Document security boundaries and known limitations.

**Exit:** no known critical security issues remain open; resource use is bounded under defined stress tests.

## Phase 12 — Packaging and releases
- [ ] Build macOS, Windows, and Linux artifacts.
- [ ] Test clean installation on each claimed platform.
- [ ] Configure signing/notarization where required and available.
- [ ] Add versioning, release notes, checksums, and GitHub Releases.
- [ ] Test upgrades and preservation of local settings.
- [ ] Document uninstall behavior and local data retention.
- [ ] Keep diagnostics free of secrets and query contents by default.
- [ ] Document supported OS versions, known limitations, and recovery steps.

**Exit:** users can install each claimed platform build and upgrade without losing settings unexpectedly.

## Phase 13 — Documentation and maintenance
- [ ] Write a concise README with status, install, development setup, and limitations.
- [ ] Document architecture, driver API, troubleshooting, and contribution workflow.
- [ ] Provide an example driver and driver contribution guide.
- [ ] Add bug/feature issue templates.
- [ ] Define supported database/OS versions and security reporting.
- [ ] Distinguish implemented, planned, and experimental features.
- [ ] Preserve MIT notices and track third-party license obligations.

## v1 definition of done
- [ ] Installs and launches on supported platforms.
- [ ] Connects to PostgreSQL and SQLite.
- [ ] Secure local credentials and TLS where applicable.
- [ ] SQL tabs, execution, cancellation, useful errors, and typed results.
- [ ] Schema/table browsing and responsive bounded result grid.
- [ ] Query history, saved queries, and basic autocomplete.
- [ ] Safe, explicit row edits where supported.
- [ ] CSV/JSON export.
- [ ] Unit, contract, integration, end-to-end, and release checks pass.
- [ ] No AI features, no required account, and no unnecessary cloud dependency.

## Explicitly out of scope for v1
- [ ] AI chat, AI-generated SQL, and AI agents.
- [ ] Cloud account, hosted synchronization, or team workspace.
- [ ] Universal support for every database at launch.
- [ ] Full ER modeling, migration orchestration, and schema diff.
- [ ] Third-party plugin marketplace before the driver API is stable.

## Working rules
- [ ] Work in small, reviewable increments with conventional commits.
- [ ] Every feature includes tests and acceptance criteria.
- [ ] Verify real workflows; compilation alone is not completion.
- [ ] Add dependencies only for concrete needs and review their licenses.
- [ ] No dead controls, fake data, or placeholder functionality in release builds.
- [ ] Update docs when behavior or architecture changes.
- [ ] Keep the main branch buildable and release scope explicit.
