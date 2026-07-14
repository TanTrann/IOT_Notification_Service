// SmartFarm Notifications — app Android, CHỈ dùng Firebase (FCM). Không SSE.
// Đăng ký FCM token với notification-service (/internal/push/token) rồi nhận push:
//   - App mở (foreground): listener bắt message → thêm vào danh sách trong app + banner.
//   - App nền/kill: hệ điều hành hiện notification trên khay (FCM). Chạm để mở lại app.
// Danh sách lưu AsyncStorage để mở lại app vẫn thấy lịch sử gần đây.
//
//   MCP ─► HiveMQ (planttree/{deviceId}/notifications) ─► service ─FCM─► app này
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, FlatList, SafeAreaView, ScrollView, StatusBar,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

// Hiện notification cả khi app đang mở (foreground)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,   // SDK cũ
    shouldShowBanner: true,  // SDK 53+
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const DEFAULT_SERVER = 'http://10.0.2.2:3001';   // 10.0.2.2 = localhost của máy dev nhìn từ emulator
const STORE_ITEMS = 'fcmItems';
const STORE_CFG = 'fcmCfg';
const MAX = 100;

const TYPE_ICON = { water: '💧', light: '💡', temperature: '🌡️', temp: '🌡️', nutrition: '🌱', disease: '🦠', system: '⚙️', alert: '⚠️' };
const SEV_COLOR = { info: '#2d7ff9', warning: '#e8930c', critical: '#e0442e' };
const SEV_LABEL = { critical: 'Nguy cấp', warning: 'Cảnh báo', info: 'Thông tin' };

const pick = (o, keys) => { for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]; return undefined; };

function normSev(raw) {
  const s = String(raw ?? '').toLowerCase();
  if (['critical', 'crit', 'error', 'danger', 'high', 'nguy cấp'].some(x => s.includes(x))) return 'critical';
  if (['warning', 'warn', 'medium', 'cảnh báo'].some(x => s.includes(x))) return 'warning';
  return 'info';
}

// Chuẩn hóa payload bất kỳ → thứ hiển thị được; KHÔNG đổi dữ liệu gốc.
function view(payload) {
  const title = pick(payload, ['title', 'tieu_de', 'name', 'event']);
  const body  = pick(payload, ['body', 'message', 'msg', 'content', 'noi_dung', 'description']);
  const type  = String(pick(payload, ['type', 'category', 'loai']) ?? '').toLowerCase();
  const sev   = normSev(pick(payload, ['severity', 'level', 'muc_do', 'priority']));
  return {
    icon:    TYPE_ICON[type] || '🔔',
    sev,
    sevRaw:  pick(payload, ['severity', 'level', 'muc_do', 'priority']),
    typeRaw: pick(payload, ['type', 'category', 'loai']),
    title:   title != null ? String(title) : '(thông báo không có title)',
    body:    body != null ? String(body) : (title != null ? '' : JSON.stringify(payload)),
  };
}

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return new Date(iso).toLocaleString('vi-VN');
}

// Dựng 1 mục từ message FCM mà expo-notifications nhận được.
// Service gửi: notification:{title,body}, data:{deviceId,type,severity,raw}
let _uid = 0;
function itemFromRequest(req) {
  const content = req?.content || {};
  const data = content.data || {};
  let payload = {};
  if (data.raw) { try { payload = JSON.parse(data.raw); } catch {} }
  if (!payload || typeof payload !== 'object' || !Object.keys(payload).length) {
    payload = { title: content.title, body: content.body, type: data.type, severity: data.severity };
  }
  return {
    id: `${req?.identifier || 'n'}-${++_uid}`,
    key: req?.identifier || null,     // để chống trùng (foreground + tap cùng 1 message)
    payload,
    deviceId: data.deviceId || '',
    receivedAt: new Date().toISOString(),
  };
}

export default function App() {
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [apiKey, setApiKey] = useState('');
  const [items, setItems] = useState([]);
  const [pushOn, setPushOn] = useState(false);
  const [showConfig, setShowConfig] = useState(true);
  const [expanded, setExpanded] = useState(null);

  const cfgRef = useRef({ server, apiKey });
  cfgRef.current = { server, apiKey };
  const seenRef = useRef(new Set());   // identifier đã thêm → chống trùng

  const addItem = useCallback((req) => {
    const it = itemFromRequest(req);
    if (it.key && seenRef.current.has(it.key)) return;
    if (it.key) seenRef.current.add(it.key);
    setItems(prev => {
      const next = [it, ...prev].slice(0, MAX);
      AsyncStorage.setItem(STORE_ITEMS, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  // Đăng ký FCM token với service → nhận push kể cả khi app đóng.
  const registerPush = useCallback(async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Bị từ chối', 'App chưa được cấp quyền thông báo.'); return false; }
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Cảnh báo SmartFarm',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 200, 100, 200],
      });
      const { data: fcmToken } = await Notifications.getDevicePushTokenAsync();
      const { server: s, apiKey: k } = cfgRef.current;
      const res = await fetch(`${s.replace(/\/$/, '')}/internal/push/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': k },
        body: JSON.stringify({ token: fcmToken, device: 'android' }),
      });
      if (!res.ok) throw new Error(`Đăng ký token lỗi: HTTP ${res.status}`);
      setPushOn(true);
      return true;
    } catch (e) {
      Alert.alert('Lỗi bật push', e.message);
      return false;
    }
  }, []);

  async function connect() {
    if (!apiKey.trim()) return Alert.alert('Thiếu API key', 'Nhập INTERNAL_API_KEY của service.');
    await AsyncStorage.setItem(STORE_CFG, JSON.stringify({ server, apiKey }));
    const ok = await registerPush();
    if (ok) setShowConfig(false);
  }

  // Nạp config + lịch sử đã lưu, tự đăng ký lại push
  useEffect(() => {
    (async () => {
      const rawItems = await AsyncStorage.getItem(STORE_ITEMS);
      if (rawItems) {
        try {
          const saved = JSON.parse(rawItems);
          saved.forEach(it => it.key && seenRef.current.add(it.key));
          setItems(saved);
        } catch {}
      }
      const rawCfg = await AsyncStorage.getItem(STORE_CFG);
      if (rawCfg) {
        const cfg = JSON.parse(rawCfg);
        setServer(cfg.server); setApiKey(cfg.apiKey);
        cfgRef.current = cfg;
        setShowConfig(false);
        registerPush();
      }
    })();
  }, [registerPush]);

  // Lắng nghe message FCM: foreground nhận + khi chạm notification từ khay
  useEffect(() => {
    const recv = Notifications.addNotificationReceivedListener(n => addItem(n.request));
    const resp = Notifications.addNotificationResponseReceivedListener(r => addItem(r.notification.request));
    return () => { recv.remove(); resp.remove(); };
  }, [addItem]);

  const renderItem = ({ item }) => {
    const v = view(item.payload);
    const open = expanded === item.id;
    return (
      <TouchableOpacity
        style={[st.noti, { borderLeftColor: SEV_COLOR[v.sev] }]}
        activeOpacity={0.7}
        onPress={() => setExpanded(open ? null : item.id)}
      >
        <Text style={st.icon}>{v.icon}</Text>
        <View style={{ flex: 1 }}>
          <View style={st.titleRow}>
            <Text style={st.title} numberOfLines={2}>{v.title}</Text>
            {v.sevRaw != null && (
              <View style={[st.badge, { backgroundColor: SEV_COLOR[v.sev] }]}>
                <Text style={st.badgeText}>{SEV_LABEL[v.sev]}</Text>
              </View>
            )}
          </View>
          {!!v.body && <Text style={st.body}>{v.body}</Text>}
          <Text style={st.meta}>{item.deviceId ? `${item.deviceId} · ` : ''}{v.typeRaw ? `${v.typeRaw} · ` : ''}{timeAgo(item.receivedAt)}</Text>
          {open && (
            <ScrollView horizontal style={st.rawBox}>
              <Text style={st.raw}>{JSON.stringify(item.payload, null, 2)}</Text>
            </ScrollView>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={st.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f4f2" />
      <View style={st.header}>
        <View>
          <Text style={st.h1}>🌱 SmartFarm</Text>
          <Text style={[st.sub, { color: pushOn ? '#1f8a4c' : '#e0442e' }]}>
            {pushOn ? '● Push đang bật (FCM)' : '○ Chưa bật push'}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setShowConfig(v => !v)}>
          <Text style={st.gear}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {showConfig && (
        <View style={st.card}>
          <Text style={st.label}>Notification Service URL (emulator: 10.0.2.2, máy thật: IP LAN)</Text>
          <TextInput style={st.input} value={server} onChangeText={setServer} autoCapitalize="none" />
          <Text style={st.label}>API key (INTERNAL_API_KEY của service)</Text>
          <TextInput
            style={st.input} value={apiKey} onChangeText={setApiKey}
            autoCapitalize="none" placeholder="chuỗi bí mật trong .env" secureTextEntry
          />
          <TouchableOpacity style={st.btn} onPress={connect}>
            <Text style={st.btnText}>Lưu & Bật nhận push</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={st.feedHead}>
        <Text style={st.h2}>Thông báo{items.length ? ` (${items.length})` : ''}</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={n => String(n.id)}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 30 }}
        ListEmptyComponent={
          <Text style={st.empty}>
            {pushOn ? 'Đang chờ thông báo… (bắn thử: node scripts/publish-test.js)' : 'Nhập API key rồi bấm "Lưu & Bật nhận push".'}
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0f4f2' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 8 },
  h1: { fontSize: 20, fontWeight: '700', color: '#1e2a26' },
  sub: { fontSize: 12, marginTop: 2, fontWeight: '600' },
  gear: { fontSize: 22 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginHorizontal: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8e5' },
  label: { fontSize: 12, color: '#6b7a74', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#e2e8e5', borderRadius: 8, padding: 9, fontSize: 13, marginBottom: 10, backgroundColor: '#fafcfb', color: '#1e2a26' },
  btn: { backgroundColor: '#1f8a4c', paddingVertical: 11, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  feedHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  h2: { fontSize: 15, fontWeight: '600', color: '#1e2a26' },
  noti: { flexDirection: 'row', gap: 10, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8e5', borderLeftWidth: 4, padding: 12, marginBottom: 9 },
  icon: { fontSize: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 14, color: '#1e2a26', flexShrink: 1, fontWeight: '700' },
  badge: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  body: { fontSize: 13, color: '#6b7a74', marginTop: 2 },
  meta: { fontSize: 11, color: '#98a6a0', marginTop: 5 },
  rawBox: { marginTop: 8, backgroundColor: '#0d1512', borderRadius: 8, padding: 10 },
  raw: { color: '#b8d4c6', fontSize: 11, fontFamily: 'monospace' },
  empty: { textAlign: 'center', color: '#6b7a74', marginTop: 40, fontSize: 13 },
});
