import React, { useState } from 'react';
import PillList from './PillList';

const STAGE_BADGE = {
  draft: 'badge-draft',
  dev: 'badge-dev',
  development: 'badge-dev',
  testing: 'badge-testing',
  production: 'badge-prod',
};

const TIMELINE_EVENTS = [
  { id: 1, time: '2:47 PM', action: 'modified', target: 'Sales overview', targetType: 'dataset' },
  { id: 2, time: '11:23 AM', action: 'added metric', target: 'Net Revenue', targetType: 'metric' },
  { id: 3, time: '9:05 AM', action: 'modified', target: 'Revenue summary', targetType: 'dataset' },
  { id: 4, time: 'Yesterday, 4:12 PM', action: 'created', target: 'Customer LTV', targetType: 'dataset' },
  { id: 5, time: 'Yesterday, 10:30 AM', action: 'updated model', target: 'Orders', targetType: 'model' },
  { id: 6, time: 'May 10', action: 'added model', target: 'Contacts', targetType: 'model' },
  { id: 7, time: 'May 10', action: 'created', target: 'Marketing attribution', targetType: 'dataset' },
  { id: 8, time: 'May 8', action: 'promoted to production', target: 'Revenue summary', targetType: 'dataset' },
  { id: 9, time: 'May 7', action: 'added metric', target: 'Return rate', targetType: 'metric' },
  { id: 10, time: 'May 6', action: 'created', target: 'Support tickets', targetType: 'dataset' },
];

const KANBAN_COLUMNS = [
  { key: 'draft', label: 'Draft' },
  { key: 'dev', label: 'Dev' },
  { key: 'production', label: 'Production' },
];

function DatasetCard({ dataset, dataModels, metrics, onOpen, draggable, onDragStart }) {
  const modelItems = (dataset.modelIds || []).map((id) => {
    const m = dataModels.find((dm) => dm.id === id);
    return { id, label: m ? m.name : id };
  });
  const dsMetrics = metrics.filter((m) => m.datasetId === dataset.id);
  const metricItems = dsMetrics.map((m) => ({ id: m.id, label: m.name }));
  const badgeClass = STAGE_BADGE[dataset.stage] || 'badge-draft';

  return (
    <article
      className="ds-hc"
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={() => onOpen(dataset.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(dataset.id); }}
    >
      <div className="ds-hc-top">
        <div className="ds-hc-title-row">
          <span className="ds-hc-name">{dataset.name}</span>
          <span className={`badge ${badgeClass}`}>{dataset.stage}</span>
        </div>
        {dataset.desc && <p className="ds-hc-desc">{dataset.desc}</p>}
      </div>

      <div className="ds-hc-body">
        {modelItems.length > 0 && (
          <div className="ds-hc-row">
            <span className="ds-hc-row-lbl">Models</span>
            <PillList items={modelItems} pillClass="ds-hc-pill ds-hc-pill-model" moreClass="ds-hc-pill ds-hc-pill-more" containerClass="ds-hc-pills" />
          </div>
        )}
        <div className="ds-hc-row">
          <span className="ds-hc-row-lbl">Joins</span>
          <span className="ds-hc-row-val">{dataset.joins || 0}</span>
        </div>
        {metricItems.length > 0 && (
          <div className="ds-hc-row">
            <span className="ds-hc-row-lbl">Metrics</span>
            <PillList items={metricItems} pillClass="ds-hc-pill ds-hc-pill-metric" moreClass="ds-hc-pill ds-hc-pill-more" containerClass="ds-hc-pills" />
          </div>
        )}
      </div>

      <div className="ds-hc-footer">
        <span className="ds-hc-meta">Modified May 12 · George A.</span>
      </div>
    </article>
  );
}

export default function HomeView({ datasets, dataModels, metrics, onOpenDataset, onNewDataset, onMoveDataset }) {
  const [dragOver, setDragOver] = useState(null);

  const sorted = {
    draft: [...datasets.draft].sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0)),
    dev: [...datasets.dev].sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0)),
    production: [...datasets.production].sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0)),
  };

  const handleDrop = (e, toStage) => {
    e.preventDefault();
    const dsId = e.dataTransfer.getData('application/x-dataset-id');
    const fromStage = e.dataTransfer.getData('application/x-dataset-stage');
    setDragOver(null);
    if (!dsId || fromStage === toStage) return;
    onMoveDataset?.(dsId, fromStage, toStage);
  };

  return (
    <div className="home-view">
      {/* Left: Activity timeline */}
      <aside className="home-timeline">
        <div className="home-tl-hd">
          <span className="home-tl-title">Activity</span>
        </div>
        <div className="home-tl-list">
          {TIMELINE_EVENTS.map((event) => (
            <div key={event.id} className="home-tl-entry">
              <span className="home-tl-time">{event.time}</span>
              <div className="home-tl-content">
                <span className="home-tl-action">{event.action} </span>
                <span className={`home-tl-target home-tl-target-${event.targetType}`}>
                  {event.target}
                </span>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Right: Kanban board */}
      <main className="home-datasets">
        <div className="home-ds-hd">
          <span className="home-ds-title">Datasets</span>
          <button className="btn btn-primary" onClick={onNewDataset}>
            + New Dataset
          </button>
        </div>

        <div className="home-kanban">
          {KANBAN_COLUMNS.map(({ key, label }) => (
            <div
              key={key}
              className={`home-kanban-col${dragOver === key ? ' drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(key); }}
              onDragLeave={(e) => {
                // only clear if leaving the column itself, not a child
                if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(null);
              }}
              onDrop={(e) => handleDrop(e, key)}
            >
              <div className="home-kanban-col-hd">
                <span className="home-kanban-col-title">{label}</span>
                <span className="home-kanban-count">{sorted[key].length}</span>
              </div>
              <div className="home-kanban-col-cards">
                {sorted[key].length === 0 ? (
                  <div className="home-kanban-empty">No datasets in {label.toLowerCase()}</div>
                ) : (
                  sorted[key].map((ds) => (
                    <DatasetCard
                      key={ds.id}
                      dataset={ds}
                      dataModels={dataModels}
                      metrics={metrics}
                      onOpen={onOpenDataset}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-dataset-id', ds.id);
                        e.dataTransfer.setData('application/x-dataset-stage', key);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
