// ============================================================
// NAVE MOD — Auto Feedback Server
// Deploy ke Vercel, set ENV vars di dashboard Vercel
// ============================================================

const https = require('https');

const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;   // token bot kamu
const CHAT_ID    = process.env.TELEGRAM_CHAT_ID;      // id group/channel
const SECRET_KEY = process.env.SECRET_KEY || 'NAVE_SECRET_KEY_123';
const MAX_BODY   = 12 * 1024 * 1024; // 12 MB max (buat base64 screenshot)

// ── Helper: baca raw body ────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    // Sudah di-parse (framework / Vercel edge)
    if (req.body && typeof req.body === 'object') return resolve(req.body);

    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        return reject(new Error('Payload terlalu besar'));
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

// ── Helper: escape HTML Telegram ────────────────────────────
function esc(s) {
  return String(s ?? '-')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Kirim foto ke Telegram ───────────────────────────────────
function tgSendPhoto(imgBuf, caption) {
  return new Promise((resolve, reject) => {
    const boundary = `Bound${Date.now()}${Math.random().toString(36).slice(2)}`;

    const textBlock = [
      `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${CHAT_ID}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML`,
      `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}`,
    ].join('\r\n') + '\r\n';

    const photoHeader =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="photo"; filename="win.jpg"\r\n` +
      `Content-Type: image/jpeg\r\n\r\n`;

    const closing = `\r\n--${boundary}--\r\n`;

    const body = Buffer.concat([
      Buffer.from(textBlock),
      Buffer.from(photoHeader),
      imgBuf,
      Buffer.from(closing),
    ]);

    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/sendPhoto`,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch { resolve({ ok: false, description: raw }); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Kirim pesan teks biasa (fallback kalau foto gagal) ────────
function tgSendMessage(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' });
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch { resolve({ ok: false }); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Build caption Telegram ───────────────────────────────────
function buildCaption(data) {
  const { playerName, uid, time, kills, rank } = data;
  return (
    `🏆 <b>CHICKEN DINNER!</b>\n\n` +
    `<pre>` +
    `Player : ${esc(playerName)}\n` +
    `UID    : ${esc(uid)}\n` +
    `Time   : ${esc(time)}\n` +
    `Kills  : ${esc(kills)}\n` +
    `Rank   : ${esc(rank)}\n` +
    `</pre>\n` +
    `✅ <b>[ ACTIVE - SAFE ]</b>\n` +
    `<b>NAVE MOD | @naveluzia</b>`
  );
}

// ── Main handler ─────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  // Validasi env
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('ENV TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID belum di-set');
    return res.status(500).json({ ok: false, error: 'Server misconfigured' });
  }

  let payload;
  try {
    payload = await readBody(req);
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }

  const { key, photoBase64 } = payload;

  // Validasi secret key
  if (!key || key !== SECRET_KEY) {
    return res.status(403).json({ ok: false, error: 'Unauthorized' });
  }

  const caption = buildCaption(payload);

  try {
    let result;

    if (photoBase64 && photoBase64.length > 100) {
      const imgBuf = Buffer.from(photoBase64, 'base64');
      result = await tgSendPhoto(imgBuf, caption);

      // Kalau foto gagal, fallback ke teks
      if (!result.ok) {
        console.warn('sendPhoto gagal, fallback ke sendMessage:', result.description);
        result = await tgSendMessage(caption);
      }
    } else {
      result = await tgSendMessage(caption);
    }

    if (result.ok) {
      return res.status(200).json({ ok: true });
    } else {
      console.error('Telegram error:', result.description);
      return res.status(502).json({ ok: false, error: result.description });
    }
  } catch (err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
};
