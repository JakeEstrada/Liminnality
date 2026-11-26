const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireRfidDeviceOrAuth } = require('../middleware/rfidDeviceAuth');
const {
  recordScan,
  listScans,
  listTags,
  listPins,
  listPhones,
  upsertTag,
  upsertPin,
  upsertPhone,
  deleteTag,
  deletePin,
  deletePhone,
  listEmployeeProfiles,
  upsertEmployeeProfile,
  addRosterEmployees,
  getKioskWeekSummary,
  getTimesheetWeek,
  upsertTimesheetWeek,
} = require('../controllers/rfidController');

const router = express.Router();

/** Pi / device posts scans here */
router.post('/scans', requireRfidDeviceOrAuth, recordScan);
router.get('/kiosk/week-summary', requireRfidDeviceOrAuth, getKioskWeekSummary);

router.use(requireAuth);
router.get('/scans', listScans);
router.get('/tags', listTags);
router.get('/pins', listPins);
router.get('/phones', listPhones);
router.post('/tags', upsertTag);
router.put('/tags', upsertTag);
router.post('/pins', upsertPin);
router.put('/pins', upsertPin);
router.post('/phones', upsertPhone);
router.put('/phones', upsertPhone);
router.delete('/tags/:id', deleteTag);
router.delete('/pins/:id', deletePin);
router.delete('/phones/:id', deletePhone);
router.get('/employee-profiles', listEmployeeProfiles);
router.post('/roster', addRosterEmployees);
router.put('/employee-profiles/:employeeKey', upsertEmployeeProfile);
router.get('/timesheets/:employeeKey/:periodId', getTimesheetWeek);
router.put('/timesheets/:employeeKey/:periodId', upsertTimesheetWeek);

module.exports = router;
