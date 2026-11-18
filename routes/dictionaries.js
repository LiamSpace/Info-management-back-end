const express = require('express');
const controller = require('../modules/dictionaries/controller');
const { asyncHandler, prepareRequest } = require('../middleware/api');
const { handleError } = require('../modules/dictionaries/middleware');

const router = express.Router();

router.use(prepareRequest);
router.get('/options', asyncHandler(controller.listAllOptions));
router.post('/:type/options/batch', asyncHandler(controller.updateOptions));
router.use(handleError);

module.exports = router;