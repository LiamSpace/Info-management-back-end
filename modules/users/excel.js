const ExcelJS = require('exceljs');
const { MAX_USERS, MAX_FIELDS, invalid, validField, validateUser } = require('./validation');

async function parseUsers(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw invalid('Excel 文件损坏或格式不正确');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) {
    throw invalid('Excel 首行必须是字段名，并且至少包含一条用户数据');
  }
  const header = sheet.getRow(1);
  if (!header.cellCount || sheet.columnCount > MAX_FIELDS) {
    throw invalid(`Excel 最多支持 ${MAX_FIELDS} 列，且必须包含表头`);
  }
  const fields = [];
  for (let column = 1; column <= header.cellCount; column += 1) {
    const value = header.getCell(column).value;
    const field = typeof value === 'string' ? value.trim() : '';
    if (!validField(field) || fields.includes(field)) {
      throw invalid(`第 ${column} 列的表头无效或重复，且不能使用 _id`);
    }
    fields.push(field);
  }
  const users = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const user = {};
    row.eachCell((cell, column) => {
      if (column > fields.length) {
        throw invalid(`第 ${rowNumber} 行存在没有表头的数据列`);
      }
      let value = cell.value;
      if (value instanceof Date) {
        value = value.toISOString();
      } else if (value && typeof value === 'object' && Array.isArray(value.richText)) {
        value = value.richText.map(part => part.text).join('');
      } else if (value && typeof value === 'object') {
        throw invalid(`第 ${rowNumber} 行、第 ${column} 列不支持公式、超链接或错误值`);
      }
      user[fields[column - 1]] = value;
    });
    if (!Object.values(user).some(value =>
      value !== null && (typeof value !== 'string' || value.trim() !== ''))) return;
    try {
      users.push(validateUser(user));
    } catch (error) {
      throw invalid(`第 ${rowNumber} 行：${error.message}`);
    }
    if (users.length > MAX_USERS) {
      throw invalid(`每次最多导入 ${MAX_USERS} 条用户数据`);
    }
  });
  if (!users.length) {
    throw invalid('Excel 中没有有效的用户数据');
  }
  return users;
}

module.exports = { parseUsers };