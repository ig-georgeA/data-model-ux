import React, { useEffect, useRef, useState } from 'react';

export default function EditPane({
  isOpen,
  mode,
  title,
  typeBadge,
  caretY,
  isGlobal,
  width,
  excludeRef,
  onClose,
  onSave,
  onEdit,
  stableKey,
  onStableKeyChange,
  children,
}) {
  const paneRef = useRef(null);
  const isInspect = mode === 'inspect';
  const [skLocked, setSkLocked] = useState(true);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Close on click outside (skip clicks within the excluded ref, e.g. the left pane)
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e) => {
      if (paneRef.current && paneRef.current.contains(e.target)) return;
      if (excludeRef?.current && excludeRef.current.contains(e.target)) return;
      if (isInspect) {
        onClose();
      } else {
        if (window.confirm('Discard unsaved changes?')) onClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen, isInspect, onClose, excludeRef]);

  const badgeLabel = typeBadge === 'model' ? 'Model' : typeBadge === 'metric' ? 'Measure' : null; // eslint-disable-line no-unused-vars
  const saveLabel = mode === 'edit' ? 'Save changes' : null;
  const editLabel = typeBadge === 'model' ? 'Edit Model' : 'Edit Metric';

  return (
    <div
      ref={paneRef}
      className={`edit-pane${isInspect ? ' edit-pane-mode-inspect' : ''} ${isOpen ? 'edit-pane-open' : ''}`}
      style={width ? { width: `${width}px`, right: 'auto' } : undefined}
      aria-hidden={!isOpen}
    >
      {/* Caret arrow — outside the inner wrapper so it escapes overflow:hidden */}
      {isOpen && caretY !== null && caretY !== undefined && (
        <span
          className="edit-pane-caret"
          style={{ top: caretY }}
          aria-hidden="true"
        />
      )}

      {/* Inner wrapper clips rounded corners without hiding the caret */}
      <div className="edit-pane-inner">

      {/* Sticky header */}
      <div className="edit-pane-header">
        <div className="edit-pane-title-area">
          <div className="edit-pane-title-row">
            <span className="edit-pane-title">{title || 'Untitled'}</span>
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
                          // eslint-disable-next-line no-alert
                          if (window.confirm('Changing the stable key may break existing integrations. Continue?')) {
                            setSkLocked(false);
                          }
                        } else {
                          setSkLocked(true);
                        }
                      }}
                    >
                      {skLocked ? '🔒' : '🔓'}
                    </button>
                  </span>
                ) : (
                  <span className="ep-sk-inspect-wrap" data-tooltip="Stable key used in APIs and integrations to uniquely identify this model. Changing it may break existing connections.">
                    <span className="ep-sk-val">{stableKey}</span>
                    <span className="ep-sk-lock-icon">🔒</span>
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
        <div className="edit-pane-header-actions">
          {isInspect && onEdit && (
            <button className="btn btn-accent btn-sm" onClick={onEdit}>{editLabel}</button>
          )}
          {!isInspect && (
            <button className="btn btn-primary btn-sm" onClick={onSave}>{saveLabel}</button>
          )}
          <button
            className="plain-btn edit-pane-close"
            onClick={onClose}
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="edit-pane-body">
        {isOpen && children}
      </div>

      {/* Footer — global notice only, no buttons */}
      {!isInspect && isGlobal && (
        <div className="edit-pane-footer">
          <span className="edit-pane-global-notice">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Changes affect all datasets
          </span>
        </div>
      )}

      </div>{/* end .edit-pane-inner */}
    </div>
  );
}
