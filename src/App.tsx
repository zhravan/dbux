import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Database,
  Download,
  FileClock,
  FolderOpen,
  Keyboard,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  TerminalSquare,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import { useState, type KeyboardEvent } from "react";

type WorkspaceTab = "query" | "history" | "schema";
type CellValue = string | number | boolean | null | Record<string, unknown> | unknown[];

interface SchemaColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
}

interface SchemaIndex {
  name: string;
  definition: string;
  unique: boolean;
  primary: boolean;
}

interface SchemaConstraint {
  name: string;
  constraintType: string;
  definition: string;
}

interface SchemaObject {
  schemaName: string;
  objectName: string;
  objectType: string;
  columns: SchemaColumn[];
  indexes: SchemaIndex[];
  constraints: SchemaConstraint[];
}

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
  truncated: boolean;
  rowLimit: number;
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

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function csvField(value: CellValue): string {
  let text = value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (typeof value === "string" && ["=", "+", "-", "@", "\t", "\r", "\n"].some((prefix) => text.startsWith(prefix))) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

function queryResultCsv(result: QueryResult): string {
  const header = result.columns.map((column) => csvField(column.name)).join(",");
  const rows = result.rows.map((row) => row.map(csvField).join(","));
  return `\uFEFF${[header, ...rows].join("\r\n")}\r\n`;
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
  const [schemaObjects, setSchemaObjects] = useState<SchemaObject[]>([]);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState("");
  const [expandedSchemas, setExpandedSchemas] = useState<string[]>([]);
  const [expandedObjects, setExpandedObjects] = useState<string[]>([]);

  const refreshSchema = async () => {
    if (!connection) {
      setSchemaObjects([]);
      setSchemaError("");
      return;
    }

    setSchemaLoading(true);
    setSchemaError("");
    try {
      const objects = await invoke<SchemaObject[]>("list_schema_objects", {
        connectionId: connection.id,
      });
      setSchemaObjects(objects);
      setExpandedSchemas((current) =>
        current.filter((schemaName) => objects.some((object) => object.schemaName === schemaName)),
      );
      setExpandedObjects([]);
    } catch (error) {
      setSchemaError(String(error));
    } finally {
      setSchemaLoading(false);
    }
  };

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
      setSchemaObjects([]);
      setSchemaError("");
      setExpandedSchemas([]);
      setExpandedObjects([]);
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
      setSchemaObjects([]);
      setSchemaError("");
      setExpandedSchemas([]);
      setExpandedObjects([]);
      setQueryResult(null);
      setQueryError("");
    }
  };

  const runQuery = async (statement = sql) => {
    if (!connection || !statement.trim() || running) return;
    setSql(statement);
    setActiveTab("query");
    setRunning(true);
    setQueryError("");
    try {
      const result = await invoke<QueryResult>("execute_query", {
        connectionId: connection.id,
        sql: statement,
      });
      setQueryResult(result);
      setHistory((items) => [
        { sql: statement, message: result.message, time: new Date().toLocaleTimeString() },
        ...items,
      ]);
    } catch (error) {
      setQueryResult(null);
      setQueryError(String(error));
    } finally {
      setRunning(false);
    }
  };

  const openSchemaExplorer = () => {
    setActiveTab("schema");
    void refreshSchema();
  };

  const previewTable = (schemaName: string, tableName: string) => {
    const statement = `SELECT * FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} LIMIT 1001;`;
    void runQuery(statement);
  };

  const exportResultsCsv = () => {
    if (!queryResult || queryResult.columns.length === 0) return;
    const blob = new Blob([queryResultCsv(queryResult)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `dbux-results-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
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
            <button className={`nav-item ${activeTab === "query" ? "selected" : ""}`} data-testid="query-editor-nav" onClick={() => setActiveTab("query")}><TerminalSquare size={15} /><span>Query editor</span><kbd>⌘ 1</kbd></button>
            <button className={`nav-item ${activeTab === "history" ? "selected" : ""}`} onClick={() => setActiveTab("history")}><FileClock size={15} /><span>Query history</span></button>
            <button className={`nav-item ${activeTab === "schema" ? "selected" : ""}`} data-testid="schema-explorer-nav" onClick={openSchemaExplorer}><Database size={15} /><span>Schema explorer</span></button>
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
              <strong>{activeTab === "query" ? "Query editor" : activeTab === "history" ? "Query history" : "Schema explorer"}</strong>
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
                <div className="results-tabs">
                  <strong>Results</strong>
                  <span>Messages</span>
                  <div className="results-spacer" />
                  {queryResult && queryResult.columns.length > 0 && (
                    <button
                      className="secondary-button export-csv-button"
                      data-testid="export-results-csv"
                      disabled={running}
                      onClick={exportResultsCsv}
                      title="Export the currently displayed result set to CSV"
                    >
                      <Download size={12} /> Export CSV
                    </button>
                  )}
                  <span className="results-meta" data-testid="query-status">{running ? "Executing…" : queryResult?.message ?? (queryError ? "Query failed" : "No query executed")}</span>
                </div>
                {queryError ? (
                  <div className="query-error" role="alert" data-testid="query-error"><strong>Query failed</strong><span>{queryError}</span></div>
                ) : queryResult && queryResult.columns.length > 0 ? (
                  <div className="result-grid-wrap" data-testid="query-results">
                    {queryResult.truncated && (
                      <div className="result-truncation" role="status" data-testid="result-truncation">
                        Showing the first {queryResult.rowLimit.toLocaleString()} rows. Additional rows were omitted to keep results responsive.
                      </div>
                    )}
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
          ) : activeTab === "history" ? (
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
          ) : (
            <div className="schema-view" data-testid="schema-explorer">
              <div className="schema-toolbar">
                <div>
                  <h2>Schema explorer</h2>
                  <p>{connection ? `Objects in ${connection.database}. Refresh to load current metadata.` : "Connect to PostgreSQL to browse tables, views, and columns."}</p>
                </div>
                <button className="secondary-button" data-testid="refresh-schema" disabled={!connection || schemaLoading} onClick={() => void refreshSchema()}>
                  <RefreshCw size={13} /> {schemaLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              {!connection ? (
                <div className="schema-empty">
                  <div className="results-empty-icon"><Database size={18} /></div>
                  <strong>No active connection</strong>
                  <span>Connect to a PostgreSQL database to inspect its schema.</span>
                </div>
              ) : schemaError ? (
                <div className="schema-message schema-error" role="alert" data-testid="schema-error">
                  <strong>Could not load schema metadata</strong>
                  <span>{schemaError}</span>
                  <button className="secondary-button" onClick={() => void refreshSchema()}>Try again</button>
                </div>
              ) : schemaLoading ? (
                <div className="schema-message" role="status" data-testid="schema-loading">Loading schema metadata…</div>
              ) : schemaObjects.length === 0 ? (
                <div className="schema-empty" data-testid="schema-empty">
                  <div className="results-empty-icon"><Database size={18} /></div>
                  <strong>No visible tables or views</strong>
                  <span>Check database privileges or create a table, then refresh.</span>
                </div>
              ) : (
                <div className="schema-tree">
                  {Array.from(new Set(schemaObjects.map((object) => object.schemaName))).map((schemaName) => {
                    const objects = schemaObjects.filter((object) => object.schemaName === schemaName);
                    const schemaExpanded = expandedSchemas.includes(schemaName);
                    return (
                      <section className="schema-group" key={schemaName}>
                        <button
                          className="schema-node schema-node-schema"
                          data-testid={`schema-toggle-${schemaName}`}
                          aria-expanded={schemaExpanded}
                          onClick={() => setExpandedSchemas((current) =>
                            current.includes(schemaName)
                              ? current.filter((name) => name !== schemaName)
                              : [...current, schemaName],
                          )}
                        >
                          {schemaExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <span className="schema-node-name">{schemaName}</span>
                          <small>{objects.length} {objects.length === 1 ? "object" : "objects"}</small>
                        </button>
                        {schemaExpanded && (
                          <div className="schema-object-list">
                            {objects.map((object) => {
                              const objectKey = `${object.schemaName}.${object.objectName}`;
                              const objectExpanded = expandedObjects.includes(objectKey);
                              return (
                                <div className="schema-object" key={objectKey}>
                                  <button
                                    className="schema-node schema-node-object"
                                    data-testid={`schema-object-${object.schemaName}-${object.objectName}`}
                                    aria-expanded={objectExpanded}
                                    onClick={() => setExpandedObjects((current) =>
                                      current.includes(objectKey)
                                        ? current.filter((key) => key !== objectKey)
                                        : [...current, objectKey],
                                    )}
                                  >
                                    {objectExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                    <span className="schema-node-name">{object.objectName}</span>
                                    <small>{object.objectType}</small>
                                    <span className="schema-column-count">{object.columns.length} cols</span>
                                  </button>
                                  {objectExpanded && (
                                    <div className="schema-columns">
                                      {object.objectType === "Table" && (
                                        <div className="schema-preview-toolbar">
                                          <span>Read-only preview · first 1,000 rows maximum</span>
                                          <button
                                            className="secondary-button schema-preview-button"
                                            data-testid={`preview-table-${object.schemaName}-${object.objectName}`}
                                            disabled={running}
                                            onClick={() => previewTable(object.schemaName, object.objectName)}
                                          >
                                            <Play size={11} /> Preview rows
                                          </button>
                                        </div>
                                      )}
                                      <div className="schema-columns-header"><span>Column</span><span>Type</span><span>Rules</span></div>
                                      {object.columns.map((column) => (
                                        <div className="schema-column" key={column.name} data-testid={`schema-column-${object.schemaName}-${object.objectName}-${column.name}`}>
                                          <span className="schema-column-name">{column.name}</span>
                                          <span className="schema-column-type">{column.dataType}</span>
                                          <span className="schema-column-rules">
                                            {column.primaryKey && <span className="schema-tag schema-tag-key">PK</span>}
                                            <span className={column.nullable ? "schema-nullable" : "schema-not-null"}>{column.nullable ? "NULL" : "NOT NULL"}</span>
                                            {column.defaultValue && <code title={column.defaultValue}>{column.defaultValue}</code>}
                                          </span>
                                        </div>
                                      ))}
                                      <section className="schema-metadata-section" data-testid={`schema-indexes-${object.schemaName}-${object.objectName}`}>
                                        <div className="schema-metadata-heading">
                                          <strong>Indexes</strong><small>{object.indexes.length}</small>
                                        </div>
                                        {object.indexes.length ? (
                                          <div className="schema-metadata-list">
                                            {object.indexes.map((index) => (
                                              <div className="schema-metadata-row" key={index.name} data-testid={`schema-index-${object.schemaName}-${object.objectName}-${index.name}`}>
                                                <div className="schema-metadata-title">
                                                  <code title={index.name}>{index.name}</code>
                                                  <span className="schema-metadata-tags">
                                                    {index.primary && <span className="schema-tag schema-tag-key">PRIMARY KEY</span>}
                                                    {index.unique && <span className="schema-tag schema-tag-unique">UNIQUE</span>}
                                                  </span>
                                                </div>
                                                <code className="schema-metadata-definition" title={index.definition}>{index.definition}</code>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <div className="schema-metadata-empty">No indexes reported.</div>
                                        )}
                                      </section>
                                      <section className="schema-metadata-section" data-testid={`schema-constraints-${object.schemaName}-${object.objectName}`}>
                                        <div className="schema-metadata-heading">
                                          <strong>Constraints</strong><small>{object.constraints.length}</small>
                                        </div>
                                        {object.constraints.length ? (
                                          <div className="schema-metadata-list">
                                            {object.constraints.map((constraint) => (
                                              <div className="schema-metadata-row" key={constraint.name} data-testid={`schema-constraint-${object.schemaName}-${object.objectName}-${constraint.name}`}>
                                                <div className="schema-metadata-title">
                                                  <code title={constraint.name}>{constraint.name}</code>
                                                  <span className="schema-metadata-type">{constraint.constraintType}</span>
                                                </div>
                                                <code className="schema-metadata-definition" title={constraint.definition}>{constraint.definition}</code>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <div className="schema-metadata-empty">No constraints reported.</div>
                                        )}
                                      </section>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}
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
