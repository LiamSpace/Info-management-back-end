const multer = require('multer');
const { invalid } = require('./validation');
const { failure } = require('../../utils/response');
const { asyncHandler, prepareRequest } = require('../../middleware/api');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
  fileFilter(req, file, callback) {
    if (!/\.xlsx$/i.test(file.originalname)) {
      return callback(invalid('仅支持 .xlsx 文件'));
    }
    callback(null, true);
  }
});

function handleError(error, req, res, next) {
  if (error instanceof multer.MulterError || error.statusCode === 400) {
    const statusCode = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message = error instanceof multer.MulterError
      ? (error.code === 'LIMIT_FILE_SIZE' ? 'Excel 文件不能超过 5 MB' : '仅允许上传一个名为 file 的文件字段')
      : error.message;
    return failure(res, statusCode, message);
  }
  if (error.code === 11000) {
    return failure(res, 409, '用户数据与唯一索引冲突；批量导入可能已有部分记录写入，请查询列表后核对');
  }
  console.error('用户数据库操作失败：', error.name, error.code);
  return failure(res, 503, '数据库操作失败，请查看后端日志；批量操作请查询列表核对结果');
}

module.exports = { asyncHandler, prepareRequest, uploadExcel: upload.single('file'), handleError };