// api/login.js — Kullanıcı girişi ve JWT token üretimi
// Harici bağımlılık yok — Node.js crypto modülü kullanılır

const crypto = require("crypto");

const TOKEN_DAYS = 7;
const TOKEN_SECRET = process.env.JWT_SECRET || "degistir-bunu-gizli-tut";

// ── Basit JWT (HS256) — harici kütüphane gerektirmez ──────────────────────
function base64url(str) {
  return Buffer.from(str).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function signToken(payload) {
  const header  = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body    = base64url(JSON.stringify(payload));
  const sig     = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [header, body, sig] = token.split(".");
    const expected = crypto
      .createHmac("sha256", TOKEN_SECRET)
      .update(`${header}.${body}`)
      .digest("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, "base64").toString());
    if (payload.exp < Date.now()) return null;  // süresi dolmuş
    return payload;
  } catch {
    return null;
  }
}

// ── Kullanıcı listesini env'den oku ──────────────────────────────────────
function getUsers() {
  try {
    return JSON.parse(process.env.USERS_CONFIG || "[]");
  } catch {
    return [];
  }
}

// ── Login Handler ─────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { username, password, token_check } = req.body || {};

  // Token yenileme kontrolü (sayfa yüklenince mevcut token geçerli mi?)
  if (token_check) {
    const payload = verifyToken(token_check);
    if (payload) return res.status(200).json({ valid: true, name: payload.name, dersler: payload.dersler });
    return res.status(401).json({ error: "Token geçersiz veya süresi dolmuş" });
  }

  if (!username || !password) {
    return res.status(400).json({ error: "Kullanıcı adı ve şifre gerekli" });
  }

  const users = getUsers();
  const user  = users.find(
    u => u.username === username.trim() && u.password === password
  );

  if (!user) {
    // Brute-force'a karşı küçük gecikme
    await new Promise(r => setTimeout(r, 400));
    return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
  }

  const payload = {
    sub:     user.username,
    name:    user.name || user.username,
    dersler: user.dersler || [],   // ["Matematik 5","Matematik 6"]
    siniflar: user.siniflar || [], // opsiyonel: ["5","6"] — boşsa tüm sınıflar
    iat:     Date.now(),
    exp:     Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000,
  };

  const token = signToken(payload);

  return res.status(200).json({
    token,
    name:    payload.name,
    dersler: payload.dersler,
    siniflar: payload.siniflar,
    expiresAt: new Date(payload.exp).toISOString(),
  });
};

// ── Token doğrulama — ai.js ve build.js tarafından import edilir ──────────
module.exports.verifyToken = verifyToken;
