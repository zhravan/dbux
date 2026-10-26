# DBUX

A focused, database-agnostic desktop workbench for developers.

DBUX is built around a simple idea: database work should feel fast, predictable, and uncluttered. The product prioritizes SQL, schema browsing, query results, keyboard workflows, and reliable local connections.

## Install DBUX

Installers for Linux, macOS, and Windows are published on the [GitHub Releases page](https://github.com/zhravan/dbux/releases/latest).

### One-command install

**Linux / macOS:**

```sh
curl -fsSL https://raw.githubusercontent.com/zhravan/dbux/main/scripts/install.sh | sh
```

The script selects a Linux AppImage/.deb or macOS DMG from the latest release. Linux AppImages install under your home directory; a .deb install may ask for sudo.

**Windows PowerShell:**

```powershell
irm https://raw.githubusercontent.com/zhravan/dbux/main/scripts/install.ps1 | iex
```

Review the installer script before piping it directly into PowerShell.

Manual installers: [latest release assets](https://github.com/zhravan/dbux/releases/latest).

### Release process

Push a version tag to build and publish platform-specific installer artifacts:

```sh
git tag v0.1.0
git push origin v0.1.0
```

CI runs on pull requests and pushes to `main`; feature branch pushes do not trigger a duplicate full run. Newer commits cancel superseded checks for the same PR.

## Export query results to CSV

The query result grid includes an **Export CSV** action when a query returns columns. It exports only the result rows currently returned by DBUX (up to its existing 1,000-row cap). Fields are quoted, embedded quotes are escaped, commas and line breaks are preserved, UTF-8 output includes a BOM, and formula-like text fields are prefixed with an apostrophe. SQL NULL and empty text both export as empty CSV fields.

## Product principles

- Developer experience first; restrained UI and useful keyboard shortcuts.
- Local-first core functionality.
- Database engines integrated through a shared driver contract.
- Secure credential handling and bounded query results.
- No AI chat, generated SQL, mandatory account, or unnecessary cloud dependency.

## Project status

Early development. The current implementation supports connecting to PostgreSQL, browsing visible schemas/tables/views and their columns, previewing table rows with an explicit server-side LIMIT and a 1,000-row display cap, and executing SQL from the desktop UI with a bounded streaming limit of 1,000 rows per query. The schema explorer shows column types, nullability, defaults, primary-key columns, index definitions, and primary-key, foreign-key, unique, check, and exclusion constraint definitions. Truncated results are marked explicitly; supported PostgreSQL decoding errors are surfaced instead of being misreported as SQL NULL, and BIGINT values remain exact in the UI. SQLite support, secure OS credential storage, query cancellation, editable rows, and additional drivers are not implemented yet.

See [the implementation checklist](docs/IMPLEMENTATION_CHECKLIST.md) for the phased roadmap and acceptance criteria.

## Development

Requirements: Node.js 22+, npm, Rust stable/Cargo, and Tauri 2 platform dependencies.

```sh
npm install
npm run dev
npm run typecheck
npm run build
npm run tauri dev
```

Rust checks (from `src-tauri`):

```sh
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all
```

Desktop UI + PostgreSQL integration tests require the Linux CI dependencies, PostgreSQL service, and `tauri-driver`:

```sh
npm run test:e2e
```

## License

MIT. See [LICENSE](LICENSE).
