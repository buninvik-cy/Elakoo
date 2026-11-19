#!/usr/bin/env node
// Tiny HTTP server for the contact form on a VPS (no dependencies, Node 20+).
// nginx serves the static site and proxies POST /api/contact here.
// Reuses the same handler as the Cloudflare version: functions/api/contact.js
//
// Environment (e.g. /etc/elakoo/contact.env, loaded by systemd):
//   PORT=8787  HOST=127.0.0.1
//   RESEND_API_KEY, CONTACT_TO_EMAIL, CONTACT_FROM_EMAIL
//   SITE_ORIGIN=https://elakoo.com

import http from 'node:http';
import { onRequestPost } from '../functions/api/contact.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const ORIGIN = process.env.SITE_ORIGIN || 'https://elakoo.com';
const MAX_BODY = 20_000;

// In-memory stand-in for the Cloudflare KV used for rate limiting.
const store = new Map();
const RATE_LIMIT = {
  async get(key) {
    const e = store.get(key);
    if (!e) return null;
    if (e.exp < Date.now()) { store.delete(key); return null; }
    return e.value;
  },
  async put(key, value, { expirationTtl = 3600 } = {}) {
    store.set(key, { value, exp: Date.now() + expirationTtl * 1000 });
  },
};
setInterval(() => { const now = Date.now(); for (const [k, e] of store) if (e.exp < now) store.delete(k); }, 600_000).unref();

const env = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  CONTACT_TO_EMAIL: process.env.CONTACT_TO_EMAIL,
  CONTACT_FROM_EMAIL: process.env.CONTACT_FROM_EMAIL,
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
  RATE_LIMIT,
};

const server = http.createServer(async (req, res) => {
  try {
    const path = (req.url || '').split('?')[0].replace(/\/$/, '');
    if (path === '/api/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (path !== '/api/contact') { res.writeHead(404); return res.end(); }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      return res.end('{"ok":false,"error":"Method not allowed"}');
    }

    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) { res.writeHead(413); return res.end(); }
      chunks.push(c);
    }

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    // Real client IP comes from nginx (X-Real-IP); expose it the way the handler expects.
    headers.set('cf-connecting-ip', req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown');

    const request = new Request(new URL('/api/contact', ORIGIN), { method: 'POST', headers, body: Buffer.concat(chunks) });
    const response = await onRequestPost({ request, env });

    const out = {};
    response.headers.forEach((v, k) => { out[k] = v; });
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error('contact-server error', err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{"ok":false,"error":"Server error. Please try again later."}');
  }
});

server.listen(PORT, HOST, () => console.log(`contact server on http://${HOST}:${PORT}`));
