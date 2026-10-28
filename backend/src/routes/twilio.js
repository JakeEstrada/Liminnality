const express = require('express');
const upload = require('../middleware/upload');
const { uploadTwilioMmsStaging } = require('../controllers/fileController');
const {
  inboundSms,
  inboundVoice,
  smsStatusCallback,
  sendSms,
  scheduleSms,
  twilioMediaDownload,
  sendSmsAdhoc,
  scheduleSmsAdhoc,
  listSms,
  getSmsDetail,
  deleteSms,
  deleteSmsConversation,
  markSmsRead,
  markJobSmsRead,
  getTwilioConfigStatus,
  syncInboundFromTwilio,
  streamSmsMessageMedia,
  getUnreadSmsCount,
} = require('../controllers/twilioController');
const { requireAuth } = require('../middleware/auth');
const { requireTwilioSignature } = require('../utils/twilioWebhook');

const router = express.Router();

router.post('/sms', requireTwilioSignature, inboundSms);
router.post('/sms-status', requireTwilioSignature, smsStatusCallback);
router.post('/voice', requireTwilioSignature, inboundVoice);
router.get('/media/:id', twilioMediaDownload);
router.get('/config-status', requireAuth, getTwilioConfigStatus);
router.post('/sync-inbound', requireAuth, syncInboundFromTwilio);
router.post('/send-sms', requireAuth, sendSms);
router.post('/schedule-sms', requireAuth, scheduleSms);
router.post('/send-sms-adhoc', requireAuth, sendSmsAdhoc);
router.post('/schedule-sms-adhoc', requireAuth, scheduleSmsAdhoc);
router.get('/unread-count', requireAuth, getUnreadSmsCount);
router.get('/messages/:id/media/:index', requireAuth, streamSmsMessageMedia);
router.get('/messages', requireAuth, listSms);
router.delete('/messages/conversation', requireAuth, deleteSmsConversation);
router.post('/messages/job/:jobId/read', requireAuth, markJobSmsRead);
router.get('/messages/:recordType/:id', requireAuth, getSmsDetail);
router.delete('/messages/:recordType/:id', requireAuth, deleteSms);
router.post('/messages/message/:id/read', requireAuth, markSmsRead);
router.post('/mms-upload', requireAuth, upload.single('file'), uploadTwilioMmsStaging);

module.exports = router;
