const express = require('express');
const controller = require('../modules/users/controller');
const { asyncHandler, prepareRequest, uploadExcel, handleError } = require('../modules/users/middleware');

const router = express.Router();

router.use(prepareRequest);

router.get('/list', asyncHandler(controller.listUsers));
router.post('/', asyncHandler(controller.createUser));
router.post('/import', uploadExcel, asyncHandler(controller.importUsers));
router.post('/:id', asyncHandler(controller.updateUser));
router.delete('/batch', asyncHandler(controller.deleteUsers));
router.delete('/:id', asyncHandler(controller.deleteUser));

router.use(handleError);

module.exports = router;
