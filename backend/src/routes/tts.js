const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { synthesizeSpeech, streamSpeech, catalog } = require('../controllers/ttsController');

router.use(requireAuth);
router.get('/voices', catalog);
router.post('/speech', synthesizeSpeech);
router.post('/speech-stream', streamSpeech);

module.exports = router;
