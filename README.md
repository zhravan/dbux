# DBUX

A focused, database-agnostic desktop workbench for developers.

DBUX is built around a simple idea: database work should feel fast, predictable, and uncluttered. The product prioritizes SQL, schema browsing, query results, keyboard workflows, and reliable local connections.

## Product principles

- Developer experience first; restrained UI and useful keyboard shortcuts.
- Local-first core functionality.
- Database engines integrated through a shared driver contract.
- Secure credential handling and bounded query results.
- No AI chat, generated SQL, mandatory account, or unnecessary cloud dependency.

## Project status

Early development. The current implementation supports connecting to PostgreSQL, executing SQL from the desktop UI, and displaying query results with a bounded streaming limit of 1,000 rows per query. When a result exceeds that limit, DBUX marks it as truncated instead of silently presenting a partial result as complete. SQLite support, secure OS credential storage, query cancellation, schema browsing, editable rows, and additional drivers are not implemented yet.

See [the implementation checklist](docs/IMPLEMENTATION_CHECKLIST.md) for the phased roadmap and acceptance criteria.

## Development

Requirements:
- Node.js 22+
- npm
- Rust stable and Cargo
- Platform dependencies required by Tauri 2

Install frontend dependencies and run the web shell:

```sh
npm install
npm run dev
```

Type-check and build the frontend:

```sh
npm run typecheck
npm run build
```

Run the desktop application:

```sh
npm run tauri dev
```

Rust checks:

```sh
cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all
```

Desktop UI + PostgreSQL integration test (Linux CI dependencies, PostgreSQL service, and `tauri-driver` required):

```sh
npm run test:e2e
```

## License

MIT. See [LICENSE](LICENSE).
