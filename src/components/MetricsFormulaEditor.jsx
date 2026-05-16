import React, { useState, useMemo } from 'react';

const AGGREGATIONS = ['SUM', 'COUNT', 'COUNT DISTINCT', 'AVG', 'MIN', 'MAX', 'RATIO'];

function ChevronIcon({ open }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 12 12" fill="none"
      style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
      aria-hidden="true"
    >
      <path d="M4 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export default function MetricsFormulaEditor({ metric, dataModels, isEditing, draft, setDraft }) {
  const [fieldSearch, setFieldSearch] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const active = draft || metric || {};

  const fieldsByModel = useMemo(() => {
    return dataModels.map((model) => ({
      modelId: model.id,
      modelName: model.name,
      sourceName: model.sourceName || '',
      sourceId: model.sourceId || '',
      fields: (model.fields || [])
        .filter((f) => f.visible !== false)
        .map((f) => ({
          key: `${model.id}.${f.key}`,
          rawKey: f.key,
          label: f.displayName || f.label || f.key,
          modelName: model.name,
          type: f.type,
          isKey: f.isKey,
        })),
    })).filter((g) => g.fields.length > 0);
  }, [dataModels]);

  const fieldsByModelForDisplay = useMemo(() => {
    if (isEditing) return fieldsByModel;
    const expr = (active.expression || '').toLowerCase();
    if (!expr) return [];
    return fieldsByModel
      .map((g) => ({
        ...g,
        fields: g.fields.filter((f) => expr.includes(f.key.toLowerCase()) || expr.includes(f.rawKey.toLowerCase())),
      }))
      .filter((g) => g.fields.length > 0);
  }, [fieldsByModel, isEditing, active.expression]);

  const fieldsByModelFiltered = useMemo(() => {
    if (!fieldSearch) return fieldsByModelForDisplay;
    const q = fieldSearch.toLowerCase();
    return fieldsByModelForDisplay
      .map((g) => ({
        ...g,
        fields: g.fields.filter(
          (f) => f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q) || g.modelName.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.fields.length > 0);
  }, [fieldsByModelForDisplay, fieldSearch]);

  const toggleGroup = (modelId) => {
    setCollapsed((prev) => ({ ...prev, [modelId]: !prev[modelId] }));
  };

  const isGroupOpen = (modelId, index) => {
    if (modelId in collapsed) return !collapsed[modelId];
    return !isEditing || index === 0;
  };

  const insertFieldRef = (fieldKey) => {
    if (!isEditing) return;
    setDraft((prev) => ({
      ...prev,
      expression: (prev?.expression || '') + (prev?.expression ? ' ' : '') + fieldKey,
    }));
  };

  const update = (prop, val) => {
    setDraft((prev) => ({ ...prev, [prop]: val }));
  };

  const FieldsPanel = ({ title, showSearch }) => (
    <div className="mfe-fields-panel">
      <div className="mfe-fields-hd">
        <span className="mfe-fields-title">{title}</span>
        {showSearch && (
          <input
            className="mfe-fields-search"
            placeholder="Search…"
            value={fieldSearch}
            onChange={(e) => setFieldSearch(e.target.value)}
          />
        )}
      </div>
      <div className="mfe-fields-list">
        {fieldsByModelFiltered.map((group, idx) => {
          const open = isGroupOpen(group.modelId, idx);
          return (
            <div key={group.modelId} className="mfe-field-group">
              <button
                className="mfe-field-group-hd"
                onClick={() => toggleGroup(group.modelId)}
                aria-expanded={open}
              >
                <span className="mfe-field-group-name">{group.modelName}</span>
                <span className="mfe-field-group-count">({group.fields.length})</span>
                <span className="mfe-field-group-right">
                  <span className="mfe-field-group-source">{group.sourceName}</span>
                  <ChevronIcon open={open} />
                </span>
              </button>
              {open && group.fields.map((f) => (
                <button
                  key={f.key}
                  className="mfe-field-row"
                  onClick={() => insertFieldRef(f.key)}
                  disabled={!isEditing}
                  title={isEditing ? `Insert ${f.key}` : f.key}
                >
                  <span className={`mfe-field-type ftype ${f.isKey ? 'key' : ''} ${f.type === 'fx' ? 'calc' : ''}`}>
                    {f.type}
                  </span>
                  <span className="mfe-field-info">
                    <span className="mfe-field-label">{f.label}</span>
                  </span>
                  <span className="mfe-field-key">{f.key}</span>
                </button>
              ))}
            </div>
          );
        })}
        {fieldsByModelFiltered.length === 0 && isEditing && (
          <div className="mfe-fields-empty">No fields match your search.</div>
        )}
        {fieldsByModelFiltered.length === 0 && !isEditing && (
          <div className="mfe-fields-empty">No fields referenced.</div>
        )}
      </div>
    </div>
  );

  if (!isEditing) {
    return (
      <div className="mfe-layout">
        {/* Inspect header: name + badges */}
        <div className="mfe-inspect-header">
          <div className="mfe-inspect-name">{active.name || <span className="mfe-empty">Untitled</span>}</div>
          <div className="mfe-inspect-badges">
            {active.aggregation && (
              <span className="mfe-badge mfe-badge-agg">{active.aggregation}</span>
            )}
            {active.isGlobal && (
              <span className="mfe-badge mfe-badge-global">Global</span>
            )}
          </div>
        </div>

        {/* Two-column body */}
        <div className="mfe-body-cols">
          {/* Left: expression */}
          <div className="mfe-col-main">
            <div className="mfe-section">
              <label className="mfe-label">
                Expression
                <span className="mfe-label-sub"> — field references or formula</span>
              </label>
              <pre className="mfe-formula-val mfe-formula-val-lg">
                {active.expression || <span className="mfe-empty">No expression</span>}
              </pre>
            </div>
          </div>

          {/* Right: description + fields used */}
          <div className="mfe-col-side">
            <div className="mfe-section">
              <label className="mfe-label">Description</label>
              <p className="mfe-desc-val">
                {active.description || <span className="mfe-empty">No description</span>}
              </p>
            </div>
            {fieldsByModelForDisplay.length > 0 && (
              <FieldsPanel title="Fields used" showSearch={false} />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mfe-layout">
      {/* Edit mode: two-column with no top header */}
      <div className="mfe-body-cols mfe-body-cols-edit">
        {/* Left: name, description, expression */}
        <div className="mfe-col-main">
          <div className="mfe-section">
            <label className="mfe-label">Metric name</label>
            <input
              className="mfe-input"
              value={active.name || ''}
              placeholder="e.g. Net Revenue"
              onChange={(e) => update('name', e.target.value)}
            />
          </div>

          <div className="mfe-section">
            <label className="mfe-label">Description</label>
            <textarea
              className="mfe-textarea"
              value={active.description || ''}
              placeholder="What does this metric measure?"
              onChange={(e) => update('description', e.target.value)}
            />
          </div>

          <div className="mfe-section">
            <label className="mfe-label">
              Expression
              <span className="mfe-label-sub"> — field references or formula</span>
            </label>
            <textarea
              className="mfe-formula-ta"
              value={active.expression || ''}
              placeholder="e.g. orders.amount - orders.discount"
              onChange={(e) => update('expression', e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>

        {/* Right: aggregation, global, field browser */}
        <div className="mfe-col-side">
          <div className="mfe-section">
            <label className="mfe-label">Aggregation</label>
            <div className="mfe-agg-grid">
              {AGGREGATIONS.map((agg) => (
                <button
                  key={agg}
                  className={`mfe-agg-btn ${active.aggregation === agg ? 'mfe-agg-btn-active' : ''}`}
                  onClick={() => update('aggregation', agg)}
                >
                  {agg}
                </button>
              ))}
            </div>
          </div>

          <div className="mfe-section">
            <label className="mfe-toggle-inline-wrap" title="Global metrics are available across all datasets">
              <span className="mfe-toggle-inline-label">Global metric</span>
              <input
                type="checkbox"
                className="mfe-toggle-input"
                checked={active.isGlobal || false}
                onChange={(e) => update('isGlobal', e.target.checked)}
              />
              <span className="mfe-toggle" />
            </label>
          </div>

          <FieldsPanel title="Available fields" showSearch={true} />
        </div>
      </div>
    </div>
  );
}
