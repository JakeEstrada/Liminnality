const express = require('express');
const router = express.Router();
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const {
  getDeveloperTasks,
  createDeveloperTask,
  updateDeveloperTask,
  deleteDeveloperTask,
} = require('../controllers/developerTasksController');
const {
  getVectorSemantics,
  askVectorSemantics,
} = require('../controllers/vectorSemanticsController');

router.use(requireAuth, requireSuperAdmin);

router.get('/vectors', getVectorSemantics);
router.post('/vectors/ask', askVectorSemantics);
router.get('/', getDeveloperTasks);
router.post('/', createDeveloperTask);
router.patch('/:id', updateDeveloperTask);
router.delete('/:id', deleteDeveloperTask);

module.exports = router;

