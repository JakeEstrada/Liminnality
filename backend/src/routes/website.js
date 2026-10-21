const express = require('express');
const router = express.Router();
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const uploadWebsiteImage = require('../middleware/uploadWebsiteImage');
const {
  getWebsite,
  updateWebsite,
  updateWebsiteAnalytics,
  getWebsiteAnalyticsReport,
  getWebsiteAnalyticsTodayIps,
  getWebsiteAnalyticsEvents,
  updateWebsiteMineIp,
  recordPublicAnalyticsEvent,
  uploadHeroPhoto,
  deleteHeroPhoto,
  uploadGalleryPhoto,
  deleteGalleryPhoto,
  createProject,
  updateProject,
  deleteProject,
  uploadProjectPhoto,
  deleteProjectPhoto,
  reorderWebsite,
  getPublicWebsite,
  getPublicWebsiteMedia,
  downloadWebsiteSlideshowZip,
} = require('../controllers/websiteController');

router.get('/public', getPublicWebsite);
router.get('/public/media/:tenantId/:assetId', getPublicWebsiteMedia);
router.post('/public/events', recordPublicAnalyticsEvent);

router.use(requireAuth, requireSuperAdmin);

router.get('/', getWebsite);
router.get('/photos/slideshow-zip', downloadWebsiteSlideshowZip);
router.put('/', updateWebsite);
router.get('/analytics/report', getWebsiteAnalyticsReport);
router.get('/analytics/today-ips', getWebsiteAnalyticsTodayIps);
router.get('/analytics/events', getWebsiteAnalyticsEvents);
router.put('/analytics/mine-ips', updateWebsiteMineIp);
router.put('/analytics', updateWebsiteAnalytics);
router.patch('/order', reorderWebsite);
router.post('/hero', uploadWebsiteImage.single('file'), uploadHeroPhoto);
router.delete('/hero/:assetId', deleteHeroPhoto);
router.post('/gallery', uploadWebsiteImage.single('file'), uploadGalleryPhoto);
router.delete('/gallery/:assetId', deleteGalleryPhoto);
router.post('/projects', createProject);
router.patch('/projects/:projectId', updateProject);
router.delete('/projects/:projectId', deleteProject);
router.post('/projects/:projectId/photos', uploadWebsiteImage.array('file', 20), uploadProjectPhoto);
router.post('/projects/:projectId/photo', uploadWebsiteImage.single('file'), uploadProjectPhoto);
router.delete('/projects/:projectId/photos/:assetId', deleteProjectPhoto);

module.exports = router;
