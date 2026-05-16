import React, { useEffect, useState } from 'react';

export default function SidePane({
  isOpen,
  variant = 'overlay', // 'overlay' | 'inline'
  mode,
  title,
  typeBadge,
  isGlobal,
  width,
  onClose,
  onDiscardClose,
  onSave,
  onEdit,
  stableKey,
  onStableKeyChange,
  onRequestStableKeyUnlock,
  children,
}) {
  const isInspect = mode === 'inspect';
  const isInline = variant === 'inline';
  const [skLocked, setSkLocked] = useState(true);

  // Reset locked state when switching items
  useEffect(() => { setSkLocked(true); }, [title]);

  // Close on Escape — dismiss directly in inspect mode, guard in edit mode
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key !== 'Escape') return;
      if (isInspect) {
        onClose?.();
      } else {
        onDiscardClose?.();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, isInspect, onClose, onDiscardClose]);

  const editLabel = typeBadge === 'model' ? 'Edit Model' : 'Edit Metric';

  const handleClose = () => {
    if (isInspect) {
      onClose?.();
    } else {
      onDiscardClose?.();
    }
  };

  if (isInline) {
    return (
      <div className="side-pane-inline" style={width ? { width: `${width}px` } : undefined}>
        <div className="side-pane-header">
          <div className="side-pane-title-area">
            <div className="side-pane-title-row">
              <span className="side-pane-title">{title || 'Untitled'}</span>
              {typeof stableKey === 'string' && stableKey && (
                <span className="ep-sk-group">
                  <span className="ep-sk-sep">|</span>
                  {!isInspect ? (
                    <span className="ep-sk-edit-wrap">
                      <input
                        className={`ep-sk-input${skLocked ? ' ep-sk-input-locked' : ''}`}
                        value={stableKey}
                        readOnly={skLocked}
                        onChange={(e) => onStableKeyChange?.(e.target.value)}
                        spellCheck={false}
                      />
                      <button
                        className="plain-btn ep-sk-lock-btn"
                        title={skLocked ? 'Unlock to edit stable key' : 'Lock stable key'}
                        onClick={() => {
                          if (skLocked) {
                            onRequestStableKeyUnlock?.(() => setSkLocked(false));
                          } else {
                            setSkLocked(true);
                          }
                        }}
                      >
                        {skLocked ? '🔒' : '🔓'}
                      </button>
                    </span>
                  ) : (
                    <span className="ep-sk-inspect-wrap" title="Stable key used in APIs and integrations. Changing it may break existing connections.">
                      <span className="ep-sk-val">{stableKey}</span>
                      <span className="ep-sk-lock-icon">🔒</span>
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
          <div className="side-pane-header-actions">
            {isInspect && onEdit && (
              <button className="btn btn-accent btn-sm" onClick={onEdit}>{editLabel}</button>
            )}
            {!isInspect && (
              <button className="btn btn-primary btn-sm" onClick={onSave}>Save changes</button>
            )}
            {onClose && (
              <button className="plain-btn side-pane-close" onClick={handleClose} aria-label="Close panel">
                ✕
              </button>
            )}
          </div>
        </div>
        {!isInspect && isGlobal && (
          <div className="side-pane-global-banner">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Changes affect all datasets
          </div>
        )}
        <div className="side-pane-body">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`side-pane${isOpen ? ' side-pane-open' : ''}`}
      style={width ? { width: `${width}px` } : undefined}
      aria-hidden={!isOpen}
      role="dialog"
      aria-modal="false"
    >
      {/* Sticky header */}
      <div className="side-pane-header">
        <div className="side-pane-title-area">
          <div className="side-pane-title-row">
            <span className="side-pane-title">{title || 'Untitled'}</span>
            {typeof stableKey === 'string' && stableKey && (
              <span className="ep-sk-group">
                <span className="ep-sk-sep">|</span>
                {!isInspect ? (
                  <span className="ep-sk-edit-wrap">
                    <input
                      className={`ep-sk-input${skLocked ? ' ep-sk-input-locked' : ''}`}
                      value={stableKey}
                      readOnly={skLocked}
                      onChange={(e) => onStableKeyChange?.(e.target.value)}
                      spellCheck={false}
                    />
                    <button
                      className="plain-btn ep-sk-lock-btn"
                      title={skLocked ? 'Unlock to edit stable key' : 'Lock stable key'}
                      onClick={() => {
                        if (skLocked) {
                          onRequestStableKeyUnlock?.(() => setSkLocked(false));
                        } else {
                          setSkLocked(true);
                        }
                      }}
                    >
                      {skLocked ? '🔒' : '🔓'}
                    </button>
                  </span>
                ) : (
                  <span className="ep-sk-inspect-wrap" title="Stable key used in APIs and integrations. Changing it may break existing connections.">
                    <span className="ep-sk-val">{stableKey}</span>
                    <span className="ep-sk-lock-icon">🔒</span>
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
        <div className="side-pane-header-actions">
          {isInspect && onEdit && (
            <button className="btn btn-accent btn-sm" onClick={onEdit}>{editLabel}</button>
          )}
          {!isInspect && (
            <button className="btn btn-primary btn-sm" onClick={onSave}>Save changes</button>
          )}
          <button
            className="plain-btn side-pane-close"
            onClick={handleClose}
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Global notice — just below header when editing a global item */}
      {!isInspect && isGlobal && (
        <div className="side-pane-global-banner">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          Changes affect all datasets
        </div>
      )}

      {/* Scrollable body */}
      <div className="side-pane-body">
        {isOpen && children}
      </div>
    </div>
  );
}
