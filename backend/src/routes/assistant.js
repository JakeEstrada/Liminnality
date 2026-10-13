const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { runAssistantChat, runMapShow, runShopAction } = require('../controllers/assistantController');

router.use(requireAuth);
router.post('/chat', runAssistantChat);
router.post('/map', runMapShow);
router.post('/shop', runShopAction);

module.exports = router;
