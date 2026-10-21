// ===== 나의 할 일 · 알림 서버 (Cloudflare Workers, 무료) =====
// 하는 일: Firestore의 pushJobs(보낼 알림 목록)에서 보낼 시각이 된 것을 찾아,
//          받는 사람의 폰/컴퓨터(users/{계정}/pushSubs)로 알림을 보내고 지워요.
// 언제: 1분마다(Cron) + 앱이 "지금 확인해 줘"(/flush)라고 부를 때
//
// Cloudflare 설정 > 변수(Secret)에 넣어야 하는 것 2개:
//   FIREBASE_SERVICE_ACCOUNT : Firebase에서 받은 서비스 계정 열쇠 파일(.json)의 내용 전체
//   VAPID_JWK                : 이 프로젝트의 .secrets/vapid-jwk.txt 내용
// 이 두 값은 비밀이에요. 코드나 채팅에 붙여넣지 마세요.

const VAPID_PUBLIC = 'BDYOI8b5KlkswnpbBaq1W-PvPq_RGHe1LRm_BRkUTwMXqAbqvfZQ47yS8eCYPtNZa8i9rRg1ZTdu-OPmiglASCI';
const VAPID_SUBJECT = 'https://kitto-daijyobu.github.io/To-Do-List/';
const ALLOWED_ORIGIN = 'https://kitto-daijyobu.github.io';
const APP_URL = 'https://kitto-daijyobu.github.io/To-Do-List/';

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/flush') {
      const sent = await processDueJobs(env);
      return new Response(JSON.stringify({ sent }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    return new Response('나의 할 일 알림 서버가 잘 돌아가고 있어요 🔔', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(processDueJobs(env));
  },
};

// ---------- 보낼 알림 처리 ----------
async function processDueJobs(env) {
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const token = await googleAccessToken(sa);
  const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;
  const auth = { Authorization: `Bearer ${token}` };

  const query = {
    structuredQuery: {
      from: [{ collectionId: 'pushJobs' }],
      where: { fieldFilter: { field: { fieldPath: 'at' }, op: 'LESS_THAN_OR_EQUAL', value: { integerValue: String(Date.now()) } } },
      limit: 50,
    },
  };
  const res = await fetch(`${base}:runQuery`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(query) });
  const rows = await res.json();
  let sent = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row.document) continue;
    const job = plain(row.document.fields);
    // 먼저 지워요. 이미 다른 쪽에서 지웠으면(동시에 처리 중) 건너뛰어요 → 같은 알림이 두 번 가지 않게
    const del = await fetch(`https://firestore.googleapis.com/v1/${row.document.name}?currentDocument.exists=true`, { method: 'DELETE', headers: auth });
    if (!del.ok) continue;

    const subsRes = await fetch(`${base}/users/${job.to}/pushSubs`, { headers: auth });
    const subs = (await subsRes.json()).documents || [];
    const payload = JSON.stringify({ title: job.title || '나의 할 일', body: job.body || '', url: APP_URL, tag: job.tag || 'mytodo' });

    for (const subDoc of subs) {
      const sub = plain(subDoc.fields);
      const result = await sendPush(sub, payload, env);
      if (result === 404 || result === 410) {
        // 더는 쓰지 않는 기기 → 지워요
        await fetch(`https://firestore.googleapis.com/v1/${subDoc.name}`, { method: 'DELETE', headers: auth });
      } else if (result >= 200 && result < 300) {
        sent++;
      }
    }
  }
  return sent;
}

// Firestore 값 → 보통 값
function plain(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if ('stringValue' in v) out[k] = v.stringValue;
    else if ('integerValue' in v) out[k] = Number(v.integerValue);
    else if ('doubleValue' in v) out[k] = v.doubleValue;
    else if ('booleanValue' in v) out[k] = v.booleanValue;
  }
  return out;
}

// ---------- 구글 로그인 (서비스 계정) ----------
async function googleAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const key = await crypto.subtle.importKey('pkcs8', pemToBytes(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const jwt = await signJwt({ alg: 'RS256', typ: 'JWT' }, claims, key, { name: 'RSASSA-PKCS1-v1_5' });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('구글 로그인 실패: ' + JSON.stringify(data));
  return data.access_token;
}

function pemToBytes(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// ---------- 웹 푸시 (RFC 8291 aes128gcm + VAPID) ----------
const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

async function signJwt(header, claims, key, algo) {
  const input = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(enc.encode(JSON.stringify(claims)))}`;
  const sig = await crypto.subtle.sign(algo, key, enc.encode(input));
  return `${input}.${b64url(sig)}`;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// 받는 기기의 공개 열쇠로 알림 내용을 암호화해요
// (asKeyPair, salt는 보통 새로 만들고, 시험할 때만 정해진 값을 넣어요)
async function encryptPayload(uaPublic, authSecret, plaintext, asKeyPair = null, salt = null) {
  const local = asKeyPair || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  salt ||= crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));

  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

async function sendPush(sub, payload, env) {
  const body = await encryptPayload(fromB64url(sub.p256dh), fromB64url(sub.auth), enc.encode(payload));

  // 보내는 쪽이 우리 서버라는 증명 (VAPID)
  const vapidKey = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const audience = new URL(sub.endpoint).origin;
  const jwt = await signJwt({ typ: 'JWT', alg: 'ES256' }, { aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT }, vapidKey, { name: 'ECDSA', hash: 'SHA-256' });

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${VAPID_PUBLIC}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '3600',
      Urgency: 'high',
    },
    body,
  });
  return res.status;
}
