import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createAccessResolver, decodeJwtPayload } from '../src/services/plantAccess.js';

const NAMEID_URI = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier';

function makeJwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

// fetch giả: trả lần lượt theo `responses` (số = status, Error = ném lỗi), ghi lại mọi lời gọi.
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}

const JWT_A = makeJwt({ nameid: 'u1', email: 'a@x', exp: 2000000000 });
const DEVICES = [{ deviceId: 'D1', name: 'Cây 1', ownerId: 'u1', members: [] }];

test('decodeJwtPayload đọc được payload', () => {
  assert.deepEqual(decodeJwtPayload(makeJwt({ nameid: 'u1', email: 'a@x', exp: 123 })), { nameid: 'u1', email: 'a@x', exp: 123 });
});

test('decodeJwtPayload trả null khi token hỏng', () => {
  assert.equal(decodeJwtPayload('abc'), null);
  assert.equal(decodeJwtPayload('a.%%%.c'), null);
  assert.equal(decodeJwtPayload(undefined), null);
});

test('Phong 200 → ok kèm userId, email, exp và danh sách cây rút gọn', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: DEVICES }]);
  const resolve = createAccessResolver({ baseUrl: 'http://phong:8000/', ttlSeconds: 60, fetchImpl });
  const r = await resolve(JWT_A);
  assert.equal(r.status, 'ok');
  assert.equal(r.userId, 'u1');
  assert.equal(r.email, 'a@x');
  assert.equal(r.exp, 2000000000);
  assert.deepEqual(r.devices, [{ deviceId: 'D1', name: 'Cây 1' }]);
  assert.ok(r.deviceIds.has('D1'));
  assert.equal(fetchImpl.calls[0].url, 'http://phong:8000/api/devices');
  assert.equal(fetchImpl.calls[0].opts.headers.Authorization, `Bearer ${JWT_A}`);
});

test('claim nameidentifier dạng URI cũng ra userId', async () => {
  const jwt = makeJwt({ [NAMEID_URI]: 'u9' });
  const resolve = createAccessResolver({ baseUrl: 'http://p', ttlSeconds: 60, fetchImpl: fakeFetch([{ status: 200, body: [] }]) });
  const r = await resolve(jwt);
  assert.equal(r.status, 'ok');
  assert.equal(r.userId, 'u9');
  assert.equal(r.exp, null);
});

test('Phong 401/403 → unauthorized', async () => {
  for (const status of [401, 403]) {
    const resolve = createAccessResolver({ baseUrl: 'http://p', ttlSeconds: 60, fetchImpl: fakeFetch([{ status }]) });
    assert.equal((await resolve(JWT_A)).status, 'unauthorized');
  }
});

test('Phong 500 hoặc lỗi mạng → unavailable', async () => {
  for (const resp of [{ status: 500 }, new Error('ECONNREFUSED')]) {
    const resolve = createAccessResolver({ baseUrl: 'http://p', ttlSeconds: 60, fetchImpl: fakeFetch([resp]) });
    assert.equal((await resolve(JWT_A)).status, 'unavailable');
  }
});

test('thiếu baseUrl → unavailable, không gọi fetch', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: [] }]);
  const resolve = createAccessResolver({ baseUrl: undefined, ttlSeconds: 60, fetchImpl });
  assert.equal((await resolve(JWT_A)).status, 'unavailable');
  assert.equal(fetchImpl.calls.length, 0);
});

test('Phong 200 nhưng payload JWT không đọc được / thiếu userId → unauthorized', async () => {
  for (const jwt of ['not-a-jwt', makeJwt({ email: 'a@x' })]) {
    const resolve = createAccessResolver({ baseUrl: 'http://p', ttlSeconds: 60, fetchImpl: fakeFetch([{ status: 200, body: [] }]) });
    assert.equal((await resolve(jwt)).status, 'unauthorized');
  }
});

test('cache trong TTL, hết TTL thì hỏi lại Phong', async () => {
  let t = 1_000_000;
  const fetchImpl = fakeFetch([{ status: 200, body: DEVICES }]);
  const resolve = createAccessResolver({ baseUrl: 'http://p', ttlSeconds: 60, fetchImpl, now: () => t });
  await resolve(JWT_A);
  t += 59_000;
  await resolve(JWT_A);
  assert.equal(fetchImpl.calls.length, 1);
  t += 2_000;
  await resolve(JWT_A);
  assert.equal(fetchImpl.calls.length, 2);
});

test('Phong treo không trả lời → unavailable sau timeoutMs, không treo theo', async () => {
  // Không bao giờ trả lời; chỉ dừng khi bị abort qua signal.
  const hang = (_url, opts) => new Promise((_resolve, reject) => {
    opts?.signal?.addEventListener('abort', () => reject(opts.signal.reason));
  });
  const resolve = createAccessResolver({ baseUrl: 'http://p', ttlSeconds: 60, timeoutMs: 50, fetchImpl: hang });
  let timer;
  const hung = new Promise(r => { timer = setTimeout(() => r({ status: 'HUNG' }), 1000); });
  const r = await Promise.race([resolve(JWT_A), hung]);
  clearTimeout(timer);
  assert.equal(r.status, 'unavailable');
});

test('JWT không đọc được → unauthorized ngay, không gọi Phong', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: [] }]);
  const resolve = createAccessResolver({ baseUrl: 'http://p', ttlSeconds: 60, fetchImpl });
  assert.equal((await resolve('x'.repeat(8000))).status, 'unauthorized');
  assert.equal(fetchImpl.calls.length, 0);
});

test('cache có giới hạn: vượt maxEntries thì bỏ mục cũ nhất', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: DEVICES }]);
  const resolve = createAccessResolver({ baseUrl: 'http://p', ttlSeconds: 60, maxEntries: 2, fetchImpl });
  const jwts = ['u1', 'u2', 'u3'].map(u => makeJwt({ nameid: u }));
  for (const j of jwts) await resolve(j);
  assert.equal(fetchImpl.calls.length, 3);
  await resolve(jwts[2]);                 // còn trong cache
  assert.equal(fetchImpl.calls.length, 3);
  await resolve(jwts[0]);                 // đã bị đẩy ra → hỏi lại Phong
  assert.equal(fetchImpl.calls.length, 4);
});

test('mục hết hạn được dọn khỏi cache khi ghi mục mới', async () => {
  let t = 1_000_000;
  const fetchImpl = fakeFetch([{ status: 200, body: DEVICES }]);
  const resolve = createAccessResolver({ baseUrl: 'http://p', ttlSeconds: 60, fetchImpl, now: () => t });
  for (let i = 0; i < 5; i++) await resolve(makeJwt({ nameid: `old${i}` }));
  t += 61_000;
  await resolve(makeJwt({ nameid: 'new' }));
  assert.equal(resolve.cacheSize(), 1);
});

test('unavailable không được cache', async () => {
  const fetchImpl = fakeFetch([{ status: 500 }, { status: 200, body: DEVICES }]);
  const resolve = createAccessResolver({ baseUrl: 'http://p', ttlSeconds: 60, fetchImpl });
  assert.equal((await resolve(JWT_A)).status, 'unavailable');
  assert.equal((await resolve(JWT_A)).status, 'ok');
});
