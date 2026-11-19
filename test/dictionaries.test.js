const assert = require('node:assert/strict');
const { before, after, beforeEach, test } = require('node:test');
const { isDeepStrictEqual } = require('node:util');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const app = require('../app');
const { ensureIndexes } = require('../modules/dictionaries/service');
const { validateType, validateBatchUpdate, validateQuery } = require('../modules/dictionaries/validation');

const options = new Map();
const users = new Map();
const originalDb = mongoose.connection.db;
const originalState = mongoose.connection.readyState;
let server;
let baseUrl;
let databaseError;

function matches(document, filter) {
  return Object.entries(filter).every(([field, value]) => {
    const candidates = value && typeof value === 'object' && '$in' in value ? value.$in : [value];
    return candidates.some(candidate => field === '_id'
      ? String(document[field]) === String(candidate)
      : document[field] === candidate);
  });
}

const optionCollection = {
  async createIndex(keys, settings) {
    assert.deepEqual(keys, { type: 1, value: 1 });
    assert.deepEqual(settings, { unique: true, name: 'dictionary_type_value_unique' });
    return settings.name;
  },
  find(filter) {
    return {
      toArray: async () => [...options.values()].filter(option => matches(option, filter)),
      sort(order) {
        assert.deepEqual(order, { sort: 1, _id: 1 });
        return { toArray: async () => [...options.values()].filter(option => matches(option, filter))
          .sort((first, second) => first.sort - second.sort || String(first._id).localeCompare(String(second._id))) };
      }
    };
  },
  async findOne(filter) {
    return [...options.values()].find(option => matches(option, filter)) || null;
  },
  async insertOne(option) {
    if ([...options.values()].some(existing => existing.type === option.type && existing.value === option.value)) {
      throw Object.assign(new Error('duplicate key'), { code: 11000 });
    }
    const insertedId = new mongoose.Types.ObjectId();
    options.set(String(insertedId), { ...option, _id: insertedId });
    return { insertedId };
  },
  async bulkWrite(operations, settings) {
    assert.deepEqual(settings, { ordered: true });
    let matchedCount = 0;
    let modifiedCount = 0;
    let insertedCount = 0;
    let deletedCount = 0;
    for (const { updateOne, insertOne, deleteOne } of operations) {
      if (deleteOne) {
        const option = await this.findOne(deleteOne.filter);
        if (option) deletedCount += Number(options.delete(String(option._id)));
        continue;
      }
      if (insertOne) {
        await this.insertOne(insertOne.document);
        insertedCount += 1;
        continue;
      }
      assert.equal(updateOne.upsert, false);
      assert.equal(Object.hasOwn(updateOne.update.$set, '_id'), false);
      const option = await this.findOne(updateOne.filter);
      if (!option) continue;
      matchedCount += 1;
      if (!isDeepStrictEqual(option, { ...option, ...updateOne.update.$set })) modifiedCount += 1;
      Object.assign(option, updateOne.update.$set);
    }
    return { matchedCount, modifiedCount, insertedCount, deletedCount };
  }
};

const userCollection = {
  async findOne(filter) {
    return [...users.values()].find(user => matches(user, filter)) || null;
  },
  find(filter = {}) {
    return { toArray: async () => [...users.values()].filter(user => matches(user, filter)) };
  },
  async insertOne(user) {
    const insertedId = new mongoose.Types.ObjectId();
    users.set(String(insertedId), { ...user, _id: insertedId });
    return { insertedId };
  },
  async insertMany(documents) {
    const insertedIds = {};
    for (const [index, document] of documents.entries()) {
      insertedIds[index] = (await this.insertOne(document)).insertedId;
    }
    return { insertedCount: documents.length, insertedIds };
  },
  async findOneAndUpdate(filter, update) {
    const user = await this.findOne(filter);
    if (!user) return null;
    Object.assign(user, update.$set);
    return user;
  }
};

before(async () => {
  mongoose.connection.db = {
    collection(name) {
      if (databaseError) throw databaseError;
      if (name === 'dictionary-options') return optionCollection;
      assert.equal(name, 'users-list');
      return userCollection;
    }
  };
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/dictionaries`;
});

beforeEach(() => {
  options.clear();
  users.clear();
  databaseError = null;
  mongoose.connection.readyState = 1;
});

after(async () => {
  mongoose.connection.db = originalDb;
  mongoose.connection.readyState = originalState;
  if (server) await new Promise(resolve => server.close(resolve));
});

async function request(path, method = 'GET', body) {
  const url = path.startsWith('/api/') ? new URL(path, baseUrl) : `${baseUrl}${path}`;
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return readResponse(response);
}

async function readResponse(response) {
  const result = await response.json();
  assert.deepEqual(Object.keys(result).sort(), ['code', 'data', 'message']);
  assert.equal(result.code, response.ok ? 0 : response.status);
  assert.equal(typeof result.message, 'string');
  if (!response.ok) assert.equal(result.data, null);
  return { status: response.status, ...result };
}

async function importUsers(rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Users').addRows(rows);
  const form = new FormData();
  form.append('file', new Blob([await workbook.xlsx.writeBuffer()]), 'users.xlsx');
  const response = await fetch(new URL('/api/users/import', baseUrl), { method: 'POST', body: form });
  return readResponse(response);
}

async function seedOption(type, fields = {}) {
  const now = new Date();
  const result = await optionCollection.insertOne({
    type, value: randomUUID(), label: 'Option', sort: 10, enabled: true,
    createdAt: now, updatedAt: now, ...fields
  });
  return JSON.parse(JSON.stringify(options.get(String(result.insertedId))));
}

test('user dictionary responses resolve labels in one lookup for list and search without mutating storage', async context => {
  await seedOption('department', { value: 'shared', label: 'Finance' });
  await seedOption('position', { value: 'shared', label: 'Manager' });
  await seedOption('rank', { value: 'shared', label: 'Senior', enabled: false });
  const first = await userCollection.insertOne({
    name: 'Alice', departmentCode: 'shared', positionCode: 'shared', rankCode: 'shared'
  });
  await userCollection.insertOne({ name: 'Bob', departmentCode: 'missing', positionCode: null, rankCode: '' });
  await userCollection.insertOne({ name: 'Carol', department: 'Legacy free text' });
  const before = JSON.parse(JSON.stringify([...users.values()]));
  const find = context.mock.method(optionCollection, 'find');
  const listed = await request('/api/users/list');
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.data, [
    { ...before[0], departmentCode: { value: 'shared', label: 'Finance' },
      positionCode: { value: 'shared', label: 'Manager' }, rankCode: { value: 'shared', label: 'Senior' } },
    { ...before[1], departmentCode: { value: 'missing', label: null },
      positionCode: { value: null, label: null }, rankCode: { value: '', label: null } },
    before[2]
  ]);
  assert.equal(find.mock.callCount(), 1);
  assert.deepEqual(find.mock.calls[0].arguments[0], {
    type: { $in: ['department', 'position', 'rank'] }, value: { $in: ['shared', 'missing'] }
  });
  assert.deepEqual(find.mock.calls[0].arguments[1], { projection: { _id: 0, type: 1, value: 1, label: 1 } });
  const searched = await request('/api/users/search', 'POST', { filters: { departmentCode: ['shared'] } });
  assert.equal(searched.status, 200);
  assert.deepEqual(searched.data, [listed.data[0]]);
  assert.equal(find.mock.callCount(), 2);
  assert.equal(users.get(String(first.insertedId)).departmentCode, 'shared');
  assert.deepEqual(JSON.parse(JSON.stringify([...users.values()])), before);
});

test('user dictionary responses format create and update results but keep scalar request values', async () => {
  for (const type of ['department', 'position', 'rank']) {
    await seedOption(type, { value: 'shared', label: `${type} label` });
  }
  await seedOption('department', { value: 'other', label: 'Other department' });
  const created = await request('/api/users', 'POST', {
    name: 'Alice', departmentCode: 'shared', positionCode: 'shared', rankCode: 'shared'
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.departmentCode, { value: 'shared', label: 'department label' });
  assert.deepEqual(created.data.positionCode, { value: 'shared', label: 'position label' });
  assert.deepEqual(created.data.rankCode, { value: 'shared', label: 'rank label' });
  assert.equal(users.get(created.data._id).departmentCode, 'shared');
  const updated = await request(`/api/users/${created.data._id}`, 'POST', {
    departmentCode: 'other', positionCode: null
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.data.departmentCode, { value: 'other', label: 'Other department' });
  assert.deepEqual(updated.data.positionCode, { value: null, label: null });
  assert.deepEqual(updated.data.rankCode, created.data.rankCode);
  assert.equal(users.get(created.data._id).departmentCode, 'other');
  assert.equal(users.get(created.data._id).positionCode, null);
  assert.deepEqual((await request('/api/users/list')).data, [updated.data]);
  assert.equal((await request('/api/users', 'POST', { name: 'Bob', departmentCode: updated.data.departmentCode })).status, 400);
  assert.equal((await request(`/api/users/${created.data._id}`, 'POST', { departmentCode: updated.data.departmentCode })).status, 400);
  assert.equal((await request('/api/users/search', 'POST', { filters: { departmentCode: updated.data.departmentCode } })).status, 400);
});

test('user dictionary responses reflect renamed labels without rewriting user values', async () => {
  const option = await seedOption('department', { label: 'Original' });
  const created = await request('/api/users', 'POST', { name: 'Alice', departmentCode: option.value });
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.departmentCode, { value: option.value, label: 'Original' });
  const renamed = await request('/department/options/batch', 'POST', {
    options: [{ _id: option._id, label: 'Renamed' }]
  });
  assert.equal(renamed.status, 200);
  const listed = await request('/api/users/list');
  const searched = await request('/api/users/search', 'POST', { filters: { departmentCode: option.value } });
  assert.deepEqual(listed.data[0].departmentCode, { value: option.value, label: 'Renamed' });
  assert.deepEqual(searched.data, listed.data);
  assert.equal(users.get(created.data._id).departmentCode, option.value);
  assert.equal((await request('/department/options/batch', 'POST', { options: [] })).status, 409);
});

test('user dictionary responses avoid dictionary queries for empty results or empty reference values', async context => {
  const find = context.mock.method(optionCollection, 'find', () => {
    throw new Error('unexpected dictionary lookup');
  });
  assert.deepEqual((await request('/api/users/list')).data, []);
  const created = await request('/api/users', 'POST', { name: 'Plain' });
  assert.equal(created.status, 201);
  assert.equal(Object.hasOwn(created.data, 'departmentCode'), false);
  const updated = await request(`/api/users/${created.data._id}`, 'POST', { departmentCode: null, positionCode: '' });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.data.departmentCode, { value: null, label: null });
  assert.deepEqual(updated.data.positionCode, { value: '', label: null });
  assert.equal(Object.hasOwn(updated.data, 'rankCode'), false);
  assert.deepEqual((await request('/api/users/list')).data, [updated.data]);
  assert.deepEqual((await request('/api/users/search', 'POST', { filters: { name: 'Plain' } })).data, [updated.data]);
  assert.deepEqual((await request('/api/users/search', 'POST', { filters: { name: 'Nobody' } })).data, []);
  assert.equal(find.mock.callCount(), 0);
  assert.equal(users.get(created.data._id).departmentCode, null);
  assert.equal(users.get(created.data._id).positionCode, '');
});

test('user dictionary responses report lookup failure instead of returning missing labels', async context => {
  const created = await userCollection.insertOne({ name: 'Alice', departmentCode: 'code' });
  context.mock.method(optionCollection, 'find', () => {
    throw new Error('dictionary lookup failed');
  });
  assert.equal((await request('/api/users/list')).status, 503);
  assert.equal((await request('/api/users/search', 'POST', { filters: { departmentCode: 'code' } })).status, 503);
  assert.equal(users.get(String(created.insertedId)).departmentCode, 'code');
});

test('dictionary configuration reads type metadata and sorted options in one query', async context => {
  const find = context.mock.method(optionCollection, 'find');
  const empty = await request('/options');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.data, {
    department: { type: 'department', name: '部门', userField: 'departmentCode', options: [] },
    position: { type: 'position', name: '职务', userField: 'positionCode', options: [] },
    rank: { type: 'rank', name: '职级', userField: 'rankCode', options: [] }
  });
  const first = await seedOption('department', { sort: 20 });
  const earlier = await seedOption('department', { sort: 5, enabled: false });
  const tied = await seedOption('department', { sort: 5 });
  await seedOption('education');
  const result = await request('/options');
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, {
    ...empty.data, department: { ...empty.data.department, options: [earlier, tied, first] }
  });
  assert.equal(find.mock.callCount(), 2);
});

test('dictionary configuration saves all labels while preserving stable identities and other fields', async context => {
  const first = await seedOption('department');
  const second = await seedOption('department', { label: 'Disabled', enabled: false, sort: 5 });
  const rank = await seedOption('rank');
  users.set('existing', { departmentCode: first.value });
  const bulkWrite = context.mock.method(optionCollection, 'bulkWrite');
  const result = await request('/department/options/batch', 'POST', { options: [
    { _id: first._id.toUpperCase(), label: ' Renamed ' },
    { _id: second._id, label: 'Renamed disabled' }
  ] });
  assert.equal(result.status, 200);
  assert.equal(bulkWrite.mock.callCount(), 1);
  for (const operation of bulkWrite.mock.calls[0].arguments[0]) {
    assert.equal(operation.updateOne.filter.type, 'department');
    assert.deepEqual(Object.keys(operation.updateOne.update.$set).sort(), ['label', 'updatedAt']);
  }
  const updatedAt = result.data.options[0].updatedAt;
  assert.ok(Number.isFinite(Date.parse(updatedAt)));
  assert.deepEqual(result.data, {
    type: 'department', name: '部门', userField: 'departmentCode', options: [
      { ...second, label: 'Renamed disabled', updatedAt }, { ...first, label: 'Renamed', updatedAt }
    ]
  });
  const listed = await request('/options');
  assert.deepEqual(listed.data.department, result.data);
  assert.deepEqual(listed.data.rank.options, [rank]);
  assert.equal(options.size, 3);
  assert.equal(users.get('existing').departmentCode, first.value);
});

test('dictionary batch save creates options without IDs and returns stable generated identifiers', async () => {
  const generatedValues = new Set();
  for (const [type, userField] of Object.entries({ department: 'departmentCode', position: 'positionCode', rank: 'rankCode' })) {
    const created = await request(`/${type}/options/batch`, 'POST', {
      options: [{ label: ' New option ' }, { label: 'New option' }]
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.type, type);
    assert.equal(created.data.userField, userField);
    assert.equal(created.data.options.length, 2);
    assert.notEqual(created.data.options[0]._id, created.data.options[1]._id);
    for (const option of created.data.options) {
      assert.match(option._id, /^[a-f\d]{24}$/);
      assert.match(option.value, /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
      generatedValues.add(option.value);
      assert.equal(option.type, type);
      assert.equal(option.label, 'New option');
      assert.equal(option.sort, 10);
      assert.equal(option.enabled, true);
      assert.ok(Number.isFinite(Date.parse(option.createdAt)));
      assert.equal(option.createdAt, option.updatedAt);
    }
    assert.deepEqual((await request('/options')).data[type], created.data);
    const saved = await request(`/${type}/options/batch`, 'POST', {
      options: created.data.options.map(({ _id }) => ({ _id, label: 'Renamed' }))
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.data.options.map(({ _id, value, createdAt }) => ({ _id, value, createdAt })),
      created.data.options.map(({ _id, value, createdAt }) => ({ _id, value, createdAt })));
    assert.ok(saved.data.options.every(option => option.label === 'Renamed'));
    const value = saved.data.options[0].value;
    const user = await request('/api/users', 'POST', { name: 'Alice', [userField]: value });
    assert.equal(user.status, 201);
    assert.deepEqual(user.data[userField], { value, label: 'Renamed' });
    assert.equal((await importUsers([['name', userField], ['Bob', value]])).status, 201);
  }
  assert.equal(generatedValues.size, 6);
  assert.equal(options.size, 6);
});

test('dictionary batch save mixes existing labels and new options in one write', async context => {
  const active = await seedOption('department', { sort: 0 });
  const disabled = await seedOption('department', { enabled: false, sort: 5 });
  const rank = await seedOption('rank');
  users.set('existing', { departmentCode: active.value });
  const bulkWrite = context.mock.method(optionCollection, 'bulkWrite');
  const result = await request('/department/options/batch', 'POST', { options: [
    { _id: active._id, label: 'Renamed' }, { label: ' New ' },
    { _id: disabled._id, label: 'Renamed disabled' }, { label: 'Another new' }
  ] });
  assert.equal(result.status, 200);
  assert.equal(bulkWrite.mock.callCount(), 1);
  const operations = bulkWrite.mock.calls[0].arguments[0];
  assert.equal(operations.filter(operation => operation.insertOne).length, 2);
  assert.equal(operations.filter(operation => operation.updateOne).length, 2);
  assert.equal(result.data.options.length, 4);
  const updatedAt = result.data.options[0].updatedAt;
  assert.deepEqual(result.data.options.slice(0, 2), [
    { ...active, label: 'Renamed', updatedAt }, { ...disabled, label: 'Renamed disabled', updatedAt }
  ]);
  assert.deepEqual(result.data.options.slice(2).map(option => option.label), ['New', 'Another new']);
  assert.equal(new Set(result.data.options.map(option => option.value)).size, 4);
  const listed = await request('/options');
  assert.deepEqual(listed.data.department, result.data);
  assert.deepEqual(listed.data.rank.options, [rank]);
  assert.equal(users.get('existing').departmentCode, active.value);
});

test('dictionary batch save deletes omitted options while renaming and creating in one write', async context => {
  const retained = await seedOption('department', { sort: 0 });
  const removed = await seedOption('department');
  const disabled = await seedOption('department', { enabled: false });
  const rank = await seedOption('rank', { value: removed.value });
  users.set('existing', { departmentCode: retained.value, rankCode: removed.value });
  const bulkWrite = context.mock.method(optionCollection, 'bulkWrite');
  const findUser = context.mock.method(userCollection, 'findOne');
  const result = await request('/department/options/batch', 'POST', { options: [
    { _id: retained._id.toUpperCase(), label: 'Renamed' }, { label: 'New' }
  ] });
  assert.equal(result.status, 200);
  assert.equal(bulkWrite.mock.callCount(), 1);
  assert.equal(findUser.mock.callCount(), 1);
  assert.deepEqual(findUser.mock.calls[0].arguments[0], {
    departmentCode: { $in: [removed.value, disabled.value] }
  });
  const operations = bulkWrite.mock.calls[0].arguments[0];
  const deletions = operations.filter(operation => operation.deleteOne);
  assert.equal(deletions.length, 2);
  for (const { deleteOne } of deletions) assert.equal(deleteOne.filter.type, 'department');
  assert.equal(options.has(removed._id), false);
  assert.equal(options.has(disabled._id), false);
  assert.deepEqual(result.data.options[0], { ...retained, label: 'Renamed', updatedAt: result.data.options[0].updatedAt });
  assert.equal(result.data.options.length, 2);
  assert.equal(result.data.options[1].label, 'New');
  assert.notEqual(result.data.options[1].value, removed.value);
  const listed = await request('/options');
  assert.deepEqual(listed.data.department, result.data);
  assert.deepEqual(listed.data.rank.options, [rank]);
  assert.equal(users.get('existing').departmentCode, retained.value);
});

test('dictionary batch save rejects referenced deletions before updating or inserting', async context => {
  const retained = await seedOption('department');
  const referenced = await seedOption('department', { enabled: false });
  const unreferenced = await seedOption('department');
  users.set('existing', { departmentCode: referenced.value });
  const bulkWrite = context.mock.method(optionCollection, 'bulkWrite');
  for (const submitted of [[], [{ _id: retained._id, label: 'Changed' }, { label: 'New' }]]) {
    const result = await request('/department/options/batch', 'POST', { options: submitted });
    assert.equal(result.status, 409);
    assert.match(result.message, /已被用户引用/);
  }
  assert.equal(bulkWrite.mock.callCount(), 0);
  assert.deepEqual((await request('/options')).data.department.options, [retained, referenced, unreferenced]);
});

test('dictionary batch save protects references for every dictionary type', async () => {
  for (const [type, userField] of Object.entries({ department: 'departmentCode', position: 'positionCode', rank: 'rankCode' })) {
    const referenced = await seedOption(type, { value: 'shared' });
    users.set(type, { [userField]: referenced.value });
    const blocked = await request(`/${type}/options/batch`, 'POST', { options: [] });
    assert.equal(blocked.status, 409);
    assert.deepEqual((await request('/options')).data[type].options, [referenced]);
    users.delete(type);
    const cleared = await request(`/${type}/options/batch`, 'POST', { options: [] });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.data.options, []);
  }
});

test('dictionary batch save stops all writes when deletion reference lookup fails', async context => {
  const retained = await seedOption('department');
  const removed = await seedOption('department');
  const bulkWrite = context.mock.method(optionCollection, 'bulkWrite');
  context.mock.method(userCollection, 'findOne', async () => {
    throw new Error('reference lookup failed');
  });
  const result = await request('/department/options/batch', 'POST', { options: [
    { _id: retained._id, label: 'Changed' }, { label: 'New' }
  ] });
  assert.equal(result.status, 503);
  assert.equal(bulkWrite.mock.callCount(), 0);
  assert.deepEqual((await request('/options')).data.department.options, [retained, removed]);
});

test('dictionary batch save detects missing deletion targets after preflight', async context => {
  const retained = await seedOption('department');
  const removed = await seedOption('department');
  const write = optionCollection.bulkWrite.bind(optionCollection);
  context.mock.method(optionCollection, 'bulkWrite', async (operations, settings) => {
    options.delete(removed._id);
    return write(operations, settings);
  });
  const result = await request('/department/options/batch', 'POST', { options: [
    { _id: retained._id, label: 'Changed' }
  ] });
  assert.equal(result.status, 409);
  assert.match(result.message, /可能已有部分更新/);
  assert.equal(options.has(removed._id), false);
  assert.equal(options.get(retained._id).label, 'Changed');
});

test('dictionary batch save validates new items and existing membership before any writes', async context => {
  const active = await seedOption('department');
  const disabled = await seedOption('department', { enabled: false });
  const foreign = await seedOption('rank');
  const valid = { _id: active._id, label: 'Changed' };
  const bulkWrite = context.mock.method(optionCollection, 'bulkWrite');
  for (const _id of [foreign._id, String(new mongoose.Types.ObjectId())]) {
    const result = await request('/department/options/batch', 'POST', { options: [
      { label: 'New' }, valid, { _id: disabled._id, label: 'Disabled' }, { _id, label: 'Invalid' }
    ] });
    assert.equal(result.status, 404);
  }
  for (const invalid of [
    { label: '' }, { label: ' ' }, { label: null }, { label: 123 }, { label: 'a'.repeat(101) },
    { label: 'New', value: 'custom' }, { label: 'New', enabled: false }, { label: 'New', sort: 1 }
  ]) {
    const result = await request('/department/options/batch', 'POST', { options: [
      valid, { _id: disabled._id, label: 'Disabled' }, { label: 'New valid' }, invalid
    ] });
    assert.equal(result.status, 400);
  }
  const oversized = await request('/department/options/batch', 'POST', {
    options: [valid, ...Array.from({ length: 1000 }, () => ({ label: 'New' }))]
  });
  assert.equal(oversized.status, 400);
  assert.equal(bulkWrite.mock.callCount(), 0);
  assert.equal(options.size, 3);
  assert.deepEqual((await request('/options')).data.department.options, [active, disabled]);
});

test('dictionary batch save reports insert failures without claiming rollback', async context => {
  const existing = await seedOption('department');
  const insert = optionCollection.insertOne.bind(optionCollection);
  let attempts = 0;
  context.mock.method(optionCollection, 'insertOne', async option => {
    attempts += 1;
    if (attempts === 2) throw new Error('connection lost during insert');
    return insert(option);
  });
  const result = await request('/department/options/batch', 'POST', { options: [
    { _id: existing._id, label: 'Renamed' }, { label: 'Inserted' }, { label: 'Not inserted' }
  ] });
  assert.equal(result.status, 503);
  assert.equal(options.size, 2);
  assert.equal(options.get(existing._id).label, 'Renamed');
  assert.equal(options.get(existing._id).value, existing.value);
  const listed = (await request('/options')).data.department.options;
  assert.deepEqual(listed.map(option => option.label), ['Renamed', 'Inserted']);
  assert.match(listed[1]._id, /^[a-f\d]{24}$/);
  assert.notEqual(listed[1].value, existing.value);
});

test('dictionary batch update rejects invalid batches before database writes', async context => {
  const created = await seedOption('department', { label: 'Finance' });
  const valid = { _id: created._id, label: 'Changed' };
  const find = context.mock.method(optionCollection, 'find');
  const bulkWrite = context.mock.method(optionCollection, 'bulkWrite');
  const invalidItems = [
    {}, { _id: created._id }, { ...valid, _id: '' }, { ...valid, _id: null }, { ...valid, _id: created.value },
    { ...valid, _id: 123 }, { ...valid, label: ' ' }, { ...valid, label: null },
    { ...valid, label: 123 }, { ...valid, label: 'a'.repeat(101) },
    { ...valid, sort: 10 }, { ...valid, enabled: false }, { ...valid, value: created.value },
    { ...valid, type: 'rank' }, { ...valid, createdAt: '2026-01-01' },
    { ...valid, updatedAt: '2026-01-01' }, { ...valid, unknown: true }
  ];
  const invalidBodies = [
    {}, [], { options: null }, { options: [valid], extra: true },
    { options: [valid, { ...valid, _id: valid._id.toUpperCase() }] },
    { options: Array.from({ length: 1001 }, () => ({ ...valid, _id: String(new mongoose.Types.ObjectId()) })) },
    ...invalidItems.map(item => ({ options: [valid, item] }))
  ];
  for (const body of invalidBodies) {
    assert.equal((await request('/department/options/batch', 'POST', body)).status, 400);
  }
  assert.equal((await request('/unknown/options/batch', 'POST', { options: [valid] })).status, 400);
  assert.equal(find.mock.callCount(), 0);
  assert.equal(bulkWrite.mock.callCount(), 0);
  assert.deepEqual((await request('/options')).data.department.options, [created]);
});

test('dictionary configuration clears unreferenced options with an empty list', async context => {
  await seedOption('department');
  await seedOption('department', { enabled: false });
  const rank = await seedOption('rank');
  const bulkWrite = context.mock.method(optionCollection, 'bulkWrite');
  const cleared = await request('/department/options/batch', 'POST', { options: [] });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.data, { type: 'department', name: '部门', userField: 'departmentCode', options: [] });
  assert.equal(bulkWrite.mock.callCount(), 1);
  const repeated = await request('/department/options/batch', 'POST', { options: [] });
  assert.equal(repeated.status, 200);
  assert.deepEqual(repeated.data, cleared.data);
  const empty = await request('/position/options/batch', 'POST', { options: [] });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.data, { type: 'position', name: '职务', userField: 'positionCode', options: [] });
  assert.equal(bulkWrite.mock.callCount(), 1);
  assert.deepEqual((await request('/options')).data.rank.options, [rank]);
  assert.equal(options.size, 1);
});

test('dictionary batch update rejects missing or foreign options without partial writes', async context => {
  const department = await seedOption('department', { label: 'Finance' });
  const rank = await seedOption('rank', { label: 'Senior' });
  const bulkWrite = context.mock.method(optionCollection, 'bulkWrite');
  for (const _id of [String(new mongoose.Types.ObjectId()), rank._id]) {
    const result = await request('/department/options/batch', 'POST', { options: [
      { _id: department._id, label: 'Changed' }, { _id, label: 'Foreign' }
    ] });
    assert.equal(result.status, 404);
    assert.match(result.message, /不存在或不属于/);
  }
  assert.equal(bulkWrite.mock.callCount(), 0);
  const listed = await request('/options');
  assert.deepEqual(listed.data.department.options, [department]);
  assert.deepEqual(listed.data.rank.options, [rank]);
  const updatedRank = await request('/rank/options/batch', 'POST', {
    options: [{ _id: rank._id, label: 'Updated rank' }]
  });
  assert.equal(updatedRank.status, 200);
  assert.equal(updatedRank.data.type, 'rank');
  assert.deepEqual(updatedRank.data.options, [{ ...rank, label: 'Updated rank', updatedAt: updatedRank.data.options[0].updatedAt }]);
});

test('dictionary batch update accepts 1000 options and preserves referenced values', async context => {
  const batch = [];
  const createdAt = new Date('2026-01-01T00:00:00Z');
  for (let index = 0; index < 1000; index += 1) {
    const _id = new mongoose.Types.ObjectId();
    options.set(String(_id), {
      _id, type: 'position', value: `position_${index}`, label: `Position ${index}`,
      sort: index, enabled: true, createdAt, updatedAt: createdAt
    });
    batch.push({ _id: String(_id), label: `Updated ${index}` });
  }
  users.set('existing', { positionCode: 'position_0' });
  const bulkWrite = context.mock.method(optionCollection, 'bulkWrite');
  const result = await request('/position/options/batch', 'POST', { options: batch });
  assert.equal(result.status, 200);
  assert.equal(result.data.type, 'position');
  assert.equal(result.data.options.length, 1000);
  assert.equal(bulkWrite.mock.callCount(), 1);
  assert.equal(options.size, 1000);
  for (const [index, option] of [...options.values()].entries()) {
    assert.equal(option.enabled, true);
    assert.equal(option.label, `Updated ${index}`);
    assert.equal(option.value, `position_${index}`);
    assert.equal(option.createdAt, createdAt);
  }
  assert.equal(users.get('existing').positionCode, 'position_0');
});

test('dictionary batch update reports concurrent deletion instead of complete success', async context => {
  const first = await seedOption('department', { label: 'First' });
  const second = await seedOption('department', { label: 'Second' });
  const write = optionCollection.bulkWrite.bind(optionCollection);
  context.mock.method(optionCollection, 'bulkWrite', async (operations, settings) => {
    options.delete(first._id);
    return write(operations, settings);
  });
  const result = await request('/department/options/batch', 'POST', { options: [
    { _id: first._id, label: 'Changed first' },
    { _id: second._id, label: 'Changed second' }
  ] });
  assert.equal(result.status, 409);
  assert.match(result.message, /可能已有部分更新/);
  assert.equal(options.has(first._id), false);
  assert.equal(options.get(second._id).label, 'Changed second');
});

test('dictionary batch update reports database failures including partial writes', async context => {
  const first = await seedOption('department', { label: 'First' });
  const second = await seedOption('department', { label: 'Second' });
  const body = { options: [
    { _id: first._id, label: 'Changed first' },
    { _id: second._id, label: 'Changed second' }
  ] };
  const write = optionCollection.bulkWrite.bind(optionCollection);
  const bulkWrite = context.mock.method(optionCollection, 'bulkWrite', async (operations, settings) => {
    await write(operations.slice(0, 1), settings);
    throw new Error('connection lost during bulk write');
  });
  mongoose.connection.readyState = 0;
  assert.equal((await request('/department/options/batch', 'POST', body)).status, 503);
  mongoose.connection.readyState = 1;
  databaseError = new Error('connection lost before lookup');
  assert.equal((await request('/department/options/batch', 'POST', body)).status, 503);
  assert.equal(bulkWrite.mock.callCount(), 0);
  assert.equal(options.get(first._id).label, 'First');
  databaseError = null;
  assert.equal((await request('/department/options/batch', 'POST', body)).status, 503);
  assert.equal(bulkWrite.mock.callCount(), 1);
  assert.equal(options.get(first._id).label, 'Changed first');
  assert.equal(options.get(second._id).label, 'Second');
});

test('dictionary index initialization requests the compound unique index', async () => {
  await ensureIndexes(mongoose.connection.db);
});

test('dictionary configuration rejects filtering to avoid incomplete save payloads', async context => {
  const find = context.mock.method(optionCollection, 'find');
  for (const query of ['enabled=true', 'enabled=false', 'enabled=true&enabled=false', 'type=department', 'unexpected=true']) {
    assert.equal((await request(`/options?${query}`)).status, 400);
  }
  assert.equal(find.mock.callCount(), 0);
});

test('all dictionary options report unavailable databases rather than empty success', async () => {
  mongoose.connection.readyState = 0;
  assert.equal((await request('/options')).status, 503);
  mongoose.connection.readyState = 1;
  databaseError = new Error('connection lost');
  assert.equal((await request('/options')).status, 503);
});

test('renaming dictionary options preserves UUID references in users and Excel', async () => {
  const userFields = { department: 'departmentCode', position: 'positionCode', rank: 'rankCode' };
  for (const [type, userField] of Object.entries(userFields)) {
    const created = await seedOption(type);
    const edited = await request(`/${type}/options/batch`, 'POST', {
      options: [{ _id: created._id, label: 'Renamed' }]
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.options[0].value, created.value);
    const user = await request('/api/users', 'POST', { name: 'Alice', [userField]: created.value });
    assert.equal(user.status, 201);
    assert.deepEqual(user.data[userField], { value: created.value, label: 'Renamed' });
    const imported = await importUsers([['name', userField], ['Bob', created.value]]);
    assert.equal(imported.status, 201);
    assert.equal(imported.data.insertedCount, 1);
  }
});

test('dictionary exposes only configuration read and label batch save routes', async () => {
  const created = await seedOption('department');
  const path = `/department/options/${created._id}`;
  for (const [method, route] of [
    ['GET', '/types'], ['GET', '/department/options'], ['POST', '/department/options'],
    ['POST', path], ['PATCH', path], ['DELETE', path], ['GET', '/department/options/batch']
  ]) {
    const body = method === 'POST' || method === 'PATCH' ? { label: 'Changed' } : undefined;
    assert.equal((await request(route, method, body)).status, 404);
  }
  assert.deepEqual((await request('/options')).data.department.options, [created]);
  assert.equal(options.size, 1);
});

test('user creation validates dictionary codes but keeps optional and unrelated fields compatible', async () => {
  for (const type of ['department', 'position', 'rank']) {
    await seedOption(type, { value: 'active', label: 'Active' });
    await seedOption(type, { value: 'disabled', label: 'Disabled', enabled: false });
  }
  const created = await request('/api/users', 'POST', {
    name: 'Alice', departmentCode: 'active', positionCode: 'active', rankCode: 'active'
  });
  assert.equal(created.status, 201);
  for (const field of ['departmentCode', 'positionCode', 'rankCode']) {
    for (const value of ['missing', 'disabled', 123, false, ' ']) {
      const rejected = await request('/api/users', 'POST', { name: 'Bob', [field]: value });
      assert.equal(rejected.status, 400);
      assert.match(rejected.message, new RegExp(field));
    }
  }
  assert.equal(users.size, 1);
  assert.equal((await request('/api/users', 'POST', { name: 'Bob', departmentCode: '', rankCode: null })).status, 201);
  assert.equal((await request('/api/users', 'POST', { name: 'Other', department: 'Legacy free text' })).status, 201);
});

test('user edits preserve inactive references, reject new ones and allow clearing', async () => {
  const option = await seedOption('department', { value: 'finance', label: 'Finance' });
  await seedOption('department', { value: 'other', label: 'Other', enabled: false });
  const user = await request('/api/users', 'POST', { name: 'Alice', departmentCode: 'finance' });
  const path = `/api/users/${user.data._id}`;
  options.get(option._id).enabled = false;
  assert.equal((await request(path, 'POST', { name: 'Updated' })).status, 200);
  assert.equal((await request(path, 'POST', { departmentCode: 'finance' })).status, 200);
  assert.equal((await request(path, 'POST', { departmentCode: 'other' })).status, 400);
  assert.equal((await request(path, 'POST', { departmentCode: 'missing' })).status, 400);
  const cleared = await request(path, 'POST', { departmentCode: null });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.data.departmentCode, { value: null, label: null });
});

test('Excel validates all dictionary references before inserting any users', async () => {
  const option = await seedOption('department', { value: 'finance', label: 'Finance' });
  const invalid = await importUsers([
    ['name', 'departmentCode'], ['Alice', 'finance'], ['Bob', 'missing']
  ]);
  assert.equal(invalid.status, 400);
  assert.match(invalid.message, /departmentCode/);
  assert.equal(users.size, 0);
  const valid = await importUsers([
    ['name', 'departmentCode'], ['Alice', 'finance'], ['Bob', 'finance']
  ]);
  assert.equal(valid.status, 201);
  assert.equal(valid.data.insertedCount, 2);
  options.get(option._id).enabled = false;
  const disabled = await importUsers([['name', 'departmentCode'], ['Charlie', 'finance']]);
  assert.equal(disabled.status, 400);
  assert.equal(users.size, 2);
});

test('dictionary validation normalizes labels and IDs without introducing writable fields', () => {
  assert.equal(validateType('department'), 'department');
  const result = validateBatchUpdate({ options: [{ _id: 'ABCDEF0123456789ABCDEF01', label: ' Finance ' }] });
  assert.deepEqual(result.options, [{ _id: new mongoose.Types.ObjectId('abcdef0123456789abcdef01'), label: 'Finance' }]);
  assert.deepEqual(validateQuery({}), {});
  assert.deepEqual(validateBatchUpdate({ options: [] }), { options: [] });
});

test('dictionary validation rejects unknown types, immutable fields and invalid values', () => {
  for (const type of ['unknown', 'education', '__proto__', 'constructor', '']) {
    assert.throws(() => validateType(type), { statusCode: 400 });
  }
  assert.throws(() => validateQuery({ enabled: ['true', 'false'] }), { statusCode: 400 });
  assert.throws(() => validateQuery({ enabled: 'true' }), { statusCode: 400 });
  assert.throws(() => validateQuery({ other: 'value' }), { statusCode: 400 });
  assert.throws(() => validateBatchUpdate({ options: [{ _id: 'invalid', label: 'Finance' }] }), { statusCode: 400 });
});