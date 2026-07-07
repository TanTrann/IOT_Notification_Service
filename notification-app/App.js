// SmartFarm Notifications — trung tâm thông báo trên mobile (Android).
// Nhận push FCM trực tiếp từ notification-service (backend không cần sửa gì:
// getDevicePushTokenAsync() trả về đúng FCM registration token mà
// fcmService.sendToDevice() đang gửi tới).
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, RefreshControl, SafeAreaView,
  StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

// Hiện notification cả khi app đang mở (foreground)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,   // SDK cũ
    shouldShowBanner: true,  // SDK 53+
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const TYPE_ICON = { water: '💧', light: '💡', temperature: '🌡️', nutrition: '🌱', disease: '🦠', system: '⚙️' };
const SEV_COLOR = { info: '#2d7ff9', warning: '#e8930c', critical: '#e0442e' };

// 10.0.2.2 = localhost của máy dev nhìn từ Android emulator.
// Chạy trên điện thoại thật thì đổi thành IP LAN của máy chạy service.
const DEFAULT_SERVER = 'http://10.0.2.2:3001';

// atob không có sẵn trên mọi bản Hermes → tự decode base64url
function b64decode(s) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  let out = '';
  for (let i = 0; i < s.length; i += 4) {
    const n = (chars.indexOf(s[i]) << 18) | (chars.indexOf(s[i + 1]) << 12)
      | ((chars.indexOf(s[i + 2]) & 63) << 6) | (chars.indexOf(s[i + 3]) & 63);
    out += String.fromCharCode((n >> 16) & 255);
    if (s[i + 2] && s[i + 2] !== '=') out += String.fromCharCode((n >> 8) & 255);
    if (s[i + 3] && s[i + 3] !== '=') out += String.fromCharCode(n & 255);
  }
  try { return decodeURIComponent(escape(out)); } catch { return out; }
}
function parseJwt(t) {
  try { return JSON.parse(b64decode(t.split('.')[1])); } catch { return null; }
}
function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return new Date(iso).toLocaleString('vi-VN');
}

export default function App() {
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [jwtRaw, setJwtRaw] = useState('');
  const [connected, setConnected] = useState(false);
  const [showConfig, setShowConfig] = useState(true);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [pushOn, setPushOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const jwt = jwtRaw.replace(/\s+/g, '');
  const deviceId = parseJwt(jwt)?.deviceId;
  const stateRef = useRef({});
  stateRef.current = { server, jwt };

  const api = useCallback(async (path, opts = {}) => {
    const { server: s, jwt: t } = stateRef.current;
    const res = await fetch(`${s.replace(/\/$/, '')}/api/v1/notifications${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}`, ...(opts.headers || {}) },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
    return json;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { items: list, unreadCount } = await api('/?page=1&limit=20');
      setItems(list); setUnread(unreadCount); setPage(1); setHasMore(list.length >= 20);
      setConnected(true);
    } catch (e) {
      Alert.alert('Không tải được thông báo', e.message);
    } finally { setLoading(false); }
  }, [api]);

  const loadMore = useCallback(async () => {
    const next = page + 1;
    try {
      const { items: list } = await api(`/?page=${next}&limit=20`);
      setItems(prev => [...prev, ...list]); setPage(next); setHasMore(list.length >= 20);
    } catch {}
  }, [api, page]);

  async function connect() {
    const claims = parseJwt(jwt);
    if (!claims) return Alert.alert('JWT không hợp lệ', 'Kiểm tra lại token đã dán.');
    if (claims.exp && claims.exp * 1000 < Date.now())
      return Alert.alert('JWT đã hết hạn', 'Sinh token mới: node generate-token.js <device_id>');
    await AsyncStorage.setItem('cfg', JSON.stringify({ server, jwt }));
    await refresh();
    setShowConfig(false);
  }

  async function enablePush() {
    if (!jwt) return Alert.alert('Thiếu JWT', 'Kết nối trước rồi mới bật push.');
    if (!Device.isDevice && !__DEV__)
      return Alert.alert('Cần thiết bị thật hoặc emulator có Google Play Services');
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') return Alert.alert('Bị từ chối', 'App chưa được cấp quyền thông báo.');
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Cảnh báo SmartFarm',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 200, 100, 200],
      });
      // Token FCM native — đúng loại token mà backend đang send tới
      const { data: fcmToken } = await Notifications.getDevicePushTokenAsync();
      await api('/token', { method: 'POST', body: JSON.stringify({ token: fcmToken, device: 'android' }) });
      setPushOn(true);
      Alert.alert('Sẵn sàng 🔔', 'Đã đăng ký nhận cảnh báo từ hệ thống.');
    } catch (e) {
      Alert.alert('Lỗi bật push', e.message);
    }
  }

  async function markRead(n) {
    if (n.isRead) return;
    try {
      await api(`/${n._id}/read`, { method: 'PATCH' });
      setItems(prev => prev.map(x => (x._id === n._id ? { ...x, isRead: true } : x)));
      setUnread(u => Math.max(0, u - 1));
    } catch (e) { Alert.alert('Lỗi', e.message); }
  }

  async function markAllRead() {
    try {
      await api('/read-all', { method: 'PATCH' });
      setItems(prev => prev.map(x => ({ ...x, isRead: true })));
      setUnread(0);
    } catch (e) { Alert.alert('Lỗi', e.message); }
  }

  // Nạp config đã lưu + tự kết nối lại
  useEffect(() => {
    AsyncStorage.getItem('cfg').then(raw => {
      if (!raw) return;
      const cfg = JSON.parse(raw);
      setServer(cfg.server); setJwtRaw(cfg.jwt);
      stateRef.current = { server: cfg.server, jwt: cfg.jwt };
      refresh().then(() => setShowConfig(false)).catch(() => {});
    });
  }, [refresh]);

  // Push đến khi app đang mở → cập nhật danh sách
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(() => refresh());
    const tap = Notifications.addNotificationResponseReceivedListener(() => refresh());
    return () => { sub.remove(); tap.remove(); };
  }, [refresh]);

  const renderItem = ({ item: n }) => (
    <TouchableOpacity
      style={[st.noti, { borderLeftColor: SEV_COLOR[n.severity] || SEV_COLOR.info }]}
      onPress={() => markRead(n)} activeOpacity={0.7}
    >
      <Text style={st.icon}>{TYPE_ICON[n.type] || '🔔'}</Text>
      <View style={{ flex: 1 }}>
        <View style={st.titleRow}>
          <Text style={[st.title, !n.isRead && st.bold]} numberOfLines={2}>{n.title}</Text>
          {!n.isRead && <View style={st.dot} />}
        </View>
        <Text style={st.body}>{n.body}</Text>
        <Text style={st.meta}>{n.deviceId} · {timeAgo(n.createdAt)}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={st.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f4f2" />
      <View style={st.header}>
        <View>
          <Text style={st.h1}>🔔 SmartFarm{unread > 0 ? `  (${unread})` : ''}</Text>
          {deviceId && connected && <Text style={st.sub}>📟 {deviceId} · push {pushOn ? 'đang bật' : 'chưa bật'}</Text>}
        </View>
        <TouchableOpacity onPress={() => setShowConfig(v => !v)}>
          <Text style={st.gear}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {showConfig && (
        <View style={st.card}>
          <Text style={st.label}>Notification Service URL (emulator: 10.0.2.2, máy thật: IP LAN)</Text>
          <TextInput style={st.input} value={server} onChangeText={setServer} autoCapitalize="none" />
          <Text style={st.label}>JWT Token (node generate-token.js &lt;device_id&gt;)</Text>
          <TextInput
            style={[st.input, { height: 70 }]} value={jwtRaw} onChangeText={setJwtRaw}
            multiline autoCapitalize="none" placeholder="eyJhbGciOi..."
          />
          <View style={st.row}>
            <TouchableOpacity style={st.btn} onPress={connect}><Text style={st.btnText}>Lưu & Kết nối</Text></TouchableOpacity>
            <TouchableOpacity style={[st.btn, st.btnGhost]} onPress={enablePush}>
              <Text style={[st.btnText, st.btnGhostText]}>🔔 Bật nhận push</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={st.feedHead}>
        <Text style={st.h2}>Thông báo</Text>
        <TouchableOpacity onPress={markAllRead}><Text style={st.link}>✓ Đọc tất cả</Text></TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={n => n._id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
        onEndReachedThreshold={0.3}
        onEndReached={() => hasMore && loadMore()}
        ListEmptyComponent={!loading && (
          <Text style={st.empty}>
            {connected ? 'Chưa có thông báo nào.' : 'Nhập JWT và bấm "Lưu & Kết nối" để bắt đầu.'}
          </Text>
        )}
        ListFooterComponent={loading && items.length > 0 ? <ActivityIndicator style={{ margin: 12 }} /> : null}
      />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0f4f2' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 8 },
  h1: { fontSize: 20, fontWeight: '700', color: '#1e2a26' },
  sub: { fontSize: 12, color: '#6b7a74', marginTop: 2 },
  gear: { fontSize: 22 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginHorizontal: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8e5' },
  label: { fontSize: 12, color: '#6b7a74', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#e2e8e5', borderRadius: 8, padding: 9, fontSize: 13, marginBottom: 10, backgroundColor: '#fafcfb', color: '#1e2a26' },
  row: { flexDirection: 'row', gap: 8 },
  btn: { backgroundColor: '#1f8a4c', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#e2e8e5' },
  btnGhostText: { color: '#176e3c' },
  feedHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  h2: { fontSize: 15, fontWeight: '600', color: '#1e2a26' },
  link: { color: '#176e3c', fontSize: 13, fontWeight: '500' },
  noti: { flexDirection: 'row', gap: 10, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8e5', borderLeftWidth: 4, padding: 12, marginBottom: 9 },
  icon: { fontSize: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 14, color: '#1e2a26', flexShrink: 1 },
  bold: { fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2d7ff9' },
  body: { fontSize: 13, color: '#6b7a74', marginTop: 2 },
  meta: { fontSize: 11, color: '#98a6a0', marginTop: 5 },
  empty: { textAlign: 'center', color: '#6b7a74', marginTop: 40, fontSize: 13 },
});
