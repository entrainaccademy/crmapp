const express = require('express');
const cors = require('cors');
const path = require('path');
const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const leadRoutes = require('./routes/lead.routes');
const callLogRoutes = require('./routes/callLog.routes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Database connection check for API requests (health check is always accessible)
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/health')) {
    return next();
  }
  const mongoose = require('mongoose');
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      success: false,
      message: 'MongoDB Atlas is unreachable. Please ensure your IP address is whitelisted in MongoDB Atlas Network Access (or add 0.0.0.0/0).',
    });
  }
  next();
});

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/calls', callLogRoutes);

// Root Route
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'CRM API Server is running',
  });
});

// 404 Handler
app.use((req, res, next) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`,
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.name || 'InternalServerError',
    message: err.message || 'An unexpected error occurred',
  });
});

module.exports = app;

