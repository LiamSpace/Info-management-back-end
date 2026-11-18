const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const types = require('../../config/dictionaries');
const { httpError } = require('../../utils/http-error');
const { validateType, validateBatchUpdate, validateQuery } = require('./validation');

function collection() {
  return mongoose.connection.db.collection('dictionary-options');
}

async function ensureIndexes(database) {
  await database.collection('dictionary-options').createIndex(
    { type: 1, value: 1 },
    { unique: true, name: 'dictionary_type_value_unique' }
  );
}

async function listAllOptions(query) {
  const typeNames = Object.keys(types);
  const filter = { type: { $in: typeNames }, ...validateQuery(query) };
  const options = await collection().find(filter).sort({ sort: 1, _id: 1 }).toArray();
  const grouped = Object.fromEntries(typeNames.map(type => [type, { type, ...types[type], options: [] }]));
  for (const option of options) {
    grouped[option.type].options.push(option);
  }
  return grouped;
}

async function updateOptions(type, input) {
  const validatedType = validateType(type);
  const { options } = validateBatchUpdate(input);
  const updates = options.filter(option => option._id !== undefined);
  const store = collection();
  const existing = await store.find({ type: validatedType }, { projection: { _id: 1, value: 1 } }).toArray();
  const existingIds = new Set(existing.map(option => String(option._id)));
  if (updates.some(option => !existingIds.has(String(option._id)))) return null;
  const retainedIds = new Set(updates.map(option => String(option._id)));
  const removed = existing.filter(option => !retainedIds.has(String(option._id)));
  if (removed.length) {
    const referenced = await mongoose.connection.db.collection('users-list').findOne(
      { [types[validatedType].userField]: { $in: removed.map(option => option.value) } },
      { projection: { _id: 1 } }
    );
    if (referenced) {
      throw httpError(409, '待删除选项已被用户引用，请保留该选项或先调整用户关联');
    }
  }
  if (!options.length && !removed.length) return { type: validatedType, ...types[validatedType], options: [] };
  const now = new Date();
  const operations = options.map(({ _id, label }) => _id === undefined ? {
    insertOne: {
      document: {
        type: validatedType, value: randomUUID(), label, sort: 10, enabled: true,
        createdAt: now, updatedAt: now
      }
    }
  } : {
    updateOne: {
      filter: { type: validatedType, _id },
      update: { $set: { label, updatedAt: now } },
      upsert: false
    }
  });
  operations.push(...removed.map(({ _id }) => ({ deleteOne: { filter: { type: validatedType, _id } } })));
  const result = await store.bulkWrite(operations, { ordered: true });
  if (result.matchedCount !== updates.length || result.deletedCount !== removed.length) {
    throw httpError(409, '部分选项已不存在，可能已有部分更新，请刷新后重试');
  }
  return {
    type: validatedType,
    ...types[validatedType],
    options: await store.find({ type: validatedType }).sort({ sort: 1, _id: 1 }).toArray()
  };
}

async function validateReferences(users, previousUsers = []) {
  for (const [type, { userField }] of Object.entries(types)) {
    const references = [];
    for (const [index, user] of users.entries()) {
      if (!Object.hasOwn(user, userField)) continue;
      const value = user[userField];
      if (value === null || value === '') continue;
      if (typeof value !== 'string') {
        throw httpError(400, `第 ${index + 1} 条用户的 ${userField} 必须是选项 value 字符串`);
      }
      if (previousUsers[index] && previousUsers[index][userField] === value) continue;
      references.push({ value, index });
    }
    if (!references.length) continue;
    const values = [...new Set(references.map(reference => reference.value))];
    const enabledOptions = await collection().find({ type, enabled: true, value: { $in: values } }).toArray();
    const enabledValues = new Set(enabledOptions.map(option => option.value));
    const missing = references.find(reference => !enabledValues.has(reference.value));
    if (missing) {
      throw httpError(400, `第 ${missing.index + 1} 条用户的 ${userField} 选项不存在或已停用`);
    }
  }
}

module.exports = { ensureIndexes, listAllOptions, updateOptions, validateReferences };