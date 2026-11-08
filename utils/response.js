function success(res, data, message = '操作成功', statusCode = 200) {
  return res.status(statusCode).json({ code: 0, message, data });
}

function failure(res, statusCode, message) {
  return res.status(statusCode).json({ code: statusCode, message, data: null });
}

module.exports = { success, failure };