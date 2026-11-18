const mongoose = require('mongoose');
const { failure } = require('../utils/response');

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);
}

function prepareRequest(req, res, next) {
  res.set('Cache-control', 'no-store');
  if (mongoose.connection.readyState !== 1) {
    return failure(res, 503, '数据库尚未连接');
  }
  next();
}

module.exports = { asyncHandler, prepareRequest };