import 'dotenv/config';
import jwt from 'jsonwebtoken';

const userId = process.argv[2] || 'user_test_01';
const token  = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });

console.log(`\nJWT cho userId: "${userId}" (hết hạn sau 7 ngày)\n`);
console.log(token);
console.log();
