const service = require('./service');
const { success, failure } = require('../../utils/response');

async function listAllOptions(req, res) {
  return success(res, await service.listAllOptions(req.query), '查询成功');
}

async function updateOptions(req, res) {
  const result = await service.updateOptions(req.params.type, req.body);
  return result ? success(res, result, '批量更新成功') : failure(res, 404, '部分选项不存在或不属于当前字典类型');
}

module.exports = { listAllOptions, updateOptions };