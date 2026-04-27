import { Dialog } from './components/ui/dialog';
import { ChevronDown, PanelLeftOpen } from 'lucide-react';
import { Menu } from './components/ui/menu';
import { Select } from './components/ui/select';
import { Switch } from './components/ui/switch';
import { Tabs } from './components/ui/tabs';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Handle, Position,
  getBezierPath, EdgeLabelRenderer,
  useReactFlow, ReactFlowProvider, useStore, useNodesInitialized,
} from '@xyflow/react';
import Dagre from '@dagrejs/dagre';
import './App.css';

const MODELS = {
  draft: [
    { id: 'customer-ltv', name: 'Customer LTV', desc: 'Lifetime value across orders and subscription events', entities: 2, joins: 1, uses: 0, stage: 'draft', progress: 0 },
    { id: 'marketing-attribution', name: 'Marketing attribution', desc: 'Campaign spend linked to converted deals via UTM source', entities: 3, joins: 2, uses: 4, stage: 'draft', progress: 1 },
  ],
  dev: [
    { id: 'sales-overview', name: 'Sales overview', desc: 'Orders joined with customers and products for sales exploration', entities: 3, joins: 2, uses: 12, stage: 'dev', progress: 6 },
    { id: 'support-tickets', name: 'Support tickets', desc: 'Zendesk tickets linked to accounts for CSAT analysis', entities: 2, joins: 1, uses: 23, stage: 'dev', progress: 11 },
  ],
  production: [
    { id: 'revenue-summary', name: 'Revenue summary', desc: 'Aggregated revenue model used across all executive dashboards', entities: 4, joins: 3, uses: 847, stage: 'production', progress: 100 },
    { id: 'headcount-roles', name: 'Headcount & roles', desc: 'HRIS data combined with org chart hierarchy for people analytics', entities: 3, joins: 2, uses: 234, stage: 'production', progress: 28 },
  ],
};

const INITIAL_ENTITIES = [
  {
    id: 'orders', label: 'orders', dbName: 'Sales DB', source: 'Sales DB · primary', primary: true,
    definition: 'Each record represents an individual order line item',
    fields: [
      { key: 'order_id', label: 'order_id', type: '#', isKey: true, role: 'ID' },
      { key: 'customer_id', label: 'customer_id', type: '#', role: 'DIMENSION' },
      { key: 'product_id', label: 'product_id', type: '#', role: 'DIMENSION' },
      { key: 'order_date', label: 'order_date', type: 'dt', role: 'DIMENSION' },
      { key: 'amount', label: 'amount', type: '$', role: 'MEASURE', agg: 'SUM' },
      { key: 'revenue_net', label: 'revenue_net', type: 'fx', calc: true, role: 'MEASURE', agg: 'SUM', semanticDesc: 'Net revenue after customer discounts and product costs' },
    ],
    x: 80, y: 70,
  },
  {
    id: 'customers', label: 'customers', dbName: 'Sales DB', source: 'Sales DB',
    definition: 'Each record represents a unique customer identity',
    fields: [
      { key: 'customer_id', label: 'customer_id', type: '#', isKey: true, role: 'ID' },
      { key: 'full_name', label: 'full_name', type: 'Aa', role: 'DIMENSION' },
      { key: 'region', label: 'region', type: 'Aa', role: 'DIMENSION' },
      { key: 'segment', label: 'segment', type: 'Aa', role: 'DIMENSION' },
    ],
    x: 390, y: 70,
  },
  {
    id: 'products', label: 'products', dbName: 'Product DB', source: 'Product DB',
    definition: 'Each record represents a product SKU',
    fields: [
      { key: 'product_id', label: 'product_id', type: '#', isKey: true, role: 'ID' },
      { key: 'product_name', label: 'product_name', type: 'Aa', role: 'DIMENSION' },
      { key: 'category', label: 'category', type: 'Aa', role: 'DIMENSION' },
      { key: 'unit_cost', label: 'unit_cost', type: '$', role: 'MEASURE', agg: 'AVG' },
    ],
    x: 245, y: 315,
  },
];

const JOIN_TYPES = [
  { value: 'INNER', label: 'Inner', implication: 'Only matched rows survive. Unmatched orders and customers are both removed from the model.', highlight: 'intersection' },
  { value: 'LEFT', label: 'Left', implication: 'All left-side rows remain. Missing matches on the right come through as null values.', highlight: 'left' },
  { value: 'LEFT_EXCL', label: 'Left excl.', implication: 'Shows only left-side rows that do not have a matching record on the right.', highlight: 'leftExclusive' },
  { value: 'RIGHT', label: 'Right', implication: 'All right-side rows remain. Missing left-side matches become nulls.', highlight: 'right' },
  { value: 'FULL', label: 'Full', implication: 'Keeps everything from both sides. Non-matching rows from either side remain with nulls.', highlight: 'full' },
  { value: 'RIGHT_EXCL', label: 'Right excl.', implication: 'Shows only right-side rows that do not have a matching record on the left.', highlight: 'rightExclusive' },
];

const PREVIEW_ROWS = [
  { order_id: 10041, order_date: '2025-03-01', amount: '$840', revenue_net: '$620', full_name: 'Priya Sharma', region: 'APAC', segment: 'Enterprise', product_name: 'Pro Seat', category: 'Licenses' },
  { order_id: 10042, order_date: '2025-03-02', amount: '$320', revenue_net: '$210', full_name: null, region: null, segment: null, product_name: 'Starter Pack', category: 'Licenses' },
  { order_id: 10043, order_date: '2025-03-02', amount: '$1,200', revenue_net: '$940', full_name: 'Carlos Vega', region: 'LATAM', segment: 'Mid-Market', product_name: 'Enterprise Suite', category: 'Licenses' },
];

const JOIN_MAP = { INNER: 'INNER JOIN', LEFT: 'LEFT JOIN', RIGHT: 'RIGHT JOIN', FULL: 'FULL OUTER JOIN', LEFT_EXCL: 'LEFT JOIN', RIGHT_EXCL: 'RIGHT JOIN' };

const ENTITY_CARD_WIDTH = 195;
const ENTITY_ROW_HEIGHT = 25;
const ENTITY_HEADER_HEIGHT = 39;
const ENTITY_FOOTER_HEIGHT = 32;

const CONNECTOR_CATEGORIES = [
  {
    category: 'Files',
    items: [
      { id: 'data-files', name: 'Data Files', desc: 'Connect directly to XLS, CSV or Google Sheets.' },
      { id: 'sharepoint', name: 'SharePoint Online', desc: 'Get info for your SharePoint lists and libraries.' },
    ],
  },
  {
    category: 'Databases',
    items: [
      { id: 'sales-db', name: 'Sales DB', dbType: 'PostgreSQL', desc: 'Connect to your queries, tables and more.' },
      { id: 'product-db', name: 'Product DB', dbType: 'MySQL', desc: 'Connect to your queries, tables and more.' },
      { id: 'azure-sql', name: 'Azure SQL', desc: 'Connect to your queries, tables and more.' },
      { id: 'azure-ssas', name: 'Azure SSAS', desc: 'Connect to your enterprise-grade data models.' },
      { id: 'mariadb', name: 'MariaDB', desc: 'Connect to your queries, tables and more.' },
      { id: 'microsoft-sql', name: 'Microsoft SQL', desc: 'Connect to your queries, tables and more.' },
      { id: 'mysql', name: 'MySQL', desc: 'Connect to your queries, tables and more.' },
      { id: 'oracle', name: 'Oracle', desc: 'Connect to your queries, tables and more.' },
      { id: 'postgresql', name: 'PostgreSQL', desc: 'Connect to your queries, tables and more.' },
      { id: 'snowflake', name: 'Snowflake', desc: 'Connect to all your cloud based data.' },
      { id: 'sybase', name: 'Sybase', desc: 'Connect to your queries, tables and more.' },
    ],
  },
  {
    category: 'Marketing, Sales and CRMs',
    items: [
      { id: 'google-ads', name: 'Google Ads', desc: 'Connect to your online advertising.' },
      { id: 'google-analytics', name: 'Google Analytics 4', desc: 'Connect to your web analytics directly.' },
      { id: 'google-search', name: 'Google Search Console', desc: 'Connect to your websites search traffic.' },
      { id: 'hubspot', name: 'HubSpot', desc: 'Connect to your marketing automation.' },
      { id: 'marketing-cloud', name: 'Marketing Cloud', desc: 'Connect to your marketing automation metrics.' },
      { id: 'marketo', name: 'Marketo', desc: 'Connect to your marketing automation.' },
      { id: 'ms-dynamics', name: 'Microsoft Dynamics', desc: 'Connect to your CRM data.' },
      { id: 'netsuite', name: 'NetSuite', desc: 'Connect to your NetSuite data.' },
      { id: 'quickbooks-desktop', name: 'QuickBooks Desktop', desc: 'Connect to your accounting software.' },
      { id: 'quickbooks-online', name: 'QuickBooks Online', desc: 'Connect to your accounting software.' },
      { id: 'salesforce', name: 'Salesforce', desc: 'Connect to your CRM data.' },
    ],
  },
  {
    category: 'Big Data Storages',
    items: [
      { id: 'amazon-athena', name: 'Amazon Athena', desc: 'Connect to all your serverless queries.' },
      { id: 'amazon-redshift', name: 'Amazon Redshift', desc: 'Connect to your cloud data warehouse.' },
      { id: 'azure-synapse', name: 'Azure Synapse', desc: 'Connect to your analytics service.' },
      { id: 'databricks', name: 'Databricks', desc: 'Connect to all your cloud based data.' },
      { id: 'elasticsearch', name: 'Elasticsearch', desc: 'Connect to your indices.' },
      { id: 'google-bigquery', name: 'Google BigQuery', desc: 'Connect to your serverless data warehouse.' },
    ],
  },
  {
    category: 'From the web',
    items: [
      { id: 'odata-feed', name: 'OData Feed', desc: 'Get content and files using Open Data Protocol.' },
      { id: 'rest-api', name: 'REST API', desc: 'Use REST to connect to additional sources.' },
      { id: 'web-resource', name: 'Web Resource', desc: 'Use files and content from URLs.' },
    ],
  },
  {
    category: 'Social Media',
    items: [
      { id: 'facebook', name: 'Facebook', desc: 'Connect to your Facebook insights.' },
      { id: 'facebook-ads', name: 'Facebook Ads', desc: 'Connect to your Facebook advertising.' },
      { id: 'instagram', name: 'Instagram', desc: 'Connect to your Instagram insights.' },
      { id: 'linkedin', name: 'LinkedIn', desc: 'Connect to your LinkedIn insights.' },
      { id: 'linkedin-ads', name: 'LinkedIn Ads', desc: 'Connect to your LinkedIn advertising.' },
    ],
  },
];

const DATASOURCE_TABLES = {
  'sales-db': { tables: ['orders', 'customers', 'returns', 'shipments', 'invoices'], views: ['v_revenue_summary', 'v_customer_cohorts'] },
  'product-db': { tables: ['products', 'categories', 'inventory', 'suppliers'], views: ['v_product_performance'] },
  'hubspot': { tables: ['contacts', 'deals', 'companies', 'activities'], views: [] },
  'salesforce': { tables: ['accounts', 'opportunities', 'leads', 'contacts', 'campaigns'], views: ['v_pipeline_summary'] },
  'google-analytics': { tables: ['sessions', 'events', 'conversions', 'audiences'], views: ['v_funnel_report'] },
  'amazon-redshift': { tables: ['fact_orders', 'dim_customers', 'dim_products', 'dim_dates'], views: ['v_daily_revenue'] },
  'google-bigquery': { tables: ['events', 'sessions', 'users', 'conversions'], views: [] },
  'snowflake': { tables: ['raw_orders', 'raw_users', 'raw_events', 'raw_products'], views: ['v_clean_orders'] },
  'postgresql': { tables: ['users', 'subscriptions', 'payments', 'logs'], views: [] },
};

const TABLE_FIELDS = {
  'returns': [
    { key: 'return_id', label: 'return_id', type: '#', isKey: true, role: 'ID' },
    { key: 'order_id', label: 'order_id', type: '#', role: 'DIMENSION' },
    { key: 'customer_id', label: 'customer_id', type: '#', role: 'DIMENSION' },
    { key: 'return_date', label: 'return_date', type: 'dt', role: 'DIMENSION' },
    { key: 'reason', label: 'reason', type: 'Aa', role: 'DIMENSION' },
  ],
  'shipments': [
    { key: 'shipment_id', label: 'shipment_id', type: '#', isKey: true, role: 'ID' },
    { key: 'order_id', label: 'order_id', type: '#', role: 'DIMENSION' },
    { key: 'shipped_at', label: 'shipped_at', type: 'dt', role: 'DIMENSION' },
    { key: 'carrier', label: 'carrier', type: 'Aa', role: 'DIMENSION' },
    { key: 'status', label: 'status', type: 'Aa', role: 'DIMENSION' },
  ],
  'invoices': [
    { key: 'invoice_id', label: 'invoice_id', type: '#', isKey: true, role: 'ID' },
    { key: 'order_id', label: 'order_id', type: '#', role: 'DIMENSION' },
    { key: 'customer_id', label: 'customer_id', type: '#', role: 'DIMENSION' },
    { key: 'amount', label: 'amount', type: '$', role: 'MEASURE', agg: 'SUM' },
    { key: 'issued_at', label: 'issued_at', type: 'dt', role: 'DIMENSION' },
  ],
  'categories': [
    { key: 'category_id', label: 'category_id', type: '#', isKey: true, role: 'ID' },
    { key: 'name', label: 'name', type: 'Aa', role: 'DIMENSION' },
    { key: 'parent_id', label: 'parent_id', type: '#', role: 'DIMENSION' },
  ],
  'inventory': [
    { key: 'inventory_id', label: 'inventory_id', type: '#', isKey: true, role: 'ID' },
    { key: 'product_id', label: 'product_id', type: '#', role: 'DIMENSION' },
    { key: 'quantity', label: 'quantity', type: '#', role: 'MEASURE', agg: 'SUM' },
    { key: 'warehouse', label: 'warehouse', type: 'Aa', role: 'DIMENSION' },
  ],
  'suppliers': [
    { key: 'supplier_id', label: 'supplier_id', type: '#', isKey: true, role: 'ID' },
    { key: 'name', label: 'name', type: 'Aa', role: 'DIMENSION' },
    { key: 'country', label: 'country', type: 'Aa', role: 'DIMENSION' },
  ],
  'v_product_performance': [
    { key: 'product_id', label: 'product_id', type: '#', isKey: true, role: 'ID' },
    { key: 'revenue', label: 'revenue', type: '$', role: 'MEASURE', agg: 'SUM' },
    { key: 'units_sold', label: 'units_sold', type: '#', role: 'MEASURE', agg: 'SUM' },
  ],
};

const CAT_COLORS = {
  'Files': '#dde8ff',
  'Databases': '#e8f0ff',
  'Marketing, Sales and CRMs': '#fde8f0',
  'Big Data Storages': '#fff3d8',
  'From the web': '#e8f8ee',
  'Social Media': '#f3e8ff',
};


const ITEM_CATEGORY_MAP = Object.fromEntries(
  CONNECTOR_CATEGORIES.flatMap((cat) => cat.items.map((item) => [item.id, cat.category]))
);

const CATEGORY_LABELS = {
  'Files': 'Files',
  'Databases': 'Databases',
  'Marketing, Sales and CRMs': 'Marketing & Sales',
  'Big Data Storages': 'Big Data',
  'From the web': 'Web',
  'Social Media': 'Social Media',
};

function connectorAbbr(name) {
  const words = name.split(' ');
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const CONNECTOR_ICONS = {
  'sharepoint':        'microsoftsharepoint',
  'sales-db':          'postgresql',
  'product-db':        'mysql',
  'azure-sql':         'microsoftazure',
  'azure-ssas':        'microsoftazure',
  'mariadb':           'mariadb',
  'microsoft-sql':     'microsoftsqlserver',
  'mysql':             'mysql',
  'oracle':            'oracle',
  'postgresql':        'postgresql',
  'snowflake':         'snowflake',
  'sybase':            'sap',
  'google-ads':        'googleads',
  'google-analytics':  'googleanalytics',
  'google-search':     'googlesearchconsole',
  'hubspot':           'hubspot',
  'marketing-cloud':   'salesforce',
  'marketo':           'marketo',
  'ms-dynamics':       'dynamics365',
  'quickbooks-desktop':'intuit',
  'quickbooks-online': 'intuit',
  'salesforce':        'salesforce',
  'amazon-athena':     'amazonaws',
  'amazon-redshift':   'amazonredshift',
  'azure-synapse':     'microsoftazure',
  'databricks':        'databricks',
  'elasticsearch':     'elasticsearch',
  'google-bigquery':   'googlebigquery',
  'facebook':          'facebook',
  'facebook-ads':      'meta',
  'instagram':         'instagram',
  'linkedin':          'linkedin',
  'linkedin-ads':      'linkedin',
};

function usageScoreFromCount(uses) {
  if (uses <= 0) return 0;
  if (uses < 5) return 1;
  if (uses < 20) return 2;
  if (uses < 100) return 3;
  if (uses < 300) return 4;
  return 5;
}

function JoinTypeGlyph({ highlight, className = 'join-type-glyph' }) {
  const glyphId = useId();
  return (
    <svg className={className} viewBox="0 0 44 28" aria-hidden="true">
      <defs>
        <clipPath id={`join-clip-left-${glyphId}`}><circle cx="15" cy="14" r="11" /></clipPath>
        <clipPath id={`join-clip-right-${glyphId}`}><circle cx="29" cy="14" r="11" /></clipPath>
      </defs>
      {(highlight === 'left' || highlight === 'full') && <circle cx="15" cy="14" r="11" className="join-fill" />}
      {(highlight === 'right' || highlight === 'full') && <circle cx="29" cy="14" r="11" className="join-fill" />}
      {highlight === 'intersection' && <circle cx="29" cy="14" r="11" className="join-fill" clipPath={`url(#join-clip-left-${glyphId})`} />}
      {highlight === 'leftExclusive' && <g><circle cx="15" cy="14" r="11" className="join-fill" /><circle cx="29" cy="14" r="11" fill="var(--surface)" clipPath={`url(#join-clip-left-${glyphId})`} /></g>}
      {highlight === 'rightExclusive' && <g><circle cx="29" cy="14" r="11" className="join-fill" /><circle cx="15" cy="14" r="11" fill="var(--surface)" clipPath={`url(#join-clip-right-${glyphId})`} /></g>}
      <circle cx="15" cy="14" r="11" className="join-ring" />
      <circle cx="29" cy="14" r="11" className="join-ring" />
    </svg>
  );
}

function EyeIcon({ className = 'eye-icon' }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2.2 10c1.75-2.85 4.55-4.28 7.8-4.28 3.22 0 6.02 1.43 7.8 4.28-1.78 2.85-4.58 4.28-7.8 4.28-3.25 0-6.05-1.43-7.8-4.28Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function EyeOffIcon({ className = 'eye-off-icon' }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2.2 10c1.75-2.85 4.55-4.28 7.8-4.28 3.22 0 6.02 1.43 7.8 4.28-1.78 2.85-4.58 4.28-7.8 4.28-3.25 0-6.05-1.43-7.8-4.28Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4 16 16 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SqlHighlight({ sql }) {
  const re = /(--[^\n]*)|(\b(?:SELECT|FROM|LEFT|RIGHT|INNER|OUTER|FULL|JOIN|ON|WHERE|GROUP|ORDER|BY|AND|OR|AS|WITH|HAVING|DISTINCT|LIMIT|NOT|NULL|IS)\b)/gi;
  const parts = [];
  let last = 0;
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(sql)) !== null) {
    if (m.index > last) parts.push(<span key={last}>{sql.slice(last, m.index)}</span>);
    if (m[1]) parts.push(<span key={m.index} className="sql-comment">{m[1]}</span>);
    else parts.push(<span key={m.index} className="sql-keyword">{m[0].toUpperCase()}</span>);
    last = m.index + m[0].length;
  }
  if (last < sql.length) parts.push(<span key={last}>{sql.slice(last)}</span>);
  return <pre className="sql-pre">{parts}</pre>;
}

function titleCase(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

// ── React Flow custom node ──────────────────────────────────────────────────
function EntityCardNode({ data }) {
  const {
    id, label, source, primary, fields,
    isJoined, hiddenFields, fieldDisplayNames, activeField,
    onSelectField, toggleHidden,
  } = data;

  return (
    <article className={`ecard ${primary ? 'primary' : ''} ${isJoined ? '' : 'unjoined'}`}>
      <header className="ec-hd draggable">
        <span className="ec-name">{label}</span>
        <span className="ec-src">{source}</span>
      </header>
      <div className="ec-fields">
        {fields.map((field) => {
          const selected = activeField?.entityId === id && activeField?.fieldKey === field.key;
          const hidden = hiddenFields.has(field.key);
          return (
            <div
              key={field.key}
              className={`frow ${selected ? 'selected' : ''} ${hidden ? 'hidden-field' : ''}`}
              onClick={() => onSelectField(id, field)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelectField(id, field); }}
            >
              <span className={`ftype ${field.isKey ? 'key' : ''} ${field.calc ? 'calc' : ''}`}>{field.type}</span>
              <span className={`fname ${field.calc ? 'calc' : ''}`}>{fieldDisplayNames[field.key] || field.label}</span>
              <button
                className={`plain-btn fa-btn ${hidden ? 'is-active' : ''}`}
                onClick={(e) => { e.stopPropagation(); toggleHidden(field.key); }}
                aria-label={hidden ? `Show ${field.label}` : `Hide ${field.label}`}
              >
                {hidden ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          );
        })}
      </div>
      <button className="plain-btn ec-add-calc nodrag nopan">+ Add calculated field</button>
      <Handle type="source" position={Position.Right} id={`${id}-src`} className="entity-handle" />
      <Handle type="target" position={Position.Left} id={`${id}-tgt`} className="entity-handle" />
    </article>
  );
}
const nodeTypes = { entity: EntityCardNode };

// ── Field popup rendered via EdgeLabelRenderer so it sits above all nodes ───
function FieldPopupLayer({
  activeField, canvasEntities, entityPositions,
  hiddenFields, fieldDisplayNames, fieldDescriptions, fieldFormulas,
  setFieldDisplayNames, setFieldDescriptions, setFieldFormulas,
  toggleHidden, closeInspectorPopup,
}) {
  const [tx, ty, zoom] = useStore((s) => s.transform);
  if (!activeField) return null;
  const entity = canvasEntities.find((e) => e.id === activeField.entityId);
  const entityPos = entityPositions[activeField.entityId];
  if (!entity || !entityPos) return null;
  const fieldMeta = entity.fields.find((f) => f.key === activeField.fieldKey);
  if (!fieldMeta) return null;
  const fieldIdx = entity.fields.findIndex((f) => f.key === activeField.fieldKey);

  // Place popup to the right of the card, vertically centred on the selected row.
  // Convert flow coords → screen-space pixels using the RF viewport transform.
  const flowX = entityPos.x + ENTITY_CARD_WIDTH + 18;
  const flowY = entityPos.y + ENTITY_HEADER_HEIGHT + Math.max(fieldIdx, 0) * ENTITY_ROW_HEIGHT + ENTITY_ROW_HEIGHT / 2;
  const left = flowX * zoom + tx;
  const top = flowY * zoom + ty;

  return (
    <div
      className="canvas-popup canvas-popup-field nodrag nopan"
      style={{
        position: 'absolute',
        left,
        top,
        transform: 'translateY(-50%)',
        pointerEvents: 'all',
        zIndex: 50,
      }}
    >
        <span className="canvas-popup-arrow" />
        <header className="canvas-popup-head">
          <div>
            <div className="detail-title">{fieldDisplayNames[fieldMeta.key] || fieldMeta.label}</div>
            <div className="detail-sub">{activeField.source}</div>
          </div>
          <button className="plain-btn canvas-popup-close" onClick={closeInspectorPopup}>×</button>
        </header>
        <div className="canvas-popup-body">
          <section className="sp-section">
            <p className="sp-lbl">Display name</p>
            <input
              className="fi-inp"
              value={fieldDisplayNames[fieldMeta.key] || ''}
              placeholder={fieldMeta.label}
              onChange={(e) => setFieldDisplayNames((prev) => ({ ...prev, [fieldMeta.key]: e.target.value }))}
            />
          </section>
          {fieldMeta.calc && (
            <section className="sp-section">
              <p className="sp-lbl">Formula</p>
              <textarea
                className="fi-ta fi-formula"
                value={fieldFormulas[fieldMeta.key] ?? (fieldMeta.formula || '')}
                onChange={(e) => setFieldFormulas((prev) => ({ ...prev, [fieldMeta.key]: e.target.value }))}
                placeholder="e.g. amount - unit_cost"
                spellCheck={false}
              />
            </section>
          )}
          <section className="sp-section">
            <p className="sp-lbl">Description for AI</p>
            <textarea
              className="fi-ta"
              value={fieldDescriptions[fieldMeta.key] || ''}
              onChange={(e) => setFieldDescriptions((prev) => ({ ...prev, [fieldMeta.key]: e.target.value }))}
              placeholder="What does this field mean in business terms?"
            />
            <p className="fi-char">{(fieldDescriptions[fieldMeta.key] || '').length} chars</p>
          </section>
          <section className="sp-section">
            <div className="fi-toggle-row">
              <span>Visible to users</span>
              <Switch.Root className="bu-switch" checked={!hiddenFields.has(fieldMeta.key)} onCheckedChange={() => toggleHidden(fieldMeta.key)}>
                <Switch.Thumb className="bu-switch-thumb" />
              </Switch.Root>
            </div>
            <div className="fi-toggle-row">
              <span>Include in AI context</span>
              <Switch.Root className="bu-switch" defaultChecked><Switch.Thumb className="bu-switch-thumb" /></Switch.Root>
            </div>
          </section>
        </div>
    </div>
  );
}

// ── React Flow custom edge ──────────────────────────────────────────────────
function JoinEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data,
}) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });
  const {
    isActive, onSelect, joinType, joinHighlight,
    fromEntity, toEntity, fromChoices, toChoices, from, to, desc,
    onUpdateJoin, hoveredJoinType, setHoveredJoinType, onClose,
  } = data;
  const [,, zoom] = useStore((s) => s.transform);

  return (
    <>
      <path id={id} className="react-flow__edge-path join-edge-path" d={edgePath} />
      <EdgeLabelRenderer>
        <button
          className={`jnode nodrag nopan ${isActive ? 'active' : ''}`}
          style={{
            position: 'absolute',
            transform: `translate(${labelX}px,${labelY}px) scale(${1 / zoom}) translate(-50%,-50%)`,
            pointerEvents: 'all',
          }}
          onClick={onSelect}
          aria-label={`Edit join between ${fromEntity} and ${toEntity}`}
        >
          <JoinTypeGlyph className="jnode-glyph" highlight={joinHighlight || 'intersection'} />
        </button>
        {isActive && (
          <div
            className="canvas-popup canvas-popup-join nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(${labelX}px,${labelY}px) scale(${1 / zoom}) translate(22px,-50%)`,
              pointerEvents: 'all',
            }}
          >
            <span className="canvas-popup-arrow" />
            <header className="canvas-popup-head">
              <div>
                <div className="detail-title">Join: {fromEntity} → {toEntity}</div>
                <div className="detail-sub">{JOIN_MAP[joinType]}</div>
              </div>
              <button className="plain-btn canvas-popup-close" onClick={onClose}>×</button>
            </header>
            <div className="canvas-popup-body">
              <section className="sp-section">
                <p className="sp-lbl">Join type</p>
                <div className="join-type-grid" role="radiogroup" aria-label="Join type selector">
                  {JOIN_TYPES.map((item) => {
                    const selected = joinType === item.value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        className={`join-type-card ${selected ? 'selected' : ''}`}
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onUpdateJoin(id, 'type', item.value)}
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
                {(() => {
                  const meta = JOIN_TYPES.find((i) => i.value === (hoveredJoinType || joinType));
                  return meta ? (
                    <div className="join-type-hint"><strong>{meta.label}</strong><p>{meta.implication}</p></div>
                  ) : null;
                })()}
              </section>
              <section className="sp-section">
                <p className="sp-lbl">Key mapping</p>
                <div className="join-map-row">
                  <Select.Root value={from} onValueChange={(v) => onUpdateJoin(id, 'from', v)} items={fromChoices}>
                    <Select.Trigger className="bu-trigger"><Select.Value /><Select.Icon className="bu-icon">▾</Select.Icon></Select.Trigger>
                    <Select.Portal><Select.Positioner><Select.Popup className="bu-popup"><Select.List>{fromChoices.map((c) => (<Select.Item key={c} value={c} className="bu-item"><Select.ItemText>{c}</Select.ItemText></Select.Item>))}</Select.List></Select.Popup></Select.Positioner></Select.Portal>
                  </Select.Root>
                  <span className="join-arrow">→</span>
                  <Select.Root value={to} onValueChange={(v) => onUpdateJoin(id, 'to', v)} items={toChoices}>
                    <Select.Trigger className="bu-trigger"><Select.Value /><Select.Icon className="bu-icon">▾</Select.Icon></Select.Trigger>
                    <Select.Portal><Select.Positioner><Select.Popup className="bu-popup"><Select.List>{toChoices.map((c) => (<Select.Item key={c} value={c} className="bu-item"><Select.ItemText>{c}</Select.ItemText></Select.Item>))}</Select.List></Select.Popup></Select.Positioner></Select.Portal>
                  </Select.Root>
                </div>
              </section>
              <section className="sp-section">
                <p className="sp-lbl">Description</p>
                <textarea className="fi-ta" value={desc} onChange={(e) => onUpdateJoin(id, 'desc', e.target.value)} />
              </section>
            </div>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
const edgeTypes = { join: JoinEdge };

// ── Auto-layout hook (Dagre) ────────────────────────────────────────────────
function useAutoLayout(canvasEntities, joins, setEntityPositions) {
  return useCallback(() => {
    const g = new Dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', ranksep: 80, nodesep: 40 });
    g.setDefaultEdgeLabel(() => ({}));
    canvasEntities.forEach((e) => {
      const height = ENTITY_HEADER_HEIGHT + e.fields.length * ENTITY_ROW_HEIGHT + ENTITY_FOOTER_HEIGHT;
      g.setNode(e.id, { width: ENTITY_CARD_WIDTH, height });
    });
    Object.values(joins).forEach((j) => {
      if (g.hasNode(j.fromEntity) && g.hasNode(j.toEntity)) {
        g.setEdge(j.fromEntity, j.toEntity);
      }
    });
    Dagre.layout(g);
    setEntityPositions(() => {
      const next = {};
      canvasEntities.forEach((e) => {
        const node = g.node(e.id);
        if (node) next[e.id] = { x: node.x - ENTITY_CARD_WIDTH / 2, y: node.y };
      });
      return next;
    });
  }, [canvasEntities, joins, setEntityPositions]);
}

// ── Inner editor (needs useReactFlow, must be inside ReactFlowProvider) ─────
function EditorCanvas({
  canvasEntities, entityPositions, setEntityPositions,
  joins, setJoins, joinedEntityIds,
  hiddenFields, fieldDisplayNames, fieldDescriptions, fieldFormulas,
  setFieldDisplayNames, setFieldDescriptions, setFieldFormulas,
  activeField, activeJoin,
  selectField, selectJoin, toggleHidden, createDragJoin,
  closeInspectorPopup, hoveredJoinType, setHoveredJoinType,
  leftCollapsed, setLeftCollapsed, rightCollapsed, setRightCollapsed, rightMode,
}) {
  const { fitView } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const prevZoomRef = useRef(zoom);
  const autoLayoutBase = useAutoLayout(canvasEntities, joins, setEntityPositions);
  const autoLayout = useCallback(() => {
    autoLayoutBase();
    setTimeout(() => fitView({ padding: 0.18, duration: 300, maxZoom: 1 }), 60);
  }, [autoLayoutBase, fitView]);

  const prevEntityCountRef = useRef(canvasEntities.length);
  useEffect(() => {
    if (canvasEntities.length > prevEntityCountRef.current) {
      autoLayout();
    }
    prevEntityCountRef.current = canvasEntities.length;
  }, [canvasEntities.length, autoLayout]);

  // Close any open popup when the canvas zoom level changes
  useEffect(() => {
    if (prevZoomRef.current !== zoom) {
      prevZoomRef.current = zoom;
      if (activeField || activeJoin) closeInspectorPopup();
    }
  }, [zoom, activeField, activeJoin, closeInspectorPopup]);

  const updateJoin = useCallback((joinId, key, value) => {
    setJoins((prev) => ({ ...prev, [joinId]: { ...prev[joinId], [key]: value } }));
  }, [setJoins]);

  const rfNodes = useMemo(() =>
    canvasEntities.map((e) => ({
      id: e.id,
      type: 'entity',
      position: entityPositions[e.id] ?? { x: 100, y: 100 },
      dragHandle: '.ec-hd',
      data: {
        ...e,
        isJoined: joinedEntityIds.has(e.id),
        hiddenFields,
        fieldDisplayNames,
        activeField,
        onSelectField: selectField,
        toggleHidden,
      },
    })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [canvasEntities, entityPositions, joinedEntityIds, hiddenFields, fieldDisplayNames, activeField]);

  const rfEdges = useMemo(() =>
    Object.values(joins).map((j) => ({
      id: j.id,
      type: 'join',
      source: j.fromEntity,
      target: j.toEntity,
      data: {
        ...j,
        joinType: j.type,
        joinHighlight: JOIN_TYPES.find((t) => t.value === j.type)?.highlight,
        isActive: activeJoin === j.id,
        onSelect: () => selectJoin(j.id),
        onUpdateJoin: updateJoin,
        hoveredJoinType,
        setHoveredJoinType,
        onClose: () => selectJoin(null),
      },
    })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [joins, activeJoin, hoveredJoinType]);

  const onNodesChange = useCallback((changes) => {
    changes.forEach((c) => {
      if (c.type === 'position' && c.position && !c.dragging) {
        setEntityPositions((prev) => ({ ...prev, [c.id]: c.position }));
      }
    });
  }, [setEntityPositions]);

  const onConnect = useCallback((conn) => {
    createDragJoin(conn.source, conn.target);
  }, [createDragJoin]);

  const isValidConnection = useCallback((conn) => {
    if (conn.source === conn.target) return false;
    return !Object.values(joins).some(
      (j) =>
        (j.fromEntity === conn.source && j.toEntity === conn.target) ||
        (j.fromEntity === conn.target && j.toEntity === conn.source)
    );
  }, [joins]);

  // Positions are pre-computed via Dagre in the useState initializer, so we only need
  // to fitView once after RF has measured all nodes (handles bounding boxes ready).
  const nodesInitialized = useNodesInitialized();
  const didInitialFit = useRef(false);
  useEffect(() => {
    if (nodesInitialized && !didInitialFit.current) {
      didInitialFit.current = true;
      fitView({ padding: 0.15, duration: 350, maxZoom: 1 });
    }
  }, [nodesInitialized, fitView]);

  return (
    <div className="canvas-wrap">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onPaneClick={() => { selectJoin(null); selectField(null, null); }}
        defaultEdgeOptions={{ type: 'join' }}
        proOptions={{ hideAttribution: true }}
        elevateEdgesOnSelect
        maxZoom={1}
      >
        <Background variant="dots" gap={20} size={1} color="rgba(0,0,0,0.1)" />
      </ReactFlow>
      <FieldPopupLayer
        activeField={activeField}
        canvasEntities={canvasEntities}
        entityPositions={entityPositions}
        hiddenFields={hiddenFields}
        fieldDisplayNames={fieldDisplayNames}
        fieldDescriptions={fieldDescriptions}
        fieldFormulas={fieldFormulas}
        setFieldDisplayNames={setFieldDisplayNames}
        setFieldDescriptions={setFieldDescriptions}
        setFieldFormulas={setFieldFormulas}
        toggleHidden={toggleHidden}
        closeInspectorPopup={closeInspectorPopup}
      />
      <div className="canvas-float-layer" aria-hidden="true">
        {leftCollapsed ? (
          <button className="float-btn float-left" onClick={() => setLeftCollapsed(false)} aria-label="Expand sources panel" style={{ display: 'flex', alignItems: 'center' }}>
            <span>Sources</span>
            <PanelLeftOpen style={{ marginLeft: 8 }} size={18} />
          </button>
        ) : null}
        {rightCollapsed && rightMode === 'sql' ? (
          <button className="float-btn float-right" onClick={() => setRightCollapsed(false)} aria-label="Expand SQL panel" style={{ display: 'flex', alignItems: 'center' }}>
            <span>SQL</span>
            <PanelLeftOpen style={{ marginLeft: 8, transform: 'rotate(180deg)' }} size={18} />
          </button>
        ) : null}
        <button className="float-btn float-auto-arrange" onClick={autoLayout} title="Auto arrange">
          Auto arrange
        </button>
      </div>
    </div>
  );
}

function App() {
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
  const [fieldFormulas, setFieldFormulas] = useState({});
  const [hiddenFields, setHiddenFields] = useState(new Set());
  const [aiOpen, setAiOpen] = useState(false);
  const [inspectView, setInspectView] = useState('visual');
  const [hoveredJoinType, setHoveredJoinType] = useState(null);
  const [joins, setJoins] = useState({
    jp1: { id: 'jp1', type: 'LEFT', fromEntity: 'orders', toEntity: 'customers', from: 'orders.customer_id', to: 'customers.customer_id', semantics: 'Many-to-one · Optional relationship (Orders → Customer)', desc: 'Connects sales to customer profiles. Preservation: All orders are kept regardless of customer match.', fromChoices: ['orders.customer_id', 'orders.order_id', 'orders.product_id'], toChoices: ['customers.customer_id', 'customers.full_name'] },
    jp2: { id: 'jp2', type: 'INNER', fromEntity: 'orders', toEntity: 'products', from: 'orders.product_id', to: 'products.product_id', semantics: 'Many-to-one · Required relationship (Orders → Product)', desc: 'Connects sales to product catalog. Filter: Only orders with a valid product SKU are included.', fromChoices: ['orders.product_id', 'orders.order_id'], toChoices: ['products.product_id', 'products.product_name'] },
  });
  const [entityPositions, setEntityPositions] = useState(() => {
    // Pre-compute Dagre layout so the first render already has correct positions.
    // This avoids any timing race between state updates and fitView.
    const g = new Dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', ranksep: 80, nodesep: 40 });
    g.setDefaultEdgeLabel(() => ({}));
    INITIAL_ENTITIES.forEach((e) => {
      g.setNode(e.id, { width: ENTITY_CARD_WIDTH, height: ENTITY_HEADER_HEIGHT + e.fields.length * ENTITY_ROW_HEIGHT + ENTITY_FOOTER_HEIGHT });
    });
    // Include initial joins so Dagre knows the rank hierarchy
    [['orders', 'customers'], ['orders', 'products']].forEach(([from, to]) => {
      if (g.hasNode(from) && g.hasNode(to)) g.setEdge(from, to);
    });
    Dagre.layout(g);
    return Object.fromEntries(INITIAL_ENTITIES.map((e) => {
      const node = g.node(e.id);
      return [e.id, node ? { x: node.x - ENTITY_CARD_WIDTH / 2, y: node.y } : { x: e.x, y: e.y }];
    }));
  });

  // Lifted to state so new entities and models can be added
  const [canvasEntities, setCanvasEntities] = useState(INITIAL_ENTITIES);
  const [models, setModels] = useState(MODELS);

  // Catalog tab
  const [catalogTab, setCatalogTab] = useState('models'); // 'models' | 'sources'
  const [sourcesSearch, setSourcesSearch] = useState('');

  // Add data source modal state
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [addSourceContext, setAddSourceContext] = useState('editor'); // 'editor' | 'new-model'
  const [connectedSources, setConnectedSources] = useState(() => new Set(['sales-db', 'product-db']));
  const [newModelName, setNewModelName] = useState('');
  const [expandedSources, setExpandedSources] = useState(new Set());
  const [addModalSearch, setAddModalSearch] = useState('');
  const [activeTableId, setActiveTableId] = useState(null);

  // AI command bar
  const [aiBarOpen, setAiBarOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiBarValue, setAiBarValue] = useState('');
  const [aiBarThinking, setAiBarThinking] = useState(false);
  const [aiBarMessages, setAiBarMessages] = useState([]); // { role: 'user'|'ai', text, actionLabel? }
  const aiBarRef = useRef(null);
  const aiPanelRef = useRef(null);
  const aiModalInputRef = useRef(null);

  const AI_BAR_SCENARIOS = [
    { match: /return/i,         text: 'I can add the `returns` table from Sales DB. It has a natural join to `orders` on `order_id` — useful for tracking return rates alongside revenue.', actionLabel: 'Add table' },
    { match: /ship/i,           text: '`shipments` from Sales DB joins to `orders` on `order_id`. Adding it would let you measure delivery timelines and fulfilment lag.', actionLabel: 'Add table' },
    { match: /invoic/i,         text: '`invoices` from Sales DB links to `orders` on `order_id`. Good for reconciling billed vs collected revenue.', actionLabel: 'Add table' },
    { match: /segment|cohort/i, text: '`segment` from `customers` is already in the model. You could group `revenue_net` by segment to build a cohort breakdown.', actionLabel: 'Add measure' },
    { match: /join|link|connect/i, text: 'All three entities are joined: `orders → customers` on `customer_id` (LEFT) and `orders → products` on `product_id` (INNER). Want me to add a third source?', actionLabel: null },
    { match: /revenue|net|profit/i, text: '`revenue_net` is already a calculated field on `orders`: `amount − unit_cost`. It\'s included as a SUM measure. Should I add a margin % field?', actionLabel: 'Add calc field' },
    { match: /product/i,        text: '`products` from Product DB is already in the model joined on `product_id`. I can add `inventory` to track stock levels alongside sales.', actionLabel: 'Add table' },
  ];

  const getFakeAiResponse = (text) => {
    for (const s of AI_BAR_SCENARIOS) {
      if (s.match.test(text)) return s;
    }
    return { text: 'I can add a `categories` dimension from Product DB to group revenue by product line. It joins to `products` on `category`.', actionLabel: 'Add table' };
  };

  const handleAiBarSubmit = () => {
    if (!aiBarValue.trim() || aiBarThinking) return;
    const userText = aiBarValue.trim();
    setAiBarMessages((prev) => [...prev, { role: 'user', text: userText }]);
    setAiBarValue('');
    setAiBarThinking(true);
    setAiModalOpen(true); // always open/keep modal on submit
    [aiBarRef, aiModalInputRef].forEach((r) => { if (r.current) r.current.style.height = 'auto'; });
    const resp = getFakeAiResponse(userText);
    setTimeout(() => {
      setAiBarThinking(false);
      setAiBarMessages((prev) => [...prev, { role: 'ai', text: resp.text, actionLabel: resp.actionLabel }]);
      requestAnimationFrame(() => {
        if (aiPanelRef.current) aiPanelRef.current.scrollTop = aiPanelRef.current.scrollHeight;
      });
    }, 950);
  };

  const handleAiBarKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiBarSubmit(); }
    if (e.key === 'Escape') { resetAiBar(); }
  };

  const handleAiBarChange = (e) => {
    setAiBarValue(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
  };

  const resetAiBar = () => {
    setAiBarOpen(false);
    setAiModalOpen(false);
    setAiBarValue('');
    setAiBarThinking(false);
    setAiBarMessages([]);
    [aiBarRef, aiModalInputRef].forEach((r) => { if (r.current) { r.current.style.height = 'auto'; r.current.blur(); } });
  };

  // Derived lookup maps
  const entityById = useMemo(
    () => Object.fromEntries(canvasEntities.map((e) => [e.id, e])),
    [canvasEntities]
  );

  const canvasEntityIds = useMemo(
    () => new Set(canvasEntities.map((e) => e.id)),
    [canvasEntities]
  );

  const isOnCanvas = (tableId) => canvasEntityIds.has(tableId);

  const groupedSources = useMemo(() => {
    const allConnectors = CONNECTOR_CATEGORIES.flatMap((c) => c.items);
    return [...connectedSources].map((sourceId) => {
      const connector = allConnectors.find((item) => item.id === sourceId);
      const data = DATASOURCE_TABLES[sourceId] || { tables: [], views: [] };
      return { id: sourceId, name: connector?.name || sourceId, dbType: connector?.dbType || '', tables: data.tables, views: data.views };
    });
  }, [connectedSources]);

  // Canvas entities grouped by source — drives the left panel
  const canvasGroups = useMemo(() => {
    const groups = {};
    canvasEntities.forEach((entity) => {
      const src = entity.dbName || 'Unknown';
      if (!groups[src]) groups[src] = [];
      groups[src].push(entity.id);
    });
    return Object.entries(groups).map(([name, tables]) => ({ name, tables }));
  }, [canvasEntities]);

  const toggleSourceExpand = (sourceId) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  };


  const joinedEntityIds = useMemo(() => {
    const ids = new Set();
    Object.values(joins).forEach((join) => {
      ids.add(join.fromEntity);
      ids.add(join.toEntity);
    });
    return ids;
  }, [joins]);

  const badgeClass = stage === 'production' ? 'badge-prod' : stage === 'dev' ? 'badge-dev' : 'badge-draft';

  const visibleFields = useMemo(() => {
    return canvasEntities.flatMap((entity) =>
      entity.fields
        .filter((field) => !hiddenFields.has(field.key))
        .map((field) => ({ key: field.key, entity: entity.id, label: fieldDisplayNames[field.key] || field.label }))
    );
  }, [canvasEntities, fieldDisplayNames, hiddenFields]);

  const currentSql = useMemo(() => {
    const columns = visibleFields
      .map((field) => {
        if (field.key === 'revenue_net') return '  (o.amount - p.unit_cost) AS revenue_net';
        const prefix = field.entity === 'orders' ? 'o' : field.entity === 'customers' ? 'c' : 'p';
        return fieldDisplayNames[field.key] ? `  ${prefix}.${field.key} AS "${fieldDisplayNames[field.key]}"` : `  ${prefix}.${field.key}`;
      })
      .join(',\n');
    return ['-- Auto-generated', 'SELECT', columns, 'FROM orders o', `${JOIN_MAP[joins.jp1.type]} customers c`, '  ON o.customer_id = c.customer_id', `${JOIN_MAP[joins.jp2.type]} products p`, '  ON o.product_id = p.product_id'].join('\n');
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
    canvasEntities.forEach((entity) => {
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
  }, [stage, visibleFields, canvasEntities, hiddenFields, fieldDisplayNames, fieldDescriptions, joins]);

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return models;
    return {
      draft: models.draft.filter((item) => item.name.toLowerCase().includes(q)),
      dev: models.dev.filter((item) => item.name.toLowerCase().includes(q)),
      production: models.production.filter((item) => item.name.toLowerCase().includes(q)),
    };
  }, [search, models]);

  const selectField = (entityId, field) => {
    if (!entityId || !field) { setActiveField(null); return; }
    setActiveField({ entityId, fieldKey: field.key, source: `${entityId}.${field.key}`, type: field.type });
    setActiveJoin(null);
    setRightCollapsed(false);
  };

  const selectJoin = (joinId) => {
    setActiveJoin(joinId);
    setActiveField(null);
    if (joinId) setRightCollapsed(false);
  };

  const toggleHidden = (fieldKey) => {
    setHiddenFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldKey)) next.delete(fieldKey);
      else next.add(fieldKey);
      return next;
    });
  };

  const closeInspectorPopup = () => { setActiveField(null); setActiveJoin(null); };

  // ── Filter modal sources by search ──────────────────────────────────────
  const filteredGroupedSources = useMemo(() => {
    if (!addModalSearch.trim()) return groupedSources;
    const q = addModalSearch.toLowerCase();
    return groupedSources
      .map((src) => ({
        ...src,
        tables: src.tables.filter((t) => t.toLowerCase().includes(q)),
        views: src.views.filter((v) => v.toLowerCase().includes(q)),
      }))
      .filter((src) => src.tables.length > 0 || src.views.length > 0 || src.name.toLowerCase().includes(q));
  }, [groupedSources, addModalSearch]);

  // ── Table → source lookup (for multi-source selections) ──────────────────
  const tableToSource = useMemo(() => {
    const map = {};
    Object.entries(DATASOURCE_TABLES).forEach(([sourceId, { tables, views }]) => {
      const connector = CONNECTOR_CATEGORIES.flatMap((c) => c.items).find((i) => i.id === sourceId);
      const sourceName = connector?.name || sourceId;
      [...tables, ...views].forEach((tableId) => { map[tableId] = { sourceId, sourceName }; });
    });
    return map;
  }, []);

  // ── Add data source helpers ──────────────────────────────────────────────

  const resetAddSourceState = () => {
    setAddSourceContext('editor');
    setNewModelName('');
    setExpandedSources(new Set());
    setAddModalSearch('');
  };

  const openAddSource = (context = 'editor') => {
    setAddSourceContext(context);
    setAddModalSearch('');
    setExpandedSources(new Set());
    setAddSourceOpen(true);
  };

  const handleConnectSource = (sourceId) => {
    setConnectedSources((prev) => new Set([...prev, sourceId]));
  };

  // Direct-toggle: checking a table immediately adds/removes it from the canvas
  const handleToggleTableOnCanvas = (tableId) => {
    if (canvasEntityIds.has(tableId)) {
      setCanvasEntities((prev) => prev.filter((e) => e.id !== tableId));
      setEntityPositions((prev) => { const next = { ...prev }; delete next[tableId]; return next; });
      setJoins((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((jid) => {
          if (next[jid].fromEntity === tableId || next[jid].toEntity === tableId) delete next[jid];
        });
        return next;
      });
    } else {
      const src = tableToSource[tableId];
      const dbName = src?.sourceName || tableId;
      const fields = TABLE_FIELDS[tableId] || [
        { key: `${tableId}_id`, label: `${tableId}_id`, type: '#', isKey: true, role: 'ID' },
        { key: `${tableId}_name`, label: `${tableId}_name`, type: 'Aa', role: 'DIMENSION' },
        { key: `${tableId}_created_at`, label: `${tableId}_created_at`, type: 'dt', role: 'DIMENSION' },
      ];
      const newEntity = {
        id: tableId, label: tableId, dbName, source: dbName,
        definition: `Records from the ${tableId} table`,
        fields,
      };
      let baseX = 600, baseY = 120;
      if (canvasEntities.length > 0) {
        const rightmost = canvasEntities.reduce((max, e) => {
          const pos = entityPositions[e.id] || { x: 0 };
          return pos.x > (entityPositions[max?.id]?.x ?? 0) ? e : max;
        }, canvasEntities[0]);
        const refPos = entityPositions[rightmost.id] || { x: 80, y: 120 };
        baseX = refPos.x + ENTITY_CARD_WIDTH + 30;
        baseY = refPos.y;
      }
      setCanvasEntities((prev) => [...prev, newEntity]);
      setEntityPositions((prev) => ({ ...prev, [tableId]: { x: baseX, y: baseY } }));
    }
  };

  const createDragJoin = (fromEntityId, toEntityId) => {
    const fromEnt = entityById[fromEntityId];
    const toEnt = entityById[toEntityId];
    if (!fromEnt || !toEnt) return;
    // Try to infer key mapping
    const toPK = toEnt.fields.find((f) => f.isKey)?.key;
    const fromPK = fromEnt.fields.find((f) => f.isKey)?.key;
    let fromField, toField;
    if (toPK && fromEnt.fields.some((f) => f.key === toPK)) {
      fromField = `${fromEntityId}.${toPK}`;
      toField = `${toEntityId}.${toPK}`;
    } else if (fromPK && toEnt.fields.some((f) => f.key === fromPK)) {
      fromField = `${fromEntityId}.${fromPK}`;
      toField = `${toEntityId}.${fromPK}`;
    } else {
      fromField = `${fromEntityId}.${fromPK || fromEnt.fields[0]?.key}`;
      toField = `${toEntityId}.${toPK || toEnt.fields[0]?.key}`;
    }
    const jid = `jp_drag_${fromEntityId}_${toEntityId}`;
    setJoins((prev) => ({
      ...prev,
      [jid]: {
        id: jid, type: 'LEFT',
        fromEntity: fromEntityId, toEntity: toEntityId,
        from: fromField, to: toField,
        semantics: `Relationship · ${fromEntityId} → ${toEntityId}`,
        desc: '',
        fromChoices: fromEnt.fields.map((f) => `${fromEntityId}.${f.key}`),
        toChoices: toEnt.fields.map((f) => `${toEntityId}.${f.key}`),
      },
    }));
    setActiveJoin(jid);
  };

  const handleRemoveFromCanvas = (tableId) => {
    setCanvasEntities((prev) => prev.filter((e) => e.id !== tableId));
    setEntityPositions((prev) => {
      const next = { ...prev };
      delete next[tableId];
      return next;
    });
    if (activeTableId === tableId) setActiveTableId(null);
  };

  const handleCreateNewModel = () => {
    if (!newModelName.trim()) return;
    const id = newModelName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const newModel = {
      id, name: newModelName.trim(),
      desc: `Model with ${canvasEntities.length} table${canvasEntities.length !== 1 ? 's' : ''}`,
      entities: canvasEntities.length, joins: 0, uses: 0, stage: 'draft', progress: 0,
    };
    setModels((prev) => ({ ...prev, draft: [...prev.draft, newModel] }));
    setView('editor');
    setStage('draft');
    setAddSourceOpen(false);
    resetAddSourceState();
  };

  const handleNewModelClick = () => openAddSource('new-model');

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="app">
      <nav className="nav">
        {/* ── Left ── */}
        <div className="nav-left">
          {view === 'catalog' ? (
            <div className="nav-brand">
              <span className="nav-brand-dot" />
              Reveal
            </div>
          ) : (
            <>
              <button className="plain-btn nav-back" title="Back to models" onClick={() => setView('catalog')}>←</button>
              <Menu.Root>
                <Menu.Trigger className="plain-btn nav-model-btn">Sales overview ▾</Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner sideOffset={6}>
                    <Menu.Popup className="menu-popup">
                      <Menu.Item className="menu-item">Rename model</Menu.Item>
                      <Menu.Item className="menu-item">Edit description</Menu.Item>
                      <Menu.Item className="menu-item">Duplicate</Menu.Item>
                      <Menu.Separator className="menu-sep" />
                      <Menu.Item className="menu-item" onClick={() => setStage('production')}>Promote to production</Menu.Item>
                      <Menu.Item className="menu-item" onClick={() => setStage('draft')}>Move to draft</Menu.Item>
                      <Menu.Separator className="menu-sep" />
                      <Menu.Item className="menu-item danger">Delete model</Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
              <span className={`badge ${badgeClass}`}>{stage}</span>
            </>
          )}
        </div>

        {/* ── Center AI bar ── */}
        {view !== 'catalog' && (
          <div className={`nav-ai-wrap${aiModalOpen ? ' modal-open' : ''}`}>
            {aiModalOpen ? (
              /* Session-active pill — click to reopen modal */
              <button className="nav-ai-active-pill" onClick={() => setAiModalOpen(true)}>
                <span className="nav-ai-sparkle">✦</span>
                <span className="nav-ai-active-label">AI chat · {aiBarMessages.length} message{aiBarMessages.length !== 1 ? 's' : ''}</span>
                <button className="plain-btn nav-ai-close-btn" onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); resetAiBar(); }} title="End session">✕</button>
              </button>
            ) : (
              <div className={`nav-ai-bar${aiBarOpen ? ' focused' : ''}`} onClick={() => { setAiBarOpen(true); aiBarRef.current?.focus(); }}>
                <span className="nav-ai-sparkle">✦</span>
                <textarea
                  ref={aiBarRef}
                  className="nav-ai-input"
                  placeholder="Ask AI to build or modify your model…"
                  value={aiBarValue}
                  rows={1}
                  onChange={handleAiBarChange}
                  onFocus={() => setAiBarOpen(true)}
                  onKeyDown={handleAiBarKey}
                  disabled={aiBarThinking}
                />
                {aiBarValue && !aiBarThinking && (
                  <button className="plain-btn nav-ai-send" onMouseDown={(e) => { e.preventDefault(); handleAiBarSubmit(); }} title="Send">↑</button>
                )}
                {aiBarOpen && !aiBarValue && (
                  <button className="plain-btn nav-ai-close-btn" onMouseDown={(e) => { e.preventDefault(); resetAiBar(); }} title="Close">✕</button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Right ── */}
        {view === 'editor' && (
          <div className="nav-right">
            <button className="btn" onClick={() => setView('inspect')}>Inspect view</button>
            <button className="btn btn-primary" onClick={() => setAiOpen(true)}>Save model</button>
          </div>
        )}
        {view === 'inspect' && (
          <div className="nav-right">
            <span className="badge badge-dev">🔒 Read-only · viewer access</span>
            <button className="btn" onClick={() => setView('editor')}>← Back to editor</button>
          </div>
        )}
      </nav>

      {view === 'catalog' ? (
        <section className="view active">
          <div className="cat-bar">
            <div className="cat-bar-inner">
              <nav className="cat-tabs">
                <button className={`cat-tab ${catalogTab === 'models' ? 'active' : ''}`} onClick={() => setCatalogTab('models')}>Models</button>
                <button className={`cat-tab ${catalogTab === 'sources' ? 'active' : ''}`} onClick={() => setCatalogTab('sources')}>Data Sources</button>
              </nav>
              {catalogTab === 'models' && (
                <div className="cat-bar-right">
                  <input className="search-input" placeholder="Search models…" value={search} onChange={(e) => setSearch(e.target.value)} />
                  <button className="btn btn-primary" onClick={handleNewModelClick}>+ New model</button>
                </div>
              )}
              {catalogTab === 'sources' && (
                <div className="cat-bar-right">
                  <input className="search-input" placeholder="Search data sources…" value={sourcesSearch} onChange={(e) => setSourcesSearch(e.target.value)} />
                </div>
              )}
            </div>
          </div>

          {catalogTab === 'models' && (
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
                  {list.map((model) => {
                    const usageScore = usageScoreFromCount(model.uses);
                    return (
                      <button key={model.id} className="plain-btn mcard" onClick={() => { setView('editor'); setStage(model.stage); }}>
                        <div className="mcard-name">{model.name}</div>
                        <div className="mcard-desc">{model.desc}</div>
                        <div className="mcard-foot">
                          <span className="badge badge-neutral">{model.entities} entities</span>
                          <span className="badge badge-neutral">{model.joins} joins</span>
                          <span className={`badge ${model.stage === 'production' ? 'badge-prod' : model.stage === 'dev' ? 'badge-dev' : 'badge-draft'}`}>{model.stage}</span>
                          <span className="mcard-usage" aria-label={`Usage score ${usageScore} out of 5 from ${model.uses} uses`}>
                            <span className="mcard-usage-dots" aria-hidden="true">
                              {Array.from({ length: 5 }, (_, i) => (
                                <span key={`${model.id}-usage-${i}`} className={`mcard-usage-dot ${i < usageScore ? 'is-filled' : ''}`} />
                              ))}
                            </span>
                            <span className="mcard-uses">{model.uses} uses</span>
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {catalogTab === 'sources' && (() => {
            const q = sourcesSearch.toLowerCase().trim();
            const filteredConnected = groupedSources.filter((s) => !q || s.name.toLowerCase().includes(q));
            const filteredAvailable = CONNECTOR_CATEGORIES.map((cat) => ({
              ...cat,
              items: cat.items.filter((item) => !connectedSources.has(item.id) && (!q || item.name.toLowerCase().includes(q))),
            })).filter((cat) => cat.items.length > 0);
            return (
              <div className="sources-page">
                <div className="sources-content">
                  {/* Connected grid */}
                  {filteredConnected.length > 0 && (
                    <div className="sources-grid">
                      {filteredConnected.map((source) => {
                        const cat = ITEM_CATEGORY_MAP[source.id];
                        const bg = CAT_COLORS[cat] || '#f0f0f0';
                        return (
                          <div key={source.id} className="source-tile source-tile--connected">
                            <div className="source-tile-icon" style={{ background: bg }}>
                              {CONNECTOR_ICONS[source.id]
                                ? <img src={`https://cdn.simpleicons.org/${CONNECTOR_ICONS[source.id]}`} alt="" className="source-row-img" />
                                : <span>{connectorAbbr(source.name)}</span>}
                            </div>
                            <div className="source-tile-body">
                              <div className="source-row-name">{source.name}</div>
                              <div className="source-row-meta">{CATEGORY_LABELS[cat] || cat} · {source.tables.length} tables{source.views.length ? ` · ${source.views.length} views` : ''}</div>
                            </div>
                            <span className="source-row-status">✓ Connected</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Separator */}
                  {filteredConnected.length > 0 && filteredAvailable.length > 0 && (
                    <hr className="sources-sep" />
                  )}

                  {/* Available grid grouped by category */}
                  {filteredAvailable.map((cat) => (
                    <div key={cat.category} className="sources-cat-block">
                      <div className="sources-cat-label">{CATEGORY_LABELS[cat.category] || cat.category}</div>
                      <div className="sources-grid">
                        {cat.items.map((item) => {
                          const bg = CAT_COLORS[cat.category] || '#f0f0f0';
                          return (
                            <div key={item.id} className="source-tile">
                              <div className="source-tile-icon" style={{ background: bg }}>
                                {CONNECTOR_ICONS[item.id]
                                  ? <img src={`https://cdn.simpleicons.org/${CONNECTOR_ICONS[item.id]}`} alt="" className="source-row-img" />
                                  : <span>{connectorAbbr(item.name)}</span>}
                              </div>
                              <div className="source-tile-body">
                                <div className="source-row-name">{item.name}</div>
                                <div className="source-row-meta">{CATEGORY_LABELS[cat.category] || cat.category}</div>
                              </div>
                              <button className="btn source-row-connect-btn" onClick={() => handleConnectSource(item.id)}>
                                Connect
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {filteredConnected.length === 0 && filteredAvailable.length === 0 && (
                    <p className="sources-empty">No data sources match "{sourcesSearch}"</p>
                  )}
                </div>
              </div>
            );
          })()}
        </section>
      ) : null}

      {view === 'editor' ? (
        <section className="view active">
          <div className="ed-body">
            <aside className={`side-panel left ${leftCollapsed ? 'collapsed' : ''}`}>
              <header className="panel-hd">
                <span className="panel-hd-title">Data</span>
                <div className="panel-hd-actions">
                  <button className="plain-btn add-source-btn" onClick={() => openAddSource()}>+ add</button>
                  <button className="plain-btn panel-collapse-btn" onClick={() => setLeftCollapsed(true)} aria-label="Collapse panel">
                    <PanelLeftOpen style={{ transform: 'rotate(180deg)' }} size={18} />
                  </button>
                </div>
              </header>
              <div className="sb-scroll">
                {canvasGroups.map((group) => (
                  <div key={group.name}>
                    <div className="src-group-hd">
                      <span>▾ {group.name}</span>
                    </div>
                    {group.tables.map((tableId) => (
                      <div
                        key={tableId}
                        className={`tbl-row ${activeTableId === tableId ? 'active' : ''}`}
                        onClick={() => setActiveTableId((prev) => (prev === tableId ? null : tableId))}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter') setActiveTableId((prev) => (prev === tableId ? null : tableId)); }}
                      >
                        <span className="tbl-row-name">{tableId}</span>
                        <button
                          className="plain-btn tbl-row-remove"
                          onClick={(e) => { e.stopPropagation(); handleRemoveFromCanvas(tableId); }}
                          aria-label={`Remove ${tableId}`}
                          title={`Remove ${tableId}`}
                        >×</button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </aside>

            <ReactFlowProvider>
              <EditorCanvas
                canvasEntities={canvasEntities}
                entityPositions={entityPositions}
                setEntityPositions={setEntityPositions}
                joins={joins}
                setJoins={setJoins}
                joinedEntityIds={joinedEntityIds}
                hiddenFields={hiddenFields}
                fieldDisplayNames={fieldDisplayNames}
                fieldDescriptions={fieldDescriptions}
                fieldFormulas={fieldFormulas}
                setFieldDisplayNames={setFieldDisplayNames}
                setFieldDescriptions={setFieldDescriptions}
                setFieldFormulas={setFieldFormulas}
                activeField={activeField}
                activeJoin={activeJoin}
                selectField={selectField}
                selectJoin={selectJoin}
                toggleHidden={toggleHidden}
                createDragJoin={createDragJoin}
                closeInspectorPopup={closeInspectorPopup}
                hoveredJoinType={hoveredJoinType}
                setHoveredJoinType={setHoveredJoinType}
                leftCollapsed={leftCollapsed}
                setLeftCollapsed={setLeftCollapsed}
                rightCollapsed={rightCollapsed}
                setRightCollapsed={setRightCollapsed}
                rightMode={rightMode}
              />
            </ReactFlowProvider>

            <aside className={`side-panel right ${rightCollapsed ? 'collapsed' : ''}`}>
              <Tabs.Root value={rightMode} onValueChange={setRightMode} className="mode-wrap">
                <header className="panel-hd tight">
                  <Tabs.List className="sql-tabs">
                    <Tabs.Tab className="sql-tab" value="sql">SQL</Tabs.Tab>
                    <Tabs.Tab className="sql-tab" value="ai">AI context</Tabs.Tab>
                  </Tabs.List>
                  <button className="plain-btn panel-collapse-btn" onClick={() => setRightCollapsed(true)} aria-label="Collapse SQL panel">
                    <PanelLeftOpen size={18} />
                  </button>
                </header>
                <Tabs.Panel value="sql" className="sql-content tab-panel">
                  <SqlHighlight sql={currentSql} />
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
                    <pre className="ai-pre">{`{\n  "orders": { "entity_type": "fact", "is_primary": true },\n  "customers": { "entity_type": "dimension", "join": "many-to-one", "is_optional": true },\n  "products": { "entity_type": "dimension", "join": "many-to-one", "is_optional": false }\n}`}</pre>
                  </section>
                  <section className="ai-section">
                    <h5>Aggregations</h5>
                    <pre className="ai-pre">{`{\n  "revenue_net": { "role": "measure", "calculation": "SUM", "description": "Net revenue after discounts" },\n  "unit_cost": { "role": "measure", "calculation": "AVG" }\n}`}</pre>
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
                  <tr>{visibleFields.map((field) => (<th key={`${field.entity}-${field.key}`} className={activeField?.fieldKey === field.key ? 'active-col' : ''}>{field.label}</th>))}</tr>
                </thead>
                <tbody>
                  {PREVIEW_ROWS.map((row) => (
                    <tr key={row.order_id}>
                      {visibleFields.map((field) => (
                        <td key={`${row.order_id}-${field.entity}-${field.key}`} className={activeField?.fieldKey === field.key ? 'active-col' : ''}>
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
                  <h2>Sales overview <span className={`badge ${badgeClass}`}>{stage}</span></h2>
                  <div className="insp-view-toggle">
                    <button className={`insp-toggle-btn ${inspectView === 'visual' ? 'active' : ''}`} onClick={() => setInspectView('visual')}>Visual</button>
                    <button className={`insp-toggle-btn ${inspectView === 'markdown' ? 'active' : ''}`} onClick={() => setInspectView('markdown')}>Markdown</button>
                  </div>
                </div>
                <p>Orders joined with customers and products from two separate databases. Use to analyze revenue by customer segment, region, and product category.</p>
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
                <div className="insp-md-wrap"><pre className="insp-md-pre">{inspectMarkdown}</pre></div>
              ) : null}

              {inspectView === 'visual' ? <h3 className="insp-section-hd">Entities & fields</h3> : null}
              {inspectView === 'visual' ? (
                <div className="insp-masonry">
                  {canvasEntities.map((entity) => {
                    const visibleEntityFields = entity.fields.filter((f) => !hiddenFields.has(f.key));
                    const dimensionFields = visibleEntityFields.filter((f) => f.role !== 'MEASURE');
                    const measureFields = visibleEntityFields.filter((f) => f.role === 'MEASURE');
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
                                    <span className="ifield-name">{fieldDisplayNames[field.key] || field.label}{fieldDisplayNames[field.key] ? <span className="ifield-orig">({field.label})</span> : null}</span>
                                    {field.isKey && <span className="ifield-badge ifield-badge-key">key</span>}
                                  </div>
                                  {(fieldDescriptions[field.key] || field.semanticDesc) ? <p className="ifield-desc">{fieldDescriptions[field.key] || field.semanticDesc}</p> : null}
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
                                    <span className="ifield-name">{fieldDisplayNames[field.key] || field.label}{fieldDisplayNames[field.key] ? <span className="ifield-orig">({field.label})</span> : null}</span>
                                    {field.calc && <span className="ifield-badge ifield-badge-calc">computed</span>}
                                    {field.agg && <span className="ifield-badge ifield-badge-agg">{field.agg}</span>}
                                  </div>
                                  {(fieldDescriptions[field.key] || field.semanticDesc) ? <p className="ifield-desc">{fieldDescriptions[field.key] || field.semanticDesc}</p> : null}
                                </div>
                              </div>
                            ))}
                          </section>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : null}

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
                  <div className="join-row"><p className="join-desc">{join.desc}</p></div>
                  <div className="join-row">
                    <p className="join-keys">Logic: Match on <span className="mono">{join.from.split('.')[1]}</span> = <span className="mono">{join.to.split('.')[1]}</span></p>
                  </div>
                </article>
              )) : null}
            </main>

            <aside className="insp-sidebar">
              <h3 className="insp-meta-hd">Model details</h3>
              <div className="meta-row"><span>Status</span><span><span className={`badge ${badgeClass}`}>{stage}</span></span></div>
              <div className="meta-row"><span>Created</span><span>Mar 14, 2025</span></div>
              <div className="meta-row"><span>Last edited</span><span>Apr 18, 2026</span></div>
              <div className="meta-row"><span>Author</span><span>George A.</span></div>
            </aside>
          </div>
        </section>
      ) : null}

      {/* AI chat modal */}
      <Dialog.Root open={aiModalOpen} onOpenChange={(open) => { if (!open) { setAiModalOpen(false); setAiBarOpen(false); } }}>
        <Dialog.Portal>
          <Dialog.Backdrop className="ai-chat-backdrop" />
          <Dialog.Viewport className="ai-chat-viewport">
            <Dialog.Popup className="ai-chat-modal">
              {/* Header */}
              <div className="ai-chat-hd">
                <span className="ai-chat-sparkle">✦</span>
                <Dialog.Title className="ai-chat-title">AI Model Assistant</Dialog.Title>
                <Dialog.Close className="plain-btn ai-chat-close">✕</Dialog.Close>
              </div>
              {/* Messages */}
              <div className="ai-chat-messages" ref={aiPanelRef}>
                {aiBarMessages.map((msg, i) =>
                  msg.role === 'user' ? (
                    <div key={i} className="ai-chat-row ai-chat-row-user">
                      <span className="ai-chat-bubble">{msg.text}</span>
                    </div>
                  ) : (
                    <div key={i} className="ai-chat-row ai-chat-row-ai">
                      <span className="ai-chat-ai-sparkle">✦</span>
                      <div className="ai-chat-ai-body">
                        <p className="ai-chat-ai-text">{msg.text}</p>
                        {msg.actionLabel && (
                          <button className="btn btn-ai ai-chat-apply-btn" onClick={() => setAiModalOpen(false)}>
                            {msg.actionLabel}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                )}
                {aiBarThinking && (
                  <div className="ai-chat-row ai-chat-row-ai">
                    <span className="ai-chat-ai-sparkle">✦</span>
                    <span className="nav-ai-thinking"><span /><span /><span /></span>
                  </div>
                )}
              </div>
              {/* Input */}
              <div className="ai-chat-input-row">
                <textarea
                  ref={aiModalInputRef}
                  className="ai-chat-input"
                  placeholder="Ask a follow-up…"
                  value={aiBarValue}
                  rows={1}
                  onChange={handleAiBarChange}
                  onKeyDown={handleAiBarKey}
                  disabled={aiBarThinking}
                  autoFocus
                />
                {aiBarValue && !aiBarThinking && (
                  <button className="plain-btn nav-ai-send" onMouseDown={(e) => { e.preventDefault(); handleAiBarSubmit(); }} title="Send">↑</button>
                )}
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>

      {/* AI suggest dialog */}
      <Dialog.Root open={aiOpen} onOpenChange={setAiOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="dialog-backdrop" />
          <Dialog.Viewport className="dialog-viewport">
            <Dialog.Popup className="dialog-popup">
              <Dialog.Title className="modal-title">✦ AI-suggested model description</Dialog.Title>
              <Dialog.Description className="modal-desc">Review the generated description before saving this model.</Dialog.Description>
              <div className="modal-body">
                <label className="modal-label" htmlFor="model-name">Model name</label>
                <input id="model-name" defaultValue="Sales overview" />
                <label className="modal-label" htmlFor="model-description">Description</label>
                <textarea id="model-description" defaultValue="Orders joined with customers (left outer) and products (inner) from two separate databases. Use to analyze revenue by customer segment, region, and product category. All orders are included even when customer data is missing." />
              </div>
              <div className="modal-actions">
                <Dialog.Close className="btn">Cancel</Dialog.Close>
                <Dialog.Close className="btn btn-primary">Save model</Dialog.Close>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Add data source modal */}
      <Dialog.Root
        open={addSourceOpen}
        onOpenChange={(open) => {
          setAddSourceOpen(open);
          if (!open) resetAddSourceState();
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="dialog-backdrop" />
          <Dialog.Viewport className="dialog-viewport">
            <Dialog.Popup className="dialog-popup ds-modal">
              <div className="ds-modal-head">
                <div className="ds-modal-head-top">
                  <Dialog.Title className="modal-title ds-modal-title">
                    {addSourceContext === 'new-model' ? 'New model — choose tables' : 'Add tables to model'}
                  </Dialog.Title>
                  <Dialog.Close className="plain-btn ds-close">×</Dialog.Close>
                </div>
                {addSourceContext === 'new-model' && (
                  <div className="ds-model-name-wrap">
                    <input
                      className="fi-inp ds-model-name-inp"
                      value={newModelName}
                      onChange={(e) => setNewModelName(e.target.value)}
                      placeholder="Model name…"
                      autoFocus
                    />
                  </div>
                )}
                <div className="ds-modal-search-wrap">
                  <input
                    className="ds-search-input"
                    placeholder="Search tables and views…"
                    value={addModalSearch}
                    onChange={(e) => setAddModalSearch(e.target.value)}
                  />
                </div>
              </div>

              <div className="ds-modal-body">
                {filteredGroupedSources.length === 0 ? (
                  <p className="ds-empty">No tables match "{addModalSearch}"</p>
                ) : (
                  <div className="ds-accordion">
                    {filteredGroupedSources.map((source) => {
                      const cat = ITEM_CATEGORY_MAP[source.id];
                      const bg = CAT_COLORS[cat] || '#f0f0f0';
                      const isOpen = expandedSources.has(source.id);
                      const onCanvasCount = [...source.tables, ...source.views].filter((t) => isOnCanvas(t)).length;
                      return (
                        <div key={source.id} className={`ds-acc-item ${isOpen ? 'open' : ''}`}>
                          <button className="ds-acc-hd" onClick={() => toggleSourceExpand(source.id)}>
                            <div className="ds-acc-icon" style={{ background: bg }}>
                              {CONNECTOR_ICONS[source.id]
                                ? <img src={`https://cdn.simpleicons.org/${CONNECTOR_ICONS[source.id]}`} alt="" className="ds-acc-brand-img" />
                                : <span className="ds-acc-abbr">{connectorAbbr(source.name)}</span>}
                            </div>
                            <span className="ds-acc-name">{source.name}</span>
                            {onCanvasCount > 0 && <span className="ds-acc-sel-badge">{onCanvasCount} added</span>}
                            <span className="ds-acc-meta">
                              {source.tables.length} table{source.tables.length !== 1 ? 's' : ''}
                              {source.views.length ? ` · ${source.views.length} view${source.views.length !== 1 ? 's' : ''}` : ''}
                            </span>
                            <ChevronDown size={14} className={`ds-acc-chevron ${isOpen ? 'open' : ''}`} />
                          </button>
                          {isOpen && (
                            <div className="ds-acc-body">
                              {source.tables.length > 0 && (
                                <div className="ds-table-list">
                                  {source.tables.map((tableId) => (
                                    <label key={tableId} className="ds-table-row">
                                      <input
                                        type="checkbox"
                                        checked={isOnCanvas(tableId)}
                                        onChange={() => handleToggleTableOnCanvas(tableId)}
                                      />
                                      <span className="ds-table-name">{tableId}</span>
                                    </label>
                                  ))}
                                </div>
                              )}
                              {source.views.length > 0 && (
                                <>
                                  <div className="ds-acc-views-hd">Views</div>
                                  <div className="ds-table-list">
                                    {source.views.map((viewId) => (
                                      <label key={viewId} className="ds-table-row">
                                        <input
                                          type="checkbox"
                                          checked={isOnCanvas(viewId)}
                                          onChange={() => handleToggleTableOnCanvas(viewId)}
                                        />
                                        <span className="ds-table-name">{viewId}</span>
                                      </label>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="ds-modal-foot">
                {addSourceContext === 'new-model' ? (
                  <>
                    <Dialog.Close className="btn">Cancel</Dialog.Close>
                    <button
                      className="btn btn-primary"
                      disabled={!newModelName.trim()}
                      onClick={handleCreateNewModel}
                    >
                      Create model
                    </button>
                  </>
                ) : (
                  <Dialog.Close className="btn btn-primary">Done</Dialog.Close>
                )}
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

export default App;
