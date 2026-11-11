require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { connectDB } = require('../src/config/db');
const { User, ROLES } = require('../src/models/user.model');

const USERS_TO_SEED = [
  {
    name: 'System Administrator',
    email: 'admin@crmapp.com',
    password: process.env.ADMIN_PASSWORD || 'crm@123',
    role: ROLES.ADMIN,
    phone: '+91 90000 00001',
  },
  {
    name: 'Afeela',
    email: 'afeela@gmail.com',
    password: process.env.DATA_ANALYST_PASSWORD || 'afeela@123',
    role: ROLES.DATA_ANALYST,
    phone: '+91 90000 00002',
  },
  {
    name: 'Vikram Malhotra',
    email: 'manager@crmapp.com',
    password: process.env.MANAGER_PASSWORD || 'manager@123',
    role: ROLES.MANAGER,
    phone: '+91 90000 00003',
  },
  {
    name: 'Rahul Sharma',
    email: 'rahul@crmapp.com',
    password: process.env.SALES_PASSWORD || 'sales@123',
    role: ROLES.SALES_EXECUTIVE,
    phone: '+91 90000 00004',
  },
  {
    name: 'Priya Patel',
    email: 'priya@crmapp.com',
    password: process.env.SALES_PASSWORD || 'sales@123',
    role: ROLES.SALES_EXECUTIVE,
    phone: '+91 90000 00005',
  },
  {
    name: 'Amit Kumar',
    email: 'amit@crmapp.com',
    password: process.env.SALES_PASSWORD || 'sales@123',
    role: ROLES.SALES_MEMBER,
    phone: '+91 90000 00006',
  },
];

const seedAllUsers = async () => {
  console.log('========================================================');
  console.log(' Trackio CRM - Comprehensive Multi-Role User Seeding ');
  console.log('========================================================\n');

  try {
    await connectDB();

    const results = [];

    for (const userData of USERS_TO_SEED) {
      const normalizedEmail = userData.email.toLowerCase().trim();
      let user = await User.findOne({ email: normalizedEmail }).select('+password');

      if (user) {
        user.name = userData.name;
        user.role = userData.role;
        user.password = userData.password; // pre-save hook will bcrypt hash it
        user.phone = userData.phone;
        user.isActive = true;
        user.mustChangePassword = false;
        await user.save();
        results.push({ ...userData, status: 'Updated' });
      } else {
        user = await User.create({
          name: userData.name,
          email: normalizedEmail,
          password: userData.password,
          role: userData.role,
          phone: userData.phone,
          isActive: true,
          mustChangePassword: false,
        });
        results.push({ ...userData, status: 'Created' });
      }
    }

    console.log('Successfully seeded all users:\n');
    console.log('----------------------------------------------------------------------------------------------------');
    console.log(
      'Role'.padEnd(18) +
      'Name'.padEnd(24) +
      'Email'.padEnd(26) +
      'Password'.padEnd(14) +
      'Status'
    );
    console.log('----------------------------------------------------------------------------------------------------');

    for (const res of results) {
      console.log(
        res.role.padEnd(18) +
        res.name.padEnd(24) +
        res.email.padEnd(26) +
        res.password.padEnd(14) +
        res.status
      );
    }
    console.log('----------------------------------------------------------------------------------------------------\n');
  } catch (error) {
    console.error('Error seeding users:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB connection closed.');
  }
};

if (require.main === module) {
  seedAllUsers();
}

module.exports = { seedAllUsers, USERS_TO_SEED };

