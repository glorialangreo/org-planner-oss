import { test } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import https from 'node:https';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import sharp from 'sharp';
import request from 'supertest';
import { downloadAvatar, isPublicAddress, normalizeAvatar } from '../server/avatars.js';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';

test('only public unicast addresses are allowed, including encoded and IPv6 cases', () => {
  for (const ip of ['127.0.0.1', '0.0.0.0', '10.1.1.1', '169.254.169.254', '172.16.0.1', '192.168.0.1', '100.64.0.1', '192.0.2.1', '198.18.0.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:7f00:1::', '64:ff9b::a00:1', 'invalid']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('invalid protocols, credentials and ports never perform DNS or HTTPS requests', async t => {
  const lookup = t.mock.method(dns, 'lookup', () => { throw new Error('Unexpected DNS request'); });
  const get = t.mock.method(https, 'get', () => { throw new Error('Unexpected network request'); });
  for (const url of ['not a URL', 'file:///photo.png', 'http://example.test/a.png', 'https://user:pass@example.test/a.png', 'https://example.test:444/a.png']) {
    await assert.rejects(downloadAvatar(url), /HTTPS/);
  }
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal(get.mock.callCount(), 0);
});

test('private or mixed DNS answers are rejected before connecting', async t => {
  const lookup = t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]);
  const get = t.mock.method(https, 'get', () => { throw new Error('Unexpected network request'); });
  await assert.rejects(downloadAvatar('https://images.example.test/photo.png'), /Private and local/);
  lookup.mock.mockImplementation(async () => [{ address: '::ffff:127.0.0.1', family: 6 }]);
  await assert.rejects(downloadAvatar('https://[::ffff:127.0.0.1]/photo.png'), /Private and local/);
  assert.equal(get.mock.callCount(), 0);
});

test('DNS timeout cannot start a late connection and DNS errors stay actionable', async t => {
  let finish: (addresses: { address: string; family: number }[]) => void = () => {};
  const lookup = t.mock.method(dns, 'lookup', () => new Promise(resolve => { finish = resolve; }));
  const get = t.mock.method(https, 'get', () => { throw new Error('Unexpected connection'); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = assert.rejects(downloadAvatar('https://images.example.test/photo.png'), /timed out/);
  t.mock.timers.tick(10_000);
  await pending;
  finish([{ address: '8.8.8.8', family: 4 }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(get.mock.callCount(), 0);
  lookup.mock.mockImplementation(async () => { throw new Error('DNS unavailable'); });
  await assert.rejects(downloadAvatar('https://images.example.test/photo.png'), /could not be downloaded/);
});

test('downloads pin the checked address, reject redirects and bound streamed bytes', async t => {
  const lookup = t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  let status = 200, mime = 'image/png', body = Buffer.from('synthetic image payload');
  let length: string | undefined;
  let requested: https.RequestOptions | undefined;
  const get = t.mock.method(https, 'get', (_url: URL, options: https.RequestOptions, callback: (response: IncomingMessage) => void) => {
    requested = options;
    const response = new IncomingMessage(new Socket());
    response.statusCode = status;
    response.headers = { 'content-type': mime, 'content-length': length };
    response.complete = true;
    queueMicrotask(() => { callback(response); if (!response.destroyed) { response.push(body); response.push(null); } });
    return new EventEmitter();
  });
  assert.deepEqual(await downloadAvatar('https://images.example.test/photo.png'), body);
  assert.equal(lookup.mock.callCount(), 1);
  assert.equal(requested?.family, 4);
  assert.equal(requested?.agent, false);
  assert.ok(requested?.signal);
  requested?.lookup?.('images.example.test', {}, (error, address, family) => {
    assert.equal(error, null); assert.equal(address, '8.8.8.8'); assert.equal(family, 4);
  });
  status = 302;
  await assert.rejects(downloadAvatar('https://images.example.test/photo.png'), /without redirects/);
  assert.equal(get.mock.callCount(), 2);
  status = 200; mime = 'text/html';
  await assert.rejects(downloadAvatar('https://images.example.test/photo.png'), /PNG, JPEG or WebP/);
  mime = 'image/png'; length = '3000001';
  await assert.rejects(downloadAvatar('https://images.example.test/photo.png'), /under 3 MB/);
  length = undefined; body = Buffer.alloc(3_000_001);
  await assert.rejects(downloadAvatar('https://images.example.test/photo.png'), /under 3 MB/);
});

test('URL avatar API stores only normalized image bytes, not URLs or metadata', async t => {
  const image = await sharp({ create: { width: 250, height: 200, channels: 3, background: '#448855' } }).jpeg().withMetadata().toBuffer();
  t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  t.mock.method(https, 'get', (_url: URL, _options: https.RequestOptions, callback: (response: IncomingMessage) => void) => {
    const response = new IncomingMessage(new Socket());
    response.statusCode = 200; response.headers = { 'content-type': 'image/jpeg' }; response.complete = true;
    queueMicrotask(() => { callback(response); response.push(image); response.push(null); });
    return new EventEmitter();
  });
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const app = createApp(db, { origin: 'http://127.0.0.1:4189', databasePath: ':memory:', snapshotPath: 'unused', distPath: 'dist' });
  const result = await request(app).post('/api/avatars').set({ Host: '127.0.0.1:4189', Origin: 'http://127.0.0.1:4189', 'X-Org-Planner': 'local' }).send({ url: 'https://images.example.test/photo.jpg' }).expect(201);
  const avatar = db.getAvatar(result.body.id)!;
  const metadata = await sharp(avatar.bytes).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 160); assert.equal(metadata.height, 160);
  assert.equal(metadata.exif, undefined);
  assert.equal(JSON.stringify(db.backup()).includes('images.example.test'), false);
  assert.deepEqual(Buffer.from(avatar.bytes), await normalizeAvatar(image));
  await assert.rejects(normalizeAvatar(Buffer.from('<svg></svg>')), /PNG, JPEG or WebP/);
  await assert.rejects(normalizeAvatar(Buffer.alloc(3_000_001)), /under 3 MB/);
});
