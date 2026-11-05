require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { connectDB } = require('../src/config/db');
const { User, ROLES } = require('../src/models/user.model');

const createAdmin = async () => {
  const args = process.argv.slice(2);
  const email = (args[0] || process.env.ADMIN_EMAIL || 'admin@crmapp.com').toLowerCase().trim();
  const password = args[1] || process.env.ADMIN_PASSWORD || 'crm@123';
  const name = args[2] || process.env.ADMIN_NAME || 'System Administrator';

  console.log('--- CRM Admin Account Initialization ---');
  console.log(`Target Email: ${email}`);
  console.log(`Target Name:  ${name}`);

  try {
    await connectDB();

    const existingUser = await User.findOne({ email }).select('+password');

    if (existingUser) {
      existingUser.name = name;
      existingUser.role = ROLES.ADMIN;
      existingUser.password = password;
      existingUser.isActive = true;
      await existingUser.save();
      console.log(`Success: Admin user '${email}' updated with new password.`);
    } else {
      const newAdmin = await User.create({
        name,
        email,
        password,
        role: ROLES.ADMIN,
        isActive: true,
      });
      console.log(`Success: Admin user created successfully with ID: ${newAdmin._id}`);
    }

    console.log('\nYou can now log in with:');
    console.log(`Email:    ${email}`);
    console.log(`Password: ${password}`);
    console.log(`Role:     ${ROLES.ADMIN}\n`);
  } catch (error) {
    console.error('Error creating admin user:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Database connection closed.');
  }
};

createAdmin();

