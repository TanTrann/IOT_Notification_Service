import { Router } from 'express';

import { login } from '../controllers/authController.js';

const router = Router();

// Đăng nhập → trả JWT (mang deviceIds của user). body: { username, password }
router.post('/login', login);

export default router;
