// Cloudflare Pages Function: POST /api/contact
// Sends the message to the owner via Resend (https://resend.com).
//
// Environment variables (Cloudflare Pages -> Settings -> Variables and Secrets):
//   RESEND_API_KEY      (secret)  Resend API key
//   CONTACT_TO_EMAIL              where messages are delivered, e.g. hello@elakoo.com
//   CONTACT_FROM_EMAIL            verified sender in Resend, e.g. "Elakoo website <no-reply@elakoo.com>"
//   TURNSTILE_SECRET_KEY (optional secret) enables Cloudflare Turnstile check if set
// Optional KV binding:
//   RATE_LIMIT                    KV namespace for per-IP rate limiting (5 messages / hour)

const SUBJECTS = ['General question', 'Suggest a video', 'Report a problem', 'Other'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_FILL_MS = 3000;
const RATE_LIMIT_PER_HOUR = 5;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) return request.json();
  const form = await request.formData();
  return Object.fromEntries(form);
}

export async function onRequestPost({ request, env }) {
  const wantsJson = (request.headers.get('accept') || '').includes('application/json');
  const reply = (ok, error, status) => {
    if (wantsJson) return json(ok ? { ok: true } : { ok: false, error }, status);
    // No-JS fallback: redirect back to the contact page with a status flag.
    const url = new URL('/contact/', request.url);
    url.searchParams.set('status', ok ? 'sent' : 'error');
    return Response.redirect(url.toString(), 303);
  };

  let data;
  try {
    data = await readBody(request);
  } catch {
    return reply(false, 'Invalid request.', 400);
  }

  const name = String(data.name || '').trim();
  const email = String(data.email || '').trim();
  const subject = SUBJECTS.includes(data.subject) ? data.subject : 'Other';
  const message = String(data.message || '').trim();

  // Spam checks: honeypot filled or form sent impossibly fast -> pretend success, send nothing.
  if (data.website) return reply(true);
  const ts = Number(data.ts);
  if (ts && Date.now() - ts < MIN_FILL_MS) return reply(true);

  if (!name || name.length > 100) return reply(false, 'Please enter your name.', 422);
  if (!EMAIL_RE.test(email) || email.length > 200) return reply(false, 'Please enter a valid email address.', 422);
  if (message.length < 10 || message.length > 5000) return reply(false, 'Message must be between 10 and 5000 characters.', 422);

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';

  if (env.TURNSTILE_SECRET_KEY) {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: String(data['cf-turnstile-response'] || ''), remoteip: ip }),
    });
    const t = await r.json().catch(() => ({}));
    if (!t.success) return reply(false, 'Spam check failed. Please reload the page and try again.', 403);
  }

  if (env.RATE_LIMIT) {
    const key = `contact:${ip}:${new Date().toISOString().slice(0, 13)}`;
    const count = Number((await env.RATE_LIMIT.get(key)) || 0);
    if (count >= RATE_LIMIT_PER_HOUR) return reply(false, 'Too many messages. Please try again later.', 429);
    await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 3700 });
  }

  if (!env.RESEND_API_KEY || !env.CONTACT_TO_EMAIL || !env.CONTACT_FROM_EMAIL) {
    console.error('Contact form is not configured: set RESEND_API_KEY, CONTACT_TO_EMAIL, CONTACT_FROM_EMAIL.');
    return reply(false, 'The contact form is not available right now. Please try again later.', 503);
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.CONTACT_FROM_EMAIL,
      to: [env.CONTACT_TO_EMAIL],
      reply_to: email,
      subject: `[Elakoo] ${subject} - ${name}`.slice(0, 200),
      text: `Name: ${name}\nEmail: ${email}\nSubject: ${subject}\n\n${message}`,
      html: `<p><b>Name:</b> ${escapeHtml(name)}<br><b>Email:</b> ${escapeHtml(email)}<br><b>Subject:</b> ${escapeHtml(subject)}</p><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
    }),
  });

  // Success only when the provider confirms it accepted the email.
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.id) {
    console.error('Resend error', res.status, JSON.stringify(out).slice(0, 300));
    return reply(false, 'Sorry, the message could not be sent. Please try again later.', 502);
  }
  return reply(true);
}

export function onRequestGet() {
  return json({ ok: false, error: 'Method not allowed' }, 405);
}
