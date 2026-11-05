const express = require('express');
const router = express.Router();
const {
  register,
  login,
  getMe,
  getRoles,
  adminTest,
  managerTest,
  changePassword,
} = require('../controllers/auth.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');
const { ROLES } = require('../models/user.model');

// Public routes
router.post('/register', register);
router.post('/login', login);
router.get('/roles', getRoles);

// Protected routes
router.get('/me', authenticateToken, getMe);
router.post('/change-password', authenticateToken, changePassword);

// Role-protected test routes
router.get(
  '/admin-test',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN),
  adminTest
);

router.get(
  '/manager-test',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN, ROLES.MANAGER),
  managerTest
);

module.exports = router;

