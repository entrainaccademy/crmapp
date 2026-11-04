require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const app = require('./src/app');
const { connectDB } = require('./src/config/db');

const PORT = process.env.PORT || 5001;

// Start Express server on port 5001
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});

// Connect to MongoDB Atlas
connectDB().catch(() => {
  console.warn(`[WARN] Server is running on port ${PORT}, but MongoDB is waiting for IP authorization.`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error(`Unhandled Rejection: ${err.message}`);
});

module.exports = server;
