import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { applyChanges } from '../utils/history.js';

const email = String(process.argv[2] || '').trim().toLowerCase();
const password = process.env.NEW_PASSWORD || '';
if (!email || password.length < 8) {
  console.error('usage: NEW_PASSWORD=... node src/tools/set-password.js user@domain');
  process.exit(2);
}
await mongoose.connect(config.mongoUri);
const user = await User.findOne({ email });
if (!user) {
  console.error('user not found');
  process.exit(1);
}
applyChanges(user, { passwordHash: await bcrypt.hash(password, config.bcryptRounds) }, null, 'password_changed');
await user.save();
console.log(`password updated for ${email}`);
await mongoose.disconnect();
