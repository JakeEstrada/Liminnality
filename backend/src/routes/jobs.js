const express = require('express');
const multer = require('multer');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { previewWorksheet } = require('../controllers/worksheetController');

const worksheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Worksheet image must be a JPEG, PNG, WEBP, or GIF'));
  },
});
const {
  getJobs,
  getPossibleDuplicates,
  getJob,
  createJob,
  updateJob,
  moveJobStage,
  deleteJob,
  getPipelineSummary,
  getDeadEstimates,
  getArchivedJobs,
  getCompletedJobs,
  moveToDeadEstimates,
  autoMoveDeadEstimates,
  archiveJob,
  unarchiveJob,
  archiveCompletedJobs,
  reopenFromCompleted,
  resetAllEstimates,
  addJobInvoice,
  getReferralCompanies,
} = require('../controllers/jobController');
const { generateJobSummary } = require('../controllers/activityController');
const { getJobMapPins, getJobGeoIssues } = require('../controllers/jobMapController');

router.use(requireAuth);

router.post('/worksheet-preview', (req, res, next) => {
  worksheetUpload.fields([
    { name: 'page', maxCount: 1 },
    { name: 'zoom', maxCount: 3 },
  ])(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Could not read that file' });
    return next();
  });
}, previewWorksheet);
router.get('/possible-duplicates', getPossibleDuplicates);
router.get('/', getJobs);
router.post('/', createJob);
router.get('/map-pins', getJobMapPins);
router.get('/geo-issues', getJobGeoIssues);
router.get('/pipeline/summary', getPipelineSummary);
router.get('/dead-estimates', getDeadEstimates); // Backward compatibility
router.get('/archive', getArchivedJobs);
router.get('/completed', getCompletedJobs);
router.get('/referral-companies', getReferralCompanies);
router.get('/dead-estimates/debug', require('../controllers/jobController').debugDeadEstimates);
router.post('/dead-estimates/auto-move', autoMoveDeadEstimates);
router.post('/archive-completed', archiveCompletedJobs);
router.post('/admin/reset-estimates', resetAllEstimates);
router.post('/:id/invoices', addJobInvoice);
router.post('/:id/move-to-dead-estimates', moveToDeadEstimates);
router.post('/:id/archive', archiveJob);
router.post('/:id/unarchive', unarchiveJob);
router.post('/:id/reopen-from-completed', reopenFromCompleted);
router.post('/:id/summary', generateJobSummary);
router.get('/:id', getJob);
router.patch('/:id', updateJob);
router.post('/:id/move-stage', moveJobStage);
router.delete('/:id', deleteJob);

module.exports = router;
