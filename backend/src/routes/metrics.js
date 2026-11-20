const express = require('express');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { getMetrics, saveAdSpend, deleteAdSpend } = require('../controllers/metricsController');

const router = express.Router();

router.use(requireAuth, requireSuperAdmin);
router.get('/', getMetrics);
router.post('/ad-spend', saveAdSpend);
router.delete('/ad-spend/:id', deleteAdSpend);

module.exports = router;
