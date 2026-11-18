const mongoose = require('mongoose');
const { z: zod } = require('zod');
const types = require('../../config/dictionaries');
const { httpError } = require('../../utils/http-error');

const typeSchema = zod.enum(Object.keys(types), { error: '不支持的字典类型' });
const labelSchema = zod.string({ error: '选项名称必须是字符串' }).trim()
  .min(1, { error: '选项名称不能为空' }).max(100, { error: '选项名称最多 100 个字符' });
const querySchema = zod.strictObject({}, { error: '字典配置查询不支持筛选参数，请获取完整配置' });
const optionIdSchema = zod.string({ error: '选项 ID 必须是字符串' })
  .regex(/^[a-f\d]{24}$/i, { error: '选项 ID 必须是 24 位十六进制字符串' })
  .transform(value => new mongoose.Types.ObjectId(value));
const batchOptionSchema = zod.strictObject({
  _id: optionIdSchema.optional(),
  label: labelSchema
}, { error: '每个选项仅允许 _id 和 label，其他字段不可修改' });
const batchUpdateSchema = zod.strictObject({
  options: zod.array(batchOptionSchema).max(1000)
}, { error: '批量更新仅允许 options 字段' })
  .refine(input => {
    const ids = input.options.filter(option => option._id !== undefined).map(option => String(option._id));
    return new Set(ids).size === ids.length;
  }, {
    error: '批量更新不能包含重复的选项 ID'
  });

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.join('.');
    throw httpError(400, field ? `${field}：${issue.message}` : issue.message);
  }
  return result.data;
}

module.exports = {
  validateType: input => parse(typeSchema, input),
  validateBatchUpdate: input => parse(batchUpdateSchema, input),
  validateQuery: input => parse(querySchema, input)
};