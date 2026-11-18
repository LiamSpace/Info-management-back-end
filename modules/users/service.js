const mongoose = require('mongoose');
const { validateUser, userId, validateUserIds } = require('./validation');
const { parseUsers } = require('./excel');
const { validateReferences } = require('../dictionaries/service');

function collection() {
  return mongoose.connection.db.collection('users-list');
}

async function listUsers() {
  return collection().find({}).toArray();
}

async function createUser(input) {
  const user = validateUser(input);
  await validateReferences([user]);
  const result = await collection().insertOne(user);
  return { ...user, _id: result.insertedId };
}

async function importUsers(buffer) {
  const users = await parseUsers(buffer);
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
  return collection().findOneAndUpdate(
    { _id: objectId },
    { $set: updates },
    { returnDocument: 'after', includeResultMetadata: false }
  );
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

module.exports = { listUsers, createUser, importUsers, updateUser, deleteUsers, deleteUser };