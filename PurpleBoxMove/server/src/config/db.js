const mongoose = require('mongoose');

async function connectDB(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { autoIndex: true });
  console.log('✓ MongoDB connected:', mongoose.connection.host + '/' + mongoose.connection.name);
}

module.exports = { connectDB };
