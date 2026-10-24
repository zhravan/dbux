# DBUX

A focused, database-agnostic desktop workbench for developers.

DBUX is being built around a simple idea: database work should feel fast, predictable, and uncluttered. The product prioritizes SQL, schema browsing, query results, keyboard workflows, and reliable local connections.

## Product principles

- Developer experience first; restrained UI and useful keyboard shortcuts.
- Local-first core functionality.
- Database engines integrated through a shared driver contract.
- Secure credential handling and bounded query results.
- No AI chat, generated SQL, mandatory account, or unnecessary cloud dependency.

## Project status

Early development. The current branch establishes the desktop shell and developer tooling. Database connectivity, query execution, and editable results are not implemented yet.

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

## License

MIT. See [LICENSE](LICENSE).
