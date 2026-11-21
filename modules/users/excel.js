const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const columns = require('../../config/user-excel');
const { MAX_USERS, MAX_FIELDS, invalid, validField, validateUser } = require('./validation');

const headerMappings = new Map(columns.map(column => [column.header, column]));

async function loadWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  if (buffer.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') {
    try {
      await workbook.xlsx.load(buffer);
    } catch {
      throw invalid('Excel 文件损坏或格式不正确');
    }
    return workbook;
  }
  let legacy;
  try {
    legacy = XLSX.read(buffer, { type: 'buffer', cellDates: false, cellNF: true, cellFormula: true });
  } catch {
    throw invalid('Excel 文件损坏、加密或格式不正确');
  }
  const source = legacy.Sheets[legacy.SheetNames[0]];
  if (!source) return workbook;
  if (source['!ref'] && XLSX.utils.decode_range(source['!ref']).e.c >= MAX_FIELDS) {
    throw invalid(`Excel 最多支持 ${MAX_FIELDS} 列，且必须包含表头`);
  }
  const sheet = workbook.addWorksheet('Users');
  for (const [address, cell] of Object.entries(source)) {
    if (address.startsWith('!')) continue;
    const { r: rowIndex, c: columnIndex } = XLSX.utils.decode_cell(address);
    const target = sheet.getCell(rowIndex + 1, columnIndex + 1);
    if (cell.f !== undefined || cell.F !== undefined || cell.l || cell.t === 'e') {
      target.value = { error: '#VALUE!' };
    } else if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
      const parts = XLSX.SSF.parse_date_code(cell.v, { date1904: legacy.Workbook?.WBProps?.date1904 });
      if (!parts) throw invalid(`第 ${rowIndex + 1} 行、第 ${columnIndex + 1} 列的日期无效`);
      const date = new Date(0);
      date.setUTCFullYear(parts.y, parts.m - 1, parts.d);
      date.setUTCHours(parts.H, parts.M, parts.S, Math.round(parts.u * 1000));
      target.value = date;
    } else {
      target.value = cell.v === undefined ? null : cell.v;
    }
  }
  return workbook;
}

function convertMappedValue(value, mapping, location) {
  if (!mapping || value === null) return value;
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (normalized === '') return '';
  if (mapping.values) {
    if (typeof normalized === 'string' && Object.hasOwn(mapping.values, normalized)) {
      return mapping.values[normalized];
    }
    if (Object.values(mapping.values).includes(normalized)) return normalized;
    throw invalid(`${location}必须填写${Object.keys(mapping.values).join('或')}，或对应的原始类型值`);
  }
  if (mapping.format === 'month') {
    if (typeof normalized !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(normalized)) {
      throw invalid(`${location}必须填写 YYYY-MM 格式的年月或 Excel 日期`);
    }
    return normalized;
  }
  if (mapping.format === 'text') {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
    throw invalid(`${location}请使用文本格式，数字必须是安全整数`);
  }
  return value;
}

async function parseUsers(buffer, dictionaryOptions = []) {
  const workbook = await loadWorkbook(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) {
    throw invalid('Excel 首行必须是字段名，并且至少包含一条用户数据');
  }
  const header = sheet.getRow(1);
  if (!header.cellCount || sheet.columnCount > MAX_FIELDS) {
    throw invalid(`Excel 最多支持 ${MAX_FIELDS} 列，且必须包含表头`);
  }
  const fields = [];
  const columnMappings = new Map();
  const dictionaryLabels = new Map();
  for (const option of dictionaryOptions) {
    if (!dictionaryLabels.has(option.type)) dictionaryLabels.set(option.type, new Map());
    const labels = dictionaryLabels.get(option.type);
    if (!labels.has(option.label)) labels.set(option.label, []);
    labels.get(option.label).push(option.value);
  }
  for (let column = 1; column <= header.cellCount; column += 1) {
    const value = header.getCell(column).value;
    const title = typeof value === 'string' ? value.trim() : '';
    const mapping = headerMappings.get(title);
    const field = mapping ? mapping.field : title;
    if (!mapping && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) {
      throw invalid(`第 ${column} 列的表头不受支持：${title}`);
    }
    if (!validField(field) || fields.includes(field)) {
      throw invalid(`第 ${column} 列的表头无效或重复，且不能使用 _id`);
    }
    fields.push(field);
    if (mapping) columnMappings.set(column, mapping);
  }
  const users = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const user = {};
    row.eachCell((cell, column) => {
      if (column > fields.length) {
        throw invalid(`第 ${rowNumber} 行存在没有表头的数据列`);
      }
      const mapping = columnMappings.get(column);
      const location = `第 ${rowNumber} 行、第 ${column} 列（${mapping?.header || fields[column - 1]}）`;
      let value = cell.value;
      if (value instanceof Date) {
        value = mapping?.format === 'month' ? value.toISOString().slice(0, 7) : value.toISOString();
      } else if (value && typeof value === 'object' && Array.isArray(value.richText)) {
        value = value.richText.map(part => part.text).join('');
      } else if (value && typeof value === 'object') {
        throw invalid(`第 ${rowNumber} 行、第 ${column} 列不支持公式、超链接或错误值`);
      }
      value = convertMappedValue(value, mapping, location);
      if (mapping && mapping.dictionary && value !== null) {
        if (typeof value !== 'string') {
          throw invalid(`${location}必须填写字典名称字符串`);
        }
        const label = value.trim();
        if (label === '') {
          value = '';
        } else {
          const matches = dictionaryLabels.get(mapping.dictionary)?.get(label) || [];
          if (!matches.length) {
            throw invalid(`${location}的名称“${label}”不存在或已停用`);
          }
          if (matches.length > 1) {
            throw invalid(`${location}的名称“${label}”存在重名，请先调整字典名称`);
          }
          value = matches[0];
        }
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