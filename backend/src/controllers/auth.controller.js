const { User, ROLES } = require('../models/user.model');
const { generateToken } = require('../utils/token');

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
const register = async (req, res, next) => {
  try {
    const { name, email, password, role, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required.',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists.',
      });
    }

    // Validate role if specified
    let assignedRole = ROLES.SALES_EXECUTIVE;
    if (role) {
      if (!Object.values(ROLES).includes(role)) {
        return res.status(400).json({
          success: false,
          message: `Invalid role '${role}'. Allowed roles: ${Object.values(ROLES).join(', ')}.`,
        });
      }
      assignedRole = role;
    }

    // Create user
    const newUser = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: assignedRole,
      phone: phone ? phone.trim() : '',
    });

    // Generate JWT token
    const token = generateToken(newUser);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      token,
      user: newUser,
    });
  } catch (error) {
    next(error);
  }
};

// @route   POST /api/auth/login
// @desc    Authenticate user & get token
// @access  Public
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Query user and explicitly select password field
    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'This account has been deactivated. Please contact an administrator.',
      });
    }

    // Verify password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
      user: user.toJSON(),
    });
  } catch (error) {
    next(error);
  }
};

// @route   GET /api/auth/me
// @desc    Get current logged in user profile
// @access  Private (Authenticated)
const getMe = async (req, res) => {
  return res.status(200).json({
    success: true,
    user: req.user,
  });
};

// @route   GET /api/auth/roles
// @desc    List available system roles
// @access  Public
const getRoles = async (req, res) => {
  return res.status(200).json({
    success: true,
    roles: Object.values(ROLES),
  });
};

// @route   GET /api/auth/admin-test
// @desc    Verify Admin-only RBAC access
// @access  Private (Admin only)
const adminTest = async (req, res) => {
  return res.status(200).json({
    success: true,
    message: `Access granted: User ${req.user.name} verified as Admin.`,
    user: req.user,
  });
};

// @route   GET /api/auth/manager-test
// @desc    Verify Manager/Admin RBAC access
// @access  Private (Admin, Manager)
const managerTest = async (req, res) => {
  return res.status(200).json({
    success: true,
    message: `Access granted: User ${req.user.name} has Manager/Admin privileges.`,
    user: req.user,
  });
};

// @route   POST /api/auth/change-password
// @desc    Change password (required for first login or security)
// @access  Private (Authenticated)
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required.',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long.',
      });
    }

    // Retrieve user with password
    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User account not found.',
      });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect.',
      });
    }

    user.password = newPassword;
    user.mustChangePassword = false;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully.',
      user: user.toJSON(),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  getMe,
  getRoles,
  adminTest,
  managerTest,
  changePassword,
};

