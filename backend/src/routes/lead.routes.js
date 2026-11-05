const express = require('express');
const router = express.Router();
const {
  getLeads,
  getLeadById,
  createLead,
  updateLead,
  assignLead,
  bulkAssignLeads,
  deleteLead,
  getAssignableUsers,
  getLeadStats,
} = require('../controllers/lead.controller');
const { authenticateToken } = require('../middleware/auth.middleware');

// All lead routes require authentication
router.use(authenticateToken);

// Aggregate stats and assignable users
router.get('/stats', getLeadStats);
router.get('/assignable-users', getAssignableUsers);

// Bulk assignment (declared before /:id)
router.post('/bulk-assign', bulkAssignLeads);

// CRUD and individual assignment
router.get('/', getLeads);
router.get('/:id', getLeadById);
router.post('/', createLead);
router.post('/:id/assign', assignLead);
router.put('/:id', updateLead);
router.delete('/:id', deleteLead);

module.exports = router;

