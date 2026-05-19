import FCMToken from '../models/FCMToken.js';
import fcmService from '../services/fcmService.js';
import notificationService from '../services/notificationService.js';

export async function saveToken(req, res) {
  try {
    const { token, device = 'web' } = req.body;
    const userId = req.userId;
    if (!token) return res.status(400).json({ success: false, message: 'Missing token' });

    await FCMToken.findOneAndUpdate(
      { token },
      { userId, token, device },
      { upsert: true, new: true }
    );
    res.status(200).json({ success: true, message: 'Token saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeToken(req, res) {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Missing token' });
    await FCMToken.deleteOne({ token, userId: req.userId });
    res.status(200).json({ success: true, message: 'Token removed' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getNotifications(req, res) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await notificationService.getByUser(req.userId, Number(page), Number(limit));
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getUnreadCount(req, res) {
  try {
    const count = await notificationService.getUnreadCount(req.userId);
    res.status(200).json({ success: true, unreadCount: count });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function markRead(req, res) {
  try {
    const updated = await notificationService.markRead(req.params.id, req.userId);
    if (!updated) return res.status(404).json({ success: false, message: 'Notification not found' });
    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function markAllRead(req, res) {
  try {
    await notificationService.markAllRead(req.userId);
    res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function handleAIResult(req, res) {
  try {
    await notificationService.handleAIResult(req.body);
    res.status(200).json({ success: true, message: 'AI result processed' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function subscribeToTopic(req, res) {
  try {
    const { token, topic = 'iot_alerts_topic' } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Missing token' });
    const result = await fcmService.subscribeToTopic(token, topic);
    res.status(200).json({ success: true, message: `Đã subscribe vào topic ${topic}`, details: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function unsubscribeFromTopic(req, res) {
  try {
    const { token, topic = 'iot_alerts_topic' } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Missing token' });
    const result = await fcmService.unsubscribeFromTopic(token, topic);
    res.status(200).json({ success: true, message: `Đã unsubscribe khỏi topic ${topic}`, details: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function handleSensorAlert(req, res) {
  try {
    await notificationService.handleSensorAlert(req.body);
    res.status(200).json({ success: true, message: 'Sensor alert processed' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}
