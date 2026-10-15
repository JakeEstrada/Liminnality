const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const {
  runAssistantChat,
  runMapShow,
  runShopAction,
  runJobLookup,
  runInterviewTurn,
} = require('../controllers/assistantController');

router.use(requireAuth);
router.post('/chat', runAssistantChat);
router.post('/map', runMapShow);
router.post('/shop', runShopAction);
router.post('/interview', runInterviewTurn);
router.get('/jobs', runJobLookup);

module.exports = router;
