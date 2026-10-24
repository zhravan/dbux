# ADR 0001: Desktop application foundation

- Status: Proposed, pending CI and driver feasibility verification
- Date: 2026-10-24

## Context

DBUX is a database-agnostic desktop workbench. It needs a focused developer UX, local credential handling, reliable query execution, and a driver boundary that can grow without database-specific logic spreading through the UI.

## Initial direction

- React + TypeScript + Vite for the renderer.
- Tauri 2 + Rust for the desktop shell and privileged backend.
- A narrow typed command boundary between renderer and backend.
- Driver implementations behind a shared contract.
- No AI features, mandatory account, or cloud dependency in the core product.

## Qualification

This decision is not final until the PostgreSQL driver spike verifies TLS, authentication, parameterized execution, cancellation, transaction semantics, and type fidelity. If the selected Rust ecosystem cannot meet those requirements reliably, evaluate an isolated sidecar or Electron before broad implementation.

## Consequences

- Rust toolchain and platform system dependencies are required for desktop builds.
- Frontend CI can run separately from Rust CI.
- Database drivers must not be allowed to bypass credential and query lifecycle controls.
- Driver capability differences must be explicit in the API and UI.
