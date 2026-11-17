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
    custom: { type: 'object', additionalProperties: true, description: 'Custom fields (Settings → Module Forms) by key. Sent keys are merged; null clears a key; unknown keys are rejected.' },
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
    custom: { type: 'object', additionalProperties: true, description: 'Custom fields (Settings → Module Forms) by key. Sent keys are merged; null clears a key; unknown keys are rejected.' },
  },
};
const Space = {
  type: 'object', required: ['external_id'], additionalProperties: false,
  properties: {
    external_id: ext, branch_external_id: { ...ext, description: 'Required on create' },
    name: { type: 'string', maxLength: 200, description: 'Required on create' }, kind: { type: 'string', maxLength: 80, description: 'Space kind by name from the value list (added if missing), e.g. Αποθήκη' },
    area_sqm: { type: ['number', 'null'], minimum: 0 }, notes: nstr(2000),
    custom: { type: 'object', additionalProperties: true, description: 'Custom fields (Settings → Module Forms) by key. Sent keys are merged; null clears a key; unknown keys are rejected.' },
  },
};
const Activity = {
  type: 'object', required: ['external_id'], additionalProperties: false,
  properties: {
    external_id: ext,
    type: { type: 'string', description: 'Activity type key (Settings → CRM activities), e.g. call, meeting, visit, task. Required on create.' },
    subject: { type: 'string', maxLength: 200, description: 'Required on create' }, body: nstr(20000),
    status: { enum: ['planned', 'in_progress', 'done', 'cancelled'] }, priority: { type: 'integer', minimum: 1, maximum: 3, description: '1 high, 2 normal, 3 low' },
    due_at: { type: ['string', 'null'], format: 'date-time' }, duration_min: { type: 'integer', minimum: 0 }, all_day: { type: 'boolean' }, location: nstr(300),
    owner_email: { type: ['string', 'null'], format: 'email', description: 'Assigned user (member of the organisation)' },
    customer_external_id: { ...nstr(100), description: 'external_id of the customer' },
    outcome: { ...nstr(40), description: 'Outcome key, e.g. interested, no_answer' }, outcome_note: nstr(5000),
    remind_before_min: { type: ['integer', 'null'], minimum: 0 },
    custom: { type: 'object', additionalProperties: true, description: 'Custom fields of the activity form' },
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
    [`/api/v1/${name}/by-id/{id}`]: {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'SoftifyOS id (e.g. data.id of a webhook)' }],
      get: { tags: [tag], summary: 'Get one by SoftifyOS id', description: 'For records without external_id (created in the app). The response also contains id.',
        responses: { 200: { description: 'Record', content: { 'application/json': { schema } } }, 404: { description: 'Not found' } } },
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

const ListName = { type: 'string', enum: ['geo_zone', 'fee_schedule', 'tour', 'ongoing_status', 'prefecture', 'customer_category', 'customer_source', 'payment_terms', 'space_kind'] };
const ListValue = { type: 'object', properties: { name: { type: 'string' }, active: { type: 'boolean' }, sort: { type: 'integer' }, created_at: { type: 'string', format: 'date-time' } } };
const ListValueIn = {
  type: 'object', required: ['name'], additionalProperties: false,
  properties: {
    name: { type: 'string', maxLength: 80, description: 'Value (matched accent/case-insensitively). Created if missing.' },
    rename_from: { type: 'string', maxLength: 80, description: 'Rename this existing value to name; records that use it are updated too.' },
    active: { type: 'boolean', description: 'false = hidden from new selections (records keep it)' },
    sort: { type: 'integer', minimum: 0 },
  },
};
const listPaths = {
  '/api/v1/lists': {
    get: { tags: ['Value lists'], summary: 'All value lists with counts', description: 'Needs the "Value lists" read permission.',
      responses: { 200: { description: 'Lists', content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: {
        list: ListName, description: { type: 'string' }, stored_as: { type: 'string', enum: ['name', 'reference'] }, values: { type: 'integer' }, active: { type: 'integer' } } } } } } } } } } },
  },
  '/api/v1/lists/{list}': {
    parameters: [{ name: 'list', in: 'path', required: true, schema: ListName }],
    get: { tags: ['Value lists'], summary: 'Values of a list', parameters: [{ name: 'include_inactive', in: 'query', schema: { type: 'string', enum: ['0', '1'], default: '1' } }],
      responses: { 200: { description: 'Values', content: { 'application/json': { schema: { type: 'object', properties: { list: ListName, values: { type: 'array', items: ListValue } } } } } } } },
  },
  '/api/v1/lists/{list}/values': {
    parameters: [{ name: 'list', in: 'path', required: true, schema: ListName }],
    put: { tags: ['Value lists'], summary: 'Create / update / rename up to 500 values', description: 'Each value is processed independently (per-item results).',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['values'], properties: { values: { type: 'array', maxItems: 500, items: ListValueIn } } } } } },
      responses: { 200: { description: 'Per-item results (name, status created/updated/error)' }, 403: { description: 'No write permission for value lists' } } },
  },
  '/api/v1/lists/{list}/values/{name}': {
    parameters: [{ name: 'list', in: 'path', required: true, schema: ListName }, { name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
    delete: { tags: ['Value lists'], summary: 'Delete a value nobody uses', responses: { 200: { description: 'Deleted' }, 404: { description: 'Not found' }, 409: { description: 'in_use: deactivate it with active=false instead' } } },
  },
};

export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'SoftifyOS Integration API', version: '1.0.0',
    description: 'Sync customers, stores, spaces and value lists from your ERP. Records are identified by your own ids (external_id); '
      + 'sending a record again updates it. Create an API key in Settings → Integrations. Rate limit: 1200 requests/minute per key.\n\n'
      + 'Read responses also include parent_id / customer_id / branch_id (SoftifyOS ids) next to the external ids.\n\n'
      + 'Webhooks: POST to your URL with headers X-Softify-Event, X-Softify-Delivery and X-Softify-Signature (t=<unix>,v1=<HMAC-SHA256(secret, "<t>.<body>")>). '
      + 'Body: { id, event, occurred_at, source, data, changed_fields? }. For customer/branch/space created, updated and archived events, data is the full record '
      + '(the same shape as GET by-id, custom fields included); *.updated events add changed_fields (e.g. ["status", "address.city", "custom.size"]). '
      + 'Deleted events carry id, external_id and name.',
  },
  servers: [{ url: '/' }],
  security: [{ apiKey: [] }],
  components: {
    securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'sos_<prefix>_<secret>' } },
    schemas: { Customer, Branch, Space, Activity, ItemResult, BatchResult },
  },
  paths: {
    '/api/v1/ping': { get: { summary: 'Check the key', responses: { 200: { description: 'OK' }, 401: { description: 'Invalid key' } } } },
    ...resource('customers', 'Customers', Customer),
    ...resource('branches', 'Stores', Branch, [{ name: 'customer_external_id', in: 'query', schema: { type: 'string' } }]),
    ...resource('spaces', 'Spaces', Space, [{ name: 'branch_external_id', in: 'query', schema: { type: 'string' } }]),
    ...resource('activities', 'CRM activities', Activity, [{ name: 'customer_external_id', in: 'query', schema: { type: 'string' } }, { name: 'status', in: 'query', schema: { enum: ['planned', 'in_progress', 'done', 'cancelled'] } }]),
    ...listPaths,
  },
};
