const userService = require('./service');
const { invalid } = require('./validation');
const { success, failure } = require('../../utils/response');

async function listUsers(req, res) {
  const users = await userService.listUsers();
  return success(res, users, '查询成功');
}

async function searchUsers(req, res) {
  const users = await userService.searchUsers(req.body);
  return success(res, users, '查询成功');
}

async function createUser(req, res) {
  const user = await userService.createUser(req.body);
  return success(res, user, '新增成功', 201);
}

async function importUsers(req, res) {
  if (!req.file) {
    throw invalid('请通过 file 字段上传 Excel 文件');
  }
  const result = await userService.importUsers(req.file.buffer);
  return success(res, result, '导入成功', 201);
}

async function updateUser(req, res) {
  const user = await userService.updateUser(req.params.id, req.body);
  if (!user) {
    return failure(res, 404, '记录不存在');
  }
  return success(res, user, '更新成功');
}

async function deleteUsers(req, res) {
  const result = await userService.deleteUsers(req.body && req.body.ids);
  return success(res, result, '批量删除完成');
}

async function deleteUser(req, res) {
  const result = await userService.deleteUser(req.params.id);
  if (!result.deletedCount) {
    return failure(res, 404, '记录不存在');
  }
  return success(res, result, '删除成功');
}

module.exports = { listUsers, searchUsers, createUser, importUsers, updateUser, deleteUsers, deleteUser };