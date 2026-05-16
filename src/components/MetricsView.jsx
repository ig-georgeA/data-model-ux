import React, { useState } from 'react';

function MetricIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

function ThreeDotIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="2.5" r="1.25" fill="currentColor" />
      <circle cx="7" cy="7" r="1.25" fill="currentColor" />
      <circle cx="7" cy="11.5" r="1.25" fill="currentColor" />
    </svg>
  );
}

function MetricItem({ metric, isActive, onInspect, onEdit, onDelete }) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const openMenu = () => { setMenuOpen(true); setHovered(true); };

  return (
    <div
      className={`lp-item${isActive ? ' lp-item-active' : ''}`}
      onClick={() => onInspect(metric.id)}
      onContextMenu={(e) => { e.preventDefault(); openMenu(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { if (!menuOpen) setHovered(false); }}
    >
      <span className="lp-in-use-dot" style={{ visibility: 'hidden' }} />
      <div className="lp-item-info">
        <span className="lp-item-name">{metric.name}</span>
        <span className="lp-item-meta">{metric.aggregation}</span>
      </div>
      {(hovered || menuOpen) && (
        <div className="lp-item-actions" onClick={(e) => e.stopPropagation()}>
          <div className="lp-menu-wrap">
            <button
              className="plain-btn lp-more-btn"
              aria-label="More options"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            >
              <ThreeDotIcon />
            </button>
            {menuOpen && (
              <>
                <div className="lp-menu-backdrop" onClick={() => { setMenuOpen(false); setHovered(false); }} />
                <div className="lp-menu-popup">
                  <button className="lp-menu-item" onClick={() => { setMenuOpen(false); setHovered(false); onEdit(metric.id); }}>Edit</button>
                  <button className="lp-menu-item lp-menu-item-danger" onClick={() => { setMenuOpen(false); setHovered(false); onDelete(metric.id); }}>Delete</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MetricsView({ metrics, selectedMetricId, onInspectMetric, onEditMetric, onDeleteMetric, onNewMetric }) {
  const [search, setSearch] = useState('');

  const filtered = metrics.filter((m) =>
    !search || m.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <aside className="editor-lp">
      <div className="lp-hd">
        <div className="lp-hd-tabs">
          <span className="lp-hd-tab lp-hd-tab-active">
            Metrics
            <span className="lp-hd-count">{metrics.length}</span>
          </span>
        </div>
        <button className="btn btn-sm lp-hd-new-btn" onClick={onNewMetric}>+ New Metric</button>
      </div>

      <div className="lp-search-wrap">
        <input
          className="lp-search"
          placeholder="Search metrics…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="lp-list">
        {filtered.map((m) => (
          <MetricItem
            key={m.id}
            metric={m}
            isActive={selectedMetricId === m.id}
            onInspect={onInspectMetric}
            onEdit={onEditMetric ?? (() => {})}
            onDelete={onDeleteMetric ?? (() => {})}
          />
        ))}
        {filtered.length === 0 && (
          <div className="lp-empty">
            {search ? 'No metrics match.' : 'No metrics yet.'}
          </div>
        )}
      </div>

    </aside>
  );
}
