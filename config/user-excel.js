const dictionaryTypes = require('./dictionaries');

module.exports = Object.freeze([
  Object.freeze({ header: '姓名', field: 'name' }),
  Object.freeze({ header: '性别', field: 'sex', values: Object.freeze({ 男: 0, 女: 1 }) }),
  Object.freeze({ header: '身份证号', field: 'id_number', format: 'text' }),
  Object.freeze({ header: '手机号码', field: 'tel', format: 'text' }),
  Object.freeze({ header: '手机号', field: 'tel', format: 'text' }),
  Object.freeze({ header: '出生年月', field: 'birth_date', format: 'month' }),
  Object.freeze({ header: '民族', field: 'ethnic' }),
  Object.freeze({ header: '学历', field: 'educational' }),
  Object.freeze({ header: '级别', field: 'level' }),
  Object.freeze({ header: '任现职时间', field: 'tenure', format: 'month' }),
  Object.freeze({ header: '任现职级时间', field: 'tenure_of_position', format: 'month' }),
  Object.freeze({ header: '任职进修班', field: 'is_advanced_class', values: Object.freeze({ 是: true, 否: false }) }),
  Object.freeze({ header: '理论测试', field: 'theoretical_test', values: Object.freeze({ 是: true, 否: false }) }),
  ...Object.entries(dictionaryTypes).map(([type, { name, userField }]) =>
    Object.freeze({ header: name, field: userField, dictionary: type })),
  Object.freeze({ header: '岗位', field: 'positionCode', dictionary: 'position' })
]);