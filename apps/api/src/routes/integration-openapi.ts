// OpenAPI 3.1 description of the Integration API v1 (served at /api/v1/openapi.json).
const ext = { type: 'string', maxLength: 100, description: 'Your system’s id' };
const nstr = (max: number, description?: string) => ({ type: ['string', 'null'], maxLength: max, ...(description ? { description } : {}) });

const Customer = {
  type: 'object', required: ['external_id'], additionalProperties: false,
  properties: {
    external_id: ext,
    code: { type: 'string', maxLength: 40, description: 'Customer code; generated (CUST-000123) when omitted on create' },
    kind: { enum: ['company', 'group'] },
    name: { type: 'string', minLength: 2, maxLength: 200, description: 'Required on create' },
    trade_name: nstr(200), vat: nstr(20, 'Greek ΑΦΜ is validated when country is GR'), tax_office: nstr(100), gemi: nstr(30), activity: nstr(200),
    status: { enum: ['active', 'prospect', 'negotiation', 'inactive'] }, category: nstr(60),
    tags: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 20 }, source: nstr(60),
    parent_external_id: { ...nstr(100), description: 'external_id of a customer of kind "group"' },
    account_manager_email: { type: ['string', 'null'], format: 'email', description: 'Must be a member of the organisation' },
    email: { type: ['string', 'null'], format: 'email' }, phone: nstr(40), mobile: nstr(40), website: nstr(200),
    address: { type: 'object', properties: { street: nstr(200), city: nstr(100), postal: nstr(20), region: nstr(100, 'Prefecture (νομός)'), country: { type: 'string', minLength: 2, maxLength: 2 } } },
    geo_zone: nstr(80, 'Value name; created if missing'),
    payment_terms: nstr(40), credit_limit: { type: ['number', 'null'], minimum: 0 }, discount: { type: 'number', minimum: 0, maximum: 100 },
    annual_value: { type: 'number', minimum: 0 }, notes: nstr(10000),
  },
};
const Branch = {
  type: 'object', required: ['external_id'], additionalProperties: false,
  properties: {
    external_id: ext, customer_external_id: { ...ext, description: 'Required on create' },
    name: { type: 'string', maxLength: 200, description: 'Legal name; required on create' }, trade_name: nstr(200),
    address: nstr(200), city: nstr(100), postal_code: nstr(20), region: nstr(100, 'Prefecture (νομός)'), phone: nstr(40), manager_name: nstr(120),
    status: { enum: ['active', 'inactive'] },
    geo_zone: nstr(80, 'Value name; created if missing'), fee_schedule: nstr(80, 'Αμοιβολόγιο (value name)'),
    tour: nstr(80, 'Εξόρμηση (value name)'), ongoing_status: nstr(80, 'Status on going (value name)'),
    seasonality: { enum: ['all_year', 'summer', 'winter', 'custom'] },
    season_months: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 12 }, description: 'Used when seasonality = custom' },
  },
};
const Space = {
  type: 'object', required: ['external_id'], additionalProperties: false,
  properties: {
    external_id: ext, branch_external_id: { ...ext, description: 'Required on create' },
    name: { type: 'string', maxLength: 200, description: 'Required on create' }, kind: { enum: ['retail', 'warehouse', 'office', 'department'] },
    area_sqm: { type: ['number', 'null'], minimum: 0 }, notes: nstr(2000),
  },
};
const ItemResult = {
  type: 'object',
  properties: {
    external_id: { type: 'string' }, status: { enum: ['created', 'updated', 'error'] }, id: { type: 'string', format: 'uuid' },
    error: { type: 'string', description: 'validation, invalid_afm, name_required, customer_not_found, branch_not_found, parent_not_found, parent_not_group, code_taken, account_manager_not_found, …' },
    detail: {},
  },
};
const BatchResult = {
  type: 'object',
  properties: { created: { type: 'integer' }, updated: { type: 'integer' }, failed: { type: 'integer' }, duration_ms: { type: 'integer' }, results: { type: 'array', items: ItemResult } },
};

const listParams = [
  { name: 'updated_since', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Only records changed since (incremental sync)' },
  { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'next_cursor from the previous page' },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
];

function resource(name: string, tag: string, schema: object, extraListParams: object[] = []) {
  return {
    [`/api/v1/${name}`]: {
      get: { tags: [tag], summary: `List ${name} (ordered by updated_at)`, parameters: [...listParams, ...extraListParams],
        responses: { 200: { description: 'Page', content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: schema }, next_cursor: { type: ['string', 'null'] } } } } } } } },
    },
    [`/api/v1/${name}/batch`]: {
      post: { tags: [tag], summary: `Create or update up to 1000 ${name}`, description: 'Each item is processed independently; failed items do not affect the others.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['items'], properties: { items: { type: 'array', maxItems: 1000, items: schema } } } } } },
        responses: { 200: { description: 'Per-item results', content: { 'application/json': { schema: BatchResult } } }, 403: { description: 'Read-only key' } } },
    },
    [`/api/v1/${name}/{external_id}`]: {
      parameters: [{ name: 'external_id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { tags: [tag], summary: 'Get one', responses: { 200: { description: 'Record', content: { 'application/json': { schema } } }, 404: { description: 'Not found' } } },
      put: { tags: [tag], summary: 'Create or update one (idempotent)', description: 'Only the fields sent are changed; null clears a field.',
        requestBody: { content: { 'application/json': { schema } } },
        responses: { 201: { description: 'Created', content: { 'application/json': { schema: ItemResult } } }, 200: { description: 'Updated' }, 422: { description: 'Rejected', content: { 'application/json': { schema: ItemResult } } } } },
      delete: { tags: [tag], summary: name === 'customers' ? 'Archive (history is kept)' : 'Delete', responses: { 200: { description: 'Done' }, 404: { description: 'Not found' } } },
    },
  };
}

export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'SoftifyOS Integration API', version: '1.0.0',
    description: 'Sync customers, stores and spaces from your ERP. Records are identified by your own ids (external_id); '
      + 'sending a record again updates it. Create an API key in Settings → Integrations. Rate limit: 1200 requests/minute per key.',
  },
  servers: [{ url: '/' }],
  security: [{ apiKey: [] }],
  components: {
    securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'sos_<prefix>_<secret>' } },
    schemas: { Customer, Branch, Space, ItemResult, BatchResult },
  },
  paths: {
    '/api/v1/ping': { get: { summary: 'Check the key', responses: { 200: { description: 'OK' }, 401: { description: 'Invalid key' } } } },
    ...resource('customers', 'Customers', Customer),
    ...resource('branches', 'Stores', Branch, [{ name: 'customer_external_id', in: 'query', schema: { type: 'string' } }]),
    ...resource('spaces', 'Spaces', Space, [{ name: 'branch_external_id', in: 'query', schema: { type: 'string' } }]),
  },
};
