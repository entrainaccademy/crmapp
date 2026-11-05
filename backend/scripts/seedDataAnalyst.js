require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { connectDB } = require('../src/config/db');
const { User, ROLES } = require('../src/models/user.model');

const seedDataAnalyst = async () => {
  const args = process.argv.slice(2);
  const email = (args[0] || process.env.DATA_ANALYST_EMAIL || 'afeela@gmail.com').toLowerCase().trim();
  const password = args[1] || process.env.DATA_ANALYST_PASSWORD || 'afeela@123';
  const name = args[2] || process.env.DATA_ANALYST_NAME || 'Afeela';
  const role = ROLES.DATA_ANALYST;

  console.log('=============================================');
  console.log(' Trackio CRM - Data Analyst Account Seeding ');
  console.log('=============================================');
  console.log(`Target Email: ${email}`);
  console.log(`Target Name:  ${name}`);
  console.log(`Target Role:  ${role}`);

  try {
    await connectDB();

    const existingUser = await User.findOne({ email }).select('+password');

    if (existingUser) {
      console.log(`Notice: Account with email '${email}' already exists.`);
      existingUser.name = name;
      existingUser.role = role;
      existingUser.password = password; // pre-save will bcrypt-hash it!
      existingUser.mustChangePassword = false;
      existingUser.isActive = true;
      await existingUser.save();
      console.log(`Success: Data Analyst account updated with new password.`);
    } else {
      const newUser = await User.create({
        name,
        email,
        password, // pre-save will bcrypt-hash it!
        role,
        mustChangePassword: false,
        isActive: true,
      });
      console.log(`Success: Data Analyst account created successfully with ID: ${newUser._id}`);
    }

    console.log('\n--- Data Analyst Credentials ---');
    console.log(`Email:    ${email}`);
    console.log(`Password: ${password}`);
    console.log(`Role:     ${role}\n`);
  } catch (error) {
    console.error('Error seeding Data Analyst account:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB connection closed.');
  }
};

// Execute if run directly
if (require.main === module) {
  seedDataAnalyst();
}

module.exports = { seedDataAnalyst };

