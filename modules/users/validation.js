const mongoose = require('mongoose');
const { z: zod } = require('zod');

const MAX_USERS = 1000;
const MAX_FIELDS = 50;
const ID_ERROR = '用户 ID 必须是 24 位十六进制字符串';
const IDS_ERROR = `ids 必须是包含 1 至 ${MAX_USERS} 个用户 ID 的数组`;

function invalid(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function validField(field) {
  return field.length > 0 && field.length <= 100 && field === field.trim() &&
    !/[.$\x00-\x1f]/.test(field) &&
    !['_id', '__proto__', 'constructor', 'prototype'].includes(field);
}

const userValueSchema = zod.union([
  zod.string(),
  zod.number(),
  zod.boolean(),
  zod.null()
], { error: '字段值只支持字符串、有限数字、布尔值或 null' }).refine(
  value => typeof value !== 'string' || value.length <= 4000,
  { error: '字符串不能超过 4000 个字符' }
);

const userObjectSchema = zod.custom(
  input => input !== null && typeof input === 'object' && !Array.isArray(input),
  { error: '用户信息必须是 JSON 对象' }
).superRefine((input, context) => {
  const fields = Object.keys(input);
  if (!fields.length || fields.length > MAX_FIELDS) {
    context.addIssue({
      code: 'custom',
      message: `用户信息需要包含 1 至 ${MAX_FIELDS} 个字段`
    });
  }
  for (const field of fields) {
    if (!validField(field)) {
      context.addIssue({ code: 'custom', message: `不允许的字段名：${field}` });
    }
  }
}).pipe(zod.record(zod.string(), userValueSchema));

const createUserSchema = userObjectSchema.refine(
  input => Object.values(input).some(value =>
    value !== null && (typeof value !== 'string' || value.trim() !== '')),
  { error: '用户信息不能全部为空' }
);

const updateUserSchema = userObjectSchema;

const userIdSchema = zod.string({ error: ID_ERROR })
  .regex(/^[a-f\d]{24}$/i, { error: ID_ERROR })
  .transform(value => new mongoose.Types.ObjectId(value));

const userIdsSchema = zod.array(userIdSchema, { error: IDS_ERROR })
  .min(1, { error: IDS_ERROR })
  .max(MAX_USERS, { error: IDS_ERROR });

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.join('.');
    throw invalid(field ? `${field}：${issue.message}` : issue.message);
  }
  return result.data;
}

function validateUser(input, editing = false) {
  return parse(editing ? updateUserSchema : createUserSchema, input);
}

function userId(value) {
  return parse(userIdSchema, value);
}

function validateUserIds(ids) {
  return parse(userIdsSchema, ids);
}

module.exports = {
  MAX_USERS,
  MAX_FIELDS,
  invalid,
  validField,
  createUserSchema,
  updateUserSchema,
  userIdSchema,
  userIdsSchema,
  validateUser,
  userId,
  validateUserIds
};