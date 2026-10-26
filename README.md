<p align="center">
  <img src="src-tauri/icons/icon-source.png" alt="DBUX logo" width="180" />
</p>

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

The script selects a Linux `.deb`, `.rpm`, or AppImage based on the local package manager and CPU architecture. Debian/Ubuntu packages may ask for `sudo`; AppImages install under your home directory. macOS installers cover Apple Silicon and Intel Macs and install to `~/Applications`.

**Windows PowerShell:**

```powershell
irm https://raw.githubusercontent.com/zhravan/dbux/main/scripts/install.ps1 | iex
```

Review the installer script before piping it directly into PowerShell.

Manual installers: [latest release assets](https://github.com/zhravan/dbux/releases/latest). Mac builds use an ad-hoc signature but are not notarized; Windows builds are not code-signed yet, so the operating system may show a security/publisher warning.

### Releases and semantic versioning

Releases use [Conventional Commits](https://www.conventionalcommits.org/) and SemVer. Use these prefixes in PR titles/squash-merge commit messages:

- `fix: ...` — patch release (for example, `0.1.0` → `0.1.1`).
- `feat: ...` — minor release (for example, `0.1.0` → `0.2.0`).
- `feat!: ...` or a `BREAKING CHANGE:` footer — breaking change; before `1.0.0`, this advances the minor version.

When releasable commits land on `main`, Release Please opens or updates a release PR with the generated changelog and synchronized versions in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `.release-please-manifest.json`. Review and merge that PR to create a `vMAJOR.MINOR.PATCH` tag and a draft GitHub Release with generated release notes.

The release workflow builds Linux x64 (`.AppImage`, `.deb`, `.rpm`), macOS Apple Silicon and Intel (`.dmg`), and Windows x64 (`.msi`, `.exe`). It verifies that each installer format exists, uploads the artifacts, and only then publishes the release and marks it **Latest**. If a build fails, the release remains a draft so the same tag can be retried from **Actions → Release desktop installers** using `workflow_dispatch` and the tag, such as `v0.2.0`.

Do not create or move release tags by hand. Keep PR titles/squash commits Conventional Commit-compliant so the automated version bump is predictable. A repository administrator must allow GitHub Actions to create pull requests in **Settings → Actions → General** for Release Please to maintain the release PR.

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
