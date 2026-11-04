const express = require('express');
const router = express.Router();
const {
  getLeads,
  getLeadById,
  createLead,
  updateLead,
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

// CRUD operations
router.get('/', getLeads);
router.get('/:id', getLeadById);
router.post('/', createLead);
router.put('/:id', updateLead);
router.delete('/:id', deleteLead);

module.exports = router;

