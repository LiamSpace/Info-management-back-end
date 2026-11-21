const mongoose = require('mongoose');
const dictionaryTypes = require('../../config/dictionaries');
const { validateUser, validateSearch, userId, validateUserIds } = require('./validation');
const { parseUsers } = require('./excel');
const { validateReferences } = require('../dictionaries/service');

function collection() {
  return mongoose.connection.db.collection('users-list');
}

async function withDictionaryLabels(users) {
  const definitions = Object.entries(dictionaryTypes);
  const values = new Set();
  for (const user of users) {
    for (const [, { userField }] of definitions) {
      const value = user[userField];
      if (typeof value === 'string' && value !== '') values.add(value);
    }
  }
  const labels = new Map(definitions.map(([type]) => [type, new Map()]));
  if (values.size) {
    const options = await mongoose.connection.db.collection('dictionary-options').find(
      { type: { $in: definitions.map(([type]) => type) }, value: { $in: [...values] } },
      { projection: { _id: 0, type: 1, value: 1, label: 1 } }
    ).toArray();
    for (const option of options) labels.get(option.type).set(option.value, option.label);
  }
  return users.map(user => {
    const result = { ...user };
    for (const [type, { userField }] of definitions) {
      if (Object.hasOwn(user, userField)) {
        result[userField] = { value: user[userField], label: labels.get(type).get(user[userField]) ?? null };
      }
    }
    return result;
  });
}

async function listUsers() {
  return withDictionaryLabels(await collection().find({}).toArray());
}

async function searchUsers(input) {
  const { filters } = validateSearch(input);
  const query = {};
  for (const [field, selection] of Object.entries(filters)) {
    const values = Array.isArray(selection) ? selection : [selection];
    if (values.length) query[field] = { $in: [...new Set(values)] };
  }
  return withDictionaryLabels(await collection().find(query).toArray());
}

async function createUser(input) {
  const user = validateUser(input);
  await validateReferences([user]);
  const result = await collection().insertOne(user);
  const [created] = await withDictionaryLabels([{ ...user, _id: result.insertedId }]);
  return created;
}

async function importUsers(buffer) {
  const options = await mongoose.connection.db.collection('dictionary-options').find(
    { type: { $in: Object.keys(dictionaryTypes) }, enabled: true },
    { projection: { _id: 0, type: 1, label: 1, value: 1 } }
  ).toArray();
  const users = await parseUsers(buffer, options);
  await validateReferences(users);
  const result = await collection().insertMany(users, { ordered: true });
  return {
    insertedCount: result.insertedCount,
    ids: Object.values(result.insertedIds)
  };
}

async function updateUser(id, input) {
  const objectId = userId(id);
  const updates = validateUser(input, true);
  const previous = await collection().findOne({ _id: objectId });
  if (!previous) return null;
  await validateReferences([updates], [previous]);
  const updated = await collection().findOneAndUpdate(
    { _id: objectId },
    { $set: updates },
    { returnDocument: 'after', includeResultMetadata: false }
  );
  if (!updated) return null;
  const [result] = await withDictionaryLabels([updated]);
  return result;
}

async function deleteUsers(ids) {
  const objectIds = validateUserIds(ids);
  const result = await collection().deleteMany({ _id: { $in: objectIds } });
  return { deletedCount: result.deletedCount };
}

async function deleteUser(id) {
  const result = await collection().deleteOne({ _id: userId(id) });
  return { deletedCount: result.deletedCount };
}

module.exports = { listUsers, searchUsers, createUser, importUsers, updateUser, deleteUsers, deleteUser };