import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  ChevronDown,
  CircleHelp,
  Database,
  FileClock,
  FolderOpen,
  Keyboard,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  TerminalSquare,
  Play,
  X,
} from "lucide-react";
import { useState, type KeyboardEvent } from "react";

type WorkspaceTab = "query" | "history";
type CellValue = string | number | boolean | null | Record<string, unknown> | unknown[];

interface ConnectionSummary {
  id: string;
  name: string;
  host: string;
  database: string;
}

interface QueryResult {
  columns: { name: string; dataType: string }[];
  rows: CellValue[][];
  rowsAffected: number;
  durationMs: number;
  message: string;
}

interface ConnectionForm {
  name: string;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  sslMode: string;
}

const initialConnectionForm: ConnectionForm = {
  name: "Local development",
  host: "127.0.0.1",
  port: "5432",
  database: "postgres",
  username: "postgres",
  password: "",
  sslMode: "prefer",
};

function displayCell(value: CellValue): string {
  if (value === null) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("query");
  const [showConnectionForm, setShowConnectionForm] = useState(false);
  const [form, setForm] = useState<ConnectionForm>(initialConnectionForm);
  const [connection, setConnection] = useState<ConnectionSummary | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [running, setRunning] = useState(false);
  const [sql, setSql] = useState("SELECT current_database();");
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [history, setHistory] = useState<{ sql: string; message: string; time: string }[]>([]);

  const updateForm = (field: keyof ConnectionForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const connect = async () => {
    setConnecting(true);
    setConnectionError("");
    try {
      const connected = await invoke<ConnectionSummary>("connect_postgres", {
        config: { ...form, port: Number(form.port) },
      });
      setConnection(connected);
      setShowConnectionForm(false);
      setQueryError("");
      setQueryResult(null);
    } catch (error) {
      setConnectionError(String(error));
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!connection) return;
    try {
      await invoke("disconnect_database", { connectionId: connection.id });
    } finally {
      setConnection(null);
      setQueryResult(null);
      setQueryError("");
    }
  };

  const runQuery = async () => {
    if (!connection || !sql.trim() || running) return;
    setRunning(true);
    setQueryError("");
    try {
      const result = await invoke<QueryResult>("execute_query", {
        connectionId: connection.id,
        sql,
      });
      setQueryResult(result);
      setHistory((items) => [
        { sql, message: result.message, time: new Date().toLocaleTimeString() },
        ...items,
      ]);
    } catch (error) {
      setQueryResult(null);
      setQueryError(String(error));
    } finally {
      setRunning(false);
    }
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void runQuery();
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Database size={16} strokeWidth={2.2} /></div>
          <span>dbux</span>
          <span className="brand-divider" />
          <span className="workspace-label">Workbench</span>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" aria-label="Help" title="Help"><CircleHelp size={16} /></button>
          <button className="icon-button" aria-label="Settings" title="Settings"><Settings2 size={16} /></button>
          <div className="avatar" aria-label="Local workspace">L</div>
        </div>
      </header>

      <div className="body-layout">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <span>CONNECTIONS</span>
            <button className="icon-button small" aria-label="Add connection" title="Add connection" onClick={() => setShowConnectionForm(true)}><Plus size={15} /></button>
          </div>

          {connection ? (
            <div className="connection-entry" data-testid="active-connection">
              <span className="connection-entry-icon"><Database size={15} /></span>
              <span className="connection-entry-copy">
                <strong>{connection.name}</strong>
                <small>{connection.host} · {connection.database}</small>
              </span>
              <button className="connection-disconnect" onClick={() => void disconnect()} aria-label="Disconnect database" title="Disconnect">×</button>
            </div>
          ) : (
            <button className="sidebar-empty" onClick={() => setShowConnectionForm(true)}>
              <span className="empty-icon"><Database size={17} /></span>
              <span className="empty-copy">
                <strong>No connections yet</strong>
                <small>Add a database to get started.</small>
              </span>
            </button>
          )}

          <div className="sidebar-section">
            <div className="sidebar-heading"><span>WORKSPACE</span></div>
            <button className={`nav-item ${activeTab === "query" ? "selected" : ""}`} onClick={() => setActiveTab("query")}><TerminalSquare size={15} /><span>Query editor</span><kbd>⌘ 1</kbd></button>
            <button className={`nav-item ${activeTab === "history" ? "selected" : ""}`} onClick={() => setActiveTab("history")}><FileClock size={15} /><span>Query history</span></button>
            <button className="nav-item" onClick={() => setSql("SELECT current_database();")}><FolderOpen size={15} /><span>Saved queries</span></button>
          </div>

          <div className="sidebar-bottom">
            <div className="local-note"><ShieldCheck size={14} /><span>Local-first by design</span></div>
            <button className="nav-item muted"><Keyboard size={15} /><span>Keyboard shortcuts</span><kbd>?</kbd></button>
            <button className="nav-item muted"><Activity size={15} /><span>Diagnostics</span></button>
          </div>
        </aside>

        <section className="workspace">
          <div className="workspace-toolbar">
            <div className="breadcrumbs">
              <span>Workspace</span><span className="crumb-separator">/</span>
              <strong>{activeTab === "query" ? "Query editor" : "Query history"}</strong>
            </div>
            <div className="toolbar-actions">
              <button className="secondary-button" onClick={() => setShowConnectionForm(true)}><Plus size={14} /> New connection</button>
              {connection ? (
                <button className="secondary-button connected-button" onClick={() => void disconnect()}><span className="status-dot connected" /> {connection.name} <ChevronDown size={13} /></button>
              ) : (
                <button className="primary-button" onClick={() => setShowConnectionForm(true)}><Database size={14} /> Connect <ChevronDown size={13} /></button>
              )}
            </div>
          </div>

          {activeTab === "query" ? (
            <div className="editor-layout">
              <div className="editor-tabs">
                <div className="editor-tab active"><span className="tab-dot" />Untitled query</div>
                <button className="icon-button small" aria-label="New query" onClick={() => setSql("")}><Plus size={15} /></button>
                <div className="editor-tab-spacer" />
                <span className="connection-status"><span className={`status-dot ${connection ? "connected" : ""}`} />{connection ? connection.database : "Not connected"}</span>
              </div>
              <div className="editor-canvas real-editor">
                <div className="line-numbers"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>
                <textarea
                  aria-label="SQL editor"
                  data-testid="sql-editor"
                  className="sql-editor"
                  spellCheck={false}
                  value={sql}
                  onChange={(event) => setSql(event.target.value)}
                  onKeyDown={handleEditorKeyDown}
                  placeholder="Write a SQL query…"
                />
                <div className="editor-hint">
                  <button className="run-query-button" data-testid="run-query" onClick={() => void runQuery()} disabled={!connection || running || !sql.trim()}>
                    <Play size={12} fill="currentColor" /> {running ? "Running…" : "Run query"}
                  </button>
                  <kbd>⌘ ↵</kbd>
                </div>
              </div>
              <div className="results-panel">
                <div className="results-tabs"><strong>Results</strong><span>Messages</span><div className="results-spacer" /><span className="results-meta" data-testid="query-status">{running ? "Executing…" : queryResult?.message ?? (queryError ? "Query failed" : "No query executed")}</span></div>
                {queryError ? (
                  <div className="query-error" role="alert" data-testid="query-error"><strong>Query failed</strong><span>{queryError}</span></div>
                ) : queryResult && queryResult.columns.length > 0 ? (
                  <div className="result-grid-wrap" data-testid="query-results">
                    <table className="result-grid">
                      <thead><tr>{queryResult.columns.map((column) => <th key={column.name}><span>{column.name}</span><small>{column.dataType}</small></th>)}</tr></thead>
                      <tbody>
                        {queryResult.rows.map((row, rowIndex) => (
                          <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex} data-testid={`result-cell-${rowIndex}-${columnIndex}`} className={value === null ? "null-cell" : ""}>{displayCell(value)}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                    {queryResult.rows.length === 0 && <div className="no-rows">Query returned no rows.</div>}
                  </div>
                ) : queryResult ? (
                  <div className="command-result" data-testid="query-results"><span className="success-mark">✓</span><strong>{queryResult.message}</strong><small>{queryResult.durationMs} ms</small></div>
                ) : (
                  <div className="results-empty">
                    <div className="results-empty-icon"><Search size={18} /></div>
                    <strong>{connection ? "Ready to query" : "Results will appear here"}</strong>
                    <span>{connection ? "Write SQL above and run it to inspect the result." : "Connect a database to execute SQL and inspect results."}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="history-view">
              {history.length ? history.map((item, index) => (
                <button className="history-item" key={index} onClick={() => { setSql(item.sql); setActiveTab("query"); }}>
                  <code>{item.sql}</code><span>{item.message}</span><small>{item.time}</small>
                </button>
              )) : (
                <div className="history-empty">
                  <div className="results-empty-icon"><FileClock size={18} /></div>
                  <strong>No query history</strong>
                  <span>Executed queries will be available in this session.</span>
                  <button className="secondary-button" onClick={() => setActiveTab("query")}>Open query editor</button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <footer className="statusbar">
        <div className="status-left"><span className="status-indicator" />Local workspace <span className="status-separator">·</span> {connection ? `Connected to ${connection.database}` : "No active connection"}</div>
        <div className="status-right"><span>DBUX 0.1.0</span><span className="status-separator">·</span><span>UTF-8</span><span className="status-separator">·</span><span>SQL</span></div>
      </footer>

      {showConnectionForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !connecting) setShowConnectionForm(false); }}>
          <section className="connection-modal" role="dialog" aria-modal="true" aria-labelledby="connection-title">
            <div className="modal-heading">
              <div><span className="eyebrow">DATABASE CONNECTION</span><h2 id="connection-title">Connect to PostgreSQL</h2><p>Credentials are used for this session and are not saved.</p></div>
              <button className="icon-button" aria-label="Close dialog" disabled={connecting} onClick={() => setShowConnectionForm(false)}><X size={16} /></button>
            </div>
            <label>Connection name<input aria-label="Connection name" value={form.name} onChange={(event) => updateForm("name", event.target.value)} /></label>
            <div className="form-row">
              <label>Host<input aria-label="Host" value={form.host} onChange={(event) => updateForm("host", event.target.value)} autoComplete="off" /></label>
              <label>Port<input aria-label="Port" type="number" value={form.port} onChange={(event) => updateForm("port", event.target.value)} /></label>
            </div>
            <label>Database<input aria-label="Database" value={form.database} onChange={(event) => updateForm("database", event.target.value)} autoComplete="off" /></label>
            <label>Username<input aria-label="Username" value={form.username} onChange={(event) => updateForm("username", event.target.value)} autoComplete="username" /></label>
            <label>Password<input aria-label="Password" type="password" value={form.password} onChange={(event) => updateForm("password", event.target.value)} autoComplete="current-password" /></label>
            <label>SSL mode<select aria-label="SSL mode" value={form.sslMode} onChange={(event) => updateForm("sslMode", event.target.value)}><option value="prefer">Prefer</option><option value="require">Require</option><option value="verify-ca">Verify CA</option><option value="verify-full">Verify full</option><option value="disable">Disable (local only)</option></select></label>
            {connectionError && <div className="form-error" role="alert" data-testid="connection-error">{connectionError}</div>}
            <div className="modal-footer"><button className="secondary-button" disabled={connecting} onClick={() => setShowConnectionForm(false)}>Cancel</button><button className="primary-button" data-testid="connect-database" disabled={connecting} onClick={() => void connect()}>{connecting ? "Connecting…" : "Connect to database"}</button></div>
            <div className="form-note"><ShieldCheck size={15} /><span>Credentials are not persisted. Avoid connecting to untrusted databases.</span></div>
          </section>
        </div>
      )}
    </main>
  );
}