import { Dialog } from './components/ui/dialog';
import { ChevronDown, PanelLeftOpen } from 'lucide-react';
import { Menu } from './components/ui/menu';
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
      { key: 'order_id',    label: 'order_id',    type: '#',  isKey: true, role: 'ID',        visible: true,  semanticDesc: 'Unique identifier per order line item. Use COUNT(DISTINCT order_id) to measure order volume. Never aggregate directly.' },
      { key: 'customer_id', label: 'customer_id', type: '#',  role: 'DIMENSION', visible: true,  semanticDesc: 'Foreign key to the customers table. Null values indicate guest or unattributed orders.' },
      { key: 'product_id',  label: 'product_id',  type: '#',  role: 'DIMENSION', visible: true,  semanticDesc: 'Foreign key to the products table. Orders without a matching product SKU are excluded via INNER JOIN.' },
      { key: 'order_date',  label: 'order_date',  type: 'dt', role: 'DIMENSION', visible: true,  semanticDesc: 'Date the order was placed (UTC). Primary time axis for this model.' },
      { key: 'amount',      label: 'amount',      type: '$',  role: 'MEASURE',   visible: true,  agg: 'SUM', semanticDesc: 'Gross order revenue in USD before discounts or cost deductions. Aggregate with SUM.' },
      { key: 'revenue_net', label: 'revenue_net', type: 'fx', role: 'MEASURE',   visible: true,  agg: 'SUM', calc: true, semanticDesc: 'Net revenue after deducting customer discounts and unit cost. Preferred metric for profitability.' },
    ],
  },
  {
    id: 'customers', name: 'Customers', sourceId: 'sales-db', sourceName: 'Sales DB',
    description: 'Each record represents a unique, deduplicated customer identity. Use to segment, filter, and profile buyers across orders.',
    grain: 'One row per customer',
    usedInDatasetIds: ['sales-overview', 'customer-ltv'],
    fields: [
      { key: 'customer_id', label: 'customer_id', type: '#',  isKey: true, role: 'ID',        visible: true,  semanticDesc: 'Primary key for the customers table. Use to JOIN with orders.customer_id.' },
      { key: 'full_name',   label: 'full_name',   type: 'Aa', role: 'DIMENSION', visible: true,  semanticDesc: "Customer's display name. Use for labeling. Avoid joining on this field; use customer_id." },
      { key: 'region',      label: 'region',      type: 'Aa', role: 'DIMENSION', visible: true,  semanticDesc: 'Geographic sales region (e.g. APAC, LATAM, EMEA, NA).' },
      { key: 'segment',     label: 'segment',     type: 'Aa', role: 'DIMENSION', visible: true,  semanticDesc: 'Customer market tier (e.g. Enterprise, Mid-Market, SMB). Key dimension for cohort analysis.' },
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
const DATASETS_INITIAL = {
  draft: [
    { id: 'customer-ltv', name: 'Customer LTV', desc: 'Lifetime value across orders and subscription events', entities: 2, joins: 1, uses: 0, stage: 'draft', progress: 0, modelIds: ['orders', 'customers'] },
    { id: 'marketing-attribution', name: 'Marketing attribution', desc: 'Campaign spend linked to converted deals via UTM source', entities: 3, joins: 2, uses: 4, stage: 'draft', progress: 1, modelIds: ['contacts'] },
  ],
  dev: [
    { id: 'sales-overview', name: 'Sales overview', desc: 'Orders joined with customers and products for sales exploration', entities: 3, joins: 2, uses: 12, stage: 'dev', progress: 6, modelIds: ['orders', 'customers', 'products'] },
    { id: 'support-tickets', name: 'Support tickets', desc: 'Zendesk tickets linked to accounts for CSAT analysis', entities: 2, joins: 1, uses: 23, stage: 'dev', progress: 11, modelIds: [] },
  ],
  production: [
    { id: 'revenue-summary', name: 'Revenue summary', desc: 'Aggregated revenue model used across all executive dashboards', entities: 4, joins: 3, uses: 847, stage: 'production', progress: 100, modelIds: ['orders', 'products'] },
    { id: 'headcount-roles', name: 'Headcount & roles', desc: 'HRIS data combined with org chart hierarchy for people analytics', entities: 3, joins: 2, uses: 234, stage: 'production', progress: 28, modelIds: [] },
  ],
};

// ── Metrics ──────────────────────────────────────────────────────────────────
const METRICS_INITIAL = [
  { id: 'total-revenue',  name: 'Total Revenue',         description: 'Sum of gross order revenue across all orders in the dataset.', datasetId: 'sales-overview',  expression: 'SUM(amount)',              aggregation: 'SUM', isGlobal: false },
  { id: 'net-revenue',    name: 'Net Revenue',           description: 'Sum of revenue after deducting discounts and unit cost.',      datasetId: 'sales-overview',  expression: 'SUM(revenue_net)',         aggregation: 'SUM', isGlobal: false },
  { id: 'aov',            name: 'Average Order Value',   description: 'Average gross revenue per order. Divide total revenue by distinct order count.', datasetId: 'sales-overview', expression: 'SUM(amount) / COUNT(DISTINCT order_id)', aggregation: 'DERIVED', isGlobal: false },
  { id: 'return-rate',    name: 'Return Rate',           description: 'Percentage of orders that resulted in a return.',             datasetId: 'revenue-summary', expression: 'COUNT(return_id) / COUNT(DISTINCT order_id)', aggregation: 'DERIVED', isGlobal: false },
];

// Legacy alias — keeps the existing editor/inspect view working unchanged
const MODELS = {
  draft:      DATASETS_INITIAL.draft,
  dev:        DATASETS_INITIAL.dev,
  production: DATASETS_INITIAL.production,
};

const INITIAL_ENTITIES = [
  {
    id: 'orders', label: 'orders', dbName: 'Sales DB', source: 'Sales DB · primary', primary: true,
    definition: 'Each record represents an individual order line item',
    fields: [
      { key: 'order_id', label: 'order_id', type: '#', isKey: true, role: 'ID', semanticDesc: 'Unique identifier per order line item. Use COUNT(DISTINCT order_id) to measure order volume. Never aggregate directly.' },
      { key: 'customer_id', label: 'customer_id', type: '#', role: 'DIMENSION', semanticDesc: 'Foreign key to the customers table. Null values indicate guest or unattributed orders, which are preserved in this model via the LEFT JOIN.' },
      { key: 'product_id', label: 'product_id', type: '#', role: 'DIMENSION', semanticDesc: 'Foreign key to the products table. This model uses an INNER JOIN on product_id, so orders without a matching product SKU are excluded.' },
      { key: 'order_date', label: 'order_date', type: 'dt', role: 'DIMENSION', semanticDesc: 'Date the order was placed (UTC). Primary time axis for this model. Use to group by day, week, month, or quarter for trend and cohort analysis.' },
      { key: 'amount', label: 'amount', type: '$', role: 'MEASURE', agg: 'SUM', semanticDesc: 'Gross order revenue in USD before any discounts or cost deductions. Aggregate with SUM. For margin or profitability questions, use revenue_net instead.' },
      { key: 'revenue_net', label: 'revenue_net', type: 'fx', calc: true, role: 'MEASURE', agg: 'SUM', semanticDesc: 'Net revenue after deducting customer discounts and product unit cost from gross amount. The preferred metric for profitability and margin analysis.' },
    ],
    x: 80, y: 70,
  },
  {
    id: 'customers', label: 'customers', dbName: 'Sales DB', source: 'Sales DB',
    definition: 'Each record represents a unique customer identity',
    fields: [
      { key: 'customer_id', label: 'customer_id', type: '#', isKey: true, role: 'ID', semanticDesc: 'Primary key for the customers table. Each row is a unique, deduplicated customer. Use to JOIN with orders.customer_id.' },
      { key: 'full_name', label: 'full_name', type: 'Aa', role: 'DIMENSION', semanticDesc: "Customer's display name. Use for labeling in user-facing reports. Avoid grouping or joining on this field; use customer_id instead." },
      { key: 'region', label: 'region', type: 'Aa', role: 'DIMENSION', semanticDesc: 'Geographic sales region (e.g. APAC, LATAM, EMEA, NA). Use to segment and compare revenue or customer counts across markets.' },
      { key: 'segment', label: 'segment', type: 'Aa', role: 'DIMENSION', semanticDesc: 'Customer market tier (e.g. Enterprise, Mid-Market, SMB). Key dimension for cohort analysis, revenue breakdown by business size, and retention comparisons.' },
    ],
    x: 390, y: 70,
  },
  {
    id: 'products', label: 'products', dbName: 'Product DB', source: 'Product DB',
    definition: 'Each record represents a product SKU',
    fields: [
      { key: 'product_id', label: 'product_id', type: '#', isKey: true, role: 'ID', semanticDesc: 'Primary key for the product catalog. Each row is a unique SKU. Use to JOIN with orders.product_id to enrich sales with product attributes.' },
      { key: 'product_name', label: 'product_name', type: 'Aa', role: 'DIMENSION', semanticDesc: 'Human-readable product name. Use for labeling product-level results. For grouping or aggregating across product lines, prefer category.' },
      { key: 'category', label: 'category', type: 'Aa', role: 'DIMENSION', semanticDesc: 'Product line grouping (e.g. Licenses, Services, Hardware). Use to aggregate and compare revenue across types of offering.' },
      { key: 'unit_cost', label: 'unit_cost', type: '$', role: 'MEASURE', agg: 'AVG', semanticDesc: 'Cost to the business per product unit in USD, averaged across orders. Multiply by units sold to estimate total cost of goods sold (COGS).' },
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
  { order_id: 10041, customer_id: 201, product_id: 301, order_date: '2025-03-01', amount: '$840', revenue_net: '$620', full_name: 'Priya Sharma', region: 'APAC', segment: 'Enterprise', product_name: 'Pro Seat', category: 'Licenses', unit_cost: '$220' },
  { order_id: 10042, customer_id: null, product_id: 302, order_date: '2025-03-02', amount: '$320', revenue_net: '$210', full_name: null, region: null, segment: null, product_name: 'Starter Pack', category: 'Licenses', unit_cost: '$110' },
  { order_id: 10043, customer_id: 203, product_id: 303, order_date: '2025-03-02', amount: '$1,200', revenue_net: '$940', full_name: 'Carlos Vega', region: 'LATAM', segment: 'Mid-Market', product_name: 'Enterprise Suite', category: 'Licenses', unit_cost: '$260' },
];

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
              <FormulaEditor
                value={fieldFormulas[fieldMeta.key] ?? (fieldMeta.formula || '')}
                onChange={(v) => setFieldFormulas((prev) => ({ ...prev, [fieldMeta.key]: v }))}
                availableFields={canvasEntities.flatMap((e) => e.fields)}
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
function CalcFieldModal({ isOpen, onClose, onSave, availableFields }) {
  const [fieldName, setFieldName] = useState('');
  const [formula, setFormula] = useState('');
  const [agg, setAgg] = useState('SUM');

  const resetState = () => { setFieldName(''); setFormula(''); setAgg('SUM'); };

  const handleSave = () => {
    if (!fieldName.trim()) return;
    onSave({ name: fieldName.trim(), formula, agg });
    resetState();
  };

  const handleClose = () => { onClose(); resetState(); };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Viewport className="dialog-viewport">
          <Dialog.Popup className="dialog-popup calc-field-modal">
            <div className="calc-field-header">
              <Dialog.Title className="modal-title">Add calculated field</Dialog.Title>
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
    fromEntity, toEntity, fromChoices, toChoices, from, to, desc,
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
        {desc && (
          <section className="sp-section">
            <p className="sp-lbl">Description</p>
            <p className="ds-fp-desc">{desc}</p>
          </section>
        )}
        {!desc && !role && (
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

function DatasetCanvasPaneInner({
  dataset, dataModels, isEditing, editDraft, setEditDraft,
  onEdit, onCancel, onSave, onOpenAddModel, onNavigateToModel,
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

  const buildNodes = useCallback(() =>
    activeEntities.map((e) => ({
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
    })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [activeEntities, positions, isEditing]);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(() => buildNodes());

  useEffect(() => {
    setRfNodes(buildNodes());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEntities.length, isEditing, positions]);

  const onNodeDragStop = useCallback((_, node) => {
    if (!isEditing) return;
    setPositions((prev) => ({ ...prev, [node.id]: node.position }));
  }, [isEditing]);

  const onInit = useCallback((instance) => {
    instance.fitView({ padding: 0.18, duration: 0, maxZoom: 1 });
  }, []);

  const stageBadgeClass = {
    draft: 'badge-draft',
    dev: 'badge-dev',
    production: 'badge-prod',
  }[dataset.stage] || 'badge-draft';

  return (
    <div className="ds-canvas-pane">
      {/* Header */}
      <div className="ds-canvas-header">
        <div className="ds-canvas-header-left">
          {isEditing ? (
            <input
              className="dm-name-input ds-name-input"
              value={editDraft.name}
              onChange={(e) => setEditDraft((p) => ({ ...p, name: e.target.value }))}
              autoFocus
            />
          ) : (
            <h2 className="dm-title">{dataset.name}</h2>
          )}
          <span className={`badge ${stageBadgeClass}`}>{dataset.stage}</span>
        </div>
        <div className="dm-header-actions">
          {isEditing ? (
            <>
              <button className="btn" onClick={onCancel}>Cancel</button>
              <button className="btn btn-primary" onClick={() => onSave(editDraft)}>Save</button>
            </>
          ) : (
            <button className="btn" onClick={onEdit}>Edit</button>
          )}
        </div>
      </div>

      {/* Description */}
      {isEditing ? (
        <textarea
          className="dm-desc-ta ds-desc-ta"
          value={editDraft.desc ?? ''}
          onChange={(e) => setEditDraft((p) => ({ ...p, desc: e.target.value }))}
          placeholder="Describe this dataset for AI and collaborators…"
        />
      ) : (
        dataset.desc && <p className="dm-desc ds-desc">{dataset.desc}</p>
      )}

      {/* Unsaved-change banner (edit mode notice) */}
      {isEditing && (
        <div className="ds-edit-banner">
          <span>Edit mode — changes are not saved until you click Save.</span>
        </div>
      )}

      {/* Canvas */}
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

        {/* Float layer */}
        <div className="canvas-float-layer" aria-hidden="false">
          {isEditing && (
            <button className="float-btn float-left ds-add-model-btn" onClick={onOpenAddModel}>
              + Add Data Model
            </button>
          )}
          {!isEditing && (
            <span className="ds-readonly-badge">Read only</span>
          )}
        </div>
      </div>
      </DsActiveFieldContext.Provider>

      {/* Empty state */}
      {activeEntities.length === 0 && (
        <div className="ds-canvas-empty">
          {isEditing
            ? <><p>No Data Models yet.</p><button className="btn btn-primary" onClick={onOpenAddModel}>+ Add Data Model</button></>
            : <p>This dataset has no Data Models configured yet. Click Edit to add some.</p>
          }
        </div>
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
    if (isEditing) {
      // eslint-disable-next-line no-alert
      if (!window.confirm('You have unsaved changes. Navigate away and lose them?')) return;
    }
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

const dsNodeTypes = { dsEntity: DsEntityCardNode };

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
  models: 'Data Models',
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
function DataModelDetail({ model, isEditing, editDraft, setIsEditing, setEditDraft, onSave, onCancel }) {
  const [fieldSearch, setFieldSearch] = useState('');
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
      {/* Header */}
      <div className="dm-header">
        <div className="dm-header-left">
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

      {/* Description */}
      {isEditing ? (
        <textarea
          className="dm-desc-ta"
          value={editDraft.description}
          onChange={(e) => setEditDraft((p) => ({ ...p, description: e.target.value }))}
          placeholder="Describe this model for AI and collaborators…"
        />
      ) : (
        <p className="dm-desc">{model.description}</p>
      )}

      {/* Fields section header */}
      <div className="dm-fields-header">
        <span className="dm-fields-title">Visible fields <span className="dm-fields-count">({visibleCount} of {active.fields.length})</span></span>
        <input
          className="dm-field-search"
          placeholder="Search fields…"
          value={fieldSearch}
          onChange={(e) => setFieldSearch(e.target.value)}
        />
      </div>

      {/* Fields table */}
      <table className="dm-fields-table">
        <thead>
          <tr>
            <th className="dm-th dm-th-check">
              <input type="checkbox" style={{ opacity: 0, pointerEvents: 'none' }} aria-hidden="true" />
            </th>
            <th className="dm-th dm-th-field">Field</th>
            <th className="dm-th dm-th-display">Display name</th>
            <th className="dm-th dm-th-role">Role</th>
            <th className="dm-th dm-th-desc">Description</th>
            <th className="dm-th dm-th-opts">
              <button className="plain-btn dm-col-opts" aria-label="Column options">⋯</button>
            </th>
          </tr>
        </thead>
        <tbody>
          {dimensionFields.length > 0 && (
            <>
              <tr className="dm-group-row">
                <td colSpan={6}>
                  <span className="dm-group-label">Dimensions</span>
                  <span className="dm-group-count">{dimensionFields.length}</span>
                </td>
              </tr>
              {dimensionFields.map((field) => (
                <DataModelFieldRow
                  key={field.key}
                  field={field}
                  isEditing={isEditing}
                  onToggleVisible={() => toggleFieldVisible(field.key)}
                  onUpdateField={(prop, val) => updateDraftField(field.key, prop, val)}
                />
              ))}
            </>
          )}
          {measureFields.length > 0 && (
            <>
              <tr className="dm-group-row">
                <td colSpan={6}>
                  <span className="dm-group-label">Measures</span>
                  <span className="dm-group-count">{measureFields.length}</span>
                </td>
              </tr>
              {measureFields.map((field) => (
                <DataModelFieldRow
                  key={field.key}
                  field={field}
                  isEditing={isEditing}
                  onToggleVisible={() => toggleFieldVisible(field.key)}
                  onUpdateField={(prop, val) => updateDraftField(field.key, prop, val)}
                />
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DataModelFieldRow({ field, isEditing, onToggleVisible, onUpdateField }) {
  const isVisible = field.visible !== false;
  const autoName = autoDisplayName(field.key);
  const displayName = field.displayName || '';
  const isAutoName = !displayName || displayName === autoName;

  return (
    <tr className={`dm-field-row ${!isVisible ? 'dm-row-hidden' : ''}`}>
      <td className="dm-td dm-td-check">
        <input
          type="checkbox"
          checked={isVisible}
          onChange={onToggleVisible}
          disabled={!isEditing}
          aria-label={`Include ${field.label}`}
        />
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
          <span className={`role-pill role-${field.role?.toLowerCase()}`}>{field.role}</span>
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
      <td className="dm-td dm-td-opts" />
    </tr>
  );
}

function App() {
  const [view, setView] = useState('catalog');
  // eslint-disable-next-line no-unused-vars
  const [search] = useState('');
  const [stage, setStage] = useState('dev');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightMode, setRightMode] = useState('sql');
  const [activeJoin, setActiveJoin] = useState(null);
  const [activeField, setActiveField] = useState(null);
  const [fieldDescriptions, setFieldDescriptions] = useState(() =>
    Object.fromEntries(
      INITIAL_ENTITIES.flatMap((e) => e.fields.filter((f) => f.semanticDesc).map((f) => [f.key, f.semanticDesc]))
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
  // eslint-disable-next-line no-unused-vars
  const [models, setModels] = useState(MODELS);

  // ── Catalog state (new two-pane layout) ────────────────────────────────
  const [objectType, setObjectType] = useState('models'); // left-pane tab only
  const [selectedObjectId, setSelectedObjectId] = useState(null);  // right-pane item id
  const [selectedObjectType, setSelectedObjectType] = useState(null); // right-pane item type
  const [catalogSearch, setCatalogSearch] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(null);
  const [dataModels, setDataModels] = useState(DATA_MODELS_INITIAL);
  const [datasets, setDatasets] = useState(DATASETS_INITIAL);
  const [metrics] = useState(METRICS_INITIAL);
  const [addModelOpen, setAddModelOpen] = useState(false);

  // Add data source modal state
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [addSourceContext, setAddSourceContext] = useState('editor'); // 'editor' | 'new-model'
  const [connectedSources] = useState(() => new Set(['sales-db', 'product-db']));
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
            calculation_method: f.calc ? 'derived' : (DBT_AGG_MAP[f.agg] || 'sum'),
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

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="app">
      <nav className="nav">
        {/* ── Left ── */}
        <div className="nav-left">
          {view === 'catalog' ? (
            <div className="nav-brand">
              <span className="nav-brand-dot" />
              <span>Reveal</span>
              <span className="nav-brand-sub">Data Catalog</span>
            </div>
          ) : (
            <>
              <button className="plain-btn nav-back" title="Back to catalog" onClick={() => setView('catalog')}>←</button>
              <Menu.Root>
                <Menu.Trigger className="plain-btn nav-model-btn">Sales overview ▾</Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner sideOffset={6}>
                    <Menu.Popup className="menu-popup">
                      <Menu.Item className="menu-item">Rename dataset</Menu.Item>
                      <Menu.Item className="menu-item">Edit description</Menu.Item>
                      <Menu.Item className="menu-item">Duplicate</Menu.Item>
                      <Menu.Separator className="menu-sep" />
                      <Menu.Item className="menu-item" onClick={() => setStage('production')}>Promote to production</Menu.Item>
                      <Menu.Item className="menu-item" onClick={() => setStage('draft')}>Move to draft</Menu.Item>
                      <Menu.Separator className="menu-sep" />
                      <Menu.Item className="menu-item danger">Delete dataset</Menu.Item>
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
        {view === 'catalog' && (
          <div className="nav-right">
            <button className="btn" onClick={() => setAddSourceOpen(true)}>Edit data sources</button>
          </div>
        )}
        {view === 'editor' && (
          <div className="nav-right">
            <button className="btn" onClick={() => setView('inspect')}>Inspect view</button>
            <button className="btn btn-primary" onClick={() => setAiOpen(true)}>Save dataset</button>
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
          <div className="catalog-layout">
            <CatalogLeftPane
              objectType={objectType}
              setObjectType={setObjectType}
              catalogSearch={catalogSearch}
              setCatalogSearch={setCatalogSearch}
              selectedObjectId={selectedObjectId}
              selectedObjectType={selectedObjectType}
              onSelectItem={(id, type) => { setSelectedObjectId(id); setSelectedObjectType(type); setIsEditing(false); setEditDraft(null); }}
              dataModels={dataModels}
              setDataModels={setDataModels}
              datasets={datasets}
              setDatasets={setDatasets}
              metrics={metrics}
              isEditing={isEditing}
              onOpenEditor={(datasetStage) => { setView('editor'); setStage(datasetStage); }}
              onEditModel={(modelId) => {
                const model = dataModels.find((m) => m.id === modelId);
                if (!model) return;
                setSelectedObjectId(modelId);
                setSelectedObjectType('models');
                setEditDraft(JSON.parse(JSON.stringify(model)));
                setIsEditing(true);
              }}
              onEditDataset={(dsId) => {
                const allDs = [...datasets.draft, ...datasets.dev, ...datasets.production];
                const ds = allDs.find((d) => d.id === dsId);
                if (!ds) return;
                setSelectedObjectId(dsId);
                setSelectedObjectType('datasets');
                setEditDraft(JSON.parse(JSON.stringify(ds)));
                setIsEditing(true);
              }}
            />
            <div className="cat-right-pane">
              {/* Data Model detail */}
              {selectedObjectType === 'models' && selectedObjectId && (
                <DataModelDetail
                  model={dataModels.find((m) => m.id === selectedObjectId)}
                  isEditing={isEditing}
                  editDraft={editDraft}
                  setIsEditing={setIsEditing}
                  setEditDraft={setEditDraft}
                  onSave={(draft) => {
                    setDataModels((prev) => prev.map((m) => m.id === draft.id ? draft : m));
                    setIsEditing(false);
                    setEditDraft(null);
                  }}
                  onCancel={() => { setIsEditing(false); setEditDraft(null); }}
                />
              )}

              {/* Dataset canvas */}
              {selectedObjectType === 'datasets' && selectedObjectId && (() => {
                const allDs = [...datasets.draft, ...datasets.dev, ...datasets.production];
                const ds = allDs.find((d) => d.id === selectedObjectId);
                if (!ds) return null;
                return (
                  <DatasetCanvasPane
                    key={selectedObjectId}
                    dataset={ds}
                    dataModels={dataModels}
                    isEditing={isEditing}
                    editDraft={editDraft}
                    setEditDraft={setEditDraft}
                    onEdit={() => {
                      setEditDraft(JSON.parse(JSON.stringify(ds)));
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
                    onNavigateToModel={(id) => {
                      setObjectType('models');
                      setSelectedObjectId(id);
                      setSelectedObjectType('models');
                      setIsEditing(false);
                      setEditDraft(null);
                    }}
                  />
                );
              })()}

              {/* Empty states — shown when nothing of the current tab type is selected */}
              {!selectedObjectId && objectType === 'models' && (
                <div className="cat-right-empty">
                  <p>Select a Data Model from the list to view its fields and semantic definitions.</p>
                </div>
              )}
              {!selectedObjectId && objectType === 'datasets' && (
                <div className="cat-right-empty">
                  <p>Select a Dataset to inspect its join canvas and field configuration.</p>
                </div>
              )}
              {!selectedObjectId && objectType === 'metrics' && (
                <div className="cat-right-empty">
                  <p>Select a Metric to view its definition and dataset context.</p>
                </div>
              )}
              {/* Cross-type selection hint */}
              {selectedObjectId && selectedObjectType !== objectType && (
                <div className="cat-right-cross-hint">
                  Showing {selectedObjectType} detail. Select an item from the list above to switch.
                </div>
              )}
            </div>
          </div>

          {/* Add Data Models modal — always rendered when a dataset is selected so it persists across tab switches */}
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
                    {group.tables.map((tableId) => {
                      const entity = canvasEntities.find((e) => e.id === tableId);
                      return (
                        <div
                          key={tableId}
                          className={`tbl-row ${activeTableId === tableId ? 'active' : ''}`}
                          onClick={() => setActiveTableId(tableId)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter') setActiveTableId(tableId); }}
                        >
                          <span className="tbl-row-name">{tableId}</span>
                          {entity?.primary && <span className="tbl-primary-pill">primary</span>}
                          <button
                            className="plain-btn tbl-row-remove"
                            onClick={(e) => { e.stopPropagation(); handleRemoveFromCanvas(tableId); }}
                            aria-label={`Remove ${tableId}`}
                            title={`Remove ${tableId}`}
                          >×</button>
                        </div>
                      );
                    })}
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
                onAddCalcField={(entityId) => setAddCalcFieldEntityId(entityId)}
                activeTableId={activeTableId}
                setActiveTableId={setActiveTableId}
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
                  <tr>{visibleFields.map((field) => {
                    const isNum = ['#', '$', 'fx'].includes(field.type);
                    return <th key={`${field.entity}-${field.key}`} className={`${isNum ? 'col-num' : ''} ${activeField?.fieldKey === field.key ? 'active-col' : ''}`}>{field.label}</th>;
                  })}</tr>
                </thead>
                <tbody>
                  {PREVIEW_ROWS.map((row) => (
                    <tr key={row.order_id}>
                      {visibleFields.map((field) => {
                        const isNum = ['#', '$', 'fx'].includes(field.type);
                        return (
                          <td key={`${row.order_id}-${field.entity}-${field.key}`} className={`${isNum ? 'col-num' : ''} ${activeField?.fieldKey === field.key ? 'active-col' : ''}`}>
                            {row[field.key] === null ? <span className="null-val">null</span> : row[field.key]}
                          </td>
                        );
                      })}
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
                    <button className={`insp-toggle-btn ${inspectView === 'json' ? 'active' : ''}`} onClick={() => setInspectView('json')}>JSON</button>
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

              {inspectView === 'json' ? (
                <div className="insp-md-wrap">
                  <JsonHighlight json={inspectJson} />
                </div>
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

      {/* Calculated field modal */}
      <CalcFieldModal
        isOpen={addCalcFieldEntityId !== null}
        onClose={() => setAddCalcFieldEntityId(null)}
        onSave={handleSaveCalcField}
        availableFields={canvasEntities.flatMap((e) => e.fields)}
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
    </div>
  );
}

export default App;
