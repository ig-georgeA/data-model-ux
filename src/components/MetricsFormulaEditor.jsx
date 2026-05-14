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

/**
 * MetricsFormulaEditor — edit/inspect a metric with global model field access.
 *
 * Props:
 *   metric     — the metric object being edited (or null for new)
 *   dataModels — all data models (for the "Available Fields" panel)
 *   isEditing  — boolean
 *   draft      — the current draft state
 *   setDraft   — setState for draft
 */
export default function MetricsFormulaEditor({ metric, dataModels, isEditing, draft, setDraft }) {
  const [fieldSearch, setFieldSearch] = useState('');  
  const [collapsed, setCollapsed] = useState({});
  const active = draft || metric || {};

  // Group fields by model, carrying sourceName/sourceId
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

  // In inspect mode, only show fields referenced in the expression
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

  // Filtered version for search
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

  // A group is open if:
  //   inspect mode — all groups open by default
  //   edit mode    — only first group open by default
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

  return (
    <div className="mfe-wrap">
      {/* Name + Global toggle */}
      <div className="mfe-section">
        <div className="mfe-name-row">
          <label className="mfe-label">Metric name</label>
          <label className="mfe-toggle-inline-wrap" title="Global metrics are available across all datasets">
            <span className="mfe-toggle-inline-label">Global</span>
            <input
              type="checkbox"
              className="mfe-toggle-input"
              checked={active.isGlobal || false}
              disabled={!isEditing}
              onChange={(e) => update('isGlobal', e.target.checked)}
            />
            <span className="mfe-toggle" />
          </label>
        </div>
        {isEditing ? (
          <input
            className="mfe-input"
            value={active.name || ''}
            placeholder="e.g. Net Revenue"
            onChange={(e) => update('name', e.target.value)}
          />
        ) : (
          <span className="mfe-value">{active.name || <span className="mfe-empty">—</span>}</span>
        )}
      </div>

      {/* Description */}
      <div className="mfe-section">
        <label className="mfe-label">Description</label>
        {isEditing ? (
          <textarea
            className="mfe-textarea"
            value={active.description || ''}
            placeholder="What does this metric measure?"
            onChange={(e) => update('description', e.target.value)}
          />
        ) : (
          <p className="mfe-desc-val">
            {active.description || <span className="mfe-empty">No description</span>}
          </p>
        )}
      </div>

      {/* Aggregation */}
      <div className="mfe-section">
        <label className="mfe-label">Aggregation</label>
        {isEditing ? (
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
        ) : (
          <span className="mfe-value">
            {active.aggregation || <span className="mfe-empty">—</span>}
          </span>
        )}
      </div>

      {/* Formula / Expression */}
      <div className="mfe-section">
        <label className="mfe-label">
          Expression
          <span className="mfe-label-sub"> — field references or formula</span>
        </label>
        {isEditing ? (
          <textarea
            className="mfe-formula-ta"
            value={active.expression || ''}
            placeholder="e.g. orders.amount - orders.discount"
            onChange={(e) => update('expression', e.target.value)}
            spellCheck={false}
          />
        ) : (
          <pre className="mfe-formula-val">
            {active.expression || <span className="mfe-empty">No expression</span>}
          </pre>
        )}
      </div>

      {/* Available Fields panel — always shown in edit mode; in inspect only when fields are referenced */}
      {(isEditing || fieldsByModelFiltered.length > 0) && (
      <div className="mfe-fields-panel">
        <div className="mfe-fields-hd">
          <span className="mfe-fields-title">{isEditing ? 'Available fields' : 'Fields used'}</span>
          {isEditing && (
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
                    <span className="mfe-field-group-chevron">{open ? '∨' : '›'}</span>
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
        </div>
      </div>
      )}
    </div>
  );
}

