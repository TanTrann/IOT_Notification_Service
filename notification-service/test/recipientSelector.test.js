import { test } from 'node:test';
import assert from 'node:assert/strict';

import { selectRecipients } from '../src/services/recipientSelector.js';

const ok = (ids) => ({ status: 'ok', userId: 'u', deviceIds: new Set(ids) });

function resolverFrom(map) {
  const calls = [];
  const fn = async (jwt) => { calls.push(jwt); return map[jwt]; };
  fn.calls = calls;
  return fn;
}

test('chỉ giữ token có quyền xem deviceId, mỗi JWT hỏi Phong 1 lần', async () => {
  const resolve = resolverFrom({ A: ok(['D1']), B: ok(['D2']) });
  const tokens = [{ token: 't1', jwt: 'A' }, { token: 't2', jwt: 'A' }, { token: 't3', jwt: 'B' }];
  assert.deepEqual(await selectRecipients(tokens, 'D1', resolve), ['t1', 't2']);
  assert.deepEqual(resolve.calls.sort(), ['A', 'B']);
});

test('phiên hết hạn (unauthorized) bị bỏ', async () => {
  const resolve = resolverFrom({ A: { status: 'unauthorized' } });
  assert.deepEqual(await selectRecipients([{ token: 't1', jwt: 'A' }], 'D1', resolve), []);
});

test('Phong không phản hồi (unavailable) → không gửi', async () => {
  const resolve = resolverFrom({ A: { status: 'unavailable' }, B: ok(['D1']) });
  const tokens = [{ token: 't1', jwt: 'A' }, { token: 't2', jwt: 'B' }];
  assert.deepEqual(await selectRecipients(tokens, 'D1', resolve), ['t2']);
});

test('token thiếu jwt bị bỏ, không gọi Phong', async () => {
  const resolve = resolverFrom({});
  assert.deepEqual(await selectRecipients([{ token: 't1' }], 'D1', resolve), []);
  assert.equal(resolve.calls.length, 0);
});

test('không có token → []', async () => {
  assert.deepEqual(await selectRecipients([], 'D1', resolverFrom({})), []);
});
