const express = require('express');
const multer = require('multer');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { synthesizeSpeech, streamSpeech, catalog, transcribeSpeech } = require('../controllers/ttsController');

const transcribeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

router.use(requireAuth);
router.get('/voices', catalog);
router.post('/speech', synthesizeSpeech);
router.post('/speech-stream', streamSpeech);
router.post('/transcribe', (req, res) => {
  transcribeUpload.single('audio')(req, res, (error) => {
    if (error) return res.status(400).json({ error: 'Audio upload was too large.' });
    return transcribeSpeech(req, res);
  });
});

module.exports = router;
