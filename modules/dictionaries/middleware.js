const { failure } = require('../../utils/response');

function handleError(error, req, res, next) {
  if (res.headersSent) return next(error);
  if ([400, 409].includes(error.statusCode)) {
    return failure(res, error.statusCode, error.message);
  }
  if (error.code === 11000) {
    return failure(res, 409, '同一字典类型下的 value 不能重复');
  }
  console.error('字典数据库操作失败：', error.name, error.code);
  return failure(res, 503, '字典数据库操作失败，请查看后端日志');
}

module.exports = { handleError };