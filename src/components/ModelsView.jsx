import React, { useState } from 'react';

const SOURCE_BRAND_COLORS = {
  'sales-db': '#336791',
  'product-db': '#e48e00',
  'hubspot': '#ff5c35',
  'salesforce': '#00a1e0',
  'snowflake': '#29b5e8',
  'google-bigquery': '#4285f4',
};
const SOURCE_COLOR_DEFAULT = '#6f675d';

function sourceBrandColor(sourceId) {
  return SOURCE_BRAND_COLORS[sourceId] || SOURCE_COLOR_DEFAULT;
}

function TableIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="9" x2="9" y2="21" />
      <line x1="3" y1="15" x2="21" y2="15" />
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

function ModelItem({ model, isActive, usedIn, onInspect, onEdit, onDelete }) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const totalFields = model.fields?.length ?? 0;
  const visibleFields = model.fields?.filter((f) => f.visible !== false).length ?? 0;

  const openMenu = () => { setMenuOpen(true); setHovered(true); };

  return (
    <div
      className={`lp-item${isActive ? ' lp-item-active' : ''}`}
      onClick={() => onInspect(model.id)}
      onContextMenu={(e) => { e.preventDefault(); openMenu(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { if (!menuOpen) setHovered(false); }}
    >
      <div className="lp-item-info">
        <span className="lp-item-name">{model.name}</span>
        {model.sourceName && (
          <span className="lp-item-meta" style={{ color: sourceBrandColor(model.sourceId) }}>
            {model.sourceName}
          </span>
        )}
      </div>
      {!(hovered || menuOpen) && (
        <span className="lp-item-fid">{visibleFields} of {totalFields} fields</span>
      )}
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
                  <button className="lp-menu-item" onClick={() => { setMenuOpen(false); setHovered(false); onEdit(model.id); }}>Edit</button>
                  <button className="lp-menu-item lp-menu-item-danger" onClick={() => { setMenuOpen(false); setHovered(false); onDelete(model.id); }}>Delete</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ModelsView({ dataModels, datasets, selectedModelId, onInspectModel, onEditModel, onDeleteModel }) {
  const [search, setSearch] = useState('');

  const allDatasets = [
    ...(datasets.draft ?? []),
    ...(datasets.dev ?? []),
    ...(datasets.production ?? []),
  ];

  const useCountMap = {};
  for (const ds of allDatasets) {
    for (const mid of ds.modelIds ?? []) {
      useCountMap[mid] = (useCountMap[mid] ?? 0) + 1;
    }
  }

  const filtered = dataModels.filter((m) =>
    !search || m.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <aside className="editor-lp">
      <div className="lp-hd">
        <div className="lp-hd-tabs">
          <span className="lp-hd-tab lp-hd-tab-active">
            Models
            <span className="lp-hd-count">{dataModels.length}</span>
          </span>
        </div>
      </div>

      <div className="lp-search-wrap">
        <input
          className="lp-search"
          placeholder="Search models…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="lp-list">
        {filtered.map((model) => (
          <ModelItem
            key={model.id}
            model={model}
            isActive={selectedModelId === model.id}
            usedIn={useCountMap[model.id] ?? 0}
            onInspect={onInspectModel}
            onEdit={onEditModel ?? (() => {})}
            onDelete={onDeleteModel ?? (() => {})}
          />
        ))}
        {filtered.length === 0 && (
          <div className="lp-empty">No models found.</div>
        )}
      </div>

    </aside>
  );
}
