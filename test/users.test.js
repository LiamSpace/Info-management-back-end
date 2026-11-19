const assert = require('node:assert/strict');
const { before, after, beforeEach, test } = require('node:test');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const originalCorsOrigins = process.env.CORS_ORIGINS;
const frontendOrigin = 'http://192.168.31.190:8002';
process.env.CORS_ORIGINS = frontendOrigin;
const app = require('../app');
const { validateUser, validateSearch, userId, validateUserIds } = require('../modules/users/validation');

const records = new Map();
let server;
let baseUrl;
let databaseError;
const originalDb = mongoose.connection.db;
const originalState = mongoose.connection.readyState;

const users = {
  async findOne(filter) {
    return records.get(String(filter._id)) || null;
  },
  find(filter = {}) {
    return { toArray: async () => [...records.values()].filter(user =>
      Object.entries(filter).every(([field, condition]) => condition.$in.some(value =>
        value === null ? user[field] === null || !Object.hasOwn(user, field) : user[field] === value))) };
  },
  async insertOne(user) {
    const insertedId = new mongoose.Types.ObjectId();
    records.set(String(insertedId), { ...user, _id: insertedId });
    return { insertedId };
  },
  async insertMany(documents, options) {
    assert.equal(options.ordered, true);
    const insertedIds = {};
    for (const [index, document] of documents.entries()) {
      insertedIds[index] = (await this.insertOne(document)).insertedId;
    }
    return { insertedCount: documents.length, insertedIds };
  },
  async findOneAndUpdate(filter, update, options) {
    assert.ok(filter._id instanceof mongoose.Types.ObjectId);
    assert.deepEqual(Object.keys(update), ['$set']);
    assert.equal(options.returnDocument, 'after');
    assert.equal(options.includeResultMetadata, false);
    const user = records.get(String(filter._id));
    if (!user) return null;
    Object.assign(user, update.$set);
    return user;
  },
  async deleteOne(filter) {
    assert.ok(filter._id instanceof mongoose.Types.ObjectId);
    return { deletedCount: Number(records.delete(String(filter._id))) };
  },
  async deleteMany(filter) {
    let deletedCount = 0;
    for (const id of filter._id.$in) {
      assert.ok(id instanceof mongoose.Types.ObjectId);
      deletedCount += Number(records.delete(String(id)));
    }
    return { deletedCount };
  }
};

before(async () => {
  mongoose.connection.db = {
    collection(name) {
      if (databaseError) throw databaseError;
      if (name === 'dictionary-options') {
        return { find: () => ({ toArray: async () => [] }) };
      }
      assert.equal(name, 'users-list');
      return users;
    }
  };
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/users`;
});

beforeEach(() => {
  records.clear();
  databaseError = null;
  mongoose.connection.readyState = 1;
});

after(async () => {
  if (originalCorsOrigins === undefined) {
    delete process.env.CORS_ORIGINS;
  } else {
    process.env.CORS_ORIGINS = originalCorsOrigins;
  }
  mongoose.connection.db = originalDb;
  mongoose.connection.readyState = originalState;
  if (server) await new Promise(resolve => server.close(resolve));
});

async function request(path, method = 'GET', body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const result = await response.json();
  assertEnvelope(response, result);
  return { status: response.status, body: result };
}

function assertEnvelope(response, body) {
  assert.deepEqual(Object.keys(body).sort(), ['code', 'data', 'message']);
  assert.equal(typeof body.message, 'string');
  assert.ok(body.message.length > 0);
  assert.equal(body.code, response.ok ? 0 : response.status);
  if (!response.ok) assert.equal(body.data, null);
}

async function importRows(rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Users').addRows(rows);
  return uploadFile(await workbook.xlsx.writeBuffer());
}

async function uploadFile(buffer, filename = 'users.xlsx', field = 'file') {
  const form = new FormData();
  form.append(field, new Blob([buffer]), filename);
  const response = await fetch(`${baseUrl}/import`, { method: 'POST', body: form });
  const result = await response.json();
  assertEnvelope(response, result);
  return { status: response.status, body: result };
}

test('CORS allows the configured frontend origin but not other origins', async () => {
  const response = await fetch(`${baseUrl}/list`, { headers: { Origin: frontendOrigin } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), frontendOrigin);
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.match(response.headers.get('Vary'), /Origin/);
  assertEnvelope(response, await response.json());
  for (const origin of ['http://untrusted.example', `${frontendOrigin}.untrusted.example`]) {
    const blocked = await fetch(`${baseUrl}/list`, { headers: { Origin: origin } });
    assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), null);
    assertEnvelope(blocked, await blocked.json());
  }
});

test('CORS preflight supports JSON, POST and DELETE before database checks', async () => {
  mongoose.connection.readyState = 0;
  for (const method of ['POST', 'DELETE']) {
    const response = await fetch(`${baseUrl}/batch`, {
      method: 'OPTIONS',
      headers: {
        Origin: frontendOrigin,
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': 'content-type,authorization'
      }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), frontendOrigin);
    assert.ok(response.headers.get('Access-Control-Allow-Methods').split(',').includes(method));
    assert.match(response.headers.get('Access-Control-Allow-Headers'), /content-type/i);
    assert.match(response.headers.get('Access-Control-Allow-Headers'), /authorization/i);
    assert.equal(await response.text(), '');
  }
});

test('CORS headers are included in JSON parsing and database errors', async () => {
  const malformed = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { Origin: frontendOrigin, 'Content-Type': 'application/json' },
    body: '{'
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get('Access-Control-Allow-Origin'), frontendOrigin);
  assertEnvelope(malformed, await malformed.json());
  mongoose.connection.readyState = 0;
  const unavailable = await fetch(`${baseUrl}/list`, { headers: { Origin: frontendOrigin } });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('Access-Control-Allow-Origin'), frontendOrigin);
  assertEnvelope(unavailable, await unavailable.json());
});

test('health and unknown API routes use the response envelope', async () => {
  mongoose.connection.readyState = 0;
  const health = await fetch(new URL('/api/health', baseUrl));
  const healthBody = await health.json();
  assert.equal(health.status, 200);
  assertEnvelope(health, healthBody);
  assert.deepEqual(healthBody.data, { status: 'ok' });
  mongoose.connection.readyState = 1;
  for (const path of ['/api/unknown', '/api/users/unknown']) {
    const response = await fetch(new URL(path, baseUrl), { headers: { Origin: frontendOrigin } });
    const body = await response.json();
    assert.equal(response.status, 404);
    assertEnvelope(response, body);
    assert.equal(body.message, '接口不存在');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), frontendOrigin);
  }
});

test('unexpected API errors use a 500 envelope without exposing internal details', async context => {
  const originalJson = app.response.json;
  context.mock.method(app.response, 'json', function(body) {
    if (body.code === 0) throw new Error('internal detail must not be returned');
    return originalJson.call(this, body);
  });
  const response = await fetch(new URL('/api/health', baseUrl), { headers: { Origin: frontendOrigin } });
  const body = await response.json();
  assert.equal(response.status, 500);
  assertEnvelope(response, body);
  assert.equal(body.message, '服务器内部错误，请查看后端日志');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), frontendOrigin);
});

test('create, list, partially edit and delete a user', async () => {
  assert.deepEqual((await request('/list')).body.data, []);
  const created = await request('/', 'POST', { name: 'Alice', phone: '00123' });
  assert.equal(created.status, 201);
  assert.equal(created.body.message, '新增成功');
  assert.match(created.body.data._id, /^[a-f\d]{24}$/);
  assert.equal((await request('/list')).body.data.length, 1);
  const edited = await request(`/${created.body.data._id}`, 'POST', { name: 'Bob' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.data.name, 'Bob');
  assert.equal(edited.body.data.phone, '00123');
  assert.equal(edited.body.data._id, created.body.data._id);
  const unsupported = await request(`/${created.body.data._id}`, 'PATCH', { name: 'Unexpected' });
  assert.equal(unsupported.status, 404);
  assert.deepEqual((await request('/list')).body.data, [edited.body.data]);
  assert.equal((await request(`/${created.body.data._id}`, 'DELETE')).body.data.deletedCount, 1);
  assert.deepEqual((await request('/list')).body.data, []);
});

test('user search combines fields with AND and selections within each field with OR', async context => {
  for (const user of [
    { name: 'Alice', departmentCode: 'finance', positionCode: 'lead', rankCode: 'senior', active: true },
    { name: 'Bob', departmentCode: 'hr', positionCode: 'member', rankCode: 'senior', active: true },
    { name: 'Carol', departmentCode: 'hr', positionCode: 'lead', rankCode: 'junior', active: true },
    { name: 'Dave', departmentCode: 'engineering', positionCode: 'lead', rankCode: 'senior', active: true },
    { name: 'Eve', departmentCode: 'finance', positionCode: 'member', rankCode: 'senior', active: false },
    { name: 'Frank', departmentCode: 'finance', positionCode: 'intern', rankCode: 'senior', active: true }
  ]) await users.insertOne(user);
  const find = context.mock.method(users, 'find');
  const single = await request('/search', 'POST', { filters: {
    departmentCode: 'finance', positionCode: 'lead', rankCode: 'senior', active: true
  } });
  assert.equal(single.status, 200);
  assert.equal(single.body.message, '查询成功');
  assert.deepEqual(single.body.data.map(user => user.name), ['Alice']);
  const multiple = await request('/search', 'POST', { filters: {
    departmentCode: ['finance', 'hr', 'finance'], positionCode: ['lead', 'member'], rankCode: 'senior', active: true
  } });
  assert.equal(multiple.status, 200);
  assert.deepEqual(multiple.body.data.map(user => user.name), ['Alice', 'Bob']);
  assert.deepEqual(find.mock.calls[1].arguments[0], {
    departmentCode: { $in: ['finance', 'hr'] }, positionCode: { $in: ['lead', 'member'] },
    rankCode: { $in: ['senior'] }, active: { $in: [true] }
  });
  assert.equal(records.size, 6);
  const unmatched = await request('/search', 'POST', { filters: { name: 'Nobody' } });
  assert.equal(unmatched.status, 200);
  assert.deepEqual(unmatched.body.data, []);
  assert.equal((await request('/list')).body.data.length, 6);
});

test('user search ignores empty selections but retains exact scalar types and null semantics', async context => {
  await users.insertOne({ name: 'Exact', count: 0, active: false, note: null });
  await users.insertOne({ name: 'String', count: '0', active: 'false', note: '' });
  await users.insertOne({ name: 'Missing', count: 1, active: true });
  const find = context.mock.method(users, 'find');
  const exact = await request('/search', 'POST', { filters: { count: 0, active: false, departmentCode: [] } });
  assert.equal(exact.status, 200);
  assert.deepEqual(exact.body.data.map(user => user.name), ['Exact']);
  assert.deepEqual(find.mock.calls[0].arguments[0], { count: { $in: [0] }, active: { $in: [false] } });
  for (const filters of [{}, { departmentCode: [] }]) {
    assert.deepEqual((await request('/search', 'POST', { filters })).body.data, (await request('/list')).body.data);
  }
  const nulls = await request('/search', 'POST', { filters: { note: [null] } });
  assert.deepEqual(nulls.body.data.map(user => user.name), ['Exact', 'Missing']);
  const emptyString = await request('/search', 'POST', { filters: { note: '' } });
  assert.deepEqual(emptyString.body.data.map(user => user.name), ['String']);
  assert.deepEqual((await request('/search', 'POST', { filters: { name: 'Ex' } })).body.data, []);
});

test('user search rejects unsafe filters and excessive input before querying', async context => {
  await users.insertOne({ name: 'Alice' });
  const find = context.mock.method(users, 'find');
  const invalidBodies = [
    {}, [], null, { filters: null }, { filters: [] }, { filters: 'name' },
    { filters: {}, sort: 'name' }, { filters: {}, $where: 'true' },
    { filters: { name: { $ne: null } } }, { filters: { name: [{ $regex: '.*' }] } },
    { filters: { name: [['Alice']] } }, { filters: { name: 'a'.repeat(4001) } },
    { filters: { name: Array(101).fill('Alice') } },
    { filters: Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`field${index}`, 'value'])) }
  ];
  for (const field of ['__proto__', 'constructor', 'prototype', '_id', '$or', '$where', 'profile.name', 'name\u0000', ' name', '', 'a'.repeat(101)]) {
    invalidBodies.push({ filters: { [field]: 'Alice' } });
  }
  for (const body of invalidBodies) {
    const result = await request('/search', 'POST', body);
    assert.equal(result.status, 400, JSON.stringify(body));
  }
  assert.equal(find.mock.callCount(), 0);
  assert.equal(records.size, 1);
});

test('user search validates scalar values and accepts documented limits', async () => {
  const input = { filters: { age: [0, 1], active: false, note: null, departmentCode: [] } };
  const parsed = validateSearch(input);
  assert.deepEqual(parsed, input);
  assert.notEqual(parsed, input);
  for (const value of [undefined, NaN, Infinity, -Infinity, new Date(), /Alice/]) {
    assert.throws(() => validateSearch({ filters: { name: value } }), { statusCode: 400 });
    assert.throws(() => validateSearch({ filters: { name: [value] } }), { statusCode: 400 });
  }
  assert.throws(() => validateSearch(undefined), { statusCode: 400 });
  const maximumFilters = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`field${index}`, []]));
  const maximumValues = Array.from({ length: 100 }, (_, index) => index);
  assert.deepEqual(validateSearch({ filters: maximumFilters }).filters, maximumFilters);
  await users.insertOne({ name: 'A.*', age: 99 });
  await users.insertOne({ name: 'Alice', age: 100 });
  const boundary = await request('/search', 'POST', { filters: { age: maximumValues } });
  assert.equal(boundary.status, 200);
  assert.deepEqual(boundary.body.data.map(user => user.name), ['A.*']);
  assert.deepEqual((await request('/search', 'POST', { filters: { name: 'A.*' } })).body.data, boundary.body.data);
  assert.deepEqual((await request('/search', 'POST', { filters: { unknownField: 'value' } })).body.data, []);
});

test('user search retains CORS headers and reports unavailable databases', async () => {
  const response = await fetch(`${baseUrl}/search`, {
    method: 'POST',
    headers: { Origin: frontendOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filters: {} })
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), frontendOrigin);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assertEnvelope(response, await response.json());
  mongoose.connection.readyState = 0;
  assert.equal((await request('/search', 'POST', { filters: {} })).status, 503);
  mongoose.connection.readyState = 1;
  databaseError = new Error('connection lost');
  assert.equal((await request('/search', 'POST', { filters: { name: ['Alice'] } })).status, 503);
});

test('rejects empty users, nested values, unsafe fields and excessive fields', async () => {
  const invalidUsers = [null, [], {}, { name: ' ' }, { name: {} },
    { _id: 'abc' }, { $set: 'name' }, { 'profile.name': 'Alice' },
    { constructor: 'Alice' }, { name: 'a'.repeat(4001) },
    Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`field${index}`, 'value']))];
  for (const user of invalidUsers) {
    assert.equal((await request('/', 'POST', user)).status, 400);
  }
  assert.equal(records.size, 0);
});

test('Zod returns parsed values and rejects non-JSON values and unsafe keys', () => {
  const input = { name: 'Alice', phone: '00123', age: 0, active: false, email: null };
  const parsed = validateUser(input);
  assert.deepEqual(parsed, input);
  assert.notEqual(parsed, input);
  for (const value of [undefined, NaN, Infinity, -Infinity, [], {}]) {
    assert.throws(() => validateUser({ name: value }), { statusCode: 400 });
  }
  for (const field of ['__proto__', 'prototype', 'constructor', '_id', '$set', 'profile.name', ' name', '']) {
    assert.throws(() => validateUser({ [field]: 'Alice' }), { statusCode: 400 });
  }
  assert.throws(() => validateUser(undefined), { statusCode: 400 });
  assert.throws(() => validateUser({ name: null }), { statusCode: 400 });
  assert.deepEqual(validateUser({ active: false }), { active: false });
  assert.deepEqual(validateUser({ age: 0 }), { age: 0 });
  const id = 'ABCDEF0123456789ABCDEF01';
  assert.ok(userId(id) instanceof mongoose.Types.ObjectId);
  assert.equal(String(userId(id)), id.toLowerCase());
  assert.deepEqual(validateUserIds([id]).map(String), [id.toLowerCase()]);
  for (const value of [null, 123, {}, 'bad']) {
    assert.throws(() => userId(value), { statusCode: 400 });
    assert.throws(() => validateUserIds([id, value]), { statusCode: 400 });
  }
});

test('editing can clear a field without altering other fields', async () => {
  const created = await request('/', 'POST', { name: 'Alice', phone: '00123' });
  const edited = await request(`/${created.body.data._id}`, 'POST', { phone: null });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.body.data, { ...created.body.data, phone: null });
  const rejected = await request(`/${created.body.data._id}`, 'POST', { phone: [] });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, 400);
  assert.match(rejected.body.message, /phone/);
  assert.deepEqual((await request('/list')).body.data, [edited.body.data]);
});

test('validates IDs and edit fields, and reports missing users', async () => {
  const id = String(new mongoose.Types.ObjectId());
  assert.equal((await request('/invalid', 'POST', { name: 'Alice' })).status, 400);
  assert.equal((await request('/invalid', 'DELETE')).status, 400);
  assert.equal((await request(`/${id}`, 'POST', {})).status, 400);
  assert.equal((await request(`/${id}`, 'POST', { _id: id })).status, 400);
  assert.equal((await request(`/${id}`, 'POST', { name: 'Alice' })).status, 404);
  assert.equal((await request(`/${id}`, 'DELETE')).status, 404);
});

test('returns JSON errors for malformed and oversized JSON bodies', async () => {
  for (const [body, expectedStatus] of [['{', 400], [JSON.stringify({ name: 'a'.repeat(1024 * 1024) }), 413]]) {
    const response = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    assert.equal(response.status, expectedStatus);
    assertEnvelope(response, await response.json());
  }
  assert.equal(records.size, 0);
});

test('batch deletion affects only selected users and validates every ID first', async () => {
  const first = await request('/', 'POST', { name: 'Alice' });
  const second = await request('/', 'POST', { name: 'Bob' });
  assert.equal((await request('/batch', 'DELETE', { ids: [first.body.data._id, 'bad'] })).status, 400);
  assert.equal(records.size, 2);
  for (const ids of [[], 'all', Array(1001).fill(first.body.data._id)]) {
    assert.equal((await request('/batch', 'DELETE', { ids })).status, 400);
  }
  const deleted = await request('/batch', 'DELETE', { ids: [first.body.data._id, first.body.data._id] });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.data.deletedCount, 1);
  assert.equal((await request('/list')).body.data[0]._id, second.body.data._id);
});

test('imports xlsx rows and preserves text phone numbers, zero and false', async () => {
  const result = await importRows([
    ['name', 'phone', 'age', 'active'],
    ['Alice', '00123', 0, false],
    [],
    ['Bob', '00456', 25, true]
  ]);
  assert.equal(result.status, 201);
  assert.equal(result.body.code, 0);
  assert.equal(result.body.data.insertedCount, 2);
  assert.equal(result.body.data.ids.length, 2);
  const imported = (await request('/list')).body.data;
  assert.equal(imported[0].phone, '00123');
  assert.equal(imported[0].age, 0);
  assert.equal(imported[0].active, false);
});

test('rejects invalid Excel headers, formulas and row limits before writing', async () => {
  const invalidSheets = [
    [], [['name']], [['name'], [' ']],
    [['name', 'name'], ['Alice', 'Bob']],
    [['_id'], ['forbidden']],
    [['$set'], ['forbidden']],
    [['name', null, 'phone'], ['Alice', null, '123']],
    [['name'], ['Alice'], ['Bob', 'extra']],
    [['name'], ['Alice'], [{ formula: '1+1', result: 2 }]],
    [['name'], ['Alice'], ['a'.repeat(4001)]],
    [['name'], ...Array.from({ length: 1001 }, () => ['Alice'])]
  ];
  for (const rows of invalidSheets) {
    assert.equal((await importRows(rows)).status, 400);
    assert.equal(records.size, 0);
  }
});

test('rejects missing files, wrong extensions, corrupt files and oversized uploads', async () => {
  assert.equal((await request('/import', 'POST', {})).status, 400);
  assert.equal((await uploadFile('bad', 'users.xls')).status, 400);
  assert.equal((await uploadFile('bad')).status, 400);
  assert.equal((await uploadFile('bad', 'users.xlsx', 'upload')).status, 400);
  assert.equal((await uploadFile(Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413);
  assert.equal(records.size, 0);
});

test('returns 503 for unavailable database and 409 for unique index conflicts', async () => {
  mongoose.connection.readyState = 0;
  assert.equal((await request('/list')).status, 503);
  assert.equal((await request('/', 'POST', { name: 'Alice' })).status, 503);
  assert.equal((await request('/import', 'POST', {})).status, 503);
  mongoose.connection.readyState = 1;
  databaseError = Object.assign(new Error('duplicate'), { code: 11000 });
  assert.equal((await request('/', 'POST', { name: 'Alice' })).status, 409);
  databaseError = new Error('connection lost');
  assert.equal((await request('/list')).status, 503);
});