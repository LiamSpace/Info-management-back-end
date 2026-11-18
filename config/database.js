const mongoose = require('mongoose');
const { ensureIndexes } = require('../modules/dictionaries/service');

mongoose.connection.on('connected', () => {
    console.log('MongoDB 已连接, 数据库: ', mongoose.connection.name);
});

mongoose.connection.on('error', (error) => {
    console.error('MongoDB 连接异常', error.name)
});

mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB 已断开')
});

async function connectDB() {
    if(!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI_MISSING');
    }
    await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000
    })
    await ensureIndexes(mongoose.connection.db);
}


module.exports = {connectDB, disconnectDB: () => mongoose.disconnect()};