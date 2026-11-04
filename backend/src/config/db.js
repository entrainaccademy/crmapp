const dns = require('dns');
const mongoose = require('mongoose');

// Configure reliable DNS servers to prevent Windows querySrv EBADRESP errors with Atlas
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Use default system DNS if setServers is unavailable
}

let retryInterval = null;

const connectDB = async () => {
  const mongoURI = process.env.MONGODB_URI;

  if (!mongoURI) {
    throw new Error('MONGODB_URI is missing from backend/.env');
  }

  const tryConnect = async () => {
    if (mongoose.connection.readyState === 1) return;

    try {
      const conn = await mongoose.connect(mongoURI, {
        dbName: process.env.MONGODB_DB_NAME || 'crmapp',
        serverSelectionTimeoutMS: 5000,
      });
      console.log(`\n✅ MongoDB Atlas connection established: ${conn.connection.host}/${conn.connection.name}`);
      if (retryInterval) {
        clearInterval(retryInterval);
        retryInterval = null;
      }
      return conn;
    } catch (error) {
      const isIpWhitelistError =
        error.name === 'MongooseServerSelectionError' ||
        error.message.includes('whitelist') ||
        error.message.includes('SSL alert number 80');

      if (isIpWhitelistError) {
        console.warn('\n[MONGODB ATLAS NOTICE] Your current IP address is not on the Atlas whitelist.');
        console.warn('👉 Fix: Go to MongoDB Atlas -> Security -> Network Access -> Add IP Address (Allow 0.0.0.0/0).');
      } else {
        console.warn(`[MONGODB NOTICE] Connection failed: ${error.message}`);
      }

      // Schedule background reconnect attempt if not already running
      if (!retryInterval) {
        retryInterval = setInterval(tryConnect, 10000);
      }
      throw error;
    }
  };

  return tryConnect();
};

module.exports = { connectDB };
