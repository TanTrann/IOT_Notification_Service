import admin from 'firebase-admin';
import { createRequire } from 'module';

let _messaging = null;

try {
  let credential;

  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    credential = admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
  } else {
    // Fallback: dùng file serviceAccountKey.json
    const require = createRequire(import.meta.url);
    const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '../../serviceAccountKey.json';
    const serviceAccount = require(keyPath);
    credential = admin.credential.cert(serviceAccount);
  }

  admin.initializeApp({ credential });
  _messaging = admin.messaging();
  console.log('Firebase Admin initialized successfully');
} catch (error) {
  console.error('Failed to initialize Firebase Admin:', error.message);
  console.warn('WARNING: Push notifications will not work without valid credentials!');
}

export const messaging = _messaging;
