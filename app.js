var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
const helmet = require('helmet');
const cors = require('cors');
const { failure } = require('./utils/response');


var app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || '')
	.split(',')
	.map(origin => origin.trim())
	.filter(Boolean);

app.use(helmet());
app.use('/api', cors({
	origin: allowedOrigins,
	credentials: true,
	methods: ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS']
}));
app.use(express.json({ limit: '1mb'}));
app.use(logger('dev'));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/api/users', usersRouter);

app.use('/api', (req, res) => failure(res, 404, '接口不存在'));

app.use((error, req, res, next) => {
	if (res.headersSent) return next(error);
	if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
		const statusCode = error.type === 'entity.too.large' ? 413 : 400;
		const message = error.type === 'entity.too.large' ? '请求正文超出大小限制' : '请求正文必须是有效的 JSON 对象';
		return failure(res, statusCode, message);
	}
	if (req.path === '/api' || req.path.startsWith('/api/')) {
		console.error('接口处理失败：', error.name, error.code);
		return failure(res, 500, '服务器内部错误，请查看后端日志');
	}
	next(error);
});

module.exports = app;
