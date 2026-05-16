import { Dialog } from './components/ui/dialog';
import { ChevronDown, PanelLeftOpen } from 'lucide-react';
import { Menu } from './components/ui/menu';
import PillList from './components/PillList';
import { Select } from './components/ui/select';
import { Switch } from './components/ui/switch';
import { Tabs } from './components/ui/tabs';
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {
  ReactFlow, Background, Handle, Position,
  getBezierPath, EdgeLabelRenderer,
  useReactFlow, ReactFlowProvider, useStore, useNodesState,
} from '@xyflow/react';
import Dagre from '@dagrejs/dagre';
import HomeView from './components/HomeView';
import EditorLeftPane from './components/EditorLeftPane';
import SidePane from './components/SidePane';
import MetricsFormulaEditor from './components/MetricsFormulaEditor';
import ModelsView from './components/ModelsView';
import MetricsView from './components/MetricsView';
import './App.css';

// ── Source brand colors ──────────────────────────────────────────────────────
const SOURCE_BRAND_COLORS = {
  'sales-db':        '#336791',
  'product-db':      '#e48e00',
  'hubspot':         '#ff5c35',
  'salesforce':      '#00a1e0',
  'snowflake':       '#29b5e8',
  'google-bigquery': '#4285f4',
  'google-analytics':'#e37400',
  'amazon-redshift': '#8c4fff',
  'databricks':      '#ff3621',
};
const SOURCE_BRAND_COLOR_DEFAULT = '#6f675d';

function sourceBrandColor(sourceId) {
  return SOURCE_BRAND_COLORS[sourceId] || SOURCE_BRAND_COLOR_DEFAULT;
}

function darkenColor(hex, lightnessReduce = 0.19) {
  const h = hex.replace('#', '');
  let r = parseInt(h.slice(0, 2), 16) / 255;
  let g = parseInt(h.slice(2, 4), 16) / 255;
  let b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0, sat = 0, lit = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = lit > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) hue = ((b - r) / d + 2) / 6;
    else hue = ((r - g) / d + 4) / 6;
  }
  lit = Math.max(0, lit - lightnessReduce);
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  if (sat === 0) { r = g = b = lit; } else {
    const q = lit < 0.5 ? lit * (1 + sat) : lit + sat - lit * sat;
    const p = 2 * lit - q;
    r = hue2rgb(p, q, hue + 1/3);
    g = hue2rgb(p, q, hue);
    b = hue2rgb(p, q, hue - 1/3);
  }
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

function autoDisplayName(fieldKey) {
  return fieldKey
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ── Data Models (single-entity semantic definitions, no joins) ────────────────
const DATA_MODELS_INITIAL = [
  {
    id: 'orders', name: 'Orders', sourceId: 'sales-db', sourceName: 'Sales DB',
    description: 'Each record represents an individual order line item placed by a customer. Use to analyze revenue, volume, and order-level trends over time.',
    grain: 'One row per order line item',
    usedInDatasetIds: ['sales-overview', 'revenue-summary'],
    fields: [
      { key: 'order_id',    label: 'order_id',    type: '#',  isKey: true, role: 'ID',        visible: true,  synonyms: 'transaction ID, purchase ID', semanticDesc: 'Unique identifier per order line item. Use COUNT(DISTINCT order_id) to measure order volume. Never aggregate directly.' },
      { key: 'customer_id', label: 'customer_id', type: '#',  role: 'DIMENSION', visible: true,  synonyms: 'buyer ID, client ID', semanticDesc: 'Foreign key to the customers table. Null values indicate guest or unattributed orders.' },
      { key: 'product_id',  label: 'product_id',  type: '#',  role: 'DIMENSION', visible: true,  semanticDesc: 'Foreign key to the products table. Orders without a matching product SKU are excluded via INNER JOIN.' },
      { key: 'order_date',  label: 'order_date',  type: 'dt', role: 'DIMENSION', visible: true,  synonyms: 'transaction date, purchase date, sale date', semanticDesc: 'Date the order was placed (UTC). Primary time axis for this model.' },
      { key: 'amount',      label: 'amount',      type: '$',  role: 'MEASURE',   visible: true,  agg: 'SUM', synonyms: 'revenue, GMV, gross sales, total', semanticDesc: 'Gross order revenue in USD before discounts or cost deductions. Aggregate with SUM.' },
      { key: 'revenue_net', label: 'revenue_net', type: 'fx', role: 'MEASURE',   visible: true,  agg: 'SUM', calc: true, synonyms: 'net revenue, margin revenue', semanticDesc: 'Net revenue after deducting customer discounts and unit cost. Preferred metric for profitability.' },
    ],
  },
  {
    id: 'customers', name: 'Customers', sourceId: 'sales-db', sourceName: 'Sales DB',
    description: 'Each record represents a unique, deduplicated customer identity. Use to segment, filter, and profile buyers across orders.',
    grain: 'One row per customer',
    usedInDatasetIds: ['sales-overview', 'customer-ltv'],
    fields: [
      { key: 'customer_id', label: 'customer_id', type: '#',  isKey: true, role: 'ID',        visible: true,  synonyms: 'buyer, client, user ID', semanticDesc: 'Primary key for the customers table. Use to JOIN with orders.customer_id.' },
      { key: 'full_name',   label: 'full_name',   type: 'Aa', role: 'DIMENSION', visible: true,  synonyms: 'name, customer name, display name', semanticDesc: "Customer's display name. Use for labeling. Avoid joining on this field; use customer_id." },
      { key: 'region',      label: 'region',      type: 'Aa', role: 'DIMENSION', visible: true,  semanticDesc: 'Geographic sales region (e.g. APAC, LATAM, EMEA, NA).' },
      { key: 'segment',     label: 'segment',     type: 'Aa', role: 'DIMENSION', visible: true,  synonyms: 'tier, market segment, company size', semanticDesc: 'Customer market tier (e.g. Enterprise, Mid-Market, SMB). Key dimension for cohort analysis.' },
    ],
  },
  {
    id: 'products', name: 'Products', sourceId: 'product-db', sourceName: 'Product DB',
    description: 'Each record represents a product SKU in the catalog. Use to enrich order data with product attributes, category, and cost.',
    grain: 'One row per product SKU',
    usedInDatasetIds: ['sales-overview', 'revenue-summary'],
    fields: [
      { key: 'product_id',   label: 'product_id',   type: '#',  isKey: true, role: 'ID',        visible: true,  semanticDesc: 'Primary key for the product catalog. Use to JOIN with orders.product_id.' },
      { key: 'product_name', label: 'product_name', type: 'Aa', role: 'DIMENSION', visible: true,  semanticDesc: 'Human-readable product name. For grouping across product lines, prefer category.' },
      { key: 'category',     label: 'category',     type: 'Aa', role: 'DIMENSION', visible: true,  semanticDesc: 'Product line grouping (e.g. Licenses, Services, Hardware).' },
      { key: 'unit_cost',    label: 'unit_cost',    type: '$',  role: 'MEASURE',   visible: false, agg: 'AVG', semanticDesc: 'Cost to the business per product unit in USD.' },
    ],
  },
  {
    id: 'returns', name: 'Returns', sourceId: 'sales-db', sourceName: 'Sales DB',
    description: 'Each record represents a product return initiated by a customer. Use to calculate return rates and identify return drivers.',
    grain: 'One row per return event',
    usedInDatasetIds: [],
    fields: [
      { key: 'return_id',   label: 'return_id',   type: '#',  isKey: true, role: 'ID',        visible: true,  semanticDesc: 'Unique identifier per return record.' },
      { key: 'order_id',    label: 'order_id',    type: '#',  role: 'DIMENSION', visible: true,  semanticDesc: 'Links the return to its originating order.' },
      { key: 'customer_id', label: 'customer_id', type: '#',  role: 'DIMENSION', visible: true,  semanticDesc: 'Links the return to the customer who initiated it.' },
      { key: 'return_date', label: 'return_date', type: 'dt', role: 'DIMENSION', visible: true,  semanticDesc: 'Date the return was initiated.' },
      { key: 'reason',      label: 'reason',      type: 'Aa', role: 'DIMENSION', visible: true,  semanticDesc: 'Customer-stated reason for the return.' },
    ],
  },
  {
    id: 'contacts', name: 'Contacts', sourceId: 'hubspot', sourceName: 'HubSpot',
    description: 'Each record represents a marketing contact in HubSpot. Use to connect marketing activity to pipeline and revenue outcomes.',
    grain: 'One row per HubSpot contact',
    usedInDatasetIds: ['marketing-attribution'],
    fields: [
      { key: 'contact_id',  label: 'contact_id',  type: '#',  isKey: true, role: 'ID',        visible: true,  semanticDesc: 'Primary key for the HubSpot contacts table.' },
      { key: 'email',       label: 'email',        type: 'Aa', role: 'DIMENSION', visible: true,  semanticDesc: 'Contact email address. Use as the join key to match with order or deal records.' },
      { key: 'lifecycle',   label: 'lifecycle',    type: 'Aa', role: 'DIMENSION', visible: true,  semanticDesc: 'HubSpot lifecycle stage (e.g. Lead, MQL, SQL, Customer).' },
      { key: 'source',      label: 'source',       type: 'Aa', role: 'DIMENSION', visible: true,  semanticDesc: 'Original acquisition source (e.g. Organic, Paid, Referral).' },
      { key: 'created_at',  label: 'created_at',   type: 'dt', role: 'DIMENSION', visible: false, semanticDesc: 'Timestamp when the contact was created in HubSpot.' },
    ],
  },
];

// ── Datasets (join & execution layer — multiple Data Models combined) ─────────
const _NOW = Date.now();
const DATASETS_INITIAL = {
  draft: [
    { id: 'customer-ltv', name: 'Customer LTV', desc: 'Lifetime value across orders and subscription events', entities: 2, joins: 1, uses: 0, stage: 'draft', progress: 0, modelIds: ['orders', 'customers'], lastModified: _NOW - 3600000 },
    { id: 'marketing-attribution', name: 'Marketing attribution', desc: 'Campaign spend linked to converted deals via UTM source', entities: 3, joins: 2, uses: 4, stage: 'draft', progress: 1, modelIds: ['contacts'], lastModified: _NOW - 7200000 },
  ],
  dev: [
    { id: 'sales-overview', name: 'Sales overview', desc: 'Orders joined with customers and products for sales exploration', entities: 3, joins: 2, uses: 12, stage: 'dev', progress: 6, modelIds: ['orders', 'customers', 'products'], lastModified: _NOW - 86400000 },
    { id: 'support-tickets', name: 'Support tickets', desc: 'Zendesk tickets linked to accounts for CSAT analysis', entities: 2, joins: 1, uses: 23, stage: 'dev', progress: 11, modelIds: [], lastModified: _NOW - 172800000 },
  ],
  production: [
    { id: 'revenue-summary', name: 'Revenue summary', desc: 'Aggregated revenue model used across all executive dashboards', entities: 4, joins: 3, uses: 847, stage: 'production', progress: 100, modelIds: ['orders', 'products'], lastModified: _NOW - 604800000 },
    { id: 'headcount-roles', name: 'Headcount & roles', desc: 'HRIS data combined with org chart hierarchy for people analytics', entities: 3, joins: 2, uses: 234, stage: 'production', progress: 28, modelIds: [], lastModified: _NOW - 1209600000 },
  ],
};

// ── Metrics ──────────────────────────────────────────────────────────────────
const METRICS_INITIAL = [
  { id: 'total-revenue',  name: 'Total Revenue',         description: 'Sum of gross order revenue across all orders in the dataset.', datasetId: 'sales-overview',  expression: 'SUM(amount)',              aggregation: 'SUM', isGlobal: false },
  { id: 'net-revenue',    name: 'Net Revenue',           description: 'Sum of revenue after deducting discounts and unit cost.',      datasetId: 'sales-overview',  expression: 'SUM(revenue_net)',         aggregation: 'SUM', isGlobal: false },
  { id: 'aov',            name: 'Average Order Value',   description: 'Average gross revenue per order. Divide total revenue by distinct order count.', datasetId: 'sales-overview', expression: 'SUM(amount) / COUNT(DISTINCT order_id)', aggregation: 'FORMULA', isGlobal: false },
  { id: 'return-rate',    name: 'Return Rate',           description: 'Percentage of orders that resulted in a return.',             datasetId: 'revenue-summary', expression: 'COUNT(return_id) / COUNT(DISTINCT order_id)', aggregation: 'FORMULA', isGlobal: false },
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
  { order_id: 10041, customer_id: 201, product_id: 301, order_date: '2025-03-01', amount: '$840', revenue_net: '$620', full_name: 'Priya Sharma', region: 'APAC', segment: 'Enterprise', product_name: 'Pro Seat', category: 'Licenses', unit_cost: '$220' },
  { order_id: 10042, customer_id: null, product_id: 302, order_date: '2025-03-02', amount: '$320', revenue_net: '$210', full_name: null, region: null, segment: null, product_name: 'Starter Pack', category: 'Licenses', unit_cost: '$110' },
  { order_id: 10043, customer_id: 203, product_id: 303, order_date: '2025-03-02', amount: '$1,200', revenue_net: '$940', full_name: 'Carlos Vega', region: 'LATAM', segment: 'Mid-Market', product_name: 'Enterprise Suite', category: 'Licenses', unit_cost: '$260' },
];

// Evaluate a metric expression against preview rows, returning a numeric value or null.
// Handles SUM, COUNT, COUNT(DISTINCT ...), AVG over fields present in rows.
function computeMetricValue(expression, rows) {
  if (!expression || !rows.length) return null;
  // Parse a field value from a row cell: strip $ and commas, return number
  const parseVal = (v) => {
    if (v === null || v === undefined) return null;
    const n = parseFloat(String(v).replace(/[$,]/g, ''));
    return isNaN(n) ? null : n;
  };

  let expr = expression;

  // COUNT(DISTINCT field)
  expr = expr.replace(/COUNT\s*\(\s*DISTINCT\s+(\w+)\s*\)/gi, (_, field) => {
    const vals = rows.map((r) => r[field]).filter((v) => v !== null && v !== undefined);
    return new Set(vals).size;
  });
  // SUM(field)
  expr = expr.replace(/SUM\s*\(\s*(\w+)\s*\)/gi, (_, field) => {
    if (!(field in rows[0])) return 'null';
    const total = rows.reduce((acc, r) => {
      const v = parseVal(r[field]);
      return v === null ? acc : acc + v;
    }, 0);
    return total;
  });
  // AVG(field)
  expr = expr.replace(/AVG\s*\(\s*(\w+)\s*\)/gi, (_, field) => {
    if (!(field in rows[0])) return 'null';
    const vals = rows.map((r) => parseVal(r[field])).filter((v) => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 'null';
  });
  // COUNT(field)
  expr = expr.replace(/COUNT\s*\(\s*(\w+)\s*\)/gi, (_, field) => {
    return rows.filter((r) => r[field] !== null && r[field] !== undefined).length;
  });

  // If any aggregate couldn't be resolved (field missing → 'null' sentinel)
  if (/\bnull\b/.test(expr)) return null;

  // Safety: only allow numeric expressions before eval
  if (!/^[\d\s+\-*/.()]+$/.test(expr)) return null;

  // eslint-disable-next-line no-eval
  return eval(expr);
}

function formatMetricValue(value, expression, isCurrency) {
  if (value === null || value === undefined) return '—';
  if (isCurrency) {
    return '$' + Math.round(value).toLocaleString();
  }
  // Ratio / percentage: result ≤ 1 and expression contains division
  if (expression.includes('/') && Math.abs(value) <= 1) {
    return (value * 100).toFixed(1) + '%';
  }
  // Default: locale number, up to 1 decimal
  return value % 1 === 0 ? value.toLocaleString() : value.toFixed(1);
}

const JOIN_MAP = { INNER: 'INNER JOIN', LEFT: 'LEFT JOIN', RIGHT: 'RIGHT JOIN', FULL: 'FULL OUTER JOIN', LEFT_EXCL: 'LEFT JOIN', RIGHT_EXCL: 'RIGHT JOIN' };

const ActiveFieldContext = createContext(null);
// Shared context for dataset canvas field popovers — one open at a time.
const DsActiveFieldContext = createContext(null);

const DBT_TYPE_MAP = { '#': 'integer', '$': 'numeric', 'Aa': 'varchar', 'dt': 'timestamp', 'fx': 'numeric' };
const DBT_AGG_MAP = { SUM: 'sum', AVG: 'average', COUNT: 'count', MIN: 'min', MAX: 'max' };

function dbSourceName(dbName) { return dbName.toLowerCase().replace(/\s+/g, '_'); }

const ENTITY_CARD_WIDTH = 195;
const ENTITY_ROW_HEIGHT = 25;
const ENTITY_HEADER_HEIGHT = 39;
const ENTITY_FOOTER_HEIGHT = 32;

const FORMULA_FUNCTIONS = [
  // Math
  { name: 'ABS',      category: 'Math',      signature: 'ABS(number)',              desc: 'Absolute value' },
  { name: 'ROUND',    category: 'Math',      signature: 'ROUND(number, decimals)',   desc: 'Round to decimals' },
  { name: 'FLOOR',    category: 'Math',      signature: 'FLOOR(number)',             desc: 'Round down to integer' },
  { name: 'CEIL',     category: 'Math',      signature: 'CEIL(number)',              desc: 'Round up to integer' },
  { name: 'SQRT',     category: 'Math',      signature: 'SQRT(number)',              desc: 'Square root' },
  { name: 'POWER',    category: 'Math',      signature: 'POWER(base, exp)',          desc: 'Raise to a power' },
  { name: 'MOD',      category: 'Math',      signature: 'MOD(number, divisor)',      desc: 'Modulo remainder' },
  // Aggregates
  { name: 'SUM',      category: 'Aggregate', signature: 'SUM(field)',                desc: 'Sum of values' },
  { name: 'AVG',      category: 'Aggregate', signature: 'AVG(field)',                desc: 'Average value' },
  { name: 'MIN',      category: 'Aggregate', signature: 'MIN(field)',                desc: 'Minimum value' },
  { name: 'MAX',      category: 'Aggregate', signature: 'MAX(field)',                desc: 'Maximum value' },
  { name: 'COUNT',    category: 'Aggregate', signature: 'COUNT(field)',              desc: 'Count of non-null values' },
  // Logic
  { name: 'IF',       category: 'Logic',     signature: 'IF(condition, then, else)', desc: 'Conditional expression' },
  { name: 'IIF',      category: 'Logic',     signature: 'IIF(condition, then, else)',desc: 'Inline conditional' },
  { name: 'CASE',     category: 'Logic',     signature: 'CASE WHEN … THEN … END',   desc: 'Multi-branch condition' },
  { name: 'COALESCE', category: 'Logic',     signature: 'COALESCE(a, b, …)',         desc: 'First non-null value' },
  { name: 'NULLIF',   category: 'Logic',     signature: 'NULLIF(a, b)',              desc: 'Null if a equals b' },
  { name: 'ISNULL',   category: 'Logic',     signature: 'ISNULL(value)',             desc: 'True when value is null' },
  // String
  { name: 'CONCAT',   category: 'String',    signature: 'CONCAT(a, b, …)',           desc: 'Concatenate strings' },
  { name: 'UPPER',    category: 'String',    signature: 'UPPER(text)',               desc: 'Convert to uppercase' },
  { name: 'LOWER',    category: 'String',    signature: 'LOWER(text)',               desc: 'Convert to lowercase' },
  { name: 'TRIM',     category: 'String',    signature: 'TRIM(text)',                desc: 'Strip leading/trailing spaces' },
  { name: 'LEN',      category: 'String',    signature: 'LEN(text)',                 desc: 'Character count' },
  // Date
  { name: 'NOW',      category: 'Date',      signature: 'NOW()',                     desc: 'Current timestamp' },
  { name: 'TODAY',    category: 'Date',      signature: 'TODAY()',                   desc: 'Current date' },
  { name: 'YEAR',     category: 'Date',      signature: 'YEAR(date)',                desc: 'Year part of date' },
  { name: 'MONTH',    category: 'Date',      signature: 'MONTH(date)',               desc: 'Month part of date' },
  { name: 'DAY',      category: 'Date',      signature: 'DAY(date)',                 desc: 'Day part of date' },
  { name: 'DATEDIFF', category: 'Date',      signature: 'DATEDIFF(unit, start, end)', desc: 'Difference between dates' },
];

const FORMULA_FN_SET = new Set(FORMULA_FUNCTIONS.map((f) => f.name));
const FORMULA_KEYWORDS = new Set(['AND','OR','NOT','THEN','ELSE','END','WHEN','AS','IN','BETWEEN','NULL','TRUE','FALSE']);

// ── Connection config schema ────────────────────────────────────────────────
// Each schema has tabs: connection, auth, advanced. Each tab is an array of field defs.
// field: { key, label, type: 'text'|'password'|'number'|'select'|'toggle'|'oauth'|'textarea', placeholder?, options?, hint? }
const CONNECTOR_CONFIG_SCHEMA = {
  sql: {
    connection: [
      { key: 'host',     label: 'Host',     type: 'text',   placeholder: 'e.g. db.example.com or 10.0.0.1' },
      { key: 'port',     label: 'Port',     type: 'number', placeholder: '5432' },
      { key: 'database', label: 'Database', type: 'text',   placeholder: 'my_database' },
      { key: 'schema',   label: 'Schema',   type: 'text',   placeholder: 'public' },
    ],
    auth: [
      { key: 'username', label: 'Username', type: 'text',     placeholder: 'db_user' },
      { key: 'password', label: 'Password', type: 'password', placeholder: '••••••••' },
    ],
    advanced: [
      { key: 'ssl',     label: 'Require SSL',       type: 'toggle' },
      { key: 'timeout', label: 'Connection Timeout', type: 'number', placeholder: '30', hint: 'seconds' },
    ],
  },
  mysql: {
    connection: [
      { key: 'host',     label: 'Host',     type: 'text',   placeholder: 'e.g. db.example.com' },
      { key: 'port',     label: 'Port',     type: 'number', placeholder: '3306' },
      { key: 'database', label: 'Database', type: 'text',   placeholder: 'my_database' },
    ],
    auth: [
      { key: 'username', label: 'Username', type: 'text',     placeholder: 'db_user' },
      { key: 'password', label: 'Password', type: 'password', placeholder: '••••••••' },
    ],
    advanced: [
      { key: 'ssl',     label: 'Require SSL',       type: 'toggle' },
      { key: 'timeout', label: 'Connection Timeout', type: 'number', placeholder: '30', hint: 'seconds' },
      { key: 'charset', label: 'Charset',            type: 'text',   placeholder: 'utf8mb4' },
    ],
  },
  mssql: {
    connection: [
      { key: 'host',     label: 'Server',   type: 'text',   placeholder: 'e.g. sqlserver.company.com\\INSTANCE' },
      { key: 'port',     label: 'Port',     type: 'number', placeholder: '1433' },
      { key: 'database', label: 'Database', type: 'text',   placeholder: 'Northwind' },
      { key: 'schema',   label: 'Schema',   type: 'text',   placeholder: 'dbo' },
    ],
    auth: [
      { key: 'authType', label: 'Auth Type', type: 'select', options: ['SQL Server Auth', 'Windows Auth', 'Azure AD'] },
      { key: 'username', label: 'Username',  type: 'text',     placeholder: 'sa' },
      { key: 'password', label: 'Password',  type: 'password', placeholder: '••••••••' },
    ],
    advanced: [
      { key: 'encrypt',  label: 'Encrypt Connection', type: 'toggle' },
      { key: 'timeout',  label: 'Connection Timeout',  type: 'number', placeholder: '30', hint: 'seconds' },
    ],
  },
  snowflake: {
    connection: [
      { key: 'account',   label: 'Account',    type: 'text', placeholder: 'xy12345.us-east-1' },
      { key: 'warehouse', label: 'Warehouse',  type: 'text', placeholder: 'COMPUTE_WH' },
      { key: 'database',  label: 'Database',   type: 'text', placeholder: 'ANALYTICS' },
      { key: 'schema',    label: 'Schema',     type: 'text', placeholder: 'PUBLIC' },
      { key: 'role',      label: 'Default Role', type: 'text', placeholder: 'ANALYST' },
    ],
    auth: [
      { key: 'authType', label: 'Auth Type', type: 'select', options: ['Username / Password', 'Key Pair', 'OAuth'] },
      { key: 'username', label: 'Username',  type: 'text',     placeholder: 'SNOWFLAKE_USER' },
      { key: 'password', label: 'Password',  type: 'password', placeholder: '••••••••' },
    ],
    advanced: [
      { key: 'timeout', label: 'Login Timeout',   type: 'number', placeholder: '60', hint: 'seconds' },
      { key: 'loginTimeout', label: 'Query Timeout', type: 'number', placeholder: '300', hint: 'seconds' },
    ],
  },
  oracle: {
    connection: [
      { key: 'host',        label: 'Host',         type: 'text',   placeholder: 'oracle.example.com' },
      { key: 'port',        label: 'Port',         type: 'number', placeholder: '1521' },
      { key: 'serviceName', label: 'Service Name', type: 'text',   placeholder: 'ORCL' },
    ],
    auth: [
      { key: 'username', label: 'Username', type: 'text',     placeholder: 'system' },
      { key: 'password', label: 'Password', type: 'password', placeholder: '••••••••' },
    ],
    advanced: [
      { key: 'ssl',     label: 'Use SSL/TLS',        type: 'toggle' },
      { key: 'timeout', label: 'Connection Timeout', type: 'number', placeholder: '30', hint: 'seconds' },
    ],
  },
  bigquery: {
    connection: [
      { key: 'projectId', label: 'Project ID',     type: 'text', placeholder: 'my-gcp-project' },
      { key: 'dataset',   label: 'Default Dataset', type: 'text', placeholder: 'analytics' },
      { key: 'location',  label: 'Location',        type: 'select', options: ['US', 'EU', 'us-central1', 'europe-west1', 'asia-east1'] },
    ],
    auth: [
      { key: 'authType', label: 'Auth Type', type: 'select', options: ['Service Account JSON', 'OAuth (User Account)'] },
      { key: 'keyJson',  label: 'Service Account JSON', type: 'textarea', placeholder: 'Paste JSON key file contents…' },
    ],
    advanced: [
      { key: 'maxBillingBytes', label: 'Max Bytes Billed', type: 'number', placeholder: '1073741824', hint: 'bytes' },
      { key: 'timeout',         label: 'Query Timeout',    type: 'number', placeholder: '300',        hint: 'seconds' },
    ],
  },
  redshift: {
    connection: [
      { key: 'host',     label: 'Cluster Endpoint', type: 'text',   placeholder: 'cluster.abc123.us-east-1.redshift.amazonaws.com' },
      { key: 'port',     label: 'Port',             type: 'number', placeholder: '5439' },
      { key: 'database', label: 'Database',         type: 'text',   placeholder: 'dev' },
      { key: 'schema',   label: 'Schema',           type: 'text',   placeholder: 'public' },
    ],
    auth: [
      { key: 'authType', label: 'Auth Type', type: 'select', options: ['Database Credentials', 'IAM Role'] },
      { key: 'username', label: 'Username',  type: 'text',     placeholder: 'awsuser' },
      { key: 'password', label: 'Password',  type: 'password', placeholder: '••••••••' },
    ],
    advanced: [
      { key: 'ssl',     label: 'Require SSL',       type: 'toggle' },
      { key: 'timeout', label: 'Connection Timeout', type: 'number', placeholder: '30', hint: 'seconds' },
    ],
  },
  databricks: {
    connection: [
      { key: 'serverHostname', label: 'Server Hostname', type: 'text', placeholder: 'adb-xxx.azuredatabricks.net' },
      { key: 'httpPath',       label: 'HTTP Path',       type: 'text', placeholder: '/sql/1.0/warehouses/abc123' },
      { key: 'catalog',        label: 'Catalog',         type: 'text', placeholder: 'main' },
      { key: 'schema',         label: 'Schema',          type: 'text', placeholder: 'default' },
    ],
    auth: [
      { key: 'token', label: 'Personal Access Token', type: 'password', placeholder: 'dapi••••••••' },
    ],
    advanced: [
      { key: 'timeout', label: 'Connection Timeout', type: 'number', placeholder: '60', hint: 'seconds' },
    ],
  },
  athena: {
    connection: [
      { key: 'region',          label: 'AWS Region',        type: 'select', options: ['us-east-1','us-east-2','us-west-1','us-west-2','eu-west-1','ap-southeast-1'] },
      { key: 'workgroup',       label: 'Workgroup',          type: 'text',   placeholder: 'primary' },
      { key: 'outputBucket',    label: 'Output S3 Bucket',   type: 'text',   placeholder: 's3://my-athena-results/' },
      { key: 'catalog',         label: 'Catalog',            type: 'text',   placeholder: 'AwsDataCatalog' },
    ],
    auth: [
      { key: 'authType',  label: 'Auth Type',       type: 'select', options: ['Access Key', 'IAM Role'] },
      { key: 'accessKey', label: 'Access Key ID',   type: 'text',     placeholder: 'AKIAIOSFODNN7EXAMPLE' },
      { key: 'secretKey', label: 'Secret Access Key', type: 'password', placeholder: '••••••••' },
    ],
    advanced: [
      { key: 'timeout', label: 'Query Timeout', type: 'number', placeholder: '300', hint: 'seconds' },
    ],
  },
  synapse: {
    connection: [
      { key: 'host',     label: 'Server',     type: 'text',   placeholder: 'workspace.sql.azuresynapse.net' },
      { key: 'port',     label: 'Port',       type: 'number', placeholder: '1433' },
      { key: 'database', label: 'Database',   type: 'text',   placeholder: 'mypool' },
      { key: 'schema',   label: 'Schema',     type: 'text',   placeholder: 'dbo' },
    ],
    auth: [
      { key: 'authType', label: 'Auth Type', type: 'select', options: ['SQL Auth', 'Azure AD'] },
      { key: 'username', label: 'Username',  type: 'text',     placeholder: 'sqladminuser' },
      { key: 'password', label: 'Password',  type: 'password', placeholder: '••••••••' },
    ],
    advanced: [
      { key: 'encrypt',  label: 'Encrypt Connection', type: 'toggle' },
      { key: 'timeout',  label: 'Connection Timeout',  type: 'number', placeholder: '30', hint: 'seconds' },
    ],
  },
  elasticsearch: {
    connection: [
      { key: 'url',   label: 'Cluster URL', type: 'text', placeholder: 'https://my-cluster.es.io:9243' },
      { key: 'index', label: 'Index',       type: 'text', placeholder: 'my-index-*' },
    ],
    auth: [
      { key: 'authType', label: 'Auth Type', type: 'select', options: ['API Key', 'Basic Auth', 'None'] },
      { key: 'apiKey',   label: 'API Key',   type: 'password', placeholder: '••••••••' },
    ],
    advanced: [
      { key: 'timeout', label: 'Request Timeout', type: 'number', placeholder: '30', hint: 'seconds' },
    ],
  },
  google_oauth: {
    connection: [
      { key: 'accountId',  label: 'Account ID',   type: 'text', placeholder: 'Auto-filled after OAuth' },
      { key: 'propertyId', label: 'Property / View ID', type: 'text', placeholder: 'Auto-filled after OAuth' },
    ],
    auth: [
      { key: '_oauth', label: 'Google Account', type: 'oauth', hint: 'Sign in with your Google account to authorise access.' },
    ],
    advanced: [
      { key: 'dateRange', label: 'Default Date Range', type: 'select', options: ['Last 30 days', 'Last 90 days', 'Last 12 months', 'Custom'] },
    ],
  },
  crm_oauth: {
    connection: [
      { key: 'instanceUrl', label: 'Instance URL', type: 'text', placeholder: 'https://yourorg.my.salesforce.com' },
    ],
    auth: [
      { key: '_oauth', label: 'OAuth Sign-in', type: 'oauth', hint: 'Authorise Reveal to access your CRM account.' },
    ],
    advanced: [
      { key: 'apiVersion', label: 'API Version', type: 'text', placeholder: 'v58.0' },
      { key: 'timeout',    label: 'Timeout',     type: 'number', placeholder: '30', hint: 'seconds' },
    ],
  },
  crm_apikey: {
    connection: [
      { key: 'portalId', label: 'Portal / Account ID', type: 'text', placeholder: 'e.g. 12345678' },
    ],
    auth: [
      { key: 'apiKey',  label: 'API Key',  type: 'password', placeholder: '••••••••' },
    ],
    advanced: [
      { key: 'timeout', label: 'Timeout', type: 'number', placeholder: '30', hint: 'seconds' },
    ],
  },
  rest: {
    connection: [
      { key: 'url',     label: 'Base URL', type: 'text',   placeholder: 'https://api.example.com/v1' },
      { key: 'method',  label: 'Method',   type: 'select', options: ['GET', 'POST'] },
    ],
    auth: [
      { key: 'authType', label: 'Auth Type', type: 'select', options: ['None', 'Bearer Token', 'Basic Auth', 'API Key Header'] },
      { key: 'token',    label: 'Token / Key', type: 'password', placeholder: '••••••••' },
    ],
    advanced: [
      { key: 'headers', label: 'Custom Headers', type: 'textarea', placeholder: 'Content-Type: application/json\nX-Custom: value' },
      { key: 'timeout', label: 'Timeout',         type: 'number',   placeholder: '30', hint: 'seconds' },
    ],
  },
  files: {
    connection: [
      { key: 'url',      label: 'File URL',    type: 'text',   placeholder: 'https://files.example.com/data.csv' },
      { key: 'fileType', label: 'File Type',   type: 'select', options: ['CSV', 'TSV', 'Excel (XLS)', 'Excel (XLSX)', 'JSON'] },
    ],
    auth: [
      { key: 'authType', label: 'Auth Type', type: 'select', options: ['None', 'Basic Auth'] },
      { key: 'username', label: 'Username',  type: 'text',     placeholder: 'optional' },
      { key: 'password', label: 'Password',  type: 'password', placeholder: '••••••••' },
    ],
    advanced: [],
  },
  sharepoint: {
    connection: [
      { key: 'siteUrl', label: 'SharePoint Site URL', type: 'text', placeholder: 'https://contoso.sharepoint.com/sites/MyTeam' },
    ],
    auth: [
      { key: '_oauth', label: 'Microsoft Account', type: 'oauth', hint: 'Sign in with your Microsoft 365 account.' },
    ],
    advanced: [
      { key: 'library', label: 'Document Library', type: 'text', placeholder: 'Shared Documents' },
    ],
  },
};

// Schema key lookup per connector id
const CONNECTOR_SCHEMA_MAP = {
  'sales-db':          'sql',
  'product-db':        'mysql',
  'azure-sql':         'mssql',
  'azure-ssas':        'mssql',
  'mariadb':           'mysql',
  'microsoft-sql':     'mssql',
  'mysql':             'mysql',
  'oracle':            'oracle',
  'postgresql':        'sql',
  'snowflake':         'snowflake',
  'sybase':            'mssql',
  'google-analytics':  'google_oauth',
  'google-ads':        'google_oauth',
  'google-search':     'google_oauth',
  'google-bigquery':   'bigquery',
  'hubspot':           'crm_apikey',
  'salesforce':        'crm_oauth',
  'ms-dynamics':       'crm_oauth',
  'marketing-cloud':   'crm_oauth',
  'marketo':           'crm_apikey',
  'netsuite':          'crm_oauth',
  'quickbooks-desktop':'crm_apikey',
  'quickbooks-online': 'crm_oauth',
  'amazon-athena':     'athena',
  'amazon-redshift':   'redshift',
  'azure-synapse':     'synapse',
  'databricks':        'databricks',
  'elasticsearch':     'elasticsearch',
  'odata-feed':        'rest',
  'rest-api':          'rest',
  'web-resource':      'rest',
  'data-files':        'files',
  'sharepoint':        'sharepoint',
  'facebook':          'crm_oauth',
  'facebook-ads':      'crm_oauth',
  'instagram':         'crm_oauth',
  'linkedin':          'crm_oauth',
  'linkedin-ads':      'crm_oauth',
};

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
    { key: 'return_id', label: 'return_id', type: '#', isKey: true, role: 'ID', semanticDesc: 'Unique identifier per return record. Use COUNT(DISTINCT return_id) to measure return volume or return rate.' },
    { key: 'order_id', label: 'order_id', type: '#', role: 'DIMENSION', semanticDesc: 'Links the return to its originating order. Join with orders on order_id to calculate return rate as a share of total orders.' },
    { key: 'customer_id', label: 'customer_id', type: '#', role: 'DIMENSION', semanticDesc: 'Links the return to the customer who initiated it. Use to identify high-return customers or segments prone to returns.' },
    { key: 'return_date', label: 'return_date', type: 'dt', role: 'DIMENSION', semanticDesc: 'Date the return was initiated. Use for time-series analysis of return rates and to compute days-to-return from order_date.' },
    { key: 'reason', label: 'reason', type: 'Aa', role: 'DIMENSION', semanticDesc: 'Customer-stated reason for the return (e.g. Damaged, Wrong Item, Not as Described). Use to categorize return drivers and prioritize quality improvements.' },
  ],
  'shipments': [
    { key: 'shipment_id', label: 'shipment_id', type: '#', isKey: true, role: 'ID', semanticDesc: 'Unique identifier per shipment. One order may produce multiple shipments (e.g. split fulfillment).' },
    { key: 'order_id', label: 'order_id', type: '#', role: 'DIMENSION', semanticDesc: 'Links the shipment to its originating order. Join with orders to calculate fulfillment lag (shipped_at minus order_date).' },
    { key: 'shipped_at', label: 'shipped_at', type: 'dt', role: 'DIMENSION', semanticDesc: 'Timestamp when the shipment was dispatched. Subtract from order_date to compute fulfillment lag. Use for SLA compliance analysis.' },
    { key: 'carrier', label: 'carrier', type: 'Aa', role: 'DIMENSION', semanticDesc: 'Shipping carrier name (e.g. FedEx, UPS, DHL). Use to compare delivery performance, cost, and on-time rates across carriers.' },
    { key: 'status', label: 'status', type: 'Aa', role: 'DIMENSION', semanticDesc: 'Current delivery status (e.g. In Transit, Delivered, Returned, Lost). Filter to Delivered for fulfilled-order analysis; use other values for exception reporting.' },
  ],
  'invoices': [
    { key: 'invoice_id', label: 'invoice_id', type: '#', isKey: true, role: 'ID', semanticDesc: 'Unique identifier per invoice. One order may generate multiple invoices due to partial billing or payment schedules.' },
    { key: 'order_id', label: 'order_id', type: '#', role: 'DIMENSION', semanticDesc: 'Links the invoice to its originating order. Join with orders to reconcile billed revenue against booked revenue.' },
    { key: 'customer_id', label: 'customer_id', type: '#', role: 'DIMENSION', semanticDesc: 'Links the invoice to the customer. Use for accounts-receivable analysis, overdue tracking, and revenue recognition by customer.' },
    { key: 'amount', label: 'amount', type: '$', role: 'MEASURE', agg: 'SUM', semanticDesc: 'Invoice amount in USD. SUM for total billed revenue. May differ from order amount due to partial billing, credits, or adjustments.' },
    { key: 'issued_at', label: 'issued_at', type: 'dt', role: 'DIMENSION', semanticDesc: 'Date the invoice was issued. Use to measure billing lag from order_date and for Days Sales Outstanding (DSO) calculations.' },
  ],
  'categories': [
    { key: 'category_id', label: 'category_id', type: '#', isKey: true, role: 'ID', semanticDesc: 'Primary key for the category hierarchy. Join with products on category_id to attach category labels to product-level data.' },
    { key: 'name', label: 'name', type: 'Aa', role: 'DIMENSION', semanticDesc: 'Display name of the product category. Use for labeling category-level breakdowns in reports and dashboards.' },
    { key: 'parent_id', label: 'parent_id', type: '#', role: 'DIMENSION', semanticDesc: 'References the parent category for nested hierarchies. A null value indicates a top-level category. Use to roll up metrics to higher-level groupings.' },
  ],
  'inventory': [
    { key: 'inventory_id', label: 'inventory_id', type: '#', isKey: true, role: 'ID', semanticDesc: 'Unique identifier for a stock record scoped to one product at one warehouse. Use COUNT to measure number of active stock positions.' },
    { key: 'product_id', label: 'product_id', type: '#', role: 'DIMENSION', semanticDesc: 'Links inventory to a product SKU. Join with products to enrich stock data with product name, category, and cost.' },
    { key: 'quantity', label: 'quantity', type: '#', role: 'MEASURE', agg: 'SUM', semanticDesc: 'Current stock level for this product at this warehouse. SUM across warehouses for total available inventory. Compare with units_sold to assess stockout risk.' },
    { key: 'warehouse', label: 'warehouse', type: 'Aa', role: 'DIMENSION', semanticDesc: 'Name or identifier of the warehouse location. Use to compare stock levels across fulfillment centers or identify regional supply imbalances.' },
  ],
  'suppliers': [
    { key: 'supplier_id', label: 'supplier_id', type: '#', isKey: true, role: 'ID', semanticDesc: 'Primary key for supplier records. Use to JOIN with product or inventory tables to attribute stock to its source vendor.' },
    { key: 'name', label: 'name', type: 'Aa', role: 'DIMENSION', semanticDesc: 'Supplier company name. Use for labeling supplier-level reports or filtering to a specific vendor in procurement analysis.' },
    { key: 'country', label: 'country', type: 'Aa', role: 'DIMENSION', semanticDesc: 'Country where the supplier is based. Use for supply chain geographic risk analysis, import compliance checks, and regional procurement reporting.' },
  ],
  'v_product_performance': [
    { key: 'product_id', label: 'product_id', type: '#', isKey: true, role: 'ID', semanticDesc: 'Links performance metrics to a product SKU. Join with products to enrich with name, category, and cost for full product analysis.' },
    { key: 'revenue', label: 'revenue', type: '$', role: 'MEASURE', agg: 'SUM', semanticDesc: 'Total revenue attributed to this product over the reporting period. SUM for overall product revenue. Compare against unit_cost to evaluate per-product margin.' },
    { key: 'units_sold', label: 'units_sold', type: '#', role: 'MEASURE', agg: 'SUM', semanticDesc: 'Total units sold for this product. SUM across the period. Divide into revenue to compute average selling price (ASP).' },
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

function JsonHighlight({ json }) {
  // Tokenize JSON into colored spans: keys, strings, numbers, booleans/null, punctuation
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(\btrue\b|\bfalse\b|\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],:])/g;
  const parts = [];
  let last = 0;
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(json)) !== null) {
    if (m.index > last) parts.push(<span key={last}>{json.slice(last, m.index)}</span>);
    if (m[1] !== undefined) {
      // string — check if it's a key (followed by colon) or a value
      const isKey = m[2] !== undefined;
      parts.push(<span key={m.index} className={isKey ? 'json-key' : 'json-str'}>{m[1]}</span>);
      if (isKey) parts.push(<span key={`${m.index}-c`} className="json-punct">{m[2]}</span>);
    } else if (m[3] !== undefined) {
      parts.push(<span key={m.index} className="json-lit">{m[3]}</span>);
    } else if (m[4] !== undefined) {
      parts.push(<span key={m.index} className="json-num">{m[4]}</span>);
    } else if (m[5] !== undefined) {
      parts.push(<span key={m.index} className="json-punct">{m[5]}</span>);
    }
    last = m.index + m[0].length;
  }
  if (last < json.length) parts.push(<span key={last}>{json.slice(last)}</span>);
  return <pre className="insp-md-pre json-pre">{parts}</pre>;
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

// ── Formula tokenizer ─────────────────────────────────────────────────────
function tokenizeFormula(text, availableFields) {
  const fieldSet = new Set((availableFields || []).map((f) => f.key.toUpperCase()));
  const tokens = [];
  // Groups: 1=ws, 2=string-literal, 3=number, 4=identifier, 5=operator/paren/comma
  const re = /(\s+)|('[^']*'|"[^"]*")|(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([+\-*/=<>!%]+|[(),])/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push({ text: text.slice(last, m.index), type: 'unknown' });
    const [full, ws, str, num, ident, op] = m;
    if (ws)    { tokens.push({ text: full, type: 'ws' }); }
    else if (str)   { tokens.push({ text: full, type: 'string' }); }
    else if (num)   { tokens.push({ text: full, type: 'number' }); }
    else if (ident) {
      const u = ident.toUpperCase();
      if (FORMULA_FN_SET.has(u))       tokens.push({ text: full, type: 'fn' });
      else if (FORMULA_KEYWORDS.has(u)) tokens.push({ text: full, type: 'keyword' });
      else if (fieldSet.has(u))         tokens.push({ text: full, type: 'field' });
      else                              tokens.push({ text: full, type: 'ident' });
    } else if (op) {
      const t = (op === '(' || op === ')') ? 'paren' : op === ',' ? 'comma' : 'op';
      tokens.push({ text: full, type: t });
    } else {
      tokens.push({ text: full, type: 'unknown' });
    }
    last = m.index + full.length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), type: 'unknown' });
  return tokens;
}

// ── FormulaEditor — typeahead + syntax-highlighted textarea ──────────────
function FormulaEditor({ value, onChange, availableFields, placeholder, autoFocus }) {
  const taRef = useRef(null);
  const [dropdown, setDropdown] = useState(null); // { items, selectedIdx, wordStart }

  function getWordAtCursor(text, cursor) {
    let start = cursor;
    while (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1])) start--;
    return { word: text.slice(start, cursor), start };
  }

  function getSuggestions(partial) {
    const q = partial.toUpperCase();
    if (!q) return [];
    const fns = FORMULA_FUNCTIONS
      .filter((f) => f.name.startsWith(q))
      .map((f) => ({ type: 'fn', name: f.name, desc: f.desc, sig: f.signature }));
    const fields = (availableFields || [])
      .filter((f) => f.key.toUpperCase().startsWith(q))
      .map((f) => ({ type: 'field', name: f.key, desc: f.label || f.key }));
    return [...fns, ...fields].slice(0, 10);
  }

  const insertSuggestion = useCallback((item) => {
    if (!item || !taRef.current) return;
    const ta = taRef.current;
    const cursor = ta.selectionStart;
    const { word, start } = getWordAtCursor(value, cursor);
    // Functions get an opening paren appended; fields are inserted as-is
    const insert = item.type === 'fn' ? item.name + '(' : item.name;
    const newVal = value.slice(0, start) + insert + value.slice(start + word.length);
    onChange(newVal);
    setDropdown(null);
    requestAnimationFrame(() => {
      if (!taRef.current) return;
      taRef.current.focus();
      const pos = start + insert.length;
      taRef.current.setSelectionRange(pos, pos);
    });
  }, [value, onChange]);

  const handleChange = (e) => {
    const v = e.target.value;
    onChange(v);
    const cursor = e.target.selectionStart;
    const { word, start } = getWordAtCursor(v, cursor);
    if (word.length >= 1) {
      const items = getSuggestions(word);
      setDropdown(items.length ? { items, selectedIdx: 0, wordStart: start } : null);
    } else {
      setDropdown(null);
    }
  };

  const handleKeyDown = (e) => {
    if (!dropdown) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setDropdown((d) => d && ({ ...d, selectedIdx: Math.min(d.selectedIdx + 1, d.items.length - 1) })); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setDropdown((d) => d && ({ ...d, selectedIdx: Math.max(d.selectedIdx - 1, 0) })); }
    else if (e.key === 'Enter' || e.key === 'Tab') { if (dropdown.items[dropdown.selectedIdx]) { e.preventDefault(); insertSuggestion(dropdown.items[dropdown.selectedIdx]); } }
    else if (e.key === 'Escape') { setDropdown(null); }
  };

  const tokens = tokenizeFormula(value || '', availableFields);

  return (
    <div
      className="formula-editor"
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropdown(null); }}
    >
      <div className="formula-editor-inner">
        {/* Highlighted layer — rendered behind the transparent textarea */}
        <pre className="formula-highlight" aria-hidden="true">
          {tokens.map((tok, i) => (
            <span key={i} className={`ftok ftok-${tok.type}`}>{tok.text}</span>
          ))}
          {/* Trailing space keeps height consistent when value ends with newline */}
          {' '}
        </pre>
        <textarea
          ref={taRef}
          className="formula-textarea"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          autoFocus={autoFocus}
        />
      </div>
      {dropdown && (
        <div className="formula-dropdown" role="listbox">
          {dropdown.items.map((item, idx) => (
            <button
              key={item.name + item.type}
              role="option"
              aria-selected={idx === dropdown.selectedIdx}
              className={`formula-dd-item ${idx === dropdown.selectedIdx ? 'selected' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); insertSuggestion(item); }}
              tabIndex={-1}
            >
              <span className={`fdd-badge fdd-badge-${item.type}`}>
                {item.type === 'fn' ? 'fn' : 'field'}
              </span>
              <span className="fdd-name">{item.name}</span>
              {item.type === 'fn' && <span className="fdd-sig">{item.sig}</span>}
              <span className="fdd-desc">{item.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── React Flow custom node ──────────────────────────────────────────────────
function EntityCardNode({ data }) {
  const {
    id, label, source, primary, fields,
    isJoined, isSelected, hiddenFields, fieldDisplayNames,
    onSelectField, toggleHidden, onAddCalcField,
  } = data;
  const activeField = useContext(ActiveFieldContext);

  return (
    <article className={`ecard ${primary ? 'primary' : ''} ${isJoined ? '' : 'unjoined'} ${isSelected ? 'selected' : ''}`}>
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
      <button className="plain-btn ec-add-calc nodrag nopan" onClick={() => onAddCalcField && onAddCalcField(id)}>+ Add calculated field</button>
      <Handle type="source" position={Position.Right} id={`${id}-src`} className="entity-handle" />
      <Handle type="target" position={Position.Left} id={`${id}-tgt`} className="entity-handle" />
    </article>
  );
}
const nodeTypes = { entity: EntityCardNode };

// ── Field popup rendered via EdgeLabelRenderer so it sits above all nodes ───
function FieldPopupLayer({
  activeField, canvasEntities, entityPositions, allFields,
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
              <FormulaEditor
                value={fieldFormulas[fieldMeta.key] ?? (fieldMeta.formula || '')}
                onChange={(v) => setFieldFormulas((prev) => ({ ...prev, [fieldMeta.key]: v }))}
                availableFields={allFields ?? []}
                placeholder="e.g. amount - unit_cost"
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

// ── Calculated field modal ────────────────────────────────────────────────
function CalcFieldModal({ isOpen, onClose, onSave, availableFields, editField }) {
  const [fieldName, setFieldName] = useState('');
  const [formula, setFormula] = useState('');
  const [agg, setAgg] = useState('SUM');

  // Sync state when editField changes (open for editing)
  useEffect(() => {
    if (isOpen) {
      setFieldName(editField?.label || '');
      setFormula(editField?.formula || '');
      setAgg(editField?.agg || 'SUM');
    }
  }, [isOpen, editField]);

  const resetState = () => { setFieldName(''); setFormula(''); setAgg('SUM'); };

  const handleSave = () => {
    if (!fieldName.trim()) return;
    onSave({ name: fieldName.trim(), formula, agg });
    resetState();
  };

  const handleClose = () => { onClose(); resetState(); };
  const isEditing = !!editField;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Viewport className="dialog-viewport">
          <Dialog.Popup className="dialog-popup calc-field-modal">
            <div className="calc-field-header">
              <Dialog.Title className="modal-title">{isEditing ? 'Edit calculated field' : 'Add calculated field'}</Dialog.Title>
              <Dialog.Close className="plain-btn canvas-popup-close">×</Dialog.Close>
            </div>
            <div className="calc-field-body">
              <section className="sp-section">
                <p className="sp-lbl">Field name</p>
                <input
                  className="fi-inp"
                  value={fieldName}
                  onChange={(e) => setFieldName(e.target.value)}
                  placeholder="e.g. margin_pct"
                  autoFocus
                />
              </section>
              <section className="sp-section">
                <p className="sp-lbl">Formula</p>
                <FormulaEditor
                  value={formula}
                  onChange={setFormula}
                  availableFields={availableFields}
                  placeholder="e.g. amount - unit_cost"
                />
              </section>
              <section className="sp-section">
                <p className="sp-lbl">Aggregation</p>
                <Select.Root
                  value={agg}
                  onValueChange={setAgg}
                  items={['SUM','AVG','MIN','MAX','COUNT']}
                >
                  <Select.Trigger className="bu-trigger calc-agg-trigger">
                    <Select.Value />
                    <Select.Icon className="bu-icon">▾</Select.Icon>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Positioner>
                      <Select.Popup className="bu-popup">
                        <Select.List>
                          {['SUM','AVG','MIN','MAX','COUNT'].map((a) => (
                            <Select.Item key={a} value={a} className="bu-item">
                              <Select.ItemText>{a}</Select.ItemText>
                            </Select.Item>
                          ))}
                        </Select.List>
                      </Select.Popup>
                    </Select.Positioner>
                  </Select.Portal>
                </Select.Root>
              </section>
            </div>
            <div className="calc-field-footer">
              <button className="btn" onClick={handleClose}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={!fieldName.trim()}
              >
                Save field
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
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
    fromEntity, toEntity, fromChoices, toChoices, from, to, desc, cardinality,
    onUpdateJoin, hoveredJoinType, setHoveredJoinType, onClose,
    isReadOnly, onEdit,
  } = data;
  const [,, zoom] = useStore((s) => s.transform);

  return (
    <>
      <path id={id} className={`react-flow__edge-path join-edge-path${isReadOnly ? ' join-edge-ro' : ''}`} d={edgePath} />
      <EdgeLabelRenderer>
        <button
          className={`jnode nodrag nopan${isActive ? ' active' : ''}${isReadOnly ? ' jnode-ro' : ''}`}
          style={{
            position: 'absolute',
            transform: `translate(${labelX}px,${labelY}px) scale(${1 / zoom}) translate(-50%,-50%)`,
            pointerEvents: 'all',
          }}
          onClick={onSelect}
          aria-label={`${isReadOnly ? 'View' : 'Edit'} join between ${fromEntity} and ${toEntity}`}
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
            {isReadOnly ? (
              <div className="canvas-popup-body">
                <section className="sp-section join-ro-section">
                  <div className="join-ro-type-row">
                    <JoinTypeGlyph highlight={joinHighlight || 'intersection'} />
                    <div>
                      <div className="join-ro-type-name">{JOIN_TYPES.find((t) => t.value === joinType)?.label ?? joinType}</div>
                      <div className="join-ro-type-sql">{JOIN_MAP[joinType]}</div>
                    </div>
                  </div>
                  <p className="join-ro-implication">{JOIN_TYPES.find((t) => t.value === joinType)?.implication}</p>
                </section>
                <section className="sp-section join-ro-section">
                  <p className="sp-lbl">Key mapping</p>
                  <div className="join-ro-map">
                    <code className="join-ro-key">{from}</code>
                    <span className="join-arrow">→</span>
                    <code className="join-ro-key">{to}</code>
                  </div>
                  {cardinality && (
                    <div className="join-ro-cardinality">
                      <span className="join-cardinality-tag">{cardinality}</span>
                    </div>
                  )}
                </section>
                {desc && (
                  <section className="sp-section join-ro-section">
                    <p className="sp-lbl">Description</p>
                    <p className="join-ro-desc">{desc}</p>
                  </section>
                )}
                <div className="join-ro-edit-notice">
                  <span>Read only</span>
                  <button className="btn btn-sm" onClick={() => { onClose(); onEdit(); }}>Edit dataset</button>
                </div>
              </div>
            ) : (
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
                <section className="sp-section">
                  <p className="sp-lbl">Cardinality</p>
                  <div className="join-cardinality-row">
                    {['one-to-one','many-to-one','one-to-many','many-to-many'].map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`join-cardinality-btn${(cardinality || 'many-to-one') === c ? ' selected' : ''}`}
                        onClick={() => onUpdateJoin(id, 'cardinality', c)}
                      >{c}</button>
                    ))}
                  </div>
                </section>
              </div>
            )}
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
  onAddCalcField, activeTableId, setActiveTableId,
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

  const buildNodes = useCallback((posOverride) =>
    canvasEntities.map((e) => ({
      id: e.id,
      type: 'entity',
      position: (posOverride ?? entityPositions)[e.id] ?? { x: 100, y: 100 },
      dragHandle: '.ec-hd',
      data: {
        ...e,
        isJoined: joinedEntityIds.has(e.id),
        hiddenFields,
        fieldDisplayNames,
        isSelected: activeTableId === e.id,
        onSelectField: selectField,
        toggleHidden,
        onAddCalcField,
      },
    })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [canvasEntities, entityPositions, joinedEntityIds, hiddenFields, fieldDisplayNames, activeTableId]);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(() => buildNodes());

  // Sync node data and structure when anything other than drag position changes.
  // Preserve in-flight drag positions from internal RF state (posMap).
  useEffect(() => {
    setRfNodes((prev) => {
      const posMap = Object.fromEntries(prev.map((n) => [n.id, n.position]));
      return buildNodes(posMap);
    });
  // buildNodes captures all relevant deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildNodes]);

  // Sync authoritative positions (layout, initial load) into RF internal state.
  useEffect(() => {
    setRfNodes((prev) =>
      prev.map((n) => ({ ...n, position: entityPositions[n.id] ?? n.position }))
    );
  }, [entityPositions, setRfNodes]);

  const onNodeClick = useCallback((_, node) => {
    setActiveTableId(node.id);
  }, [setActiveTableId]);

  const onNodeDragStart = useCallback((_, node) => {
    setActiveTableId(node.id);
  }, [setActiveTableId]);

  const onNodeDragStop = useCallback((_, node) => {
    setEntityPositions((prev) => ({ ...prev, [node.id]: node.position }));
  }, [setEntityPositions]);

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

  // onInit fires after RF mounts and has measured all nodes.
  // Since entityPositions is pre-populated with Dagre coords, the first render
  // already has correct positions — fitView can run immediately in onInit.
  const onInit = useCallback((instance) => {
    instance.fitView({ padding: 0.15, duration: 0, maxZoom: 1 });
  }, []);

  return (
    <ActiveFieldContext.Provider value={activeField}>
    <div className="canvas-wrap">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onPaneClick={() => { selectJoin(null); selectField(null, null); setActiveTableId(null); }}
        defaultEdgeOptions={{ type: 'join' }}
        proOptions={{ hideAttribution: true }}
        elevateEdgesOnSelect
        maxZoom={1}
        onInit={onInit}
      >
        <Background variant="dots" gap={20} size={1} color="rgba(0,0,0,0.1)" />
      </ReactFlow>
      <FieldPopupLayer
        activeField={activeField}
        canvasEntities={canvasEntities}
        entityPositions={entityPositions}
        allFields={canvasEntities.flatMap((e) => e.fields)}
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
    </ActiveFieldContext.Provider>
  );
}

// ── Catalog left pane ─────────────────────────────────────────────────────────
// ── Dataset Canvas right pane ─────────────────────────────────────────────
// Read-only ReactFlow canvas scoped to a single dataset's modelIds.
// Edit mode unlocks drag, connect, and add-model interactions.

// Build a joins map from inferred key-field matches between entity pairs.
function initJoinsFromEntities(entities) {
  const joins = {};
  for (let i = 0; i < entities.length; i++) {
    for (let j = 0; j < entities.length; j++) {
      if (i === j) continue;
      const a = entities[i];
      const b = entities[j];
      const bPrimaryKeys = b.allFields.filter((f) => f.isKey).map((f) => f.key);
      const matchingField = a.allFields.find((f) => bPrimaryKeys.includes(f.key) && !f.isKey);
      const reverseExists = Object.values(joins).some(
        (jn) => jn.fromEntity === b.id && jn.toEntity === a.id
      );
      if (matchingField && !reverseExists) {
        const id = `join-${a.id}-${b.id}`;
        joins[id] = {
          id,
          fromEntity: a.label,  // human-readable label for JoinEdge popup
          toEntity: b.label,
          fromEntityId: a.id,   // actual RF source/target ids
          toEntityId: b.id,
          type: 'LEFT',
          from: matchingField.key,
          to: matchingField.key,
          desc: '',
          fromChoices: a.allFields.map((f) => f.key),
          toChoices: b.allFields.map((f) => f.key),
        };
      }
    }
  }
  return joins;
}

// ── Dataset canvas field popover overlay ──────────────────────────────────
// Rendered as a sibling to ReactFlow in ds-canvas-body so it escapes
// each node's stacking context and can sit above all cards.
function DsFieldPopoverLayer() {
  const ctx = useContext(DsActiveFieldContext);
  const [tx, ty, zoom] = useStore((s) => s.transform);
  if (!ctx || !ctx.activeDsField) return null;

  const { activeDsField, setActiveDsField, activeEntities, positions, onNavigateToModel } = ctx;
  const entity = activeEntities.find((e) => e.id === activeDsField.nodeId);
  const entityPos = positions[activeDsField.nodeId];
  if (!entity || !entityPos) return null;

  const allFields = entity.allFields || entity.fields;
  const fieldMeta = allFields.find((f) => f.key === activeDsField.fieldKey);
  if (!fieldMeta) return null;

  const visFields = entity.fields;
  const fieldIdx = visFields.findIndex((f) => f.key === activeDsField.fieldKey);

  // Convert flow coords → screen-space pixels via RF viewport transform
  const flowX = entityPos.x + ENTITY_CARD_WIDTH + 18;
  const flowY = entityPos.y + ENTITY_HEADER_HEIGHT + Math.max(fieldIdx, 0) * ENTITY_ROW_HEIGHT + ENTITY_ROW_HEIGHT / 2;
  const left = flowX * zoom + tx;
  const top  = flowY * zoom + ty;

  const displayName = fieldMeta.label || fieldMeta.key;
  const fieldKey    = fieldMeta.key;
  const role        = fieldMeta.role;
  const desc        = fieldMeta.semanticDesc;
  const synonyms    = (fieldMeta.synonyms || '').split(',').map((s) => s.trim()).filter(Boolean);

  return (
    <div
      className="canvas-popup ds-fp-layer nodrag nopan"
      style={{ position: 'absolute', left, top, transform: 'translateY(-50%)', pointerEvents: 'all', zIndex: 200 }}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="canvas-popup-arrow" />
      <header className="canvas-popup-head ds-fp-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="detail-title">{displayName}</div>
          {displayName !== fieldKey && (
            <div className="detail-sub ds-fp-key">{fieldKey}</div>
          )}
        </div>
        <button className="plain-btn canvas-popup-close" onClick={() => setActiveDsField(null)}>×</button>
      </header>
      <div className="canvas-popup-body">
        {role && (
          <div className="ds-fp-pill-row">
            <span className={`ds-field-badge ds-field-badge-${role.toLowerCase()}`}>
              {ROLE_LABEL[role] ?? role}
            </span>
          </div>
        )}
        {synonyms.length > 0 && (
          <div className="ds-fp-synonyms">
            {synonyms.map((s) => <span key={s} className="synonym-tag">{s}</span>)}
          </div>
        )}
        {desc && (
          <section className="sp-section">
            <p className="sp-lbl">Description</p>
            <p className="ds-fp-desc">{desc}</p>
          </section>
        )}
        {!desc && !role && synonyms.length === 0 && (
          <p className="ds-fp-empty">No description added.</p>
        )}
      </div>
      {onNavigateToModel && (
        <div className="join-ro-edit-notice">
          <span />
          <button className="btn btn-sm" onClick={() => onNavigateToModel(activeDsField.nodeId)}>
            Edit in Model
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 5, flexShrink: 0 }} aria-hidden="true">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

function DatasetInspectView({ entities, joins, metrics = [], onAddMetric, onInspectMetric, onEditMetric, onRemoveMetric }) {
  const joinList = Object.values(joins);
  return (
    <div className="ds-inspect-view">
      <div className="insp-flex-row">
        {entities.length > 0 && (
          <div className="insp-section">
            <h3 className="insp-section-hd" style={{ marginTop: 0 }}>Entities &amp; Fields</h3>
            <div className="insp-cards-row">
              {entities.map((entity) => {
                const dimensionFields = entity.fields.filter((f) => f.role !== 'MEASURE');
                const measureFields = entity.fields.filter((f) => f.role === 'MEASURE');
                return (
                  <article className="ent-block" key={entity.id}>
                    <header className="ent-block-hd">
                      <div className="ent-block-name-row">
                        <span className="ent-block-name">
                          {entity.label}
                          {entity.source && <span className="ent-block-db"> ({entity.source})</span>}
                        </span>
                      </div>
                    </header>
                    {dimensionFields.length > 0 && (
                      <section className="field-group">
                        <h4 className="field-group-title dimensions">
                          Dimensions <span className="field-group-count">{dimensionFields.length}</span>
                        </h4>
                        {dimensionFields.map((field) => {
                          const synonymCount = field.synonyms ? field.synonyms.split(',').filter(s => s.trim()).length : 0;
                          return (
                            <div className="ifield ifield-compact" key={field.key} title={field.semanticDesc || undefined}>
                              <span className="ifield-type-chip">{field.type}</span>
                              <span className="ifield-name">{field.displayName || field.label}</span>
                              {field.isKey && <span className="ifield-badge ifield-badge-key">key</span>}
                              {synonymCount > 0 && <span className="ifield-alias-count">{synonymCount} alias{synonymCount !== 1 ? 'es' : ''}</span>}
                            </div>
                          );
                        })}
                      </section>
                    )}
                    {measureFields.length > 0 && (
                      <section className="field-group">
                        <h4 className="field-group-title measures">
                          Measures <span className="field-group-count">{measureFields.length}</span>
                        </h4>
                        {measureFields.map((field) => (
                          <div className="ifield ifield-compact" key={field.key} title={field.semanticDesc || undefined}>
                            <span className="ifield-type-chip">{field.type}</span>
                            <span className="ifield-name">{field.displayName || field.label}</span>
                            {field.calc && <span className="ifield-badge ifield-badge-calc">computed</span>}
                          </div>
                        ))}
                      </section>
                    )}
                    {entity.hiddenCount > 0 && (
                      <div className="ent-block-hidden">{entity.hiddenCount} hidden field{entity.hiddenCount !== 1 ? 's' : ''}</div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {joinList.length > 0 && (
          <div className="insp-section">
            <div className="insp-section-head-row">
              <h3 className="insp-section-hd" style={{ marginTop: 0 }}>Joins</h3>
              <span className="insp-section-sub">SQL execution — how these models are combined at query time</span>
            </div>
            <div className="insp-cards-row">
              {joinList.map((join) => {
                const sqlKeyword = JOIN_MAP[join.type] ?? join.type.replace(/_/g, ' ');
                return (
                  <article className="join-block" key={join.id}>
                    <header className="join-block-hd">
                      <span className="join-name">{join.fromEntity} → {join.toEntity}</span>
                      {join.cardinality && (
                        <span className="join-cardinality-tag">{join.cardinality}</span>
                      )}
                    </header>
                    <div className="join-block-sql-row">
                      <code className="join-sql-kw">{sqlKeyword}</code>
                      <span className="join-sql-on">ON <code className="join-sql-expr">{join.from} = {join.to}</code></span>
                    </div>
                    {join.desc && (
                      <div className="join-row"><p className="join-desc">{join.desc}</p></div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Metrics ── */}
        <div className="insp-section">
          <div className="insp-section-head-row">
            <h3 className="insp-section-hd" style={{ marginTop: 0 }}>Metrics</h3>
            {onAddMetric && (
              <button className="plain-btn ds-metric-add-btn" onClick={onAddMetric}>
                + Add metric
              </button>
            )}
          </div>
          {metrics.length === 0 ? (
            <div className="ds-metrics-empty">
              <p>No metrics defined for this dataset yet.</p>
            </div>
          ) : (
            <div className="insp-cards-row">
              {metrics.map((metric) => (
                <article
                  key={metric.id}
                  className="ds-metric-card"
                  onClick={() => onInspectMetric && onInspectMetric(metric.id)}
                  role={onInspectMetric ? 'button' : undefined}
                  tabIndex={onInspectMetric ? 0 : undefined}
                  onKeyDown={onInspectMetric ? (e) => { if (e.key === 'Enter') onInspectMetric(metric.id); } : undefined}
                >
                  <div className="ds-metric-card-top">
                    <span className="ds-metric-name">{metric.name}</span>
                    <div className="ds-metric-card-top-actions">
                      <span className="ds-metric-agg-badge">{metric.aggregation}</span>
                      {onRemoveMetric && (
                        <button
                          className="plain-btn ds-metric-remove-btn"
                          onClick={(e) => { e.stopPropagation(); onRemoveMetric(metric.id); }}
                          title="Remove from dataset"
                          aria-label="Remove metric from dataset"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                  {metric.description && (
                    <p className="ds-metric-desc">{metric.description}</p>
                  )}
                  {metric.expression && (
                    <code className="ds-metric-expr">{metric.expression}</code>
                  )}
                  {onEditMetric && (
                    <button
                      className="plain-btn ds-metric-edit-btn"
                      onClick={(e) => { e.stopPropagation(); onEditMetric(metric.id); }}
                      title="Edit metric"
                    >
                      Edit
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DatasetCanvasPaneInner({
  dataset, dataModels, metrics = [], isEditing, editDraft, setEditDraft,
  onEdit, onCancel, onSave, onOpenAddModel, onNavigateToModel,
  onAddMetric, onInspectMetric, onEditMetric, onRemoveMetric,
}) {
  const { fitView } = useReactFlow();

  // Active field popover state — shared across all nodes (one at a time)
  const [activeDsField, setActiveDsField] = useState(null); // { nodeId, fieldKey } | null

  // Build entity list from modelIds
  const getEntities = useCallback((draft) => {
    const ids = draft?.modelIds ?? dataset.modelIds ?? [];
    return ids.map((mid) => {
      const dm = dataModels.find((m) => m.id === mid);
      if (!dm) return null;
      const visFields = dm.fields.filter((f) => f.visible !== false);
      return {
        id: dm.id,
        label: dm.name,
        source: dm.sourceName,
        sourceId: dm.sourceId,
        allFields: dm.fields,
        fields: visFields,
        hiddenCount: dm.fields.length - visFields.length,
      };
    }).filter(Boolean);
  }, [dataset.modelIds, dataModels]);

  const activeEntities = isEditing ? getEntities(editDraft) : getEntities(null);

  // Join state — inferred from entity key-field matches; type/keys are editable
  const [joins, setJoins] = useState(() => initJoinsFromEntities(activeEntities));
  const [activeJoin, setActiveJoin] = useState(null);
  const [hoveredJoinType, setHoveredJoinType] = useState(null);

  const updateJoin = useCallback((joinId, key, value) => {
    setJoins((prev) => ({ ...prev, [joinId]: { ...prev[joinId], [key]: value } }));
  }, []);

  // JoinEdge-compatible edges built from joins state
  const rfEdges = useMemo(() =>
    Object.values(joins).map((j) => ({
      id: j.id,
      type: 'join',
      source: j.fromEntityId,
      target: j.toEntityId,
      data: {
        ...j,
        joinType: j.type,
        joinHighlight: JOIN_TYPES.find((t) => t.value === j.type)?.highlight,
        isActive: activeJoin === j.id,
        isReadOnly: !isEditing,
        onEdit,
        onSelect: () => setActiveJoin((prev) => prev === j.id ? null : j.id),
        onUpdateJoin: updateJoin,
        hoveredJoinType,
        setHoveredJoinType,
        onClose: () => setActiveJoin(null),
      },
    })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [joins, activeJoin, hoveredJoinType]);

  // Positions via Dagre — ranks nodes by join graph
  const computePositions = useCallback((entities, joinMap) => {
    if (entities.length === 0) return {};
    const g = new Dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', ranksep: 80, nodesep: 40 });
    g.setDefaultEdgeLabel(() => ({}));
    entities.forEach((e) => {
      const h = ENTITY_HEADER_HEIGHT + e.fields.length * ENTITY_ROW_HEIGHT + ENTITY_FOOTER_HEIGHT;
      g.setNode(e.id, { width: ENTITY_CARD_WIDTH, height: h });
    });
    Object.values(joinMap).forEach((j) => {
      if (g.hasNode(j.fromEntityId) && g.hasNode(j.toEntityId)) {
        g.setEdge(j.fromEntityId, j.toEntityId);
      }
    });
    Dagre.layout(g);
    const pos = {};
    entities.forEach((e) => {
      const node = g.node(e.id);
      if (node) pos[e.id] = { x: node.x - ENTITY_CARD_WIDTH / 2, y: node.y };
    });
    return pos;
  }, []);

  const [positions, setPositions] = useState(() => computePositions(activeEntities, joins));

  // When entity count changes: re-merge joins (preserve edited types), recompute layout
  useEffect(() => {
    const fresh = initJoinsFromEntities(activeEntities);
    setJoins((prev) => {
      const merged = {};
      Object.values(fresh).forEach((j) => {
        merged[j.id] = prev[j.id]
          ? { ...j, type: prev[j.id].type, from: prev[j.id].from, to: prev[j.id].to, desc: prev[j.id].desc }
          : j;
      });
      return merged;
    });
    const newPos = computePositions(activeEntities, fresh);
    setPositions(newPos);
    setTimeout(() => fitView({ padding: 0.18, duration: 300, maxZoom: 1 }), 80);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEntities.length]);

  const datasetMetrics = metrics.filter((m) => m.datasetId === dataset.id);

  const buildNodes = useCallback(() => {
    const entityNodes = activeEntities.map((e) => ({
      id: e.id,
      type: 'dsEntity',
      position: positions[e.id] ?? { x: 100, y: 100 },
      dragHandle: '.ec-hd',
      data: {
        ...e,
        isEditing,
        hiddenCount: e.hiddenCount,
        onViewInModel: () => onNavigateToModel(e.id),
        onRemove: isEditing ? () => {
          setEditDraft((prev) => ({ ...prev, modelIds: (prev.modelIds ?? []).filter((id) => id !== e.id) }));
        } : null,
      },
    }));

    if (datasetMetrics.length > 0) {
      // Position metrics box below the entity row
      const allY = Object.values(positions).map((p) => p.y);
      const allH = activeEntities.map((e) => ENTITY_HEADER_HEIGHT + e.fields.length * ENTITY_ROW_HEIGHT + ENTITY_FOOTER_HEIGHT);
      const maxBottom = allY.length > 0 ? Math.max(...allY.map((y, i) => y + (allH[i] ?? 0))) : 0;
      const metricsY = maxBottom > 0 ? maxBottom + 40 : 100;
      const metricsX = positions[activeEntities[0]?.id]?.x ?? 60;

      entityNodes.push({
        id: '__metrics__',
        type: 'dsMetrics',
        position: positions['__metrics__'] ?? { x: metricsX, y: metricsY },
        dragHandle: '.ec-hd',
        data: {
          metrics: datasetMetrics,
          isEditing,
          onRemove: isEditing ? (id) => onRemoveMetric && onRemoveMetric(id) : null,
          onInspect: (id) => onInspectMetric && onInspectMetric(id),
          onEdit: isEditing ? (id) => onEditMetric && onEditMetric(id) : null,
          onAdd: isEditing ? () => onAddMetric && onAddMetric() : null,
        },
      });
    }

    return entityNodes;
  },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [activeEntities, positions, isEditing, datasetMetrics.length]);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(() => buildNodes());

  useEffect(() => {
    setRfNodes(buildNodes());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEntities.length, isEditing, positions, datasetMetrics.length]);

  const onNodeDragStop = useCallback((_, node) => {
    if (!isEditing) return;
    setPositions((prev) => ({ ...prev, [node.id]: node.position }));
  }, [isEditing]);

  const onInit = useCallback((instance) => {
    instance.fitView({ padding: 0.18, duration: 0, maxZoom: 1 });
  }, []);

  const handleAutoArrange = useCallback(() => {
    const newPos = computePositions(activeEntities, joins);
    setPositions(newPos);
    setTimeout(() => fitView({ padding: 0.18, duration: 300, maxZoom: 1 }), 80);
  }, [computePositions, activeEntities, joins, fitView]);

  const stageBadgeClass = {
    draft: 'badge-draft',
    dev: 'badge-dev',
    development: 'badge-dev',
    testing: 'badge-testing',
    production: 'badge-prod',
  }[dataset.stage] || 'badge-draft';

  const STAGE_OPTIONS = ['draft', 'development', 'testing', 'production'];

  return (
    <div className="ds-canvas-pane">
      {/* Header */}
      <div className="ds-canvas-header">
        {isEditing ? (
          <div className="ds-header-edit-row">
            <input
              className="ds-name-input"
              value={editDraft.name}
              onChange={(e) => setEditDraft((p) => ({ ...p, name: e.target.value }))}
              autoFocus
            />
            <select
              className={`ds-stage-select ds-stage-select-${editDraft.stage ?? 'draft'}`}
              value={editDraft.stage ?? 'draft'}
              onChange={(e) => setEditDraft((p) => ({ ...p, stage: e.target.value }))}
            >
              {STAGE_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="ds-header-title-row">
            <h2 className="dm-title">{dataset.name}</h2>
            <span className={`badge ${stageBadgeClass}`}>{dataset.stage}</span>
          </div>
        )}
        {/* Description */}
        {isEditing ? (
          <textarea
            className="ds-desc-ta-edit"
            value={editDraft.desc ?? ''}
            onChange={(e) => setEditDraft((p) => ({ ...p, desc: e.target.value }))}
            placeholder="Describe this dataset for AI and collaborators…"
          />
        ) : (
          dataset.desc && <p className="dm-desc ds-desc">{dataset.desc}</p>
        )}
      </div>

      {/* Canvas (edit mode) / Inspect view (readonly) */}
      {isEditing ? (
        <>
          <DsActiveFieldContext.Provider value={{ activeDsField, setActiveDsField, activeEntities, positions, onNavigateToModel }}>
          <div className="ds-canvas-body">
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={dsNodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onNodeDragStop={onNodeDragStop}
              onPaneClick={() => { setActiveJoin(null); setActiveDsField(null); }}
              nodesDraggable={isEditing}
              nodesConnectable={false}
              elementsSelectable={true}
              panOnDrag
              zoomOnScroll={false}
              zoomOnPinch={false}
              zoomOnDoubleClick={false}
              preventScrolling={false}
              proOptions={{ hideAttribution: true }}
              onInit={onInit}
              maxZoom={1}
              minZoom={1}
            >
              <Background variant="dots" gap={20} size={1} color="rgba(0,0,0,0.1)" />
            </ReactFlow>
            <DsFieldPopoverLayer />
            <div className="canvas-float-layer" aria-hidden="false">
              <button className="float-btn float-auto-arrange" onClick={handleAutoArrange}>
                Auto arrange
              </button>
            </div>
          </div>
          </DsActiveFieldContext.Provider>
          {activeEntities.length === 0 && (
            <div className="ds-canvas-empty">
              <div className="empty-state empty-state-canvas">
                <div className="empty-state-icon">
                  <svg width="44" height="44" viewBox="0 0 48 48" fill="none" aria-hidden="true">
                    <rect x="4" y="14" width="18" height="20" rx="3" stroke="currentColor" strokeWidth="2" fill="none"/>
                    <rect x="26" y="14" width="18" height="20" rx="3" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="3 2"/>
                    <line x1="22" y1="24" x2="26" y2="24" stroke="currentColor" strokeWidth="2" strokeDasharray="2 2"/>
                    <line x1="8" y1="22" x2="18" y2="22" stroke="currentColor" strokeWidth="1.5" opacity="0.4"/>
                    <line x1="8" y1="26" x2="14" y2="26" stroke="currentColor" strokeWidth="1.5" opacity="0.4"/>
                    <circle cx="38" cy="38" r="8" fill="var(--bg)" stroke="currentColor" strokeWidth="2"/>
                    <line x1="35" y1="38" x2="41" y2="38" stroke="currentColor" strokeWidth="2"/>
                    <line x1="38" y1="35" x2="38" y2="41" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                </div>
                <h3 className="empty-state-title">Add your first Data Model</h3>
                <p className="empty-state-desc">Start by adding a Data Model to this dataset. You can then define joins between models to build a queryable structure.</p>
              </div>
            </div>
          )}
        </>
      ) : activeEntities.length === 0 ? (
        <div className="ds-canvas-empty">
          <div className="empty-state empty-state-canvas">
            <div className="empty-state-icon">
              <svg width="44" height="44" viewBox="0 0 48 48" fill="none" aria-hidden="true">
                <rect x="4" y="14" width="18" height="20" rx="3" stroke="currentColor" strokeWidth="2" fill="none"/>
                <rect x="26" y="14" width="18" height="20" rx="3" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="3 2"/>
                <line x1="22" y1="24" x2="26" y2="24" stroke="currentColor" strokeWidth="2" strokeDasharray="2 2"/>
                <line x1="8" y1="22" x2="18" y2="22" stroke="currentColor" strokeWidth="1.5" opacity="0.4"/>
                <line x1="8" y1="26" x2="14" y2="26" stroke="currentColor" strokeWidth="1.5" opacity="0.4"/>
              </svg>
            </div>
            <h3 className="empty-state-title">No Data Models configured</h3>
            <p className="empty-state-desc">This dataset doesn't have any Data Models yet. Switch to Edit mode to add models and configure how they join.</p>
          </div>
        </div>
      ) : (
        <DatasetInspectView
          entities={activeEntities}
          joins={joins}
          metrics={metrics.filter((m) => m.datasetId === dataset.id)}
          onAddMetric={isEditing ? onAddMetric : undefined}
          onInspectMetric={onInspectMetric}
          onEditMetric={isEditing ? onEditMetric : undefined}
          onRemoveMetric={isEditing ? onRemoveMetric : undefined}
        />
      )}

      {/* Preview panel */}
      {activeEntities.length > 0 && (() => {
        const previewFields = activeEntities.flatMap((e) =>
          e.fields.map((f) => ({ entity: e.id, key: f.key, label: f.label, type: f.type }))
        );
        const nullCount = PREVIEW_ROWS.filter((r) =>
          previewFields.some((f) => r[f.key] === null)
        ).length;
        return (
          <section className="prev-panel ds-prev-panel">
            <header className="prev-hd">
              <div className="prev-title">Preview · {PREVIEW_ROWS.length} rows</div>
              {nullCount > 0 && (
                <span className="badge badge-warn">{nullCount} row{nullCount !== 1 ? 's' : ''} with nulls</span>
              )}
            </header>
            <div className="prev-scroll">
              <table className="ptab">
                <thead>
                  <tr>
                    {previewFields.map((f) => (
                      <th key={`${f.entity}-${f.key}`} className={['#','$','fx'].includes(f.type) ? 'col-num' : ''}>
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PREVIEW_ROWS.map((row, ri) => (
                    <tr key={ri}>
                      {previewFields.map((f) => (
                        <td key={`${ri}-${f.entity}-${f.key}`} className={['#','$','fx'].includes(f.type) ? 'col-num' : ''}>
                          {row[f.key] === null
                            ? <span className="null-val">null</span>
                            : row[f.key] !== undefined ? row[f.key] : <span className="null-val">—</span>
                          }
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })()}
    </div>
  );
}

// Simple entity card for the dataset canvas
const ROLE_LABEL = { ID: 'Primary Key', DIMENSION: 'Dimension', MEASURE: 'Measure' };

function DsEntityCardNode({ id, data }) {
  const { label, source, sourceId, fields, allFields, hiddenCount, isEditing, onViewInModel, onRemove } = data;
  const [popoverOpen, setPopoverOpen] = useState(false);

  const ctx = useContext(DsActiveFieldContext);
  const activeFieldKey = ctx?.activeDsField?.nodeId === id ? ctx.activeDsField.fieldKey : null;

  const hiddenFields = allFields
    ? allFields.filter((f) => f.visible === false || !fields.some((vf) => vf.key === f.key))
    : [];

  const handleNavigate = (e) => {
    e.stopPropagation();
    onViewInModel();
  };

  return (
    <article className={`ecard ds-ecard${isEditing ? '' : ' ds-ecard-readonly'}`}>
      <Handle type="source" position={Position.Right} id={`${id}-src`} className="entity-handle" />
      <Handle type="target" position={Position.Left} id={`${id}-tgt`} className="entity-handle" />
      <header className="ec-hd draggable">
        <span className="ec-name">{label}</span>
        {isEditing && onRemove && (
          <button className="plain-btn ds-ecard-remove" onClick={onRemove} aria-label="Remove model" title="Remove from dataset">✕</button>
        )}
        <span className="ec-src" style={{ color: sourceBrandColor(sourceId) }}>{source}</span>
      </header>
      <div className="ec-fields">
        {fields.map((field) => (
          <div
            key={field.key}
            className={`frow ds-frow${activeFieldKey === field.key ? ' ds-frow-active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!ctx) return;
              ctx.setActiveDsField((prev) =>
                prev?.nodeId === id && prev?.fieldKey === field.key
                  ? null
                  : { nodeId: id, fieldKey: field.key }
              );
            }}
          >
            <span className={`ftype ${field.isKey ? 'key' : ''} ${field.calc ? 'calc' : ''}`}>{field.type}</span>
            <span className="fname">{field.label}</span>
          </div>
        ))}
      </div>
      {hiddenCount > 0 && (
        <footer
          className="ds-hidden-footer"
          onMouseEnter={() => setPopoverOpen(true)}
          onMouseLeave={() => setPopoverOpen(false)}
        >
          {popoverOpen && (
            <div className="ds-hidden-popover">
              <div className="ds-hidden-popover-title">Hidden fields</div>
              {hiddenFields.map((f) => (
                <div key={f.key} className="ds-hidden-popover-field">
                  <span className={`ftype ${f.isKey ? 'key' : ''} ${f.calc ? 'calc' : ''}`}>{f.type}</span>
                  <span>{f.label}</span>
                </div>
              ))}
            </div>
          )}
          <span className="ds-hidden-trigger nodrag nopan">
            {/* eye-slash icon */}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
            <span className="ds-hidden-label">{hiddenCount} hidden field{hiddenCount !== 1 ? 's' : ''}</span>
          </span>
          <button
            className="plain-btn ds-hidden-nav-btn nodrag nopan"
            onClick={handleNavigate}
            title="View in Data Model"
            aria-label="View in Data Model"
          >
            {/* external-link / arrow-right icon */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </button>
        </footer>
      )}
    </article>
  );
}

const dsNodeTypes = { dsEntity: DsEntityCardNode, dsMetrics: DsMetricsBoxNode };

function DsMetricsBoxNode({ data }) {
  const { metrics, isEditing, onRemove, onInspect } = data;
  return (
    <article className="ds-metrics-box">
      <header className="ds-metrics-box-hd ec-hd">
        <span className="ec-name">Metrics</span>
        <span className="ds-metrics-box-count">{metrics.length}</span>
      </header>
      <div className="ds-metrics-box-rows">
        {metrics.map((m) => (
          <div key={m.id} className="ds-metrics-box-row nodrag nopan">
            <button
              className="plain-btn ds-metrics-box-name"
              onClick={() => onInspect && onInspect(m.id)}
              title={m.expression || m.name}
            >
              {m.name}
            </button>
            <span className="ds-metric-agg-badge">{m.aggregation}</span>
            {isEditing && onRemove && (
              <button
                className="plain-btn ds-metrics-box-remove-btn nodrag nopan"
                onClick={() => onRemove(m.id)}
                title="Remove from dataset"
                aria-label="Remove metric"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {isEditing && (
          <button
            className="plain-btn ds-metrics-box-add-btn nodrag nopan"
            onClick={() => data.onAdd && data.onAdd()}
          >
            + Add metric
          </button>
        )}
      </div>
    </article>
  );
}

function DatasetCanvasPane(props) {
  return (
    <ReactFlowProvider>
      <DatasetCanvasPaneInner {...props} />
    </ReactFlowProvider>
  );
}

// ── Add Data Models modal ─────────────────────────────────────────────────
function AddModelModal({ open, onClose, dataModels, currentModelIds, onAdd }) {
  const [search, setSearch] = useState('');
  const [checked, setChecked] = useState(new Set());

  // Reset on open
  useEffect(() => { if (open) { setSearch(''); setChecked(new Set()); } }, [open]);

  const available = dataModels.filter(
    (m) => !currentModelIds.includes(m.id) &&
      (!search.trim() || m.name.toLowerCase().includes(search.trim().toLowerCase()))
  );

  const toggle = (id) => setChecked((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  if (!open) return null;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Viewport className="dialog-viewport">
          <Dialog.Popup className="dialog-popup add-model-modal">
            <Dialog.Title className="dialog-title">Add Data Models</Dialog.Title>

          <div className="add-model-search-wrap">
            <input
              className="add-model-search"
              placeholder="Search Data Models…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div className="add-model-list">
            {available.length === 0 && (
              <div className="add-model-empty">
                {search ? 'No matching Data Models.' : 'All Data Models are already in this dataset.'}
              </div>
            )}
            {available.map((m) => (
              <label key={m.id} className="add-model-row">
                <input
                  type="checkbox"
                  checked={checked.has(m.id)}
                  onChange={() => toggle(m.id)}
                  className="add-model-check"
                />
                <div className="add-model-row-info">
                  <span className="add-model-row-name">{m.name}</span>
                  <span className="add-model-row-source" style={{ color: sourceBrandColor(m.sourceId) }}>{m.sourceName}</span>
                </div>
              </label>
            ))}
          </div>

          <div className="add-model-footer">
            <button className="btn" onClick={() => setChecked(new Set())} disabled={checked.size === 0}>Clear</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={checked.size === 0}
                onClick={() => { onAdd([...checked]); onClose(); }}
              >
                Add selected ({checked.size})
              </button>
            </div>
          </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const OBJ_TYPE_LABELS = {
  models: 'Models',
  datasets: 'Datasets',
  metrics: 'Metrics',
};
const OBJ_TYPE_DESCS = {
  models: 'Semantic definitions of a single entity — fields, grain, and business meaning.',
  datasets: 'Join configurations combining multiple Data Models into a queryable structure.',
  metrics: 'Business-defined KPIs and calculated outcomes built on top of datasets.',
};

function CatalogLeftPane({
  objectType, setObjectType, catalogSearch, setCatalogSearch,
  selectedObjectId, selectedObjectType, onSelectItem,
  dataModels, setDataModels, datasets, setDatasets, metrics,
  isEditing, onOpenEditor, onEditModel, onEditDataset,
}) {
  const allDatasets = [...datasets.draft, ...datasets.dev, ...datasets.production];
  const q = catalogSearch.trim().toLowerCase();

  const filteredModels  = dataModels.filter((m) => !q || m.name.toLowerCase().includes(q));
  const filteredDatasets = allDatasets.filter((d) => !q || d.name.toLowerCase().includes(q));
  const filteredMetrics  = metrics.filter((m) => !q || m.name.toLowerCase().includes(q));

  const counts = { models: dataModels.length, datasets: allDatasets.length, metrics: metrics.length };

  const handleAddNew = (type) => {
    if (type === 'model') {
      const id = `model-${Date.now()}`;
      const stub = { id, name: 'New Data Model', sourceId: 'sales-db', sourceName: 'Sales DB', description: '', grain: '', usedInDatasetIds: [], fields: [] };
      setDataModels((prev) => [...prev, stub]);
      setObjectType('models');
      onSelectItem(id, 'models');
    } else if (type === 'dataset') {
      const id = `dataset-${Date.now()}`;
      const stub = { id, name: 'New Dataset', desc: '', entities: 0, joins: 0, uses: 0, stage: 'draft', progress: 0, modelIds: [] };
      setDatasets((prev) => ({ ...prev, draft: [...prev.draft, stub] }));
      setObjectType('datasets');
      onSelectItem(id, 'datasets');
    } else if (type === 'metric') {
      setObjectType('metrics');
    }
  };

  return (
    <div className="cat-left-pane">
      {/* Search + Add row */}
      <div className="cat-left-top">
        <div className="cat-left-search-wrap">
          <svg className="cat-search-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          <input
            className="cat-left-search"
            placeholder="Find…"
            value={catalogSearch}
            onChange={(e) => setCatalogSearch(e.target.value)}
          />
        </div>
        <Menu.Root>
          <Menu.Trigger className="btn cat-add-btn">Add ▾</Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner sideOffset={4} align="end">
              <Menu.Popup className="menu-popup">
                <Menu.Item className="menu-item" onClick={() => handleAddNew('model')}>New Data Model</Menu.Item>
                <Menu.Item className="menu-item" onClick={() => handleAddNew('dataset')}>New Dataset</Menu.Item>
                <Menu.Item className="menu-item" onClick={() => handleAddNew('metric')}>New Metric</Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>

      {/* Type tab switcher */}
      <div className="obj-type-tabs" role="tablist">
        {['models', 'datasets', 'metrics'].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={objectType === t}
            className={`obj-type-tab ${objectType === t ? 'active' : ''}`}
            onClick={() => setObjectType(t)}
          >
            {OBJ_TYPE_LABELS[t]} <span className="obj-type-count">{counts[t]}</span>
          </button>
        ))}
      </div>

      {/* Description */}
      <p className="obj-type-desc">{OBJ_TYPE_DESCS[objectType]}</p>

      {/* List */}
      <div className="cat-left-list">
        {objectType === 'models' && filteredModels.map((model) => (
          <ModelListItem
            key={model.id}
            model={model}
            selected={selectedObjectType === 'models' && selectedObjectId === model.id}
            onClick={() => onSelectItem(model.id, 'models')}
            onDelete={() => setDataModels((prev) => prev.filter((m) => m.id !== model.id))}
            onEdit={() => onEditModel(model.id)}
          />
        ))}
        {objectType === 'datasets' && filteredDatasets.map((ds) => (
          <DatasetListItem
            key={ds.id}
            dataset={ds}
            selected={selectedObjectType === 'datasets' && selectedObjectId === ds.id}
            onClick={() => onSelectItem(ds.id, 'datasets')}
            onEdit={() => onEditDataset(ds.id)}
            onDelete={() => setDatasets((prev) => ({
              draft: prev.draft.filter((d) => d.id !== ds.id),
              dev: prev.dev.filter((d) => d.id !== ds.id),
              production: prev.production.filter((d) => d.id !== ds.id),
            }))}
          />
        ))}
        {objectType === 'metrics' && filteredMetrics.map((m) => (
          <MetricListItem
            key={m.id}
            metric={m}
            selected={selectedObjectType === 'metrics' && selectedObjectId === m.id}
            onClick={() => onSelectItem(m.id, 'metrics')}
          />
        ))}
      </div>
    </div>
  );
}

// ── List item: Data Model ────────────────────────────────────────────────────
function ModelListItem({ model, selected, onClick, onDelete, onEdit }) {
  const used = model.usedInDatasetIds.length > 0;
  const visibleCount = model.fields.filter((f) => f.visible !== false).length;
  const totalCount = model.fields.length;

  return (
    <div
      className={`obj-list-item ${selected ? 'selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
    >
      <div className="obj-list-main">
        <div className="obj-list-name-row">
          <span className="obj-list-name">{model.name}</span>
        </div>
        <div className="obj-list-source" style={{ color: sourceBrandColor(model.sourceId) }}>{model.sourceName}</div>
      </div>
      <div className="obj-list-right">
        <TooltipPrimitive.Provider delayDuration={300}>
          <TooltipPrimitive.Root>
            <TooltipPrimitive.Trigger asChild>
              <span className={`obj-list-dot ${used ? 'used' : ''}`} aria-label={used ? 'Used in datasets' : 'Not used'} />
            </TooltipPrimitive.Trigger>
            <TooltipPrimitive.Portal>
              <TooltipPrimitive.Content className="obj-tooltip" sideOffset={5}>
                {used
                  ? `Used in: ${model.usedInDatasetIds.join(', ')}`
                  : 'Not used in any dataset yet.'}
                <TooltipPrimitive.Arrow className="obj-tooltip-arrow" />
              </TooltipPrimitive.Content>
            </TooltipPrimitive.Portal>
          </TooltipPrimitive.Root>
        </TooltipPrimitive.Provider>
        <span className="obj-list-fields">{visibleCount} of {totalCount} fields</span>
      </div>
      <Menu.Root>
        <Menu.Trigger className="plain-btn obj-list-menu" onClick={(e) => e.stopPropagation()} aria-label="Model options">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="7" cy="2.5" r="1.25" fill="currentColor"/>
            <circle cx="7" cy="7" r="1.25" fill="currentColor"/>
            <circle cx="7" cy="11.5" r="1.25" fill="currentColor"/>
          </svg>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner>
            <Menu.Popup className="menu-popup" side="top" align="end" sideOffset={6}>
              <Menu.Item className="menu-item" onClick={(e) => { e.stopPropagation(); onEdit(); }}>Edit</Menu.Item>
              <Menu.Item className="menu-item danger" onClick={(e) => { e.stopPropagation(); onDelete(); }}>Delete</Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

// ── List item: Dataset ───────────────────────────────────────────────────────
function DatasetListItem({ dataset, selected, onClick, onEdit, onDelete }) {
  const usageScore = usageScoreFromCount(dataset.uses);
  return (
    <div
      className={`obj-list-item ${selected ? 'selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
    >
      <div className="obj-list-main">
        <div className="obj-list-name-row">
          <span className="obj-list-name">{dataset.name}</span>
        </div>
        <div className="obj-list-meta">{dataset.entities} Entities · {dataset.joins} Joins</div>
      </div>
      <div className="obj-list-right">
        <span className="mcard-usage" aria-label={`Usage score ${usageScore} of 5`}>
          <span className="mcard-usage-dots" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className={`mcard-usage-dot ${i < usageScore ? 'is-filled' : ''}`} />
            ))}
          </span>
          <span className="mcard-uses">{dataset.uses}</span>
        </span>
      </div>
      <Menu.Root>
        <Menu.Trigger className="plain-btn obj-list-menu" onClick={(e) => e.stopPropagation()} aria-label="Dataset options">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="7" cy="2.5" r="1.25" fill="currentColor"/>
            <circle cx="7" cy="7" r="1.25" fill="currentColor"/>
            <circle cx="7" cy="11.5" r="1.25" fill="currentColor"/>
          </svg>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner>
            <Menu.Popup className="menu-popup" side="top" align="end" sideOffset={6}>
              <Menu.Item className="menu-item" onClick={(e) => { e.stopPropagation(); onEdit(); }}>Edit</Menu.Item>
              <Menu.Item className="menu-item danger" onClick={(e) => { e.stopPropagation(); onDelete(); }}>Delete</Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

// ── List item: Metric ────────────────────────────────────────────────────────
function MetricListItem({ metric, selected, onClick }) {
  return (
    <div
      className={`obj-list-item ${selected ? 'selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
    >
      <div className="obj-list-main">
        <span className="obj-list-name">{metric.name}</span>
        <div className="obj-list-meta">{metric.aggregation} · {metric.datasetId}</div>
      </div>
      <span className={`badge badge-neutral`}>{metric.aggregation}</span>
    </div>
  );
}

// ── Data Model detail pane ───────────────────────────────────────────────────
function DataModelDetail({ model, isEditing, editDraft, setIsEditing, setEditDraft, onSave, onCancel, inPane = false, onRequestStableKeyUnlock }) {
  const [fieldSearch, setFieldSearch] = useState('');
  const [calcModalOpen, setCalcModalOpen] = useState(false);
  const [calcEditTarget, setCalcEditTarget] = useState(null); // field being edited
  const [stableKeyUnlocked, setStableKeyUnlocked] = useState(false);
  if (!model) return null;

  const active = isEditing ? editDraft : model;
  const visibleCount = active.fields.filter((f) => f.visible !== false).length;

  const q = fieldSearch.trim().toLowerCase();
  const dimensionFields = active.fields.filter((f) => f.role !== 'MEASURE' && (!q || f.key.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)));
  const measureFields   = active.fields.filter((f) => f.role === 'MEASURE'  && (!q || f.key.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)));

  const handleEdit = () => {
    setEditDraft(JSON.parse(JSON.stringify(model)));
    setIsEditing(true);
  };

  const updateDraftField = (fieldKey, prop, value) => {
    setEditDraft((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => f.key === fieldKey ? { ...f, [prop]: value } : f),
    }));
  };

  const toggleFieldVisible = (fieldKey) => {
    if (isEditing) {
      updateDraftField(fieldKey, 'visible', !(editDraft.fields.find((f) => f.key === fieldKey)?.visible ?? true));
    }
  };

  return (
    <div className="dm-detail">
      {/* Header — hidden when rendered inside EditPane (which provides its own header) */}
      {!inPane && (
        <div className="dm-header">
          <div className="dm-header-left">
            <div className="dm-title-row">
              {isEditing ? (
                <input
                  className="dm-name-input"
                  value={editDraft.name}
                  onChange={(e) => setEditDraft((p) => ({ ...p, name: e.target.value }))}
                  autoFocus
                />
              ) : (
                <h2 className="dm-title">{model.name}</h2>
              )}
              {/* Stable key inline with title */}
              <span className="dm-stable-key-row">
                <span className="dm-stable-key-icon" title="Stable key">🔑</span>
                {isEditing ? (
                  <>
                    <input
                      className="dm-sk-input dm-sk-header"
                      value={editDraft.stableKey || autoStableKey(editDraft)}
                      readOnly={!stableKeyUnlocked}
                      onChange={(e) => setEditDraft((p) => ({ ...p, stableKey: e.target.value }))}
                      spellCheck={false}
                    />
                    <button
                      className="plain-btn dm-sk-lock-btn"
                      title={stableKeyUnlocked ? 'Lock key' : 'Unlock to edit'}
                      onClick={() => {
                        if (!stableKeyUnlocked) {
                          onRequestStableKeyUnlock?.(() => setStableKeyUnlocked(true));
                        } else {
                          setStableKeyUnlocked(false);
                        }
                      }}
                    >
                      {stableKeyUnlocked ? '🔓' : '🔒'}
                    </button>
                  </>
                ) : (
                  <span className="dm-stable-key-val">{model.stableKey || autoStableKey(model)} <span className="dm-sk-lock">🔒</span></span>
                )}
              </span>
            </div>
            <span className="dm-source-label" style={{ color: sourceBrandColor(model.sourceId) }}>{model.sourceName}</span>
          </div>
          <div className="dm-header-actions">
            {isEditing ? (
              <>
                <button className="btn" onClick={onCancel}>Cancel</button>
                <button className="btn btn-primary" onClick={() => onSave(editDraft)}>Save</button>
              </>
            ) : (
              <button className="btn" onClick={handleEdit}>Edit</button>
            )}
          </div>
        </div>
      )}


      {/* Model meta grid: Description (50%), Row represents (25%), Stable key (25%) */}
      <div className="dm-model-meta-grid">
        {/* Description */}
        <div className="dm-section dm-meta-desc">
          <span className="dm-lbl">Description</span>
          {isEditing ? (
            <textarea
              className="dm-desc-ta"
              value={editDraft.description}
              onChange={(e) => setEditDraft((p) => ({ ...p, description: e.target.value }))}
              placeholder="Describe this model for AI and collaborators…"
            />
          ) : (
            <p className="dm-desc" style={{ margin: 0 }}>{model.description}</p>
          )}
        </div>
        {/* Row represents (grain) */}
        <div className="dm-section dm-meta-grain">
          <span className="dm-section-lbl" data-tooltip="What does one row in this model mean?">Row represents</span>
          {isEditing ? (
            <input
              className="dm-grain-input"
              value={editDraft.grain || ''}
              onChange={(e) => setEditDraft((p) => ({ ...p, grain: e.target.value }))}
              placeholder="e.g. One row per order line item"
            />
          ) : (
            <span className="dm-grain-val">{active.grain || <span className="dm-grain-empty">Not set</span>}</span>
          )}
        </div>

      </div>

      {/* Fields section header */}
      <div className="dm-fields-header">
        <span className="dm-fields-title">Visible fields <span className="dm-fields-count">({visibleCount} of {active.fields.length})</span></span>
        <div className="dm-fields-actions">
          {isEditing && (
            <button className="plain-btn dm-add-calc-btn" onClick={() => setCalcModalOpen(true)}>
              <span className="dm-add-calc-icon">fx</span>
              Add calculated field
            </button>
          )}
          <input
            className="dm-field-search"
            placeholder="Search fields…"
            value={fieldSearch}
            onChange={(e) => setFieldSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Fields table */}
      <table className="dm-fields-table">
        <thead>
          <tr>
            <th className="dm-th dm-th-vis">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </th>
            <th className="dm-th dm-th-field">Field</th>
            <th className="dm-th dm-th-display">Display name</th>
            <th className="dm-th dm-th-role">Role</th>
            <th className="dm-th dm-th-synonyms">Synonyms</th>
            <th className="dm-th dm-th-desc">Description</th>
            <th className="dm-th dm-th-opts">
              <button className="plain-btn dm-col-opts" aria-label="Column options">⋯</button>
            </th>
          </tr>
        </thead>
        <tbody>
          {[...dimensionFields, ...measureFields].map((field) => (
            <DataModelFieldRow
              key={field.key}
              field={field}
              isEditing={isEditing}
              onToggleVisible={() => toggleFieldVisible(field.key)}
              onUpdateField={(prop, val) => updateDraftField(field.key, prop, val)}
              onEditCalcField={field.calc ? () => { setCalcEditTarget(field); setCalcModalOpen(true); } : undefined}
            />
          ))}
        </tbody>
      </table>

      <CalcFieldModal
        isOpen={calcModalOpen}
        onClose={() => { setCalcModalOpen(false); setCalcEditTarget(null); }}
        availableFields={active.fields}
        editField={calcEditTarget}
        onSave={({ name, formula, agg }) => {
          if (calcEditTarget) {
            // Update existing calc field
            updateDraftField(calcEditTarget.key, 'label', name);
            updateDraftField(calcEditTarget.key, 'formula', formula);
            updateDraftField(calcEditTarget.key, 'agg', agg);
          } else {
            const newField = {
              key: name.toLowerCase().replace(/\s+/g, '_'),
              label: name,
              type: 'fx',
              role: 'MEASURE',
              visible: true,
              calc: true,
              formula,
              agg,
              semanticDesc: '',
              synonyms: '',
            };
            setEditDraft((prev) => ({ ...prev, fields: [...prev.fields, newField] }));
          }
          setCalcModalOpen(false);
          setCalcEditTarget(null);
        }}
      />

      {/* Semantic Relationships — FK fields that link to other entities */}
      {(() => {
        const fkFields = active.fields.filter(
          (f) => !f.isKey && f.role === 'DIMENSION' && f.key.endsWith('_id')
        );
        if (fkFields.length === 0) return null;
        return (
          <div className="dm-rel-section">
            <div className="dm-rel-header">
              <span className="dm-fields-title">Relationships</span>
              <span className="dm-rel-subtitle">Semantic links to other entities via foreign key fields</span>
            </div>
            <div className="dm-rel-list">
              {fkFields.map((field) => {
                const refEntityId = field.key.replace(/_id$/, '');
                const refEntityLabel = refEntityId
                  .split('_')
                  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                  .join(' ');
                return (
                  <div className="dm-rel-item" key={field.key}>
                    <div className="dm-rel-row">
                      <div className="dm-rel-side">
                        <span className="dm-rel-entity-name">{active.name}</span>
                        <code className="dm-rel-field">{field.key}</code>
                      </div>
                      <span className="dm-rel-arrow" aria-hidden="true">→</span>
                      <div className="dm-rel-side">
                        <span className="dm-rel-entity-name">{refEntityLabel}</span>
                        <code className="dm-rel-field">{refEntityId}_id</code>
                      </div>
                    </div>
                    <span className="dm-rel-cardinality">many : 1</span>
                    {field.semanticDesc && (
                      <p className="dm-rel-desc">{field.semanticDesc}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function DataModelFieldRow({ field, isEditing, onToggleVisible, onUpdateField, onEditCalcField }) {
  const isVisible = field.visible !== false;
  const autoName = autoDisplayName(field.key);
  const displayName = field.displayName || '';
  const isAutoName = !displayName || displayName === autoName;
  const [formulaPopoverOpen, setFormulaPopoverOpen] = useState(false);

  return (
    <tr className={`dm-field-row ${!isVisible ? 'dm-row-hidden' : ''}`}>
      <td className="dm-td dm-td-vis">
        <div className="dm-vis-cell">
          <Switch.Root
            className="dm-vis-switch"
            checked={isVisible}
            onCheckedChange={onToggleVisible}
            disabled={!isEditing}
            aria-label={`${isVisible ? 'Hide' : 'Show'} ${field.label}`}
          >
            <Switch.Thumb className="dm-vis-switch-thumb" />
          </Switch.Root>
          <svg className="dm-vis-eye" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </div>
      </td>
      <td className="dm-td dm-td-field">
        <span className={`ftype ${field.isKey ? 'key' : ''} ${field.calc ? 'calc' : ''}`}>{field.type}</span>
        <span className="dm-field-name">{field.label}</span>
      </td>
      <td className="dm-td dm-td-display">
        {isEditing ? (
          <input
            className="dm-cell-input"
            value={displayName}
            placeholder={autoName}
            onChange={(e) => onUpdateField('displayName', e.target.value)}
          />
        ) : (
          <span className={isAutoName ? 'dm-auto-name' : 'dm-custom-name'}>
            {displayName || autoName}
          </span>
        )}
      </td>
      <td className="dm-td dm-td-role">
        {isEditing ? (
          <Select.Root
            value={field.role}
            onValueChange={(v) => onUpdateField('role', v)}
            items={['ID', 'DIMENSION', 'MEASURE']}
          >
            <Select.Trigger className="bu-trigger dm-role-trigger">
              <Select.Value />
              <Select.Icon className="bu-icon">▾</Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Positioner>
                <Select.Popup className="bu-popup">
                  <Select.List>
                    {['ID', 'DIMENSION', 'MEASURE'].map((r) => (
                      <Select.Item key={r} value={r} className="bu-item">
                        <Select.ItemText>{r}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.List>
                </Select.Popup>
              </Select.Positioner>
            </Select.Portal>
          </Select.Root>
        ) : (
          <span className={`dm-role-label dm-role-${field.role?.toLowerCase()}`}>{field.role}</span>
        )}
      </td>
      <td className="dm-td dm-td-synonyms">
        {isEditing ? (
          <input
            className="dm-cell-input"
            value={field.synonyms || ''}
            placeholder="e.g. revenue, GMV"
            onChange={(e) => onUpdateField('synonyms', e.target.value)}
          />
        ) : (
          <div className="dm-synonym-pills">
            <PillList
              items={(field.synonyms || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => ({ id: s, label: s }))}
              pillClass="synonym-tag"
              moreClass="synonym-tag synonym-tag-more"
              containerClass="dm-synonym-pills"
            />
          </div>
        )}
      </td>
      <td className="dm-td dm-td-desc">
        {isEditing ? (
          <input
            className="dm-cell-input"
            value={field.semanticDesc || ''}
            placeholder="Add a description…"
            onChange={(e) => onUpdateField('semanticDesc', e.target.value)}
          />
        ) : (
          <span className="dm-desc-cell" title={field.semanticDesc}>{field.semanticDesc}</span>
        )}
      </td>
      <td className="dm-td dm-td-opts">
        {field.calc && isEditing && onEditCalcField && (
          <button
            className="plain-btn dm-edit-calc-btn"
            onClick={onEditCalcField}
            title="Edit formula"
            aria-label={`Edit formula for ${field.label}`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        )}
        {field.calc && !isEditing && field.formula && (
          <div
            className="dm-formula-popover-wrap"
            onMouseEnter={() => setFormulaPopoverOpen(true)}
            onMouseLeave={() => setFormulaPopoverOpen(false)}
          >
            <button className="plain-btn dm-formula-peek-btn" aria-label="View formula">
              <span className="dm-formula-peek-icon">fx</span>
            </button>
            {formulaPopoverOpen && (
              <div className="dm-formula-popover">
                <div className="dm-formula-popover-label">Formula</div>
                <code className="dm-formula-popover-code">{field.formula}</code>
                {field.agg && <div className="dm-formula-popover-agg">Aggregation: <strong>{field.agg}</strong></div>}
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

// ── Stable key helper ─────────────────────────────────────────────────────────
function slugify(str) {
  return (str || '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 64);
}
function autoStableKey(model) {
  return slugify(model.sourceName || '') + '_' + slugify(model.name || '');
}

// ── Nav dataset combo (trigger + filterable dropdown) ────────────────────────
function DatasetCombo({ datasets, selectedObjectId, onChange }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const ref = useRef(null);

  const allDatasets = [...datasets.draft, ...datasets.dev, ...datasets.production];
  const selected = allDatasets.find((d) => d.id === selectedObjectId);
  const filtered = filter.trim()
    ? allDatasets.filter((d) => d.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : allDatasets;

  const stageCls = (stage) => stage === 'production' ? 'prod' : stage === 'dev' ? 'dev' : 'draft';

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setFilter('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = (id) => {
    onChange(id);
    setOpen(false);
    setFilter('');
  };

  return (
    <div className="nav-ds-combo" ref={ref}>
      <button
        className={`nav-ds-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="nav-ds-trigger-name">{selected ? selected.name : 'Select a dataset…'}</span>
        {selected && (
          <span className={`nav-ds-trigger-badge badge badge-${stageCls(selected.stage)}`}>
            {selected.stage}
          </span>
        )}
        <svg className="nav-ds-trigger-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="nav-ds-dropdown" role="listbox">
          <div className="nav-ds-search-wrap">
            <input
              className="nav-ds-search"
              placeholder="Filter datasets…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />
          </div>
          <div className="nav-ds-list">
            {filtered.length === 0 && (
              <div className="nav-ds-empty">No matches</div>
            )}
            {filtered.map((ds) => (
              <button
                key={ds.id}
                className={`nav-ds-option${ds.id === selectedObjectId ? ' selected' : ''}`}
                onClick={() => handleSelect(ds.id)}
                role="option"
                aria-selected={ds.id === selectedObjectId}
              >
                <span className="nav-ds-option-name">{ds.name}</span>
                <span className={`nav-ds-option-badge badge badge-${stageCls(ds.stage)}`}>{ds.stage}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const [view, setView] = useState('home');
  // eslint-disable-next-line no-unused-vars
  const [search] = useState('');
  // eslint-disable-next-line no-unused-vars
  const [stage, setStage] = useState('dev');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightMode, setRightMode] = useState('sql');
  const [activeJoin, setActiveJoin] = useState(null);
  const [activeField, setActiveField] = useState(null);
  const [fieldDescriptions, setFieldDescriptions] = useState(() =>
    Object.fromEntries(
      DATA_MODELS_INITIAL.flatMap((m) => m.fields.filter((f) => f.semanticDesc).map((f) => [f.key, f.semanticDesc]))
    )
  );
  const [fieldDisplayNames, setFieldDisplayNames] = useState({});
  const [fieldFormulas, setFieldFormulas] = useState({ revenue_net: 'amount - unit_cost' });
  const [addCalcFieldEntityId, setAddCalcFieldEntityId] = useState(null);
  const [hiddenFields, setHiddenFields] = useState(new Set());
  const [aiOpen, setAiOpen] = useState(false);
  const [inspectView, setInspectView] = useState('visual');
  const [hoveredJoinType, setHoveredJoinType] = useState(null);
  const [joins, setJoins] = useState({
    jp1: { id: 'jp1', type: 'LEFT', fromEntity: 'orders', toEntity: 'customers', from: 'orders.customer_id', to: 'customers.customer_id', cardinality: 'many-to-one', semantics: 'Many-to-one · Optional relationship (Orders → Customer)', desc: 'Connects sales to customer profiles. Preservation: All orders are kept regardless of customer match.', fromChoices: ['orders.customer_id', 'orders.order_id', 'orders.product_id'], toChoices: ['customers.customer_id', 'customers.full_name'] },
    jp2: { id: 'jp2', type: 'INNER', fromEntity: 'orders', toEntity: 'products', from: 'orders.product_id', to: 'products.product_id', cardinality: 'many-to-one', semantics: 'Many-to-one · Required relationship (Orders → Product)', desc: 'Connects sales to product catalog. Filter: Only orders with a valid product SKU are included.', fromChoices: ['orders.product_id', 'orders.order_id'], toChoices: ['products.product_id', 'products.product_name'] },
  });
  const [entityPositions, setEntityPositions] = useState({});

  const [canvasEntities, setCanvasEntities] = useState(() =>
    DATA_MODELS_INITIAL.map((m) => ({
      id: m.id,
      label: m.name,
      dbName: m.sourceName,
      source: m.sourceName,
      primary: false,
      definition: m.description,
      fields: m.fields,
    }))
  );

  // ── Catalog state (new two-pane layout) ────────────────────────────────
  const [objectType, setObjectType] = useState('models'); // left-pane tab only
  const [selectedObjectId, setSelectedObjectId] = useState(null);  // right-pane item id
  const [selectedObjectType, setSelectedObjectType] = useState(null); // right-pane item type
  const [catalogSearch, setCatalogSearch] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(null);
  const [dataModels, setDataModels] = useState(DATA_MODELS_INITIAL);
  const [datasets, setDatasets] = useState(DATASETS_INITIAL);
  const [metrics, setMetrics] = useState(METRICS_INITIAL);
  const [addModelOpen, setAddModelOpen] = useState(false);

  // ── Edit pane (right sliding overlay) ─────────────────────────────────────
  // item: { type: 'model' | 'metric', id: string | null, mode: 'edit' | 'inspect' }
  const [editPaneItem, setEditPaneItem] = useState(null);
  const [editPaneCaretY, setEditPaneCaretY] = useState(null);
  const [editPaneDraft, setEditPaneDraft] = useState(null);
  const catalogPaneRef = useRef(null);
  const lpContainerRef = useRef(null);

  // Remember last selected item per top-level view for auto-restore
  const lastModelsItemIdRef = useRef(null);
  const lastMetricsItemIdRef = useRef(null);

  // ── Confirm dialog (replaces all window.confirm calls) ────────────────────
  // shape: { title, message, confirmLabel?, cancelLabel?, onConfirm } | null
  const [confirmDialog, setConfirmDialog] = useState(null);

  // Add data source modal state
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [addSourceContext, setAddSourceContext] = useState('editor'); // 'editor' | 'new-model'
  const [connectedSources, setConnectedSources] = useState(() => new Set(['sales-db', 'product-db']));
  const [connectedSourceConfigs, setConnectedSourceConfigs] = useState({});
  const [srcDrawerOpen, setSrcDrawerOpen] = useState(false);
  const [srcDrawerTarget, setSrcDrawerTarget] = useState(null); // null = list, string id = detail
  const [newModelName, setNewModelName] = useState('');
  const [expandedSources, setExpandedSources] = useState(new Set());
  const [addModalSearch, setAddModalSearch] = useState('');
  const [activeTableId, setActiveTableId] = useState(null);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setActiveTableId(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
    // FK columns on the "to" side of a join duplicate the "from" side — exclude them.
    const joinedFKs = new Set(Object.values(joins).map((j) => `${j.toEntity}.${j.to.split('.')[1]}`));
    return canvasEntities.flatMap((entity) =>
      entity.fields
        .filter((field) => !hiddenFields.has(field.key))
        .filter((field) => !joinedFKs.has(`${entity.id}.${field.key}`))
        .map((field) => ({ key: field.key, entity: entity.id, label: fieldDisplayNames[field.key] || field.label, type: field.type }))
    );
  }, [canvasEntities, fieldDisplayNames, hiddenFields, joins]);

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

  const inspectJson = useMemo(() => {
    // Build FK relationship test lookup: { 'entityId.fieldKey': [{ to, field, join_type }] }
    const fkTests = {};
    Object.values(joins).forEach((j) => {
      const [fromEntity, fromField] = j.from.split('.');
      const [toEntity, toField] = j.to.split('.');
      const toEntityMeta = canvasEntities.find((e) => e.id === toEntity);
      if (!toEntityMeta) return;
      const toSource = dbSourceName(toEntityMeta.dbName);
      const key = `${fromEntity}.${fromField}`;
      if (!fkTests[key]) fkTests[key] = [];
      fkTests[key].push({
        relationships: {
          to: `source('${toSource}', '${toEntity}')`,
          field: toField,
          meta: { join_type: JOIN_MAP[j.type] },
        },
      });
    });

    // Group entities by database → sources
    const sourceGroups = {};
    canvasEntities.forEach((entity) => {
      const srcName = dbSourceName(entity.dbName);
      if (!sourceGroups[srcName]) sourceGroups[srcName] = { name: srcName, database: entity.dbName, tables: [] };
      const columns = entity.fields.map((f) => {
        const name = fieldDisplayNames[f.key] || f.key;
        const tests = [];
        if (f.isKey) tests.push('unique', 'not_null');
        const relTests = fkTests[`${entity.id}.${f.key}`] || [];
        relTests.forEach((t) => tests.push(t));
        const desc = fieldDescriptions[f.key] || f.semanticDesc;
        return {
          name,
          ...(fieldDisplayNames[f.key] ? { original_name: f.key } : {}),
          data_type: DBT_TYPE_MAP[f.type] || f.type,
          ...(desc ? { description: desc } : {}),
          ...(hiddenFields.has(f.key) ? { meta: { hidden: true } } : {}),
          ...(tests.length ? { tests } : {}),
        };
      });
      sourceGroups[srcName].tables.push({
        name: entity.id,
        description: entity.definition,
        ...(entity.primary ? { meta: { primary: true } } : {}),
        columns,
      });
    });

    // Composed model columns: visible non-measure fields from all entities
    const modelColumns = canvasEntities.flatMap((entity) =>
      entity.fields
        .filter((f) => !hiddenFields.has(f.key) && f.role !== 'MEASURE')
        .map((f) => {
          const name = fieldDisplayNames[f.key] || f.key;
          const desc = fieldDescriptions[f.key] || f.semanticDesc;
          return {
            name,
            data_type: DBT_TYPE_MAP[f.type] || f.type,
            ...(desc ? { description: desc } : {}),
            meta: {
              source: `${entity.id}.${f.key}`,
              ...(f.isKey ? { is_key: true } : {}),
            },
          };
        })
    );

    // Metrics: visible measure fields
    const metrics = canvasEntities.flatMap((entity) =>
      entity.fields
        .filter((f) => !hiddenFields.has(f.key) && f.role === 'MEASURE')
        .map((f) => {
          const name = fieldDisplayNames[f.key] || f.key;
          const desc = fieldDescriptions[f.key] || f.semanticDesc;
          return {
            name,
            label: titleCase(name.replace(/_/g, ' ')),
            model: "ref('sales_overview')",
            calculation_method: f.calc ? 'formula' : (DBT_AGG_MAP[f.agg] || 'sum'),
            expression: f.key,
            ...(f.calc && fieldFormulas[f.key] ? { formula: fieldFormulas[f.key] } : {}),
            ...(desc ? { description: desc } : {}),
            meta: { source: `${entity.id}.${f.key}` },
          };
        })
    );

    const obj = {
      version: 2,
      sources: Object.values(sourceGroups),
      models: [
        {
          name: 'sales_overview',
          description: 'Orders joined with customers and products from two separate databases. Use to analyze revenue by customer segment, region, and product category.',
          config: {
            materialized: 'view',
            tags: [stage],
          },
          meta: { analytics_scope: 'Individual order line items' },
          columns: modelColumns,
        },
      ],
      metrics,
    };
    return JSON.stringify(obj, null, 2);
  }, [stage, canvasEntities, hiddenFields, fieldDisplayNames, fieldDescriptions, fieldFormulas, joins]);

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

  const handleSaveCalcField = ({ name, formula, agg }) => {
    const entityId = addCalcFieldEntityId;
    if (!entityId) return;
    const key = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    setCanvasEntities((prev) =>
      prev.map((e) =>
        e.id === entityId
          ? { ...e, fields: [...e.fields, { key, label: name, type: 'fx', calc: true, role: 'MEASURE', agg }] }
          : e
      )
    );
    setFieldFormulas((prev) => ({ ...prev, [key]: formula }));
    setAddCalcFieldEntityId(null);
  };

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
    const stub = {
      id, name: newModelName.trim(),
      sourceId: '', sourceName: '', description: '', grain: '',
      usedInDatasetIds: [], fields: [],
    };
    setDataModels((prev) => [...prev, stub]);
    setAddSourceOpen(false);
    resetAddSourceState();
  };

  // ── New dataset handler ───────────────────────────────────────────────────
  const handleNewDataset = () => {
    const id = `dataset-${Date.now()}`;
    const stub = { id, name: 'New Dataset', desc: '', entities: 0, joins: 0, uses: 0, stage: 'draft', progress: 0, modelIds: [] };
    setDatasets((prev) => ({ ...prev, draft: [...prev.draft, stub] }));
    setSelectedObjectId(id);
    setSelectedObjectType('datasets');
    setIsEditing(false);
    setEditDraft(null);
    setView('catalog');
  };

  // ── Move dataset between Kanban stages ───────────────────────────────────
  const doMoveDataset = (dsId, fromStage, toStage) => {
    setDatasets((prev) => {
      const item = prev[fromStage]?.find((d) => d.id === dsId);
      if (!item) return prev;
      return {
        ...prev,
        [fromStage]: prev[fromStage].filter((d) => d.id !== dsId),
        [toStage]: [...prev[toStage], { ...item, stage: toStage, lastModified: Date.now() }],
      };
    });
  };

  const handleMoveDataset = (dsId, fromStage, toStage) => {
    if (toStage === 'production') {
      const allDs = [...datasets.draft, ...datasets.dev, ...datasets.production];
      const ds = allDs.find((d) => d.id === dsId);
      setConfirmDialog({
        title: 'Promote to Production',
        message: `"${ds?.name}" is used in ${ds?.uses ?? 0} place${(ds?.uses ?? 0) !== 1 ? 's' : ''}. Promote to production?`,
        confirmLabel: 'Promote',
        onConfirm: () => doMoveDataset(dsId, fromStage, toStage),
      });
    } else {
      doMoveDataset(dsId, fromStage, toStage);
    }
  };

  // ── Open dataset from home view ───────────────────────────────────────────
  const handleOpenDataset = (dsId) => {
    setSelectedObjectId(dsId);
    setSelectedObjectType('datasets');
    setIsEditing(false);
    setEditDraft(null);
    setEditPaneItem(null);
    setView('catalog');
  };

  // ── Add model to the current dataset (drag-drop or double-click) ──────────
  const handleAddModelToDataset = (modelId) => {
    if (!selectedObjectId) return;
    const allDs = [...datasets.draft, ...datasets.dev, ...datasets.production];
    const base = editDraft ?? JSON.parse(JSON.stringify(allDs.find((d) => d.id === selectedObjectId) ?? {}));
    if ((base.modelIds || []).includes(modelId)) return;
    const newDraft = { ...base, modelIds: [...new Set([...(base.modelIds ?? []), modelId])] };
    setEditDraft(newDraft);
    setIsEditing(true);
  };

  const handleRemoveModelFromDataset = (modelId) => {
    if (!editDraft) return;
    setEditDraft((prev) => ({ ...prev, modelIds: (prev.modelIds ?? []).filter((id) => id !== modelId) }));
  };

  const handleAddMetricToDataset = (metricId) => {
    if (!selectedObjectId) return;
    setMetrics((prev) => prev.map((m) =>
      m.id === metricId ? { ...m, datasetId: selectedObjectId } : m
    ));
    if (!isEditing) setIsEditing(true);
  };

  const handleRemoveMetricFromDataset = (metricId) => {
    setMetrics((prev) => prev.map((m) =>
      m.id === metricId ? { ...m, datasetId: null } : m
    ));
  };

  // ── Open edit pane ────────────────────────────────────────────────────────
  const openEditPane = (type, id, mode, itemRef) => {
    if (type === 'model') {
      const m = dataModels.find((dm) => dm.id === id);
      setEditPaneDraft(m ? JSON.parse(JSON.stringify(m)) : null);
    } else if (type === 'metric') {
      const m = metrics.find((mt) => mt.id === id);
      setEditPaneDraft(
        m
          ? JSON.parse(JSON.stringify(m))
          : { id: `metric-${Date.now()}`, name: '', description: '', datasetId: selectedObjectId, expression: '', aggregation: 'SUM', isGlobal: false }
      );
    }
    setEditPaneItem({ type, id, mode });
    if (itemRef?.current && lpContainerRef.current) {
      const itemRect = itemRef.current.getBoundingClientRect();
      // pane is position:fixed; top:24px — caretY is relative to pane top
      const PANE_TOP = 24;
      const rawY = itemRect.top + itemRect.height / 2 - PANE_TOP;
      const viewportH = window.innerHeight;
      const clampedY = Math.min(Math.max(rawY, 16), viewportH - PANE_TOP * 2 - 16);
      setEditPaneCaretY(clampedY);
    } else {
      setEditPaneCaretY(null);
    }
  };

  const handleCloseEditPane = () => {
    setEditPaneItem(null);
    setEditPaneDraft(null);
    setEditPaneCaretY(null);
  };

  const handleSaveFromPane = () => {
    if (!editPaneDraft || !editPaneItem) return;
    const savedId = editPaneDraft.id || `metric-${Date.now()}`;
    if (editPaneItem.type === 'model') {
      setDataModels((prev) => prev.map((m) => m.id === editPaneDraft.id ? editPaneDraft : m));
    } else if (editPaneItem.type === 'metric') {
      if (editPaneItem.id) {
        setMetrics((prev) => prev.map((m) => m.id === editPaneDraft.id ? editPaneDraft : m));
      } else {
        setMetrics((prev) => [...prev, { ...editPaneDraft, id: savedId }]);
      }
    }
    // Switch back to inspect mode, keep pane open
    setEditPaneItem((prev) => prev ? { ...prev, id: savedId, mode: 'inspect' } : prev);
  };

  // Track last selected item per top-level view
  useEffect(() => {
    if (editPaneItem?.type === 'model' && editPaneItem.id) lastModelsItemIdRef.current = editPaneItem.id;
    else if (editPaneItem?.type === 'metric' && editPaneItem.id) lastMetricsItemIdRef.current = editPaneItem.id;
  }, [editPaneItem]);

  // Auto-select first (or last remembered) item when entering models/metrics views
  useEffect(() => {
    if (view === 'models') {
      if (editPaneItem?.type === 'model') return;
      const targetId = lastModelsItemIdRef.current || dataModels[0]?.id;
      if (targetId) openEditPane('model', targetId, 'inspect', null);
    } else if (view === 'metrics') {
      if (editPaneItem?.type === 'metric') return;
      const targetId = lastMetricsItemIdRef.current || metrics[0]?.id;
      if (targetId) openEditPane('metric', targetId, 'inspect', null);
    }
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guard navigation away from unsaved dataset edits
  const guardedExitEdit = useCallback((onConfirmed) => {
    if (!isEditing) { onConfirmed(); return; }
    setConfirmDialog({
      title: 'Unsaved changes',
      message: 'Discard unsaved changes and continue?',
      confirmLabel: 'Discard',
      onConfirm: () => { setIsEditing(false); setEditDraft(null); onConfirmed(); },
    });
  }, [isEditing]);

  // Derived: currently selected dataset (for catalog view)
  const selectedDataset = useMemo(() => {
    if (!selectedObjectId || selectedObjectType !== 'datasets') return null;
    const allDs = [...datasets.draft, ...datasets.dev, ...datasets.production];
    return allDs.find((d) => d.id === selectedObjectId) ?? null;
  }, [selectedObjectId, selectedObjectType, datasets]);

  // Derived: model/metric for the edit pane header
  const editPaneModel = editPaneItem?.type === 'model'
    ? dataModels.find((m) => m.id === editPaneItem.id) ?? null
    : null;
  const editPaneMetric = editPaneItem?.type === 'metric'
    ? metrics.find((m) => m.id === editPaneItem.id) ?? null
    : null;
  const editPaneTitle = editPaneItem?.type === 'model'
    ? (editPaneDraft?.name || editPaneModel?.name || 'Model')
    : (editPaneDraft?.name || editPaneMetric?.name || 'Metric');

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="app">
      <nav className="nav">
        {/* ── Left ── */}
        <div className="nav-left">
          {view === 'home' || view === 'models' || view === 'metrics' ? (
            <div className="nav-brand">
              <span className="nav-brand-dot" />
              <span>Reveal</span>
              <span className="nav-brand-sub">Data Catalog</span>
            </div>
          ) : view === 'catalog' ? (
            <div className="nav-breadcrumb">
              <button className="plain-btn nav-back-home" onClick={() => guardedExitEdit(() => { setView('home'); setEditPaneItem(null); })}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                Back
              </button>
              <span className="nav-breadcrumb-sep">/</span>
              <DatasetCombo
                datasets={datasets}
                selectedObjectId={selectedObjectId}
                onChange={(id) => guardedExitEdit(() => {
                  setSelectedObjectId(id);
                  setSelectedObjectType('datasets');
                  setIsEditing(false);
                  setEditDraft(null);
                  setEditPaneItem(null);
                })}
              />
            </div>
          ) : (
            <button className="plain-btn nav-back" onClick={() => guardedExitEdit(() => { setView('home'); setEditPaneItem(null); })}>
              ← Home
            </button>
          )}
        </div>

        {/* ── Center — nav tabs for top-level views ── */}
        <div className="nav-center">
          {(view === 'home' || view === 'models' || view === 'metrics') && (
            <div className="nav-tabs">
              {[{ id: 'home', label: 'Datasets' }, { id: 'models', label: 'Models' }, { id: 'metrics', label: 'Metrics' }].map(({ id, label }) => (
                <button
                  key={id}
                  className={`nav-tab${view === id ? ' nav-tab-active' : ''}`}
                  onClick={() => guardedExitEdit(() => { setView(id); setEditPaneItem(null); })}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Right ── */}
        <div className="nav-right">
          {view === 'home' && (
            <button className="btn" onClick={() => setSrcDrawerOpen(true)}>Edit data sources</button>
          )}
          {view === 'catalog' && selectedDataset && !isEditing && (
            <button className="btn btn-primary" onClick={() => {
              setEditDraft(JSON.parse(JSON.stringify(selectedDataset)));
              setIsEditing(true);
            }}>Edit</button>
          )}
          {view === 'catalog' && selectedDataset && isEditing && (
            <>
              <button className="btn" onClick={() => { setIsEditing(false); setEditDraft(null); setEditPaneItem(null); }}>Cancel</button>
              <button className="btn btn-primary" onClick={() => {
                if (!editDraft) return;
                setDatasets((prev) => {
                  const update = (arr) => arr.map((d) => d.id === editDraft.id ? { ...d, ...editDraft } : d);
                  return { draft: update(prev.draft), dev: update(prev.dev), production: update(prev.production) };
                });
                setIsEditing(false);
                setEditDraft(null);
                setEditPaneItem(null);
              }}>Save</button>
            </>
          )}
        </div>
      </nav>

      {/* ── Home view ── */}
      {view === 'home' && (
        <section className="view active">
          <HomeView
            datasets={datasets}
            dataModels={dataModels}
            metrics={metrics}
            onOpenDataset={handleOpenDataset}
            onNewDataset={handleNewDataset}
            onMoveDataset={handleMoveDataset}
          />
        </section>
      )}

      {/* ── Models view — two-panel ── */}
      {view === 'models' && (
        <section className="view active">
          <div className="two-panel-layout">
            <ModelsView
              dataModels={dataModels}
              datasets={datasets}
              selectedModelId={editPaneItem?.type === 'model' ? editPaneItem.id : null}
              onInspectModel={(id) => openEditPane('model', id, 'inspect', null)}
              onEditModel={(id) => openEditPane('model', id, 'edit', null)}
              onDeleteModel={(id) => setConfirmDialog({ title: 'Delete model', message: 'Remove this model from the catalog?', confirmLabel: 'Delete', onConfirm: () => setDataModels((prev) => prev.filter((m) => m.id !== id)) })}
              onNewModel={() => {
                const id = `model-${Date.now()}`;
                const stub = { id, name: 'New Model', sourceId: 'sales-db', sourceName: 'Sales DB', description: '', grain: '', usedInDatasetIds: [], fields: [] };
                setDataModels((prev) => [...prev, stub]);
                openEditPane('model', id, 'edit', null);
              }}
            />
            <SidePane
              variant="inline"
              isOpen={!!editPaneItem}
              mode={editPaneItem?.mode || 'inspect'}
              title={editPaneTitle}
              typeBadge="model"
              isGlobal
              onDiscardClose={() => setConfirmDialog({ title: 'Unsaved changes', message: 'Discard changes to this model?', confirmLabel: 'Discard', onConfirm: handleCloseEditPane })}
              onSave={handleSaveFromPane}
              onEdit={() => setEditPaneItem((prev) => prev ? { ...prev, mode: 'edit' } : prev)}
              stableKey={editPaneDraft?.stableKey || (editPaneModel ? autoStableKey(editPaneModel) : undefined)}
              onStableKeyChange={(val) => setEditPaneDraft((p) => p ? { ...p, stableKey: val } : p)}
              onRequestStableKeyUnlock={(cb) => setConfirmDialog({ title: 'Unlock stable key', message: 'Changing the stable key may break existing integrations. Continue?', confirmLabel: 'Unlock', onConfirm: cb })}
            >
              {editPaneItem?.type === 'model' && editPaneDraft && (
                <DataModelDetail
                  model={editPaneModel ?? editPaneDraft}
                  isEditing={editPaneItem?.mode === 'edit'}
                  editDraft={editPaneDraft}
                  setIsEditing={() => {}}
                  setEditDraft={setEditPaneDraft}
                  onSave={handleSaveFromPane}
                  onCancel={handleCloseEditPane}
                  inPane
                  onRequestStableKeyUnlock={(cb) => setConfirmDialog({ title: 'Unlock stable key', message: 'Changing the stable key may break existing integrations. Continue?', confirmLabel: 'Unlock', onConfirm: cb })}
                />
              )}
            </SidePane>
          </div>
        </section>
      )}

      {/* ── Metrics view — two-panel ── */}
      {view === 'metrics' && (
        <section className="view active">
          <div className="two-panel-layout">
            <MetricsView
              metrics={metrics}
              selectedMetricId={editPaneItem?.type === 'metric' ? editPaneItem.id : null}
              onInspectMetric={(id) => openEditPane('metric', id, 'inspect', null)}
              onEditMetric={(id) => openEditPane('metric', id, 'edit', null)}
              onDeleteMetric={(id) => {
                setConfirmDialog({
                  title: 'Delete metric',
                  message: 'Delete this metric from the catalog?',
                  confirmLabel: 'Delete',
                  onConfirm: () => setMetrics((prev) => prev.filter((m) => m.id !== id)),
                });
              }}
              onNewMetric={() => openEditPane('metric', null, 'edit', null)}
            />
            <SidePane
              variant="inline"
              isOpen={!!editPaneItem}
              mode={editPaneItem?.mode || 'inspect'}
              title={editPaneTitle}
              typeBadge="metric"
              isGlobal={false}
              onDiscardClose={() => setConfirmDialog({ title: 'Unsaved changes', message: 'Discard changes to this metric?', confirmLabel: 'Discard', onConfirm: handleCloseEditPane })}
              onSave={handleSaveFromPane}
              onEdit={() => setEditPaneItem((prev) => prev ? { ...prev, mode: 'edit' } : prev)}
            >
              {editPaneItem?.type === 'metric' && (
                <MetricsFormulaEditor
                  metric={editPaneMetric}
                  dataModels={dataModels}
                  isEditing={editPaneItem.mode === 'edit'}
                  draft={editPaneDraft}
                  setDraft={setEditPaneDraft}
                />
              )}
            </SidePane>
          </div>
        </section>
      )}

      {/* ── Catalog / Dataset editor view ── */}
      {view === 'catalog' ? (
        <section className="view active">
          <div className="catalog-layout">
            <div className="lp-container" ref={lpContainerRef}>
              <EditorLeftPane
                dataModels={dataModels}
                metrics={metrics}
                currentDataset={editDraft ?? selectedDataset}
                isDatasetEditing={isEditing}
                activeItemId={editPaneItem?.id || null}
                activeItemType={editPaneItem?.type || null}
                onBeforeTabChange={() => {
                  handleCloseEditPane();
                  return true;
                }}
                onInspectModel={(id) => openEditPane('model', id, 'inspect', null)}
                onEditModel={(id) => openEditPane('model', id, 'edit', null)}
                onDeleteModel={(id) => {
                  setConfirmDialog({
                    title: 'Delete model',
                    message: 'Remove this model from the catalog?',
                    confirmLabel: 'Delete',
                    onConfirm: () => setDataModels((prev) => prev.filter((m) => m.id !== id)),
                  });
                }}
                onAddModel={(id) => handleAddModelToDataset(id)}
                onRemoveModel={(id) => handleRemoveModelFromDataset(id)}
                onInspectMetric={(id) => openEditPane('metric', id, 'inspect', null)}
                onEditMetric={(id) => openEditPane('metric', id, 'edit', null)}
                onDeleteMetric={(id) => {
                  setConfirmDialog({
                    title: 'Delete metric',
                    message: 'Delete this metric from the catalog?',
                    confirmLabel: 'Delete',
                    onConfirm: () => setMetrics((prev) => prev.filter((m) => m.id !== id)),
                  });
                }}
                onAddMetric={(id) => handleAddMetricToDataset(id)}
                onRemoveMetric={(id) => handleRemoveMetricFromDataset(id)}
                onNewModel={() => {
                  const id = `model-${Date.now()}`;
                  const stub = { id, name: 'New Model', sourceId: 'sales-db', sourceName: 'Sales DB', description: '', grain: '', usedInDatasetIds: [], fields: [] };
                  setDataModels((prev) => [...prev, stub]);
                  openEditPane('model', id, 'edit', null);
                }}
                onNewMetric={() => openEditPane('metric', null, 'edit', null)}
              />
            </div>
            <div
              className="cat-canvas-area"
              ref={catalogPaneRef}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const modelId = e.dataTransfer.getData('application/x-model-id');
                if (modelId) handleAddModelToDataset(modelId);
                const metricId = e.dataTransfer.getData('application/x-metric-id');
                if (metricId) handleAddMetricToDataset(metricId);
              }}
            >
              {selectedDataset ? (
                <DatasetCanvasPane
                  key={selectedObjectId}
                  dataset={selectedDataset}
                  dataModels={dataModels}
                  metrics={metrics}
                  isEditing={isEditing}
                  editDraft={editDraft}
                  setEditDraft={setEditDraft}
                  onEdit={() => {
                    setEditDraft(JSON.parse(JSON.stringify(selectedDataset)));
                    setIsEditing(true);
                  }}
                  onCancel={() => { setIsEditing(false); setEditDraft(null); }}
                  onSave={(draft) => {
                    setDatasets((prev) => {
                      const update = (arr) => arr.map((d) => d.id === draft.id ? { ...d, ...draft } : d);
                      return { draft: update(prev.draft), dev: update(prev.dev), production: update(prev.production) };
                    });
                    setIsEditing(false);
                    setEditDraft(null);
                  }}
                  onOpenAddModel={() => setAddModelOpen(true)}
                  onNavigateToModel={(id) => openEditPane('model', id, 'inspect', null)}
                  onAddMetric={() => openEditPane('metric', null, 'edit', null)}
                  onInspectMetric={(id) => openEditPane('metric', id, 'inspect', null)}
                  onEditMetric={(id) => openEditPane('metric', id, 'edit', null)}
                  onRemoveMetric={(id) => setMetrics((prev) => prev.map((m) => m.id === id ? { ...m, datasetId: null } : m))}
                />
              ) : (
                <div className="cat-canvas-empty">
                  <div className="empty-state">
                    <h3 className="empty-state-title">No dataset selected</h3>
                    <p className="empty-state-desc">Select a dataset from the dropdown above, or create a new one.</p>
                    <button className="btn btn-primary" onClick={handleNewDataset}>+ New Dataset</button>
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* Add Data Models modal */}
          <AddModelModal
            open={addModelOpen}
            onClose={() => setAddModelOpen(false)}
            dataModels={dataModels}
            currentModelIds={(() => {
              const allDs = [...datasets.draft, ...datasets.dev, ...datasets.production];
              const ds = editDraft ?? allDs.find((d) => d.id === selectedObjectId);
              return ds?.modelIds ?? [];
            })()}
            onAdd={(newIds) => {
              const allDs = [...datasets.draft, ...datasets.dev, ...datasets.production];
              setEditDraft((prev) => {
                const base = prev ?? JSON.parse(JSON.stringify(allDs.find((d) => d.id === selectedObjectId) ?? {}));
                return { ...base, modelIds: [...new Set([...(base.modelIds ?? []), ...newIds])] };
              });
              setIsEditing(true);
            }}
          />
        </section>
      ) : null}

      {/* Calculated field modal */}
      <CalcFieldModal
        isOpen={addCalcFieldEntityId !== null}
        onClose={() => setAddCalcFieldEntityId(null)}
        onSave={handleSaveCalcField}
        availableFields={dataModels.flatMap((m) => m.fields)}
      />

      {/* AI chat modal */}
      <Dialog.Root open={aiModalOpen} onOpenChange={(open) => { if (!open) { setAiModalOpen(false); setAiBarOpen(false); } }}>
        <Dialog.Portal>
          <Dialog.Backdrop className="ai-chat-backdrop" />
          <Dialog.Viewport className="ai-chat-viewport">
            <Dialog.Popup className="ai-chat-modal">
              <Dialog.Title className="sr-only">AI Model Assistant</Dialog.Title>
              <Dialog.Close className="plain-btn ai-chat-close-float">✕</Dialog.Close>
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

      {/* ── Side Pane (overlay — catalog view only) ── */}
      <SidePane
        isOpen={editPaneItem !== null && view === 'catalog'}
        mode={editPaneItem?.mode || 'inspect'}
        title={editPaneTitle}
        typeBadge={editPaneItem?.type || null}
        isGlobal={editPaneItem?.type === 'model'}
        width={editPaneItem?.type === 'metric' ? 500 : 1150}
        onClose={handleCloseEditPane}
        onDiscardClose={() => setConfirmDialog({
          title: 'Unsaved changes',
          message: 'Discard changes to this item?',
          confirmLabel: 'Discard',
          onConfirm: handleCloseEditPane,
        })}
        onSave={handleSaveFromPane}
        onEdit={() => setEditPaneItem((prev) => prev ? { ...prev, mode: 'edit' } : prev)}
        stableKey={editPaneItem?.type === 'model' ? (editPaneDraft?.stableKey || (editPaneModel ? autoStableKey(editPaneModel) : undefined)) : undefined}
        onStableKeyChange={editPaneItem?.type === 'model' ? (val) => setEditPaneDraft((p) => p ? { ...p, stableKey: val } : p) : undefined}
        onRequestStableKeyUnlock={(cb) => setConfirmDialog({
          title: 'Unlock stable key',
          message: 'Changing the stable key may break existing integrations. Continue?',
          confirmLabel: 'Unlock',
          onConfirm: cb,
        })}
      >
        {editPaneItem?.type === 'model' && editPaneDraft && (
          <DataModelDetail
            model={editPaneModel ?? editPaneDraft}
            isEditing={editPaneItem.mode === 'edit'}
            editDraft={editPaneDraft}
            setIsEditing={() => {}}
            setEditDraft={setEditPaneDraft}
            onSave={handleSaveFromPane}
            onCancel={handleCloseEditPane}
            inPane
            onRequestStableKeyUnlock={(cb) => setConfirmDialog({
              title: 'Unlock stable key',
              message: 'Changing the stable key may break existing integrations. Continue?',
              confirmLabel: 'Unlock',
              onConfirm: cb,
            })}
          />
        )}
        {editPaneItem?.type === 'metric' && (
          <MetricsFormulaEditor
            metric={editPaneMetric}
            dataModels={dataModels}
            isEditing={editPaneItem.mode === 'edit'}
            draft={editPaneDraft}
            setDraft={setEditPaneDraft}
          />
        )}
      </SidePane>

      {/* ── Source Drawer ── */}
      <SourceDrawer
        open={srcDrawerOpen}
        onClose={() => { setSrcDrawerOpen(false); setSrcDrawerTarget(null); }}
        connectedSources={connectedSources}
        setConnectedSources={setConnectedSources}
        connectedSourceConfigs={connectedSourceConfigs}
        setConnectedSourceConfigs={setConnectedSourceConfigs}
        drawerTarget={srcDrawerTarget}
        setDrawerTarget={setSrcDrawerTarget}
      />

      {/* ── Reusable confirm dialog (replaces all window.confirm) ── */}
      <Dialog.Root open={!!confirmDialog} onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Backdrop className="dialog-backdrop" />
          <Dialog.Viewport className="dialog-viewport">
            <Dialog.Popup className="dialog-popup">
              <Dialog.Title className="modal-title">{confirmDialog?.title}</Dialog.Title>
              {confirmDialog?.message && (
                <Dialog.Description className="modal-desc">{confirmDialog.message}</Dialog.Description>
              )}
              <div className="modal-actions">
                <Dialog.Close className="btn">{confirmDialog?.cancelLabel || 'Cancel'}</Dialog.Close>
                <button
                  className="btn btn-primary"
                  onClick={() => { confirmDialog?.onConfirm(); setConfirmDialog(null); }}
                >
                  {confirmDialog?.confirmLabel || 'Confirm'}
                </button>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

// ── SourceDrawer ─────────────────────────────────────────────────────────────
function ConnectorIcon({ id, size = 24 }) {
  const slug = CONNECTOR_ICONS[id];
  if (slug) {
    return (
      <img
        src={`https://cdn.simpleicons.org/${slug}`}
        alt=""
        width={size}
        height={size}
        className="src-icon-img"
        onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }}
      />
    );
  }
  return null;
}

function ConnectorAvatar({ id, name, size = 32 }) {
  const slug = CONNECTOR_ICONS[id];
  const cat = ITEM_CATEGORY_MAP[id];
  const bg = CAT_COLORS[cat] || '#e8f0ff';
  const stroke = darkenColor(bg);
  return (
    <span className="src-avatar" style={{ width: size, height: size, background: bg, boxShadow: `0 0 0 1.5px ${stroke}` }}>
      {slug ? (
        <>
          <img
            src={`https://cdn.simpleicons.org/${slug}`}
            alt=""
            width={size * 0.55}
            height={size * 0.55}
            className="src-icon-img"
          />
          <span className="src-avatar-abbr" style={{ display: 'none' }}>{connectorAbbr(name)}</span>
        </>
      ) : (
        <span className="src-avatar-abbr">{connectorAbbr(name)}</span>
      )}
    </span>
  );
}

function SchemaField({ field, value, onChange, required }) {
  const { key, label, type, placeholder, options, hint } = field;

  if (type === 'oauth') {
    return (
      <div className="src-field src-field-oauth">
        <div className="src-field-label">{label}</div>
        {field.hint && <div className="src-field-hint">{field.hint}</div>}
        <button className="btn btn-primary src-oauth-btn" onClick={() => {}}>
          Sign in
        </button>
      </div>
    );
  }

  if (type === 'toggle') {
    return (
      <div className="src-field src-field-toggle">
        <Switch.Root
          className="bu-switch"
          checked={!!value}
          onCheckedChange={(v) => onChange(key, v)}
        >
          <Switch.Thumb className="bu-switch-thumb" />
        </Switch.Root>
        <label className="src-field-toggle-label">{label}</label>
      </div>
    );
  }

  if (type === 'select') {
    return (
      <div className="src-field">
        <label className="src-field-label">{label}{required && <span className="src-field-required"> *</span>}</label>
        <select
          className="src-field-input src-field-select"
          value={value || ''}
          onChange={(e) => onChange(key, e.target.value)}
        >
          <option value="">Select…</option>
          {(options || []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  if (type === 'textarea') {
    return (
      <div className="src-field">
        <label className="src-field-label">{label}{required && <span className="src-field-required"> *</span>}</label>
        <textarea
          className="src-field-input src-field-textarea"
          placeholder={placeholder}
          value={value || ''}
          onChange={(e) => onChange(key, e.target.value)}
          rows={6}
        />
      </div>
    );
  }

  return (
    <div className="src-field">
      <label className="src-field-label">{label}{required && <span className="src-field-required"> *</span>}</label>
      <div className="src-field-input-wrap">
        <input
          className="src-field-input"
          type={type === 'password' ? 'password' : type === 'number' ? 'number' : 'text'}
          placeholder={placeholder}
          value={value || ''}
          onChange={(e) => onChange(key, e.target.value)}
        />
        {hint && <span className="src-field-hint-inline">{hint}</span>}
      </div>
    </div>
  );
}

function SourceDrawer({
  open,
  onClose,
  connectedSources,
  setConnectedSources,
  connectedSourceConfigs,
  setConnectedSourceConfigs,
  drawerTarget,
  setDrawerTarget,
}) {
  const [formValues, setFormValues] = useState({});
  const [tablesOpen, setTablesOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [drawerSearch, setDrawerSearch] = useState('');
  const [selectedTables, setSelectedTables] = useState(new Set());
  const [selectedViews, setSelectedViews] = useState(new Set());

  // Animate detail pane: keep content visible during exit transition
  const [contentTarget, setContentTarget] = useState(null);
  const exitTimerRef = useRef(null);
  useEffect(() => {
    if (drawerTarget) {
      if (exitTimerRef.current) { clearTimeout(exitTimerRef.current); exitTimerRef.current = null; }
      setContentTarget(drawerTarget);
    } else {
      exitTimerRef.current = setTimeout(() => { setContentTarget(null); exitTimerRef.current = null; }, 300);
    }
  }, [drawerTarget]);
  useEffect(() => () => { if (exitTimerRef.current) clearTimeout(exitTimerRef.current); }, []);

  // Reset form + search when target/open changes
  useEffect(() => {
    if (drawerTarget) {
      setFormValues(connectedSourceConfigs[drawerTarget] || {});
      setTablesOpen(false);
      setViewsOpen(false);
      setSelectedTables(new Set(DATASOURCE_TABLES[drawerTarget]?.tables || []));
      setSelectedViews(new Set(DATASOURCE_TABLES[drawerTarget]?.views || []));
    } else {
      setDrawerSearch('');
    }
  }, [drawerTarget, connectedSourceConfigs]);

  const allItems = useMemo(() => {
    const map = {};
    CONNECTOR_CATEGORIES.forEach((cat) => cat.items.forEach((item) => { map[item.id] = item; }));
    return map;
  }, []);

  const connectedList = Array.from(connectedSources).map((id) => allItems[id]).filter(Boolean);

  const searchLower = drawerSearch.toLowerCase();
  const filteredConnectedList = drawerSearch
    ? connectedList.filter((item) => item.name.toLowerCase().includes(searchLower))
    : connectedList;

  const handleFieldChange = (key, val) => {
    setFormValues((prev) => ({ ...prev, [key]: val }));
  };

  const handleSave = () => {
    if (!drawerTarget) return;
    setConnectedSourceConfigs((prev) => ({ ...prev, [drawerTarget]: formValues }));
    setConnectedSources((prev) => {
      const next = new Set(prev);
      next.add(drawerTarget);
      return next;
    });
    setDrawerTarget(null);
  };

  const handleDisconnect = () => {
    if (!drawerTarget) return;
    setConnectedSources((prev) => {
      const next = new Set(prev);
      next.delete(drawerTarget);
      return next;
    });
    setConnectedSourceConfigs((prev) => {
      const next = { ...prev };
      delete next[drawerTarget];
      return next;
    });
    setDrawerTarget(null);
  };

  const schemaKey = contentTarget ? CONNECTOR_SCHEMA_MAP[contentTarget] : null;
  const schema = schemaKey ? CONNECTOR_CONFIG_SCHEMA[schemaKey] : null;
  const contentTargetItem = contentTarget ? allItems[contentTarget] : null;
  const isConnected = contentTarget ? connectedSources.has(contentTarget) : false;

  const tables = contentTarget ? (DATASOURCE_TABLES[contentTarget] || {}) : {};
  const tableList = tables.tables || [];
  const viewList = tables.views || [];

  return (
    <>
      {/* Overlay */}
      <div
        className={`src-overlay${open ? ' src-overlay-visible' : ''}`}
        onClick={onClose}
      />

      {/* Panel */}
      <aside className={`src-drawer${open ? ' src-drawer-open' : ''}`}>

        {/* ── Detail pane (slides in from right) ─── */}
        <div className={`src-pane src-pane-detail${drawerTarget ? ' src-pane-in' : ''}`}>
          {contentTargetItem && (
            <>
            <div className="src-detail-hd">
              <button className="src-back-btn" onClick={() => setDrawerTarget(null)}>
                ← Back
              </button>
              <div className="src-detail-identity">
                <div className="src-detail-identity-left">
                  <ConnectorAvatar id={contentTargetItem.id} name={contentTargetItem.name} size={36} />
                  <div>
                    <div className="src-detail-name">{contentTargetItem.name}</div>
                    {contentTargetItem.dbType && <div className="src-detail-type">{contentTargetItem.dbType}</div>}
                  </div>
                </div>
                {isConnected && (
                  <div className="src-connected-badge">
                    <svg className="src-connected-check" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="#16a34a"/><path d="M4.5 8.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
                    Connected
                  </div>
                )}
              </div>
            </div>

            {/* Tabbed form + Data Objects — single scrollable region */}
            <div className="src-drawer-body">
              {schema ? (() => {
                const hasConnMissing = schema.connection?.some((f) => !formValues[f.key]);
                const hasAuthMissing = schema.auth?.some((f) => !formValues[f.key]);
                return (
                  <Tabs.Root defaultValue="connection" className="src-form-tabs">
                    <Tabs.List className="src-form-tab-list">
                      {schema.connection?.length > 0 && (
                        <Tabs.Tab className="src-form-tab" value="connection">
                          {hasConnMissing && <span className="src-tab-dot" aria-label="Required fields are missing"><span className="src-tab-dot-tip">Required fields are missing.</span></span>}
                          Connection
                        </Tabs.Tab>
                      )}
                      {schema.auth?.length > 0 && (
                        <Tabs.Tab className="src-form-tab" value="auth">
                          {hasAuthMissing && <span className="src-tab-dot" aria-label="Required fields are missing"><span className="src-tab-dot-tip">Required fields are missing.</span></span>}
                          Authentication
                        </Tabs.Tab>
                      )}
                      {schema.advanced?.length > 0 && (
                        <Tabs.Tab className="src-form-tab" value="advanced">Advanced</Tabs.Tab>
                      )}
                    </Tabs.List>
                    {schema.connection?.length > 0 && (
                      <Tabs.Panel value="connection" className="src-field-group">
                        {schema.connection.map((field) => (
                          <SchemaField key={field.key} field={field} value={formValues[field.key]} onChange={handleFieldChange} required />
                        ))}
                      </Tabs.Panel>
                    )}
                    {schema.auth?.length > 0 && (
                      <Tabs.Panel value="auth" className="src-field-group">
                        {schema.auth.map((field) => (
                          <SchemaField key={field.key} field={field} value={formValues[field.key]} onChange={handleFieldChange} required />
                        ))}
                      </Tabs.Panel>
                    )}
                    {schema.advanced?.length > 0 && (
                      <Tabs.Panel value="advanced" className="src-field-group">
                        {schema.advanced.map((field) => (
                          <SchemaField key={field.key} field={field} value={formValues[field.key]} onChange={handleFieldChange} />
                        ))}
                      </Tabs.Panel>
                    )}
                  </Tabs.Root>
                );
              })() : (
                <div className="src-empty-tab">No configuration available.</div>
              )}

              {/* Tables & Views section (only if connected and has data) */}
              {isConnected && (tableList.length > 0 || viewList.length > 0) && (
                <div className="src-tables-section">
                  <div className="src-section-lbl">Data Objects</div>
                  {tableList.length > 0 && (
                    <div className="src-collapsible">
                      <button
                        className="src-collapsible-hd"
                        onClick={() => setTablesOpen((v) => !v)}
                      >
                        <span>Tables</span>
                        <span className="src-sel-count" data-partial={selectedTables.size < tableList.length}>{selectedTables.size} of {tableList.length} selected</span>
                        <span className={`src-chevron${tablesOpen ? ' src-chevron-open' : ''}`}>›</span>
                      </button>
                      <div className={`src-collapsible-body-wrap${tablesOpen ? '' : ' collapsed'}`}>
                        <div>
                          <div className="src-collapsible-body">
                            <label className="src-table-item src-table-item-selall" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                className="src-check"
                                checked={selectedTables.size === tableList.length}
                                onChange={(e) => setSelectedTables(e.target.checked ? new Set(tableList) : new Set())}
                              />
                              Select all
                            </label>
                            {tableList.map((t) => (
                              <label key={t} className="src-table-item src-table-item-check" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  className="src-check"
                                  checked={selectedTables.has(t)}
                                  onChange={(e) => setSelectedTables((prev) => {
                                    const next = new Set(prev);
                                    e.target.checked ? next.add(t) : next.delete(t);
                                    return next;
                                  })}
                                />
                                {t}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {viewList.length > 0 && (
                    <div className="src-collapsible">
                      <button
                        className="src-collapsible-hd"
                        onClick={() => setViewsOpen((v) => !v)}
                      >
                        <span>Views</span>
                        <span className="src-sel-count" data-partial={selectedViews.size < viewList.length}>{selectedViews.size} of {viewList.length} selected</span>
                        <span className={`src-chevron${viewsOpen ? ' src-chevron-open' : ''}`}>›</span>
                      </button>
                      <div className={`src-collapsible-body-wrap${viewsOpen ? '' : ' collapsed'}`}>
                        <div>
                          <div className="src-collapsible-body">
                            <label className="src-table-item src-table-item-selall" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                className="src-check"
                                checked={selectedViews.size === viewList.length}
                                onChange={(e) => setSelectedViews(e.target.checked ? new Set(viewList) : new Set())}
                              />
                              Select all
                            </label>
                            {viewList.map((v) => (
                              <label key={v} className="src-table-item src-table-item-check" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  className="src-check"
                                  checked={selectedViews.has(v)}
                                  onChange={(e) => setSelectedViews((prev) => {
                                    const next = new Set(prev);
                                    e.target.checked ? next.add(v) : next.delete(v);
                                    return next;
                                  })}
                                />
                                {v}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="src-drawer-foot">
              {isConnected && (
                <button className="btn src-disconnect-btn" onClick={handleDisconnect}>
                  Disconnect
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button className="btn" onClick={() => setDrawerTarget(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave}>
                {isConnected ? 'Update' : 'Connect'}
              </button>
            </div>
            </>
          )}
        </div>

        {/* ── List pane (slides out to left) ─────── */}
        <div className={`src-pane src-pane-list${drawerTarget ? ' src-pane-out' : ''}`}>
          <div className="src-drawer-hd">
            <div className="src-drawer-title">Data Sources</div>
            <button className="src-close-btn" onClick={onClose}>×</button>
          </div>

          <div className="src-search-bar">
            <svg className="src-search-icon" viewBox="0 0 20 20" fill="none">
              <circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              className="src-search-input"
              type="text"
              placeholder="Search data sources…"
              value={drawerSearch}
              onChange={(e) => setDrawerSearch(e.target.value)}
              autoComplete="off"
            />
            {drawerSearch && (
              <button className="src-search-clear" onClick={() => setDrawerSearch('')}>×</button>
            )}
          </div>

          <div className="src-drawer-body">
            {/* Connected section */}
            {filteredConnectedList.length > 0 ? (
              <div className="src-list-section">
                <div className="src-section-lbl">Connected</div>
                {filteredConnectedList.map((item) => (
                  <button
                    key={item.id}
                    className="src-row src-row-connected"
                    onClick={() => setDrawerTarget(item.id)}
                  >
                    <ConnectorAvatar id={item.id} name={item.name} size={32} />
                    <div className="src-row-info">
                      <div className="src-row-name">{item.name}</div>
                      {item.dbType && <div className="src-row-sub">{item.dbType}</div>}
                    </div>
                    <svg className="src-connected-check" viewBox="0 0 16 16" aria-label="Connected"><circle cx="8" cy="8" r="8" fill="#16a34a"/><path d="M4.5 8.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
                    <span className="src-row-chevron">›</span>
                  </button>
                ))}
              </div>
            ) : !drawerSearch && (
              <div className="src-empty-connected">
                <p className="src-empty-connected-title">No sources connected yet.</p>
                <p className="src-empty-connected-sub">Connect a data source to start building models.</p>
                <button
                  className="btn btn-primary src-empty-connected-btn"
                  onClick={() => {
                    const first = CONNECTOR_CATEGORIES[0]?.items[0];
                    if (first) setDrawerTarget(first.id);
                  }}
                >
                  + Connect a source
                </button>
              </div>
            )}

            {/* Available groups */}
            {CONNECTOR_CATEGORIES.map((cat) => {
              const availableItems = cat.items.filter((item) => {
                if (connectedSources.has(item.id)) return false;
                if (drawerSearch) return item.name.toLowerCase().includes(searchLower);
                return true;
              });
              if (availableItems.length === 0) return null;
              return (
                <div key={cat.category} className="src-list-section">
                  <div className="src-section-lbl">{cat.category}</div>
                  {availableItems.map((item) => (
                    <div key={item.id} className="src-row src-row-available">
                      <ConnectorAvatar id={item.id} name={item.name} size={32} />
                      <div className="src-row-info">
                        <div className="src-row-name">{item.name}</div>
                      </div>
                      <button
                        className="src-row-connect-btn"
                        onClick={() => setDrawerTarget(item.id)}
                      >
                        Connect
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}

            {/* Empty state */}
            {drawerSearch && filteredConnectedList.length === 0 &&
              CONNECTOR_CATEGORIES.every((cat) =>
                cat.items.every((item) => connectedSources.has(item.id) || !item.name.toLowerCase().includes(searchLower))
              ) && (
              <div className="src-search-empty">No data sources match "<strong>{drawerSearch}</strong>"</div>
            )}
          </div>
        </div>

      </aside>
    </>
  );
}

export default App;
