var express = require('express');
var router = express.Router();
const { success } = require('../utils/response');

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

router.get('/api/health', function(req, res, next) {
  return success(res, { status: 'ok' }, '服务运行正常');
});

module.exports = router;
