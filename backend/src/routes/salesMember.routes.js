const express = require('express');
const router = express.Router();
const {
  getSalesMembers,
  createSalesMember,
  updateSalesMember,
  toggleSalesMemberStatus,
  getAnalyticsOverview,
} = require('../controllers/salesMember.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');
const { ROLES } = require('../models/user.model');

// All Sales Member management routes require authentication and Analyst/Admin/Manager role
router.use(authenticateToken);
router.use(authorizeRoles(ROLES.DATA_ANALYST, ROLES.ADMIN, ROLES.MANAGER));

// Analytics Dashboard Endpoint for Data Analyst
router.get('/analytics', getAnalyticsOverview);

// Sales Members CRUD
router.get('/', getSalesMembers);
router.post('/', createSalesMember);
router.put('/:id', updateSalesMember);
router.patch('/:id/toggle-status', toggleSalesMemberStatus);

module.exports = router;

