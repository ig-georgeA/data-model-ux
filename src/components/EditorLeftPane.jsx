import React, { useState, useRef } from 'react';

function ThreeDotIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="7" cy="2.5" r="1.25" fill="currentColor" />
      <circle cx="7" cy="7" r="1.25" fill="currentColor" />
      <circle cx="7" cy="11.5" r="1.25" fill="currentColor" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="9" x2="9" y2="21" />
    </svg>
  );
}

function MetricIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

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

function ItemMenu({ isInUse, itemType, onEdit, onInspect, onDelete, onClose }) {
  const editLabel = itemType === 'model' ? 'Edit Model' : 'Edit Metric';
  return (
    <div className="lp-menu-popup">
      <button
        className="lp-menu-item"
        onClick={() => { onClose(); onEdit(); }}
      >
        {editLabel}
      </button>
      <button
        className="lp-menu-item lp-menu-item-danger"
        onClick={() => { onClose(); onDelete(); }}
      >
        {isInUse && itemType === 'model' ? 'Remove from catalog…' : 'Delete'}
      </button>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ModelItem({ model, isInUse, isActive, onEdit, onInspect, onDelete, isDatasetEditing, onAdd }) {
  const itemRef = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const totalCount = model.fields ? model.fields.length : 0;
  const visibleCount = model.fields
    ? model.fields.filter((f) => f.visible !== false).length
    : 0;

  const handleMouseLeave = () => {
    if (!menuOpen) setHovered(false);
  };

  return (
    <div
      ref={itemRef}
      className={`lp-item ${isInUse ? 'lp-item-in-use' : ''} ${isActive ? 'lp-item-active' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-model-id', model.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDoubleClick={() => isDatasetEditing ? onAdd(model.id) : onInspect(model.id, itemRef)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={handleMouseLeave}
    >
      <span
        className={`lp-in-use-dot ${isInUse ? 'lp-in-use-dot-active' : ''}`}
        title={isInUse ? 'Used in this dataset' : 'Not in this dataset'}
      />
      <span className="lp-item-icon">
        <TableIcon />
      </span>
      <div className="lp-item-info">
        <span className="lp-item-name">{model.name}</span>
        {model.sourceName && (
          <span className="lp-item-meta" style={{ color: sourceBrandColor(model.sourceId) }}>
            {model.sourceName}
          </span>
        )}
      </div>
      {isDatasetEditing ? (
        hovered && (
          <button
            className="plain-btn lp-add-to-ds-btn"
            aria-label="Add to dataset"
            title="Add to dataset"
            onClick={(e) => { e.stopPropagation(); onAdd(model.id); }}
          >
            <PlusIcon />
          </button>
        )
      ) : (
        <>
          {!(hovered || menuOpen) && (
            <span className="lp-item-fid">{visibleCount} of {totalCount} fid.</span>
          )}
          {(hovered || menuOpen) && (
            <div className="lp-item-actions">
              <button
                className="btn btn-sm"
                onClick={(e) => { e.stopPropagation(); onInspect(model.id, itemRef); }}
              >
                Inspect
              </button>
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
                    <div
                      className="lp-menu-backdrop"
                      onClick={() => { setMenuOpen(false); setHovered(false); }}
                    />
                    <ItemMenu
                      isInUse={isInUse}
                      itemType="model"
                      onEdit={() => onEdit(model.id, itemRef)}
                      onInspect={() => onInspect(model.id, itemRef)}
                      onDelete={() => onDelete(model.id)}
                      onClose={() => { setMenuOpen(false); setHovered(false); }}
                    />
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MetricItem({ metric, isInUse, isActive, onEdit, onInspect, onDelete, isDatasetEditing, onAdd }) {
  const itemRef = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleMouseLeave = () => {
    if (!menuOpen) setHovered(false);
  };

  return (
    <div
      ref={itemRef}
      className={`lp-item ${isInUse ? 'lp-item-in-use' : ''} ${isActive ? 'lp-item-active' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-metric-id', metric.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDoubleClick={() => isDatasetEditing ? onAdd(metric.id) : onInspect(metric.id, itemRef)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={handleMouseLeave}
    >
      <span
        className={`lp-in-use-dot ${isInUse ? 'lp-in-use-dot-active' : ''}`}
        title={isInUse ? 'Used in this dataset' : ''}
      />
      <span className="lp-item-icon lp-item-icon-metric">
        <MetricIcon />
      </span>
      <div className="lp-item-info">
        <span className="lp-item-name">{metric.name}</span>
        <span className="lp-item-meta">
          {metric.aggregation}
          {metric.isGlobal ? ' · Global' : metric.datasetId ? ` · ${metric.datasetId}` : ''}
        </span>
      </div>
      {isDatasetEditing ? (
        hovered && (
          <button
            className="plain-btn lp-add-to-ds-btn"
            aria-label="Add to dataset"
            title="Add to dataset"
            onClick={(e) => { e.stopPropagation(); onAdd(metric.id); }}
          >
            <PlusIcon />
          </button>
        )
      ) : (
        (hovered || menuOpen) && (
          <div className="lp-item-actions">
            <button
              className="btn btn-sm"
              onClick={(e) => { e.stopPropagation(); onInspect(metric.id, itemRef); }}
            >
              Inspect
            </button>
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
                  <div
                    className="lp-menu-backdrop"
                    onClick={() => { setMenuOpen(false); setHovered(false); }}
                  />
                  <ItemMenu
                    isInUse={isInUse}
                    itemType="metric"
                    onEdit={() => onEdit(metric.id, itemRef)}
                    onInspect={() => onInspect(metric.id, itemRef)}
                    onDelete={() => onDelete(metric.id)}
                    onClose={() => { setMenuOpen(false); setHovered(false); }}
                  />
                </>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}

export default function EditorLeftPane({
  dataModels,
  metrics,
  currentDataset,
  isDatasetEditing,
  activeItemId,
  activeItemType,
  onBeforeTabChange,
  onEditModel,
  onInspectModel,
  onDeleteModel,
  onAddModel,
  onEditMetric,
  onInspectMetric,
  onDeleteMetric,
  onAddMetric,
  onNewModel,
  onNewMetric,
}) {
  const [activeTab, setActiveTab] = useState('models');

  const handleTabChange = (tab) => {
    if (activeTab === tab) return;
    if (onBeforeTabChange) {
      const ok = onBeforeTabChange(tab);
      if (!ok) return;
    }
    setActiveTab(tab);
    setSearch('');
  };
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const currentModelIds = currentDataset?.modelIds ?? [];
  const currentDatasetId = currentDataset?.id ?? null;

  const filteredModels = dataModels.filter((m) => {
    if (filter === 'in-use' && !currentModelIds.includes(m.id)) return false;
    if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const filteredMetrics = metrics.filter((m) => {
    if (filter === 'in-use' && m.datasetId !== currentDatasetId && !m.isGlobal) return false;
    if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <aside className="editor-lp">
      {/* Header: "Models N · Metrics N" tabs + ALL filter dropdown */}
      <div className="lp-hd">
        <div className="lp-hd-tabs">
          <button
            className={`lp-hd-tab ${activeTab === 'models' ? 'lp-hd-tab-active' : ''}`}
            onClick={() => handleTabChange('models')}
          >
            Models
            <span className="lp-hd-count">{dataModels.length}</span>
          </button>
          <span className="lp-hd-sep">·</span>
          <button
            className={`lp-hd-tab ${activeTab === 'metrics' ? 'lp-hd-tab-active' : ''}`}
            onClick={() => handleTabChange('metrics')}
          >
            Metrics
            <span className="lp-hd-count">{metrics.length}</span>
          </button>
        </div>
        <select
          className="lp-filter-select"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All</option>
          <option value="in-use">In use</option>
        </select>
      </div>

      {/* Search */}
      <div className="lp-search-wrap">
        <input
          className="lp-search"
          placeholder={activeTab === 'models' ? 'Search models…' : 'Search metrics…'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* List */}
      <div className="lp-list">
        {activeTab === 'models' && (
          <>
            {filteredModels.map((model) => (
              <ModelItem
                key={model.id}
                model={model}
                isInUse={currentModelIds.includes(model.id)}
                isActive={activeItemType === 'model' && activeItemId === model.id}
                onEdit={onEditModel}
                onInspect={onInspectModel}
                onDelete={onDeleteModel}
                isDatasetEditing={isDatasetEditing}
                onAdd={onAddModel}
              />
            ))}
            {filteredModels.length === 0 && (
              <div className="lp-empty">
                {filter === 'in-use'
                  ? 'No models in this dataset yet.'
                  : 'No models found.'}
              </div>
            )}
          </>
        )}

        {activeTab === 'metrics' && (
          <>
            {filteredMetrics.map((metric) => (
              <MetricItem
                key={metric.id}
                metric={metric}
                isInUse={metric.datasetId === currentDatasetId || metric.isGlobal}
                isActive={activeItemType === 'metric' && activeItemId === metric.id}
                onEdit={onEditMetric}
                onInspect={onInspectMetric}
                onDelete={onDeleteMetric}
                isDatasetEditing={isDatasetEditing}
                onAdd={onAddMetric}
              />
            ))}
            {filteredMetrics.length === 0 && (
              <div className="lp-empty">
                {filter === 'in-use'
                  ? 'No metrics for this dataset yet.'
                  : 'No metrics found.'}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="lp-footer">
        {activeTab === 'models' && (
          <button className="btn lp-add-btn" onClick={onNewModel}>
            + Add Model
          </button>
        )}
        {activeTab === 'metrics' && (
          <button className="btn lp-add-btn" onClick={onNewMetric}>
            + New Metric
          </button>
        )}
      </div>
    </aside>
  );
}
