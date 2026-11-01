var express = require('express');
const mongoose = require('mongoose');

var router = express.Router();

router.get('/list', async (req, res) => {
  res.set('Cache-control', 'no-store');

  if(mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      status: 'error',
      message: '数据库尚未连接'
    })
  }

  try {
    const database = mongoose.connection.db;
    await database.command({ping: 1});

    const document = await database
                  .collection('users-list')
                  .findOne({});

          if(!document) {
            return res.status(404).json({ message: '记录不存在'});
          }

          return res.json(document);
  } catch (error) {
    console.error('数据库检查失败：', error.name, error.code);
    return res.status(503).json({
      status: 'error',
      message: '数据库检查失败, 请查看后端日志'
    })
  }
})

module.exports = router;
