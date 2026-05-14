import React, { useRef, useState, useLayoutEffect } from 'react';

export default function PillList({ items, pillClass = '', moreClass = '', containerClass = 'pill-list-row' }) {
  const outerRef  = useRef(null);  // constrained wrapper — tells us available width
  const measureRef = useRef(null); // hidden absolute row for measuring natural pill widths
  const [cap, setCap] = useState(items.length);

  useLayoutEffect(() => {
    const outerEl   = outerRef.current;
    const measureEl = measureRef.current;
    if (!outerEl || !measureEl) return;

    const recalc = () => {
      const availW = outerEl.getBoundingClientRect().width;
      if (!availW) return;
      const pillEls = Array.from(measureEl.children);
      if (pillEls.length === 0) return;
      const morePill = pillEls[pillEls.length - 1]; // last child = "+N" pill
      const moreW = morePill.getBoundingClientRect().width;
      const GAP = 4;
      let used = 0;
      let count = 0;
      for (let i = 0; i < pillEls.length - 1; i++) {
        const pw = pillEls[i].getBoundingClientRect().width;
        const gapBefore = i > 0 ? GAP : 0;
        const willHaveMore = count + 1 < pillEls.length - 1; // more items still waiting
        const reserve = willHaveMore ? moreW + GAP : 0;
        if (used + gapBefore + pw + reserve <= availW) {
          used += gapBefore + pw;
          count++;
        } else {
          break;
        }
      }
      setCap(count);
    };

    const ro = new ResizeObserver(recalc);
    ro.observe(outerEl);
    recalc();
    return () => ro.disconnect();
  }, [items]);

  const visible = items.slice(0, cap);
  const hidden  = items.slice(cap);

  return (
    <div ref={outerRef} style={{ width: '100%', minWidth: 0, overflow: 'hidden', position: 'relative' }}>
      {/* Hidden absolute row — measures natural pill widths without affecting layout */}
      <div
        ref={measureRef}
        aria-hidden="true"
        style={{ position: 'absolute', top: 0, left: 0, visibility: 'hidden', display: 'flex', gap: 4, pointerEvents: 'none', whiteSpace: 'nowrap' }}
      >
        {items.map((item) => (
          <span key={item.id} className={pillClass}>{item.label}</span>
        ))}
        {/* +N measured as a plain link, not a pill */}
        <span className="pill-list-more-link">+{items.length} more</span>
      </div>
      {/* Visible row */}
      <div className={containerClass}>
        {visible.map((item) => (
          <span key={item.id} className={pillClass}>{item.label}</span>
        ))}
        {hidden.length > 0 && (
          <span
            className="pill-list-more-link"
            title={hidden.map((i) => i.label).join(', ')}
          >
            +{hidden.length} more
          </span>
        )}
      </div>
    </div>
  );
}
