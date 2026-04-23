import { Dialog } from './components/ui/dialog';
import { Menu } from './components/ui/menu';
import { Select } from './components/ui/select';
import { Switch } from './components/ui/switch';
import { Tabs } from './components/ui/tabs';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import './App.css';

const MODELS = {
  draft: [
    {
      id: 'customer-ltv',
      name: 'Customer LTV',
      desc: 'Lifetime value across orders and subscription events',
      entities: 2,
      joins: 1,
      uses: 0,
      stage: 'draft',
      progress: 0,
    },
    {
      id: 'marketing-attribution',
      name: 'Marketing attribution',
      desc: 'Campaign spend linked to converted deals via UTM source',
      entities: 3,
      joins: 2,
      uses: 4,
      stage: 'draft',
      progress: 1,
    },
  ],
  dev: [
    {
      id: 'sales-overview',
      name: 'Sales overview',
      desc: 'Orders joined with customers and products for sales exploration',
      entities: 3,
      joins: 2,
      uses: 12,
      stage: 'dev',
      progress: 6,
    },
    {
      id: 'support-tickets',
      name: 'Support tickets',
      desc: 'Zendesk tickets linked to accounts for CSAT analysis',
      entities: 2,
      joins: 1,
      uses: 23,
      stage: 'dev',
      progress: 11,
    },
  ],
  production: [
    {
      id: 'revenue-summary',
      name: 'Revenue summary',
      desc: 'Aggregated revenue model used across all executive dashboards',
      entities: 4,
      joins: 3,
      uses: 847,
      stage: 'production',
      progress: 100,
    },
    {
      id: 'headcount-roles',
      name: 'Headcount & roles',
      desc: 'HRIS data combined with org chart hierarchy for people analytics',
      entities: 3,
      joins: 2,
      uses: 234,
      stage: 'production',
      progress: 28,
    },
  ],
};

const INITIAL_ENTITIES = [
  {
    id: 'orders',
    label: 'orders',
    dbName: 'Sales-DB',
    source: 'Sales DB · primary',
    primary: true,
    definition: 'Each record represents an individual order line item',
    fields: [
      { key: 'order_id', label: 'order_id', type: '#', isKey: true, role: 'ID' },
      { key: 'customer_id', label: 'customer_id', type: '#', role: 'DIMENSION' },
      { key: 'product_id', label: 'product_id', type: '#', role: 'DIMENSION' },
      { key: 'order_date', label: 'order_date', type: 'dt', role: 'DIMENSION' },
      { key: 'amount', label: 'amount', type: '$', role: 'MEASURE', agg: 'SUM' },
      { key: 'revenue_net', label: 'revenue_net', type: 'fx', calc: true, role: 'MEASURE', agg: 'SUM', semanticDesc: 'Net revenue after customer discounts and product costs' },
    ],
    x: 80,
    y: 70,
  },
  {
    id: 'customers',
    label: 'customers',
    dbName: 'Sales-DB',
    source: 'Sales DB',
    definition: 'Each record represents a unique customer identity',
    fields: [
      { key: 'customer_id', label: 'customer_id', type: '#', isKey: true, role: 'ID' },
      { key: 'full_name', label: 'full_name', type: 'Aa', role: 'DIMENSION' },
      { key: 'region', label: 'region', type: 'Aa', role: 'DIMENSION' },
      { key: 'segment', label: 'segment', type: 'Aa', role: 'DIMENSION' },
    ],
    x: 390,
    y: 70,
  },
  {
    id: 'products',
    label: 'products',
    dbName: 'Product-DB',
    source: 'Product DB',
    definition: 'Each record represents a product SKU',
    fields: [
      { key: 'product_id', label: 'product_id', type: '#', isKey: true, role: 'ID' },
      { key: 'product_name', label: 'product_name', type: 'Aa', role: 'DIMENSION' },
      { key: 'category', label: 'category', type: 'Aa', role: 'DIMENSION' },
      { key: 'unit_cost', label: 'unit_cost', type: '$', role: 'MEASURE', agg: 'AVG' },
    ],
    x: 245,
    y: 315,
  },
];

const JOIN_TYPES = [
  {
    value: 'INNER',
    label: 'Inner',
    implication: 'Only matched rows survive. Unmatched orders and customers are both removed from the model.',
    highlight: 'intersection',
  },
  {
    value: 'LEFT',
    label: 'Left',
    implication: 'All left-side rows remain. Missing matches on the right come through as null values.',
    highlight: 'left',
  },
  {
    value: 'LEFT_EXCL',
    label: 'Left excl.',
    implication: 'Shows only left-side rows that do not have a matching record on the right.',
    highlight: 'leftExclusive',
  },
  {
    value: 'RIGHT',
    label: 'Right',
    implication: 'All right-side rows remain. Missing left-side matches become nulls.',
    highlight: 'right',
  },
  {
    value: 'FULL',
    label: 'Full',
    implication: 'Keeps everything from both sides. Non-matching rows from either side remain with nulls.',
    highlight: 'full',
  },
  {
    value: 'RIGHT_EXCL',
    label: 'Right excl.',
    implication: 'Shows only right-side rows that do not have a matching record on the left.',
    highlight: 'rightExclusive',
  },
];

const PREVIEW_ROWS = [
  {
    order_id: 10041,
    order_date: '2025-03-01',
    amount: '$840',
    revenue_net: '$620',
    full_name: 'Priya Sharma',
    region: 'APAC',
    segment: 'Enterprise',
    product_name: 'Pro Seat',
    category: 'Licenses',
  },
  {
    order_id: 10042,
    order_date: '2025-03-02',
    amount: '$320',
    revenue_net: '$210',
    full_name: null,
    region: null,
    segment: null,
    product_name: 'Starter Pack',
    category: 'Licenses',
  },
  {
    order_id: 10043,
    order_date: '2025-03-02',
    amount: '$1,200',
    revenue_net: '$940',
    full_name: 'Carlos Vega',
    region: 'LATAM',
    segment: 'Mid-Market',
    product_name: 'Enterprise Suite',
    category: 'Licenses',
  },
];

const JOIN_MAP = {
  INNER: 'INNER JOIN',
  LEFT: 'LEFT JOIN',
  RIGHT: 'RIGHT JOIN',
  FULL: 'FULL OUTER JOIN',
  LEFT_EXCL: 'LEFT JOIN',
  RIGHT_EXCL: 'RIGHT JOIN',
};

const ENTITY_CARD_WIDTH = 195;
const ENTITY_ROW_HEIGHT = 25;
const ENTITY_HEADER_HEIGHT = 39;
const ENTITY_FOOTER_HEIGHT = 32;
const JOIN_NODE_WIDTH = 36;
const JOIN_NODE_HEIGHT = 21;

const entityById = Object.fromEntries(INITIAL_ENTITIES.map((entity) => [entity.id, entity]));

const joinTypeByValue = Object.fromEntries(JOIN_TYPES.map((item) => [item.value, item]));

function usageScoreFromCount(uses) {
  if (uses <= 0) {
    return 0;
  }
  if (uses < 5) {
    return 1;
  }
  if (uses < 20) {
    return 2;
  }
  if (uses < 100) {
    return 3;
  }
  if (uses < 300) {
    return 4;
  }
  return 5;
}

function JoinTypeGlyph({ highlight, className = 'join-type-glyph' }) {
  const glyphId = useId();

  return (
    <svg className={className} viewBox="0 0 44 28" aria-hidden="true">
      <defs>
        <clipPath id={`join-clip-left-${glyphId}`}>
          <circle cx="15" cy="14" r="11" />
        </clipPath>
        <clipPath id={`join-clip-right-${glyphId}`}>
          <circle cx="29" cy="14" r="11" />
        </clipPath>
      </defs>

      {(highlight === 'left' || highlight === 'full') && <circle cx="15" cy="14" r="11" className="join-fill" />}
      {(highlight === 'right' || highlight === 'full') && <circle cx="29" cy="14" r="11" className="join-fill" />}
      {highlight === 'intersection' && (
        <circle cx="29" cy="14" r="11" className="join-fill" clipPath={`url(#join-clip-left-${glyphId})`} />
      )}
      {highlight === 'leftExclusive' && (
        <g>
          <circle cx="15" cy="14" r="11" className="join-fill" />
          <circle cx="29" cy="14" r="11" fill="var(--surface)" clipPath={`url(#join-clip-left-${glyphId})`} />
        </g>
      )}
      {highlight === 'rightExclusive' && (
        <g>
          <circle cx="29" cy="14" r="11" className="join-fill" />
          <circle cx="15" cy="14" r="11" fill="var(--surface)" clipPath={`url(#join-clip-right-${glyphId})`} />
        </g>
      )}

      <circle cx="15" cy="14" r="11" className="join-ring" />
      <circle cx="29" cy="14" r="11" className="join-ring" />
    </svg>
  );
}

function EyeIcon({ className = 'eye-icon' }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M2.2 10c1.75-2.85 4.55-4.28 7.8-4.28 3.22 0 6.02 1.43 7.8 4.28-1.78 2.85-4.58 4.28-7.8 4.28-3.25 0-6.05-1.43-7.8-4.28Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function EyeOffIcon({ className = 'eye-off-icon' }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M2.2 10c1.75-2.85 4.55-4.28 7.8-4.28 3.22 0 6.02 1.43 7.8 4.28-1.78 2.85-4.58 4.28-7.8 4.28-3.25 0-6.05-1.43-7.8-4.28Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M4 16 16 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SqlHighlight({ sql }) {
  const keywords = /\b(SELECT|FROM|JOIN|LEFT|INNER|OUTER|ON|WHERE|GROUP|BY|ORDER|AND|OR|AS|WITH)\b/gi;
  const parts = sql.split(keywords).map((part, i) => {
    if (keywords.test(part)) {
      return <span key={i} className="sql-keyword">{part}</span>;
    }
    return <span key={i}>{part}</span>;
  });
  return <pre className="sql-pre">{parts}</pre>;
}

function titleCase(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function App() {
  const canvasRef = useRef(null);
  const canvasInnerRef = useRef(null);
  const dragStateRef = useRef(null);
  const didInitialCenterRef = useRef(false);
  const [view, setView] = useState('catalog');
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('dev');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightMode, setRightMode] = useState('sql');
  const [activeJoin, setActiveJoin] = useState(null);
  const [activeField, setActiveField] = useState(null);
  const [fieldDescriptions, setFieldDescriptions] = useState({});
  const [fieldDisplayNames, setFieldDisplayNames] = useState({});
  const [hiddenFields, setHiddenFields] = useState(new Set());
  const [aiOpen, setAiOpen] = useState(false);
  const [canvasScroll, setCanvasScroll] = useState({ left: 0, top: 0 });
  const [inspectView, setInspectView] = useState('visual');
  const [hoveredJoinType, setHoveredJoinType] = useState(null);
  const [joins, setJoins] = useState({
    jp1: {
      id: 'jp1',
      type: 'LEFT',
      fromEntity: 'orders',
      toEntity: 'customers',
      from: 'orders.customer_id',
      to: 'customers.customer_id',
      semantics: 'Many-to-one · Optional relationship (Orders → Customer)',
      desc: 'Connects sales to customer profiles. Preservation: All orders are kept regardless of customer match.',
      fromChoices: ['orders.customer_id', 'orders.order_id', 'orders.product_id'],
      toChoices: ['customers.customer_id', 'customers.full_name'],
    },
    jp2: {
      id: 'jp2',
      type: 'INNER',
      fromEntity: 'orders',
      toEntity: 'products',
      from: 'orders.product_id',
      to: 'products.product_id',
      semantics: 'Many-to-one · Required relationship (Orders → Product)',
      desc: 'Connects sales to product catalog. Filter: Only orders with a valid product SKU are included.',
      fromChoices: ['orders.product_id', 'orders.order_id'],
      toChoices: ['products.product_id', 'products.product_name'],
    },
  });
  const [entityPositions, setEntityPositions] = useState(() =>
    Object.fromEntries(INITIAL_ENTITIES.map((entity) => [entity.id, { x: entity.x, y: entity.y }]))
  );

  const joinNodePositions = useMemo(() => {
    const customers = entityPositions.customers;
    const products = entityPositions.products;

    return {
      jp1: {
        left: customers.x - 16 - JOIN_NODE_WIDTH,
        top: customers.y + ENTITY_HEADER_HEIGHT + ENTITY_ROW_HEIGHT * 2 - JOIN_NODE_HEIGHT / 2,
      },
      jp2: {
        left: products.x - 16 - JOIN_NODE_WIDTH,
        top: products.y - 16 - JOIN_NODE_HEIGHT,
      },
    };
  }, [entityPositions]);

  const connectorPaths = useMemo(() => {
    const orders = entityPositions.orders;
    const customers = entityPositions.customers;
    const products = entityPositions.products;
    const jp1 = joinNodePositions.jp1;
    const jp2 = joinNodePositions.jp2;
    const jp1CenterY = jp1.top + JOIN_NODE_HEIGHT / 2;
    const jp2CenterY = jp2.top + JOIN_NODE_HEIGHT / 2;
    const ordersCustomerY = orders.y + ENTITY_HEADER_HEIGHT + ENTITY_ROW_HEIGHT * 2;
    const ordersProductY = orders.y + ENTITY_HEADER_HEIGHT + ENTITY_ROW_HEIGHT * 3.1;
    const productAnchorY = products.y - 8;
    const jp1LeftStartX = orders.x + ENTITY_CARD_WIDTH;
    const jp1LeftEndX = jp1.left;
    const jp1RightStartX = jp1.left + JOIN_NODE_WIDTH;
    const jp1RightEndX = customers.x;
    const jp2LeftStartX = orders.x + ENTITY_CARD_WIDTH;
    const jp2LeftEndX = jp2.left;
    const jp2RightStartX = jp2.left + JOIN_NODE_WIDTH;
    const jp2RightEndX = products.x;

    return {
      jp1Left: `M ${jp1LeftStartX} ${ordersCustomerY} C ${jp1LeftStartX + (jp1LeftEndX - jp1LeftStartX) * 0.42} ${ordersCustomerY} ${jp1LeftStartX + (jp1LeftEndX - jp1LeftStartX) * 0.68} ${jp1CenterY} ${jp1LeftEndX} ${jp1CenterY}`,
      jp1Right: `M ${jp1RightStartX} ${jp1CenterY} C ${jp1RightStartX + (jp1RightEndX - jp1RightStartX) * 0.3} ${jp1CenterY} ${jp1RightStartX + (jp1RightEndX - jp1RightStartX) * 0.72} ${jp1CenterY} ${jp1RightEndX} ${jp1CenterY}`,
      jp2Left: `M ${jp2LeftStartX} ${ordersProductY} C ${jp2LeftStartX + (jp2LeftEndX - jp2LeftStartX) * 0.28} ${ordersProductY + 24} ${jp2LeftStartX + (jp2LeftEndX - jp2LeftStartX) * 0.78} ${jp2CenterY - 16} ${jp2LeftEndX} ${jp2CenterY}`,
      jp2Right: `M ${jp2RightStartX} ${jp2CenterY} C ${jp2RightStartX + (jp2RightEndX - jp2RightStartX) * 0.34} ${jp2CenterY + 8} ${jp2RightStartX + (jp2RightEndX - jp2RightStartX) * 0.76} ${productAnchorY - 6} ${jp2RightEndX} ${productAnchorY}`,
    };
  }, [entityPositions, joinNodePositions]);

  const badgeClass = stage === 'production' ? 'badge-prod' : stage === 'dev' ? 'badge-dev' : 'badge-draft';

  const visibleFields = useMemo(() => {
    return INITIAL_ENTITIES.flatMap((entity) =>
      entity.fields
        .filter((field) => !hiddenFields.has(field.key))
        .map((field) => ({
          key: field.key,
          entity: entity.id,
          label: fieldDisplayNames[field.key] || field.label,
        }))
    );
  }, [fieldDisplayNames, hiddenFields]);

  const currentSql = useMemo(() => {
    const columns = visibleFields
      .map((field) => {
        if (field.key === 'revenue_net') {
          return '  (o.amount - p.unit_cost) AS revenue_net';
        }
        const prefix = field.entity === 'orders' ? 'o' : field.entity === 'customers' ? 'c' : 'p';
        return fieldDisplayNames[field.key]
          ? `  ${prefix}.${field.key} AS "${fieldDisplayNames[field.key]}"`
          : `  ${prefix}.${field.key}`;
      })
      .join(',\n');

    return [
      '-- Auto-generated',
      'SELECT',
      columns,
      'FROM orders o',
      `${JOIN_MAP[joins.jp1.type]} customers c`,
      '  ON o.customer_id = c.customer_id',
      `${JOIN_MAP[joins.jp2.type]} products p`,
      '  ON o.product_id = p.product_id',
    ].join('\n');
  }, [fieldDisplayNames, joins.jp1.type, joins.jp2.type, visibleFields]);

  const inspectMarkdown = useMemo(() => {
    const lines = [];
    lines.push(`# Sales overview`);
    lines.push(`> **${stage}** · 3 entities · ${visibleFields.length} visible fields`);
    lines.push('');
    lines.push('Orders joined with customers and products from two separate databases. Use to analyze revenue by customer segment, region, and product category.');
    lines.push('');
    lines.push('**Analytics scope:** Individual order line items');
    lines.push('');
    lines.push('## Entities');
    lines.push('');

    INITIAL_ENTITIES.forEach((entity) => {
      const visibleEntityFields = entity.fields.filter((f) => !hiddenFields.has(f.key));
      const dims = visibleEntityFields.filter((f) => f.role !== 'MEASURE');
      const measures = visibleEntityFields.filter((f) => f.role === 'MEASURE');

      lines.push(`### ${titleCase(entity.label)} (${entity.dbName})${entity.primary ? ' — Primary' : ''}`);
      lines.push(entity.definition);
      lines.push('');

      if (dims.length) {
        lines.push('**Dimensions**');
        dims.forEach((f) => {
          const name = fieldDisplayNames[f.key] || f.label;
          const desc = fieldDescriptions[f.key] || f.semanticDesc;
          let line = `- \`${name}\``;
          if (f.isKey) line += ' *(key)*';
          if (desc) line += ` — ${desc}`;
          lines.push(line);
        });
        lines.push('');
      }

      if (measures.length) {
        lines.push('**Measures**');
        measures.forEach((f) => {
          const name = fieldDisplayNames[f.key] || f.label;
          const desc = fieldDescriptions[f.key] || f.semanticDesc;
          let line = `- \`${name}\``;
          if (f.calc) line += ' *(computed)*';
          if (f.agg) line += ` · ${f.agg}`;
          if (desc) line += ` — ${desc}`;
          lines.push(line);
        });
        lines.push('');
      }
    });

    lines.push('## Relationships');
    lines.push('');

    Object.values(joins).forEach((join) => {
      lines.push(`### ${titleCase(join.fromEntity)} → ${titleCase(join.toEntity)}`);
      lines.push(join.semantics.replace(/\s*\(.*?\)\s*$/, ''));
      lines.push('');
      lines.push(join.desc);
      lines.push(`\`${join.from} = ${join.to}\``);
      lines.push('');
    });

    return lines.join('\n');
  }, [stage, visibleFields, hiddenFields, fieldDisplayNames, fieldDescriptions, joins]);

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return MODELS;
    }
    return {
      draft: MODELS.draft.filter((item) => item.name.toLowerCase().includes(q)),
      dev: MODELS.dev.filter((item) => item.name.toLowerCase().includes(q)),
      production: MODELS.production.filter((item) => item.name.toLowerCase().includes(q)),
    };
  }, [search]);

  const selectField = (entityId, field) => {
    setActiveField({ entityId, fieldKey: field.key, source: `${entityId}.${field.key}`, type: field.type });
    setActiveJoin(null);
    setRightCollapsed(false);
  };

  const selectJoin = (joinId) => {
    setActiveJoin(joinId);
    setActiveField(null);
    setRightCollapsed(false);
  };

  const toggleHidden = (fieldKey) => {
    setHiddenFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldKey)) {
        next.delete(fieldKey);
      } else {
        next.add(fieldKey);
      }
      return next;
    });
  };

  const updateJoin = (joinId, key, value) => {
    setJoins((prev) => ({
      ...prev,
      [joinId]: {
        ...prev[joinId],
        [key]: value,
      },
    }));
  };

  const handleEntityPointerDown = (event, entityId) => {
    if (event.button !== 0 || !canvasRef.current) {
      return;
    }

    const canvasRect = canvasRef.current.getBoundingClientRect();
    const pointerX = event.clientX - canvasRect.left + canvasRef.current.scrollLeft;
    const pointerY = event.clientY - canvasRect.top + canvasRef.current.scrollTop;
    const entityPosition = entityPositions[entityId];

    if (!entityPosition) {
      return;
    }

    dragStateRef.current = {
      entityId,
      pointerId: event.pointerId,
      offsetX: pointerX - entityPosition.x,
      offsetY: pointerY - entityPosition.y,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleEntityPointerMove = (event) => {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId || !canvasRef.current) {
      return;
    }

    const canvasRect = canvasRef.current.getBoundingClientRect();
    const pointerX = event.clientX - canvasRect.left + canvasRef.current.scrollLeft;
    const pointerY = event.clientY - canvasRect.top + canvasRef.current.scrollTop;
    const nextX = Math.max(16, pointerX - dragState.offsetX);
    const nextY = Math.max(16, pointerY - dragState.offsetY);

    setEntityPositions((prev) => ({
      ...prev,
      [dragState.entityId]: { x: nextX, y: nextY },
    }));
  };

  const handleEntityPointerUp = (event) => {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const activeJoinModel = activeJoin ? joins[activeJoin] : null;
  const activeFieldMeta = activeField
    ? entityById[activeField.entityId]?.fields.find((field) => field.key === activeField.fieldKey)
    : null;
  const activeJoinTypeMeta = JOIN_TYPES.find((item) => item.value === (hoveredJoinType || activeJoinModel?.type));

  useEffect(() => {
    if (view !== 'editor' || !canvasRef.current || !canvasInnerRef.current) {
      return;
    }

    if (didInitialCenterRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const entityBounds = INITIAL_ENTITIES.reduce(
      (bounds, entity) => {
        const entityPosition = entityPositions[entity.id];
        const entityHeight = ENTITY_HEADER_HEIGHT + entity.fields.length * ENTITY_ROW_HEIGHT + ENTITY_FOOTER_HEIGHT;

        return {
          minX: Math.min(bounds.minX, entityPosition.x),
          minY: Math.min(bounds.minY, entityPosition.y),
          maxX: Math.max(bounds.maxX, entityPosition.x + ENTITY_CARD_WIDTH),
          maxY: Math.max(bounds.maxY, entityPosition.y + entityHeight),
        };
      },
      { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: 0, maxY: 0 }
    );

    const joinBounds = Object.values(joinNodePositions).reduce(
      (bounds, node) => ({
        minX: Math.min(bounds.minX, node.left),
        minY: Math.min(bounds.minY, node.top),
        maxX: Math.max(bounds.maxX, node.left + JOIN_NODE_WIDTH),
        maxY: Math.max(bounds.maxY, node.top + JOIN_NODE_HEIGHT),
      }),
      entityBounds
    );

    const centerCanvas = () => {
      const leftInset = 64;
      const rightInset = 0;
      const visibleWidth = canvas.clientWidth - leftInset - rightInset;
      const visibleHeight = canvas.clientHeight;
      const contentCenterX = (joinBounds.minX + joinBounds.maxX) / 2;
      const contentCenterY = (joinBounds.minY + joinBounds.maxY) / 2;
      const viewportCenterX = leftInset + visibleWidth / 2;
      const viewportCenterY = visibleHeight / 2;

      canvas.scrollLeft = Math.max(0, contentCenterX - viewportCenterX);
      canvas.scrollTop = Math.max(0, contentCenterY - viewportCenterY);
    };

    centerCanvas();
    const frameId = window.requestAnimationFrame(centerCanvas);
    didInitialCenterRef.current = true;

    return () => window.cancelAnimationFrame(frameId);
  }, [entityPositions, joinNodePositions, leftCollapsed, rightCollapsed, view]);

  useEffect(() => {
    if (view !== 'editor') {
      didInitialCenterRef.current = false;
    }
  }, [view]);

  const closeInspectorPopup = () => {
    setActiveField(null);
    setActiveJoin(null);
  };

  const fieldPopupPosition = useMemo(() => {
    if (!activeField) {
      return null;
    }

    const entity = entityById[activeField.entityId];
    const entityPosition = entityPositions[activeField.entityId];
    if (!entity) {
      return null;
    }

    const fieldIndex = entity.fields.findIndex((field) => field.key === activeField.fieldKey);

    return {
      left: entityPosition.x + 220,
      top: entityPosition.y + 48 + Math.max(fieldIndex, 0) * 25 - 12,
    };
  }, [activeField, entityPositions]);

  const joinPopupPosition = useMemo(() => {
    if (!activeJoin) {
      return null;
    }

    const node = joinNodePositions[activeJoin];
    if (!node) {
      return null;
    }

    return {
      left: node.left + 26,
      top: node.top - 24,
    };
  }, [activeJoin, joinNodePositions]);

  return (
    <div className="app">
      <nav className="nav">
        {view === 'catalog' && (
          <div className="nav-brand">
            <span className="nav-brand-dot" />
            Reveal
          </div>
        )}

        {view !== 'catalog' && (
          <div className="nav-center">
            <button className="plain-btn nav-back" title="Back to models" onClick={() => setView('catalog')}>
              ←
            </button>
            <Menu.Root>
              <Menu.Trigger className="plain-btn nav-model-btn">Sales overview ▾</Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner sideOffset={6}>
                  <Menu.Popup className="menu-popup">
                    <Menu.Item className="menu-item">Rename model</Menu.Item>
                    <Menu.Item className="menu-item">Edit description</Menu.Item>
                    <Menu.Item className="menu-item">Duplicate</Menu.Item>
                    <Menu.Separator className="menu-sep" />
                    <Menu.Item className="menu-item" onClick={() => setStage('production')}>
                      Promote to production
                    </Menu.Item>
                    <Menu.Item className="menu-item" onClick={() => setStage('draft')}>
                      Move to draft
                    </Menu.Item>
                    <Menu.Separator className="menu-sep" />
                    <Menu.Item className="menu-item danger">Delete model</Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
            <span className={`badge ${badgeClass}`}>{stage}</span>
            <span className="badge badge-neutral">3 entities · 2 joins</span>
          </div>
        )}



        {view === 'editor' ? (
          <div className="nav-right">
            <button className="btn btn-ai" onClick={() => setAiOpen(true)}>
              ✦ AI suggest
            </button>
            <button className="btn" onClick={() => setView('inspect')}>
              Inspect view
            </button>
            <button className="btn btn-primary" onClick={() => setAiOpen(true)}>
              Save model
            </button>
          </div>
        ) : null}

        {view === 'inspect' ? (
          <div className="nav-right">
            <span className="badge badge-dev">🔒 Read-only · viewer access</span>
            <button className="btn" onClick={() => setView('editor')}>
              ← Back to editor
            </button>
          </div>
        ) : null}
      </nav>

      {view === 'catalog' ? (
        <section className="view active">
          <div className="cat-bar">
            <div>
              <h1>Data models</h1>
              <p>6 models</p>
            </div>
            <div className="cat-bar-right">
              <input
                className="search-input"
                placeholder="Search models…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button className="btn btn-primary" onClick={() => setView('editor')}>
                + New model
              </button>
            </div>
          </div>

          <div className="kanban">
            {[
              ['Draft', filteredModels.draft],
              ['Dev', filteredModels.dev],
              ['Production', filteredModels.production],
            ].map(([label, list]) => (
              <div key={label}>
                <div className="kcol-head">
                  <span className="kcol-label">{label}</span>
                  <span className="kcol-count">{list.length}</span>
                </div>
                {list.map((model) => (
                  (() => {
                    const usageScore = usageScoreFromCount(model.uses);

                    return (
                      <button
                        key={model.id}
                        className="plain-btn mcard"
                        onClick={() => {
                          setView('editor');
                          setStage(model.stage);
                        }}
                      >
                        <div className="mcard-name">{model.name}</div>
                        <div className="mcard-desc">{model.desc}</div>
                        <div className="mcard-foot">
                          <span className="badge badge-neutral">{model.entities} entities</span>
                          <span className="badge badge-neutral">{model.joins} joins</span>
                          <span className={`badge ${model.stage === 'production' ? 'badge-prod' : model.stage === 'dev' ? 'badge-dev' : 'badge-draft'}`}>
                            {model.stage}
                          </span>
                          <span
                            className="mcard-usage"
                            aria-label={`Usage score ${usageScore} out of 5 from ${model.uses} uses`}
                          >
                            <span className="mcard-usage-dots" aria-hidden="true">
                              {Array.from({ length: 5 }, (_, index) => (
                                <span
                                  key={`${model.id}-usage-${index}`}
                                  className={`mcard-usage-dot ${index < usageScore ? 'is-filled' : ''}`}
                                />
                              ))}
                            </span>
                            <span className="mcard-uses">{model.uses} uses</span>
                          </span>
                        </div>
                      </button>
                    );
                  })()
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {view === 'editor' ? (
        <section className="view active">
          <div className="ed-body">
            <aside className={`side-panel left ${leftCollapsed ? 'collapsed' : ''}`}>
              <header className="panel-hd">
                <span className="panel-hd-title">Data sources</span>
                <button className="plain-btn panel-collapse-btn" onClick={() => setLeftCollapsed(true)}>
                  «
                </button>
              </header>
              <div className="sb-search-wrap">
                <input placeholder="Search tables…" />
              </div>
              <div className="sb-scroll">
                <p className="src-group-hd">▾ Sales DB (Postgres)</p>
                <p className="tbl-row on-canvas">orders ↗</p>
                <p className="tbl-row on-canvas">customers ↗</p>
                <p className="tbl-row">returns</p>
                <p className="tbl-row">shipments</p>
                <p className="src-group-hd">▾ Product DB (MySQL)</p>
                <p className="tbl-row on-canvas">products ↗</p>
                <p className="tbl-row">categories</p>
                <p className="tbl-row">inventory</p>
              </div>
            </aside>

            <div className="canvas-wrap">
              <div className="canvas" ref={canvasRef} onScroll={(e) => setCanvasScroll({ left: e.target.scrollLeft, top: e.target.scrollTop })}>
                <div className="canvas-inner" ref={canvasInnerRef}>
                  <svg className="join-svg" viewBox="0 0 2400 1800" preserveAspectRatio="none">
                    <path d={connectorPaths.jp1Left} />
                    <path d={connectorPaths.jp1Right} />
                    <path d={connectorPaths.jp2Left} />
                    <path d={connectorPaths.jp2Right} />
                  </svg>

                  {INITIAL_ENTITIES.map((entity) => (
                    <article
                      key={entity.id}
                      className={`ecard ${entity.primary ? 'primary' : ''}`}
                      style={{ left: entityPositions[entity.id].x, top: entityPositions[entity.id].y }}
                    >
                      <header
                        className="ec-hd draggable"
                        onPointerDown={(event) => handleEntityPointerDown(event, entity.id)}
                        onPointerMove={handleEntityPointerMove}
                        onPointerUp={handleEntityPointerUp}
                      >
                      <span className="ec-name">{entity.label}</span>
                      <span className="ec-src">{entity.source}</span>
                      </header>
                      <div className="ec-fields">
                        {entity.fields.map((field) => {
                        const selected =
                          activeField?.entityId === entity.id && activeField?.fieldKey === field.key;
                        const hidden = hiddenFields.has(field.key);
                        return (
                          <div
                            key={field.key}
                            className={`frow ${selected ? 'selected' : ''} ${hidden ? 'hidden-field' : ''}`}
                            onClick={() => selectField(entity.id, field)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                selectField(entity.id, field);
                              }
                            }}
                          >
                            <span className={`ftype ${field.isKey ? 'key' : ''} ${field.calc ? 'calc' : ''}`}>
                              {field.type}
                            </span>
                            <span className={`fname ${field.calc ? 'calc' : ''}`}>
                              {fieldDisplayNames[field.key] || field.label}
                            </span>
                            <button
                              className={`plain-btn fa-btn ${hidden ? 'is-active' : ''}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleHidden(field.key);
                              }}
                              aria-label={hidden ? `Show ${field.label}` : `Hide ${field.label}`}
                            >
                              {hidden ? <EyeOffIcon /> : <EyeIcon />}
                            </button>
                          </div>
                        );
                        })}
                      </div>
                      <button className="plain-btn ec-add-calc">+ Add calculated field</button>
                    </article>
                  ))}

                  <button
                    className={`plain-btn jnode ${activeJoin === 'jp1' ? 'active' : ''}`}
                    style={{ left: joinNodePositions.jp1.left, top: joinNodePositions.jp1.top }}
                    onClick={() => selectJoin('jp1')}
                    aria-label="Edit join between orders and customers"
                  >
                    <JoinTypeGlyph
                      className="jnode-glyph"
                      highlight={joinTypeByValue[joins.jp1.type].highlight}
                    />
                  </button>
                  <button
                    className={`plain-btn jnode ${activeJoin === 'jp2' ? 'active' : ''}`}
                    style={{ left: joinNodePositions.jp2.left, top: joinNodePositions.jp2.top }}
                    onClick={() => selectJoin('jp2')}
                    aria-label="Edit join between orders and products"
                  >
                    <JoinTypeGlyph
                      className="jnode-glyph"
                      highlight={joinTypeByValue[joins.jp2.type].highlight}
                    />
                  </button>

                  {/* popups moved to canvas-wrap level to avoid overflow clipping */}
                  {false && activeFieldMeta && fieldPopupPosition ? (
                    <div
                      className="canvas-popup canvas-popup-field"
                      style={{ left: fieldPopupPosition.left, top: fieldPopupPosition.top }}
                    >
                    <span className="canvas-popup-arrow" />
                    <header className="canvas-popup-head">
                      <div>
                        <div className="detail-title">{fieldDisplayNames[activeFieldMeta.key] || activeFieldMeta.label}</div>
                        <div className="detail-sub">{activeField?.source}</div>
                      </div>
                      <button className="plain-btn canvas-popup-close" onClick={closeInspectorPopup}>
                        ×
                      </button>
                    </header>
                    <div className="canvas-popup-body">
                      <section className="sp-section">
                        <p className="sp-lbl">Display name</p>
                        <input
                          className="fi-inp"
                          value={fieldDisplayNames[activeFieldMeta.key] || ''}
                          placeholder={activeFieldMeta.label}
                          onChange={(event) =>
                            setFieldDisplayNames((prev) => ({
                              ...prev,
                              [activeFieldMeta.key]: event.target.value,
                            }))
                          }
                        />
                      </section>

                      <section className="sp-section">
                        <p className="sp-lbl">Description for AI</p>
                        <textarea
                          className="fi-ta"
                          value={fieldDescriptions[activeFieldMeta.key] || ''}
                          onChange={(event) =>
                            setFieldDescriptions((prev) => ({
                              ...prev,
                              [activeFieldMeta.key]: event.target.value,
                            }))
                          }
                          placeholder="What does this field mean in business terms?"
                        />
                        <p className="fi-char">{(fieldDescriptions[activeFieldMeta.key] || '').length} chars</p>
                      </section>

                      <section className="sp-section">
                        <div className="fi-toggle-row">
                          <span>Visible to users</span>
                          <Switch.Root
                            className="bu-switch"
                            checked={!hiddenFields.has(activeFieldMeta.key)}
                            onCheckedChange={() => toggleHidden(activeFieldMeta.key)}
                          >
                            <Switch.Thumb className="bu-switch-thumb" />
                          </Switch.Root>
                        </div>
                        <div className="fi-toggle-row">
                          <span>Include in AI context</span>
                          <Switch.Root className="bu-switch" defaultChecked>
                            <Switch.Thumb className="bu-switch-thumb" />
                          </Switch.Root>
                        </div>
                      </section>
                    </div>
                    </div>
                  ) : null}

                  {false && activeJoinModel && joinPopupPosition ? (
                    <div
                      className="canvas-popup canvas-popup-join"
                      style={{ left: joinPopupPosition.left, top: joinPopupPosition.top }}
                    >
                    <span className="canvas-popup-arrow" />
                    <header className="canvas-popup-head">
                      <div>
                        <div className="detail-title">
                          Join: {activeJoinModel.fromEntity} → {activeJoinModel.toEntity}
                        </div>
                        <div className="detail-sub">{JOIN_MAP[activeJoinModel.type]}</div>
                      </div>
                      <button className="plain-btn canvas-popup-close" onClick={closeInspectorPopup}>
                        ×
                      </button>
                    </header>

                    <div className="canvas-popup-body">
                      <section className="sp-section">
                        <p className="sp-lbl">Join type</p>
                        <div className="join-type-grid" role="radiogroup" aria-label="Join type selector">
                          {JOIN_TYPES.map((item) => {
                            const selected = activeJoinModel.type === item.value;

                            return (
                              <button
                                key={item.value}
                                type="button"
                                className={`join-type-card ${selected ? 'selected' : ''}`}
                                role="radio"
                                aria-checked={selected}
                                onClick={() => updateJoin(activeJoinModel.id, 'type', item.value)}
                                onMouseEnter={() => setHoveredJoinType(item.value)}
                                onMouseLeave={() => setHoveredJoinType(null)}
                                title={item.implication}
                              >
                                <JoinTypeGlyph highlight={item.highlight} />
                                <span className="join-type-name">{item.label}</span>
                              </button>
                            );
                          })}
                        </div>
                        {activeJoinTypeMeta ? (
                          <div className="join-type-hint">
                            <strong>{activeJoinTypeMeta.label}</strong>
                            <p>{activeJoinTypeMeta.implication}</p>
                          </div>
                        ) : null}
                      </section>

                      <section className="sp-section">
                        <p className="sp-lbl">Key mapping</p>
                        <div className="join-map-row">
                          <Select.Root
                            value={activeJoinModel.from}
                            onValueChange={(value) => updateJoin(activeJoinModel.id, 'from', value)}
                            items={activeJoinModel.fromChoices}
                          >
                            <Select.Trigger className="bu-trigger">
                              <Select.Value />
                              <Select.Icon className="bu-icon">▾</Select.Icon>
                            </Select.Trigger>
                            <Select.Portal>
                              <Select.Positioner>
                                <Select.Popup className="bu-popup">
                                  <Select.List>
                                    {activeJoinModel.fromChoices.map((item) => (
                                      <Select.Item key={item} value={item} className="bu-item">
                                        <Select.ItemText>{item}</Select.ItemText>
                                      </Select.Item>
                                    ))}
                                  </Select.List>
                                </Select.Popup>
                              </Select.Positioner>
                            </Select.Portal>
                          </Select.Root>

                          <span className="join-arrow">→</span>

                          <Select.Root
                            value={activeJoinModel.to}
                            onValueChange={(value) => updateJoin(activeJoinModel.id, 'to', value)}
                            items={activeJoinModel.toChoices}
                          >
                            <Select.Trigger className="bu-trigger">
                              <Select.Value />
                              <Select.Icon className="bu-icon">▾</Select.Icon>
                            </Select.Trigger>
                            <Select.Portal>
                              <Select.Positioner>
                                <Select.Popup className="bu-popup">
                                  <Select.List>
                                    {activeJoinModel.toChoices.map((item) => (
                                      <Select.Item key={item} value={item} className="bu-item">
                                        <Select.ItemText>{item}</Select.ItemText>
                                      </Select.Item>
                                    ))}
                                  </Select.List>
                                </Select.Popup>
                              </Select.Positioner>
                            </Select.Portal>
                          </Select.Root>
                        </div>
                      </section>

                      <section className="sp-section">
                        <p className="sp-lbl">Description</p>
                        <textarea
                          className="fi-ta"
                          value={activeJoinModel.desc}
                          onChange={(event) => updateJoin(activeJoinModel.id, 'desc', event.target.value)}
                        />
                      </section>
                    </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {activeFieldMeta && fieldPopupPosition ? (
                <div
                  className="canvas-popup canvas-popup-field"
                  style={{ left: fieldPopupPosition.left - canvasScroll.left, top: fieldPopupPosition.top - canvasScroll.top }}
                >
                  <span className="canvas-popup-arrow" />
                  <header className="canvas-popup-head">
                    <div>
                      <div className="detail-title">{fieldDisplayNames[activeFieldMeta.key] || activeFieldMeta.label}</div>
                      <div className="detail-sub">{activeField?.source}</div>
                    </div>
                    <button className="plain-btn canvas-popup-close" onClick={closeInspectorPopup}>×</button>
                  </header>
                  <div className="canvas-popup-body">
                    <section className="sp-section">
                      <p className="sp-lbl">Display name</p>
                      <input
                        className="fi-inp"
                        value={fieldDisplayNames[activeFieldMeta.key] || ''}
                        placeholder={activeFieldMeta.label}
                        onChange={(event) => setFieldDisplayNames((prev) => ({ ...prev, [activeFieldMeta.key]: event.target.value }))}
                      />
                    </section>
                    <section className="sp-section">
                      <p className="sp-lbl">Description for AI</p>
                      <textarea
                        className="fi-ta"
                        value={fieldDescriptions[activeFieldMeta.key] || ''}
                        onChange={(event) => setFieldDescriptions((prev) => ({ ...prev, [activeFieldMeta.key]: event.target.value }))}
                        placeholder="What does this field mean in business terms?"
                      />
                      <p className="fi-char">{(fieldDescriptions[activeFieldMeta.key] || '').length} chars</p>
                    </section>
                    <section className="sp-section">
                      <div className="fi-toggle-row">
                        <span>Visible to users</span>
                        <Switch.Root className="bu-switch" checked={!hiddenFields.has(activeFieldMeta.key)} onCheckedChange={() => toggleHidden(activeFieldMeta.key)}>
                          <Switch.Thumb className="bu-switch-thumb" />
                        </Switch.Root>
                      </div>
                      <div className="fi-toggle-row">
                        <span>Include in AI context</span>
                        <Switch.Root className="bu-switch" defaultChecked>
                          <Switch.Thumb className="bu-switch-thumb" />
                        </Switch.Root>
                      </div>
                    </section>
                  </div>
                </div>
              ) : null}

              {activeJoinModel && joinPopupPosition ? (
                <div
                  className="canvas-popup canvas-popup-join"
                  style={{ left: joinPopupPosition.left - canvasScroll.left, top: joinPopupPosition.top - canvasScroll.top }}
                >
                  <span className="canvas-popup-arrow" />
                  <header className="canvas-popup-head">
                    <div>
                      <div className="detail-title">Join: {activeJoinModel.fromEntity} → {activeJoinModel.toEntity}</div>
                      <div className="detail-sub">{JOIN_MAP[activeJoinModel.type]}</div>
                    </div>
                    <button className="plain-btn canvas-popup-close" onClick={closeInspectorPopup}>×</button>
                  </header>
                  <div className="canvas-popup-body">
                    <section className="sp-section">
                      <p className="sp-lbl">Join type</p>
                      <div className="join-type-grid" role="radiogroup" aria-label="Join type selector">
                        {JOIN_TYPES.map((item) => {
                          const selected = activeJoinModel.type === item.value;
                          return (
                            <button key={item.value} type="button" className={`join-type-card ${selected ? 'selected' : ''}`} role="radio" aria-checked={selected} onClick={() => updateJoin(activeJoinModel.id, 'type', item.value)} onMouseEnter={() => setHoveredJoinType(item.value)} onMouseLeave={() => setHoveredJoinType(null)} title={item.implication}>
                              <JoinTypeGlyph highlight={item.highlight} />
                              <span className="join-type-name">{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                      {activeJoinTypeMeta ? (
                        <div className="join-type-hint">
                          <strong>{activeJoinTypeMeta.label}</strong>
                          <p>{activeJoinTypeMeta.implication}</p>
                        </div>
                      ) : null}
                    </section>
                    <section className="sp-section">
                      <p className="sp-lbl">Key mapping</p>
                      <div className="join-map-row">
                        <Select.Root value={activeJoinModel.from} onValueChange={(value) => updateJoin(activeJoinModel.id, 'from', value)} items={activeJoinModel.fromChoices}>
                          <Select.Trigger className="bu-trigger"><Select.Value /><Select.Icon className="bu-icon">▾</Select.Icon></Select.Trigger>
                          <Select.Portal><Select.Positioner><Select.Popup className="bu-popup"><Select.List>{activeJoinModel.fromChoices.map((item) => (<Select.Item key={item} value={item} className="bu-item"><Select.ItemText>{item}</Select.ItemText></Select.Item>))}</Select.List></Select.Popup></Select.Positioner></Select.Portal>
                        </Select.Root>
                        <span className="join-arrow">→</span>
                        <Select.Root value={activeJoinModel.to} onValueChange={(value) => updateJoin(activeJoinModel.id, 'to', value)} items={activeJoinModel.toChoices}>
                          <Select.Trigger className="bu-trigger"><Select.Value /><Select.Icon className="bu-icon">▾</Select.Icon></Select.Trigger>
                          <Select.Portal><Select.Positioner><Select.Popup className="bu-popup"><Select.List>{activeJoinModel.toChoices.map((item) => (<Select.Item key={item} value={item} className="bu-item"><Select.ItemText>{item}</Select.ItemText></Select.Item>))}</Select.List></Select.Popup></Select.Positioner></Select.Portal>
                        </Select.Root>
                      </div>
                    </section>
                    <section className="sp-section">
                      <p className="sp-lbl">Description</p>
                      <textarea className="fi-ta" value={activeJoinModel.desc} onChange={(event) => updateJoin(activeJoinModel.id, 'desc', event.target.value)} />
                    </section>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="canvas-float-layer" aria-hidden="true">
              {leftCollapsed ? (
                <button className="float-btn float-left" onClick={() => setLeftCollapsed(false)}>
                  Sources
                </button>
              ) : null}

              {/* Removed SQL float button */}
            </div>

            <aside className={`side-panel right ${rightCollapsed ? 'collapsed' : ''}`}>
              <Tabs.Root value={rightMode} onValueChange={setRightMode} className="mode-wrap">
                <header className="panel-hd tight">
                  <Tabs.List className="sql-tabs">
                    <Tabs.Tab className="sql-tab" value="sql">
                      SQL
                    </Tabs.Tab>
                    <Tabs.Tab className="sql-tab" value="ai">
                      AI context
                    </Tabs.Tab>
                  </Tabs.List>
                  <button className="plain-btn panel-collapse-btn" onClick={() => setRightCollapsed(true)}>
                    »
                  </button>
                </header>


                <Tabs.Panel value="sql" className="sql-content tab-panel">
                  <pre>{currentSql}</pre>
                </Tabs.Panel>

                <Tabs.Panel value="ai" className="sql-content ai-copy tab-panel">
                  <div className="ai-context-header">
                    <h4>Model Intent</h4>
                    <p>Machine-readable semantic context for AI query generation and interpretation.</p>
                  </div>
                  
                  <section className="ai-section">
                    <h5>Row Meaning</h5>
                    <code>{`{ "row_meaning": "order_line_item", "description": "One row per individual order line" }`}</code>
                  </section>

                  <section className="ai-section">
                    <h5>Relationship Map</h5>
                    <pre className="ai-pre">{`{
  "orders": { "entity_type": "fact", "is_primary": true },
  "customers": { "entity_type": "dimension", "join": "many-to-one", "is_optional": true },
  "products": { "entity_type": "dimension", "join": "many-to-one", "is_optional": false }
}`}</pre>
                  </section>

                  <section className="ai-section">
                    <h5>Aggregations</h5>
                    <pre className="ai-pre">{`{
  "revenue_net": { "role": "measure", "calculation": "SUM", "description": "Net revenue after discounts" },
  "unit_cost": { "role": "measure", "calculation": "AVG" }
}`}</pre>
                  </section>

                  <div className="ai-footer">
                    <p className="muted">These semantic cues are injected into the LLM system prompt for improved accuracy.</p>
                  </div>
                </Tabs.Panel>
              </Tabs.Root>

            </aside>
          </div>

          <section className="prev-panel">
            <header className="prev-hd">
              <div className="prev-title">Preview · 3 of 4,821 rows</div>
              <span className="badge badge-warn">2 null customer rows</span>
            </header>
            <div className="prev-scroll">
              <table className="ptab">
                <thead>
                  <tr>
                    {visibleFields.map((field) => (
                      <th key={field.key} className={activeField?.fieldKey === field.key ? 'active-col' : ''}>
                        {field.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PREVIEW_ROWS.map((row) => (
                    <tr key={row.order_id}>
                      {visibleFields.map((field) => (
                        <td key={`${row.order_id}-${field.key}`} className={activeField?.fieldKey === field.key ? 'active-col' : ''}>
                          {row[field.key] === null ? <span className="null-val">null</span> : row[field.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      ) : null}

      {view === 'inspect' ? (
        <section className="view active">
          <div className="insp-body">
            <main className="insp-main">
              <header className="insp-model-hd">
                <div className="insp-model-hd-row">
                  <h2>
                    Sales overview <span className={`badge ${badgeClass}`}>{stage}</span>
                  </h2>
                  <div className="insp-view-toggle">
                    <button className={`insp-toggle-btn ${inspectView === 'visual' ? 'active' : ''}`} onClick={() => setInspectView('visual')}>Visual</button>
                    <button className={`insp-toggle-btn ${inspectView === 'markdown' ? 'active' : ''}`} onClick={() => setInspectView('markdown')}>Markdown</button>
                  </div>
                </div>
                <p>
                  Orders joined with customers and products from two separate databases. Use to analyze revenue by
                  customer segment, region, and product category.
                </p>
                <div className="insp-grain-summary">
                  <span className="grain-lbl">Analytics Scope:</span>
                  <span className="grain-val">Individual order line items</span>
                </div>
                <div className="insp-tags">
                  <span className="badge badge-neutral">3 entities</span>
                  <span className="badge badge-neutral">2 joins</span>
                  <span className="badge badge-neutral">{visibleFields.length} visible fields</span>
                </div>
              </header>



              {inspectView === 'markdown' ? (
                <div className="insp-md-wrap">
                  <pre className="insp-md-pre">{inspectMarkdown}</pre>
                </div>
              ) : null}

              {inspectView === 'visual' ? <h3 className="insp-section-hd">Entities & fields</h3> : null}
              {inspectView === 'visual' ? <div className="insp-masonry">
                {INITIAL_ENTITIES.map((entity) => {
                  const visibleEntityFields = entity.fields.filter((field) => !hiddenFields.has(field.key));
                  const dimensionFields = visibleEntityFields.filter((field) => field.role !== 'MEASURE');
                  const measureFields = visibleEntityFields.filter((field) => field.role === 'MEASURE');

                  return (
                    <article className={`ent-block ${entity.primary ? 'is-primary' : ''}`} key={entity.id}>
                      <header className="ent-block-hd">
                        <div className="ent-block-name-row">
                          <span className="ent-block-name">{titleCase(entity.label)} <span className="ent-block-db">({entity.dbName})</span></span>
                          {entity.primary ? <span className="ent-primary-badge">Primary</span> : null}
                        </div>
                        <div className="ent-block-grain">{entity.definition}</div>
                      </header>

                      {dimensionFields.length ? (
                        <section className="field-group">
                          <h4 className="field-group-title dimensions">Dimensions <span className="field-group-count">{dimensionFields.length}</span></h4>
                          {dimensionFields.map((field) => (
                            <div className="ifield" key={field.key}>
                              <span className="ifield-type-chip">{field.type}</span>
                              <div className="ifield-right">
                                <div className="ifield-name-row">
                                  <span className="ifield-name">
                                    {fieldDisplayNames[field.key] || field.label}
                                    {fieldDisplayNames[field.key] ? <span className="ifield-orig">({field.label})</span> : null}
                                  </span>
                                  {field.isKey && <span className="ifield-badge ifield-badge-key">key</span>}
                                </div>
                                {(fieldDescriptions[field.key] || field.semanticDesc) ? (
                                  <p className="ifield-desc">{fieldDescriptions[field.key] || field.semanticDesc}</p>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </section>
                      ) : null}

                      {measureFields.length ? (
                        <section className="field-group">
                          <h4 className="field-group-title measures">Measures <span className="field-group-count">{measureFields.length}</span></h4>
                          {measureFields.map((field) => (
                            <div className="ifield" key={field.key}>
                              <span className="ifield-type-chip">{field.type}</span>
                              <div className="ifield-right">
                                <div className="ifield-name-row">
                                  <span className="ifield-name">
                                    {fieldDisplayNames[field.key] || field.label}
                                    {fieldDisplayNames[field.key] ? <span className="ifield-orig">({field.label})</span> : null}
                                  </span>
                                  {field.calc && <span className="ifield-badge ifield-badge-calc">computed</span>}
                                  {field.agg && <span className="ifield-badge ifield-badge-agg">{field.agg}</span>}
                                </div>
                                {(fieldDescriptions[field.key] || field.semanticDesc) ? (
                                  <p className="ifield-desc">{fieldDescriptions[field.key] || field.semanticDesc}</p>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </section>
                      ) : null}
                    </article>
                  );
                })}
              </div> : null}

              {inspectView === 'visual' ? <h3 className="insp-section-hd">Relationships & Core Logic</h3> : null}
              {inspectView === 'visual' ? Object.values(joins).map((join) => (
                <article className="join-block" key={join.id}>
                  <header className="join-block-hd">
                    <span className="join-name">{titleCase(join.fromEntity)} → {titleCase(join.toEntity)}</span>
                    <div className="join-semantics">
                      {join.semantics.replace(/\s*\(.*?\)\s*$/, '').split(' · ').map((part, i) => (
                        <span key={i} className={`join-sem-part join-sem-part-${i}`}>{part}</span>
                      ))}
                    </div>
                  </header>
                  <div className="join-row">
                    <p className="join-desc">{join.desc}</p>
                  </div>
                  <div className="join-row">
                    <p className="join-keys">
                      Logic: Match on <span className="mono">{join.from.split('.')[1]}</span> = <span className="mono">{join.to.split('.')[1]}</span>
                    </p>
                  </div>
                </article>
              )) : null}
            </main>

            <aside className="insp-sidebar">
              <h3 className="insp-meta-hd">Model details</h3>
              <div className="meta-row">
                <span>Status</span>
                <span>
                  <span className={`badge ${badgeClass}`}>{stage}</span>
                </span>
              </div>
              <div className="meta-row">
                <span>Created</span>
                <span>Mar 14, 2025</span>
              </div>
              <div className="meta-row">
                <span>Last edited</span>
                <span>Apr 18, 2026</span>
              </div>
              <div className="meta-row">
                <span>Author</span>
                <span>George A.</span>
              </div>
            </aside>
          </div>
        </section>
      ) : null}

      <Dialog.Root open={aiOpen} onOpenChange={setAiOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="dialog-backdrop" />
          <Dialog.Viewport className="dialog-viewport">
            <Dialog.Popup className="dialog-popup">
              <Dialog.Title className="modal-title">✦ AI-suggested model description</Dialog.Title>
              <Dialog.Description className="modal-desc">
                Review the generated description before saving this model.
              </Dialog.Description>
              <div className="modal-body">
                <label className="modal-label" htmlFor="model-name">
                  Model name
                </label>
                <input id="model-name" defaultValue="Sales overview" />
                <label className="modal-label" htmlFor="model-description">
                  Description
                </label>
                <textarea
                  id="model-description"
                  defaultValue="Orders joined with customers (left outer) and products (inner) from two separate databases. Use to analyze revenue by customer segment, region, and product category. All orders are included even when customer data is missing."
                />
              </div>
              <div className="modal-actions">
                <Dialog.Close className="btn">Cancel</Dialog.Close>
                <Dialog.Close className="btn btn-primary">Save model</Dialog.Close>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

export default App;
