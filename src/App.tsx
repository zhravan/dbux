import { useState } from "react";
import {
  Activity,
  ChevronDown,
  CircleHelp,
  Command,
  Database,
  FileClock,
  FolderOpen,
  Keyboard,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";

type WorkspaceTab = "query" | "history";

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("query");
  const [showConnectionForm, setShowConnectionForm] = useState(false);

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

          <button className="sidebar-empty" onClick={() => setShowConnectionForm(true)}>
            <span className="empty-icon"><Database size={17} /></span>
            <span className="empty-copy">
              <strong>No connections yet</strong>
              <small>Add a database to get started.</small>
            </span>
          </button>

          <div className="sidebar-section">
            <div className="sidebar-heading"><span>WORKSPACE</span></div>
            <button className={`nav-item ${activeTab === "query" ? "selected" : ""}`} onClick={() => setActiveTab("query")}><TerminalSquare size={15} /><span>Query editor</span><kbd>⌘ 1</kbd></button>
            <button className={`nav-item ${activeTab === "history" ? "selected" : ""}`} onClick={() => setActiveTab("history")}><FileClock size={15} /><span>Query history</span></button>
            <button className="nav-item" onClick={() => setShowConnectionForm(true)}><FolderOpen size={15} /><span>Saved queries</span></button>
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
              <button className="primary-button" onClick={() => setShowConnectionForm(true)}><Database size={14} /> Connect <ChevronDown size={13} /></button>
            </div>
          </div>

          {activeTab === "query" ? (
            <div className="editor-layout">
              <div className="editor-tabs">
                <div className="editor-tab active"><span className="tab-dot" />Untitled query <span className="tab-unsaved">●</span></div>
                <button className="icon-button small" aria-label="New query"><Plus size={15} /></button>
                <div className="editor-tab-spacer" />
                <span className="connection-status"><span className="status-dot" />Not connected</span>
              </div>
              <div className="editor-canvas">
                <div className="line-numbers"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>
                <div className="editor-placeholder">
                  <p className="sql-comment">-- Your next query starts here</p>
                  <p><span className="sql-keyword">SELECT</span> <span className="sql-function">current_database</span>();</p>
                  <p className="sql-comment">-- Connect a database to execute SQL.</p>
                </div>
                <div className="editor-hint"><Command size={12} /> <span>Run query</span><kbd>⌘ ↵</kbd></div>
              </div>
              <div className="results-panel">
                <div className="results-tabs"><strong>Results</strong><span>Messages</span><div className="results-spacer" /><span className="results-meta">No query executed</span></div>
                <div className="results-empty">
                  <div className="results-empty-icon"><Search size={18} /></div>
                  <strong>Results will appear here</strong>
                  <span>Run a query to inspect rows, types, and execution details.</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="history-empty">
              <div className="results-empty-icon"><FileClock size={18} /></div>
              <strong>No query history</strong>
              <span>Executed queries will be available here on this device.</span>
              <button className="secondary-button" onClick={() => setActiveTab("query")}>Open query editor</button>
            </div>
          )}
        </section>
      </div>

      <footer className="statusbar">
        <div className="status-left"><span className="status-indicator" />Local workspace <span className="status-separator">·</span> No active connection</div>
        <div className="status-right"><span>DBUX 0.1.0</span><span className="status-separator">·</span><span>UTF-8</span><span className="status-separator">·</span><span>SQL</span></div>
      </footer>

      {showConnectionForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowConnectionForm(false); }}>
          <section className="connection-modal" role="dialog" aria-modal="true" aria-labelledby="connection-title">
            <div className="modal-heading">
              <div><span className="eyebrow">DATABASE CONNECTION</span><h2 id="connection-title">Add a connection</h2><p>Connection setup will be enabled when the driver layer lands.</p></div>
              <button className="icon-button" aria-label="Close dialog" onClick={() => setShowConnectionForm(false)}>×</button>
            </div>
            <label>Database type<select defaultValue="postgres"><option value="postgres">PostgreSQL</option><option value="sqlite">SQLite</option><option value="mysql" disabled>MySQL · coming later</option><option value="duckdb" disabled>DuckDB · coming later</option></select></label>
            <label>Connection name<input placeholder="e.g. Local development" /></label>
            <div className="form-note"><ShieldCheck size={15} /><span>No credentials are collected by this preview. Real connection support is not implemented yet.</span></div>
            <div className="modal-footer"><button className="secondary-button" onClick={() => setShowConnectionForm(false)}>Cancel</button><button className="primary-button" onClick={() => setShowConnectionForm(false)}>Close preview</button></div>
          </section>
        </div>
      )}
    </main>
  );
}