const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");
const multer = require("multer");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");


const app = express();
app.set("trust proxy", 1);

const PORT = process.env.PORT || 8080;
const MODEL = "gpt-5.6-luna";
const DAILY_LIMIT = 5;
const SIGNED_IN_DAILY_LIMIT = 15;
const PRO_DAILY_LIMIT = 50;
const IP_DAILY_SAFETY_LIMIT = 20;
const BURST_LIMIT = 15;
const BURST_WINDOW_SECONDS = 60;
const TRANSLATE_BURST_LIMIT = 20;
const SHOPPING_BURST_LIMIT = 10;
const MAX_MESSAGE_LENGTH = 3000;
const MEMORY_DAYS = 30;
const VISITOR_COOKIE_DAYS = 365;
const ANALYTICS_RETENTION_DAYS = 395;
const PSEUDONYMOUS_USAGE_RETENTION_DAYS = 31;
const SHOPPING_TOKEN_TTL_SECONDS = 1800;
const AUTH_SESSION_DAYS = 30;
const PRIVACY_POLICY_VERSION = "2026-09-09";
const TERMS_VERSION = "2026-09-09";
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const EMAIL_VERIFY_TTL_HOURS = 24;
const PASSWORD_RESET_TTL_MINUTES = 60;
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const CHAD_EMAIL_FROM = process.env.CHAD_EMAIL_FROM || "Chad P.D. Chee <noreply@chadpdchee.com>";
const APP_BASE_URL = "https://chadpdchee.com";

// Sponsor platform
const SPONSOR_PRICE_USD = 149;
const SPONSOR_MAX_ACTIVE_SLOTS = 4;
const SPONSOR_AGREEMENT_VERSION = "2026-09-11-30DAY-FOUNDING149";
const SPONSOR_DURATION_DAYS = 30;
const SPONSOR_AGREEMENT_TEXT = `Chad P.D. Chee Sponsor Placement Agreement — Version 2026-09-11-30DAY-FOUNDING149

This agreement is between Hammered Handyman Media ("Publisher") and the company or brand identified in this order ("Sponsor").

Placement and fee. Sponsor is purchasing one Chad P.D. Chee direct sponsor position for $149 USD for 30 consecutive days. The placement participates in the site's rotating direct-sponsor inventory, with no more than four active paid sponsor positions scheduled at the same time. This is a one-time purchase and does not automatically renew.

Approval. Payment does not cause automatic publication. Publisher may review, edit with Sponsor approval, reject, suspend, or remove creative that is inaccurate, unlawful, unsafe, misleading, technically harmful, incompatible with the audience, or reasonably likely to damage the Publisher or Chad P.D. Chee brand. If Publisher rejects a campaign before it runs and the parties cannot agree on acceptable creative, the sponsorship fee will be refunded.

Sponsor materials and claims. Sponsor represents that it has the rights needed to provide its names, logos, trademarks, images, URLs, offers, discount codes, and advertising claims. Sponsor is responsible for the accuracy and legality of its products, claims, prices, promotions, and discount terms.

License. Sponsor grants Publisher a limited, non-exclusive license during the campaign and reasonable reporting/archive period to display Sponsor-provided brand assets and creative for the purchased placement and related campaign reporting.

Performance. Publisher does not guarantee any minimum number of impressions, clicks, leads, sales, conversions, revenue, or other result. Dashboard statistics are first-party measurements and may be affected by browsers, blockers, connectivity, fraud filtering, and technical conditions.

Timing. Each purchased placement receives 30 consecutive days. Sponsor may request the earliest available start or choose a future start date. A requested date is subject to inventory and approval. If Publisher approval occurs after the reserved start date, the campaign will receive a full 30-day run beginning on approval or the next available start date that does not exceed four simultaneous paid sponsors. Sponsor-caused delays, including late or incomplete creative, may require a later available start date.

Cancellation and refunds. Before approval, Sponsor may request cancellation. Once an approved campaign has begun running, fees are generally non-refundable except where Publisher fails to provide the placement for a material portion of the campaign or otherwise agrees in writing.

Platform and law. Sponsor content must comply with applicable law and relevant platform/payment requirements. Publisher may refuse regulated, deceptive, dangerous, infringing, hateful, adult, illegal, or otherwise unsuitable advertising.

Entire order. This agreement, the campaign information submitted with it, and the site's Privacy Policy and Terms form the sponsor order. Material custom terms must be agreed to in writing by both parties.`;
const SPONSOR_SESSION_DAYS = 30;
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || "";
const PAYPAL_ENV = String(process.env.PAYPAL_ENV || "sandbox").toLowerCase() === "live" ? "live" : "sandbox";
const PAYPAL_API_BASE = PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

// Prepaid Chad chat packs. Credits never expire and are only attached to signed-in accounts.
const CHAT_PACKS = Object.freeze({
    starter: { id: "starter", chats: 50, priceUsd: 2.99, label: "50 Chad Chats" },
    popular: { id: "popular", chats: 150, priceUsd: 5.99, label: "150 Chad Chats" },
    value: { id: "value", chats: 500, priceUsd: 14.99, label: "500 Chad Chats" }
});
const DIGITALOCEAN_MONTHLY_USD = Number(process.env.DIGITALOCEAN_MONTHLY_USD || 12);
const PAYPAL_EST_PERCENT = Number(process.env.PAYPAL_EST_PERCENT || 2.9);
const PAYPAL_EST_FIXED_USD = Number(process.env.PAYPAL_EST_FIXED_USD || 0.30);

const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || "";
const CHAD_ADMIN_TEST_KEY = process.env.CHAD_ADMIN_TEST_KEY || "";
const AMAZON_TAG = "dannyroymolso-20";
const ANALYTICS_SECRET = process.env.ANALYTICS_SIGNING_KEY || crypto.randomBytes(32).toString("hex");

const ALLOWED_ORIGINS = new Set([
    "https://hammeredhandyman.com",
    "https://www.hammeredhandyman.com",
    "https://seal-app-zgkfc.ondigitalocean.app",
    "https://chadpdchee.com",
    "https://www.chadpdchee.com"
]);

const ALLOWED_TURNSTILE_HOSTS = new Set([
    "hammeredhandyman.com",
    "www.hammeredhandyman.com",
    "seal-app-zgkfc.ondigitalocean.app",
    "chadpdchee.com",
    "www.chadpdchee.com"
]);

app.use(express.json({ limit: "3mb" }));

app.use((req, res, next) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";

    if (origin && ALLOWED_ORIGINS.has(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Vary", "Origin");
        res.setHeader(
            "Access-Control-Allow-Headers",
            "Content-Type, X-Chad-Admin-Key, X-ChadPDG-Dev, X-WP-Nonce"
        );
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    }

    if (req.method === "OPTIONS") {
        if (origin && !ALLOWED_ORIGINS.has(origin)) {
            return res.sendStatus(403);
        }
        return res.sendStatus(204);
    }

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return res.status(403).json({
            success: false,
            error: "Request blocked."
        });
    }

    next();
});


app.get("/verify-email", (req, res) => {
    const token = String(req.query.token || "").replace(/[^A-Za-z0-9_-]/g, "");

    res.type("html").send(`<!doctype html>
<html>
<head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Verify ChadPDChee</title>
</head>
<body style="font-family:Arial,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0">
    <main style="max-width:560px;padding:32px;text-align:center">
        <h1>ChadPDChee</h1>
        <p id="msg">Verifying your email and signing you in...</p>
    </main>
    <script>
    (async () => {
        const msg = document.getElementById('msg');
        try {
            const response = await fetch('/auth/verify-email', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: ${JSON.stringify(token)} })
            });

            const data = await response.json();

            if (data.success) {
                msg.textContent = 'Email verified. Chad is letting you in. Try not to make him regret it.';
                setTimeout(() => {
                    window.location.replace('/?verified=1');
                }, 900);
                return;
            }

            msg.textContent = data.error || 'Verification failed.';
        } catch (error) {
            msg.textContent = 'Verification failed. Please try again.';
        }
    })();
    </script>
</body>
</html>`);
});

app.get("/reset-password", (req, res) => {
    const token = String(req.query.token || "").replace(/[^A-Za-z0-9_-]/g, "");
    res.type("html").send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reset ChadPDChee Password</title></head><body style="font-family:Arial,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0"><main style="width:min(92vw,520px);padding:32px"><h1>Reset password</h1><form id="f"><label>New password<br><input id="p" type="password" minlength="8" maxlength="128" required style="width:100%;box-sizing:border-box;padding:12px;margin:8px 0 16px"></label><button style="padding:12px 18px">Set new password</button></form><p id="msg"></p><script>document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();const msg=document.getElementById('msg');msg.textContent='Resetting...';try{const r=await fetch('/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(token)},password:document.getElementById('p').value})});const d=await r.json();msg.textContent=d.success?'Password changed. You can return to ChadPDChee and sign in.':(d.error||'Reset failed.');if(d.success)e.target.remove();}catch(err){msg.textContent='Reset failed. Please try again.';}});</script></main></body></html>`);
});

app.use(express.static("public"));

const databaseUrl = process.env.DATABASE_URL
    ? process.env.DATABASE_URL
        .replace(/[?&]sslmode=[^&]*/i, "")
        .replace(/\?$/, "")
    : "";

const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
});

function parseCookies(req) {
    const out = {};
    const raw = req.headers.cookie || "";
    for (const part of raw.split(";")) {
        const index = part.indexOf("=");
        if (index < 0) continue;
        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        if (!key) continue;
        try {
            out[key] = decodeURIComponent(value);
        } catch {
            out[key] = value;
        }
    }
    return out;
}

function appendSetCookie(res, cookie) {
    const current = res.getHeader("Set-Cookie");
    if (!current) {
        res.setHeader("Set-Cookie", cookie);
    } else if (Array.isArray(current)) {
        res.setHeader("Set-Cookie", [...current, cookie]);
    } else {
        res.setHeader("Set-Cookie", [current, cookie]);
    }
}

function setPersistentCookie(res, name, value, maxAgeSeconds) {
    appendSetCookie(
        res,
        `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`
    );
}


function clearCookie(res, name) {
    appendSetCookie(
        res,
        `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`
    );
}

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function validEmail(value) {
    const email = normalizeEmail(value);
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function passwordLooksAcceptable(value) {
    return typeof value === "string" &&
        value.length >= PASSWORD_MIN_LENGTH &&
        value.length <= PASSWORD_MAX_LENGTH;
}

function scryptAsync(password, salt, options = {}) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, 64, options, (error, derivedKey) => {
            if (error) reject(error);
            else resolve(derivedKey);
        });
    });
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const N = 16384;
    const r = 8;
    const p = 1;
    const derived = await scryptAsync(password, salt, {
        N,
        r,
        p,
        maxmem: 64 * 1024 * 1024
    });
    return `scrypt$${N}$${r}$${p}$${salt}$${derived.toString("hex")}`;
}

async function verifyPassword(password, stored) {
    try {
        const parts = String(stored || "").split("$");
        if (parts.length !== 6 || parts[0] !== "scrypt") return false;
        const N = Number(parts[1]);
        const r = Number(parts[2]);
        const p = Number(parts[3]);
        const salt = parts[4];
        const expected = Buffer.from(parts[5], "hex");
        const actual = await scryptAsync(password, salt, {
            N,
            r,
            p,
            maxmem: 64 * 1024 * 1024
        });
        return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    } catch {
        return false;
    }
}

function hashSessionToken(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
}

async function createAuthSession(userId, req, res) {
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000);
    const ipHash = hashValue(getClientIp(req));
    const userAgent = String(req.headers["user-agent"] || "").slice(0, 500);

    await pool.query(
        `INSERT INTO chad_user_sessions
            (token_hash, user_id, expires_at, ip_hash, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [tokenHash, userId, expiresAt, ipHash, userAgent]
    );

    setPersistentCookie(
        res,
        "chad_session",
        token,
        AUTH_SESSION_DAYS * 24 * 60 * 60
    );
}

async function getAuthenticatedUser(req) {
    const cookies = parseCookies(req);
    const token = cookies.chad_session || "";
    if (!token || token.length > 200) return null;

    const result = await pool.query(
        `SELECT u.id, u.email, u.display_name, u.email_verified, u.plan, u.pro_until,
                u.created_at, u.marketing_consent
         FROM chad_user_sessions s
         JOIN chad_users u ON u.id = s.user_id
         WHERE s.token_hash = $1
           AND s.expires_at > NOW()
           AND s.revoked_at IS NULL
           AND u.deleted_at IS NULL
         LIMIT 1`,
        [hashSessionToken(token)]
    );

    if (!result.rowCount) return null;

    await pool.query(
        `UPDATE chad_user_sessions SET last_seen_at = NOW() WHERE token_hash = $1`,
        [hashSessionToken(token)]
    ).catch(() => {});

    return result.rows[0];
}

async function revokeCurrentSession(req, res) {
    const cookies = parseCookies(req);
    const token = cookies.chad_session || "";
    if (token) {
        await pool.query(
            `UPDATE chad_user_sessions SET revoked_at = NOW()
             WHERE token_hash = $1`,
            [hashSessionToken(token)]
        ).catch(() => {});
    }
    clearCookie(res, "chad_session");
}

async function requireAuthenticatedUser(req, res) {
    const user = await getAuthenticatedUser(req);
    if (!user) {
        res.status(401).json({
            success: false,
            error: "Please sign in to continue."
        });
        return null;
    }
    return user;
}

function validUuid(value) {
    return typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validVisitorId(value) {
    return typeof value === "string" &&
        /^[a-zA-Z0-9_-]{16,128}$/.test(value);
}

const MAX_CHAT_IMAGE_DATA_URL_LENGTH = 1_500_000;

function normalizeChatImageDataUrl(value) {
    if (typeof value !== "string") return "";
    const dataUrl = value.trim();
    if (!dataUrl) return "";
    if (dataUrl.length > MAX_CHAT_IMAGE_DATA_URL_LENGTH) return "";
    if (!/^data:image\/(jpeg|jpg|png|webp);base64,[a-z0-9+/=\r\n]+$/i.test(dataUrl)) return "";
    return dataUrl;
}

function getOrCreateVisitorId(req, res) {
    const cookies = parseCookies(req);
    const legacyBody = req.body && (
        req.body.analytics_visitor ||
        req.body.visitor_id
    );
    const legacyQuery = req.query && req.query.visitor_id;

    let id = cookies.chadgpt_visitor || legacyBody || legacyQuery || "";

    if (!validVisitorId(id) && !validUuid(id)) {
        id = crypto.randomUUID();
    }

    setPersistentCookie(
        res,
        "chadgpt_visitor",
        id,
        VISITOR_COOKIE_DAYS * 24 * 60 * 60
    );

    return id.toLowerCase();
}

async function getOrCreateConversationId(req, res) {
    const cookies = parseCookies(req);
    const bodyId = req.body && req.body.conversation_id;
    let id = cookies.chadgpt_conversation || bodyId || "";
    const user = await getAuthenticatedUser(req);

    if (validUuid(id)) {
        const existing = await pool.query(
            `SELECT id, user_id FROM chad_conversations WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (existing.rowCount) {
            const owner = existing.rows[0].user_id;
            if (user) {
                if (!owner) {
                    await pool.query(
                        `UPDATE chad_conversations
                         SET user_id = $2, updated_at = NOW()
                         WHERE id = $1 AND user_id IS NULL`,
                        [id, user.id]
                    );
                } else if (String(owner) !== String(user.id)) {
                    id = "";
                }
            } else if (owner) {
                id = "";
            }
        }
    }

    if (!validUuid(id)) {
        id = crypto.randomUUID();
    }

    if (user) {
        await pool.query(
            `INSERT INTO chad_conversations (id, user_id)
             VALUES ($1, $2)
             ON CONFLICT (id) DO UPDATE
             SET updated_at = NOW(),
                 user_id = COALESCE(chad_conversations.user_id, EXCLUDED.user_id)`,
            [id, user.id]
        );
    } else {
        await ensureConversation(id);
    }

    setPersistentCookie(
        res,
        "chadgpt_conversation",
        id,
        user ? AUTH_SESSION_DAYS * 24 * 60 * 60 : MEMORY_DAYS * 24 * 60 * 60
    );

    return id;
}

function hashValue(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function safeSecretMatch(supplied, expected) {
    if (!supplied || !expected) return false;
    const a = Buffer.from(String(supplied));
    const b = Buffer.from(String(expected));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isAdminTestRequest(req) {
    const supplied =
        req.headers["x-chad-admin-key"] ||
        req.headers["x-chadpdg-dev"] ||
        "";
    return safeSecretMatch(
        typeof supplied === "string" ? supplied.trim() : "",
        CHAD_ADMIN_TEST_KEY
    );
}

function getClientIp(req) {
    return req.ip || req.socket?.remoteAddress || "unknown";
}

function torontoDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Toronto",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function getTorontoResetInfo() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Toronto",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    }).formatToParts(now);
    const v = Object.fromEntries(parts.map(p => [p.type, p.value]));

    // Calculate Toronto's UTC offset by comparing formatted local parts to UTC.
    const asLocalUTC = Date.UTC(
        Number(v.year), Number(v.month) - 1, Number(v.day),
        Number(v.hour), Number(v.minute), Number(v.second)
    );
    const offsetMs = asLocalUTC - now.getTime();

    const localMidnightTomorrowUTC = Date.UTC(
        Number(v.year), Number(v.month) - 1, Number(v.day) + 1, 0, 0, 0
    ) - offsetMs;

    const reset = new Date(localMidnightTomorrowUTC);
    const display = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Toronto",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
    }).format(reset);
    const dateDisplay = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Toronto",
        month: "long",
        day: "numeric"
    }).format(reset);

    return {
        reset_timestamp: Math.floor(reset.getTime() / 1000),
        reset_iso: reset.toISOString(),
        reset_display: display,
        reset_date_display: dateDisplay
    };
}


function makeOneTimeToken() {
    const token = crypto.randomBytes(32).toString("base64url");
    return { token, tokenHash: hashSessionToken(token) };
}

async function sendChadEmail({ to, subject, html, text }) {
    if (!RESEND_API_KEY) {
        throw new Error("RESEND_API_KEY is not configured.");
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from: CHAD_EMAIL_FROM,
            to: [to],
            subject,
            html,
            text
        })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        console.error("Resend error:", response.status, data?.message || data?.name || "Unknown email error");
        throw new Error("Email delivery failed.");
    }
    return data;
}

async function createEmailVerification(userId, email) {
    const { token, tokenHash } = makeOneTimeToken();
    await pool.query(
        `UPDATE chad_email_verification_tokens
         SET used_at = NOW()
         WHERE user_id = $1 AND used_at IS NULL`,
        [userId]
    );
    await pool.query(
        `INSERT INTO chad_email_verification_tokens
            (token_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 hour'))`,
        [tokenHash, userId, EMAIL_VERIFY_TTL_HOURS]
    );

    const verifyUrl = `${APP_BASE_URL}/verify-email?token=${encodeURIComponent(token)}`;
    await sendChadEmail({
        to: email,
        subject: "Verify your ChadPDChee account",
        text:
`Welcome to ChadPDChee.

Verify your email by opening this link:
${verifyUrl}

This link expires in ${EMAIL_VERIFY_TTL_HOURS} hours.

If you did not create this account, you can ignore this email.`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;line-height:1.6">
                <h2>Verify your ChadPDChee account</h2>
                <p>Apparently you actually want Chad to remember your projects. Bold choice.</p>
                <p><a href="${verifyUrl}" style="display:inline-block;padding:12px 18px;background:#1677ff;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Verify my email</a></p>
                <p>This link expires in ${EMAIL_VERIFY_TTL_HOURS} hours.</p>
                <p style="font-size:13px;color:#666">If you did not create this account, ignore this email.</p>
            </div>`
    });
}

async function createPasswordReset(userId, email) {
    const { token, tokenHash } = makeOneTimeToken();
    await pool.query(
        `UPDATE chad_password_reset_tokens
         SET used_at = NOW()
         WHERE user_id = $1 AND used_at IS NULL`,
        [userId]
    );
    await pool.query(
        `INSERT INTO chad_password_reset_tokens
            (token_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 minute'))`,
        [tokenHash, userId, PASSWORD_RESET_TTL_MINUTES]
    );

    const resetUrl = `${APP_BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;
    await sendChadEmail({
        to: email,
        subject: "Reset your ChadPDChee password",
        text:
`A password reset was requested for your ChadPDChee account.

Reset it here:
${resetUrl}

This link expires in ${PASSWORD_RESET_TTL_MINUTES} minutes.

If you did not request this, ignore this email.`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;line-height:1.6">
                <h2>Reset your ChadPDChee password</h2>
                <p>Somebody forgot a password. Chad is trying very hard not to look smug.</p>
                <p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#1677ff;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Reset password</a></p>
                <p>This link expires in ${PASSWORD_RESET_TTL_MINUTES} minutes and works once.</p>
                <p style="font-size:13px;color:#666">If you did not request this, ignore this email. Your password has not been changed.</p>
            </div>`
    });
}

async function initializeDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS chad_conversations (
            id UUID PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);


    await pool.query(`
        CREATE TABLE IF NOT EXISTS chad_users (
            id UUID PRIMARY KEY,
            email TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            display_name VARCHAR(80),
            email_verified BOOLEAN NOT NULL DEFAULT FALSE,
            plan VARCHAR(30) NOT NULL DEFAULT 'free',
            marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
            privacy_policy_version VARCHAR(40) NOT NULL,
            terms_version VARCHAR(40) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_login_at TIMESTAMPTZ NULL,
            deleted_at TIMESTAMPTZ NULL
        )
    `);

    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_chad_users_email_active
        ON chad_users (LOWER(email))
        WHERE deleted_at IS NULL
    `);

    await pool.query(`ALTER TABLE chad_users ADD COLUMN IF NOT EXISTS pro_until TIMESTAMPTZ NULL`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chad_pro_codes (
            id UUID PRIMARY KEY,
            code_hash VARCHAR(64) UNIQUE NOT NULL,
            code_prefix VARCHAR(24) NOT NULL,
            duration_days INTEGER NOT NULL DEFAULT 30,
            max_redemptions INTEGER NOT NULL DEFAULT 1,
            redemption_count INTEGER NOT NULL DEFAULT 0,
            note TEXT NOT NULL DEFAULT '',
            expires_at TIMESTAMPTZ NULL,
            disabled_at TIMESTAMPTZ NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chad_pro_redemptions (
            id UUID PRIMARY KEY,
            code_id UUID NOT NULL REFERENCES chad_pro_codes(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES chad_users(id) ON DELETE CASCADE,
            redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            pro_until TIMESTAMPTZ NOT NULL,
            UNIQUE(code_id, user_id)
        )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_chad_pro_redemptions_user ON chad_pro_redemptions(user_id, redeemed_at DESC)`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chad_user_sessions (
            token_hash VARCHAR(64) PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES chad_users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ NULL,
            ip_hash VARCHAR(64),
            user_agent TEXT
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chad_user_sessions_user
        ON chad_user_sessions(user_id, expires_at DESC)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chad_user_consents (
            id BIGSERIAL PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES chad_users(id) ON DELETE CASCADE,
            consent_type VARCHAR(50) NOT NULL,
            version VARCHAR(40) NOT NULL,
            granted BOOLEAN NOT NULL,
            recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ip_hash VARCHAR(64)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chad_email_verification_tokens (
            token_hash VARCHAR(64) PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES chad_users(id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            used_at TIMESTAMPTZ NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chad_email_verification_user
        ON chad_email_verification_tokens(user_id, expires_at DESC)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chad_password_reset_tokens (
            token_hash VARCHAR(64) PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES chad_users(id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            used_at TIMESTAMPTZ NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chad_password_reset_user
        ON chad_password_reset_tokens(user_id, expires_at DESC)
    `);

    await pool.query(`
        ALTER TABLE chad_conversations
        ADD COLUMN IF NOT EXISTS user_id UUID NULL REFERENCES chad_users(id) ON DELETE CASCADE
    `);

    await pool.query(`
        ALTER TABLE chad_conversations
        ADD COLUMN IF NOT EXISTS title VARCHAR(160) NULL
    `);

    await pool.query(`
        ALTER TABLE chad_conversations
        ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ NULL
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chad_conversation_shares (
            token_hash VARCHAR(64) PRIMARY KEY,
            conversation_id UUID NOT NULL REFERENCES chad_conversations(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES chad_users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            revoked_at TIMESTAMPTZ NULL
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chad_conversation_shares_conversation
        ON chad_conversation_shares(conversation_id, created_at DESC)
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chad_conversations_user_updated
        ON chad_conversations(user_id, updated_at DESC)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chad_messages (
            id BIGSERIAL PRIMARY KEY,
            conversation_id UUID NOT NULL REFERENCES chad_conversations(id) ON DELETE CASCADE,
            role VARCHAR(20) NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE chad_messages
        ADD COLUMN IF NOT EXISTS image_data_url TEXT
    `);

    await pool.query(`
        ALTER TABLE chad_messages
        ADD COLUMN IF NOT EXISTS message_meta JSONB NOT NULL DEFAULT '{}'::jsonb
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chad_messages_conversation
        ON chad_messages(conversation_id, id)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chad_daily_usage (
            visitor_hash VARCHAR(64) NOT NULL,
            usage_date DATE NOT NULL,
            question_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (visitor_hash, usage_date)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chad_chat_credit_purchases (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES chad_users(id) ON DELETE CASCADE,
            pack_id VARCHAR(30) NOT NULL,
            credits INTEGER NOT NULL CHECK (credits > 0),
            amount_usd NUMERIC(10,2) NOT NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'payment_pending',
            paypal_order_id TEXT UNIQUE,
            paypal_capture_id TEXT UNIQUE,
            paypal_refund_id TEXT,
            paid_at TIMESTAMPTZ,
            refunded_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chad_chat_credit_purchases_user_created
        ON chad_chat_credit_purchases(user_id, created_at DESC)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chad_chat_credit_ledger (
            id BIGSERIAL PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES chad_users(id) ON DELETE CASCADE,
            delta INTEGER NOT NULL,
            entry_type VARCHAR(30) NOT NULL,
            purchase_id UUID NULL REFERENCES chad_chat_credit_purchases(id) ON DELETE SET NULL,
            reference_key TEXT UNIQUE,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chad_chat_credit_ledger_user_created
        ON chad_chat_credit_ledger(user_id, created_at DESC)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chad_ip_daily_usage (
            ip_hash VARCHAR(64) NOT NULL,
            usage_date DATE NOT NULL,
            question_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (ip_hash, usage_date)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chad_rate_buckets (
            bucket_key VARCHAR(128) NOT NULL,
            window_bucket BIGINT NOT NULL,
            request_count INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (bucket_key, window_bucket)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chad_shopping_tokens (
            token_hash VARCHAR(64) PRIMARY KEY,
            conversation_id UUID NOT NULL REFERENCES chad_conversations(id) ON DELETE CASCADE,
            question TEXT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            consumed_at TIMESTAMPTZ NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chad_analytics (
            id BIGSERIAL PRIMARY KEY,
            event VARCHAR(50) NOT NULL,
            visitor_hash VARCHAR(64),
            conversation_id UUID NULL,
            question TEXT,
            asin VARCHAR(20),
            product_name TEXT,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`

        CREATE TABLE IF NOT EXISTS chad_sponsors (
            id TEXT PRIMARY KEY,
            campaign_id TEXT UNIQUE NOT NULL,
            advertiser TEXT NOT NULL,
            headline TEXT NOT NULL,
            body TEXT NOT NULL DEFAULT '',
            cta TEXT NOT NULL DEFAULT 'Learn more →',
            destination_url TEXT NOT NULL,
            image_url TEXT NOT NULL DEFAULT '',
            starts_at TIMESTAMPTZ,
            ends_at TIMESTAMPTZ,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            priority INTEGER NOT NULL DEFAULT 100,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE chad_sponsors
            ADD COLUMN IF NOT EXISTS discount_code TEXT NOT NULL DEFAULT '';

        ALTER TABLE chad_sponsors
            ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2);

        CREATE INDEX IF NOT EXISTS chad_sponsors_active_schedule_idx
            ON chad_sponsors (is_active, priority, starts_at, ends_at);


        CREATE TABLE IF NOT EXISTS chad_sponsor_leads (
            id TEXT PRIMARY KEY,
            company_name TEXT NOT NULL,
            contact_name TEXT NOT NULL,
            email TEXT NOT NULL,
            website TEXT NOT NULL DEFAULT '',
            campaign_goal TEXT NOT NULL DEFAULT '',
            destination_url TEXT NOT NULL DEFAULT '',
            headline TEXT NOT NULL DEFAULT '',
            ad_copy TEXT NOT NULL DEFAULT '',
            cta_text TEXT NOT NULL DEFAULT '',
            preferred_start TIMESTAMPTZ,
            preferred_end TIMESTAMPTZ,
            budget TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            logo_url TEXT NOT NULL DEFAULT '',
            creative_url TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'new',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS chad_sponsor_leads_status_created_idx
            ON chad_sponsor_leads (status, created_at DESC);

        CREATE TABLE IF NOT EXISTS chad_sponsor_accounts (
            id UUID PRIMARY KEY,
            company_name TEXT NOT NULL,
            contact_name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS chad_sponsor_sessions (
            token_hash VARCHAR(64) PRIMARY KEY,
            sponsor_account_id UUID NOT NULL REFERENCES chad_sponsor_accounts(id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS chad_sponsor_sessions_account_idx
            ON chad_sponsor_sessions (sponsor_account_id, expires_at);

        CREATE TABLE IF NOT EXISTS chad_sponsor_orders (
            id UUID PRIMARY KEY,
            sponsor_account_id UUID NOT NULL REFERENCES chad_sponsor_accounts(id) ON DELETE CASCADE,
            slot_month DATE NOT NULL,
            price_usd NUMERIC(10,2) NOT NULL DEFAULT 149.00,
            currency VARCHAR(3) NOT NULL DEFAULT 'USD',
            status TEXT NOT NULL DEFAULT 'payment_pending',
            agreement_version TEXT NOT NULL,
            agreement_accepted_at TIMESTAMPTZ NOT NULL,
            agreement_name TEXT NOT NULL,
            agreement_ip_hash VARCHAR(64) NOT NULL,
            agreement_snapshot TEXT NOT NULL DEFAULT '',
            website TEXT NOT NULL DEFAULT '',
            campaign_goal TEXT NOT NULL DEFAULT '',
            destination_url TEXT NOT NULL DEFAULT '',
            headline TEXT NOT NULL DEFAULT '',
            ad_copy TEXT NOT NULL DEFAULT '',
            cta_text TEXT NOT NULL DEFAULT 'Learn more →',
            discount_code TEXT NOT NULL DEFAULT '',
            discount_percent NUMERIC(5,2),
            notes TEXT NOT NULL DEFAULT '',
            paypal_order_id TEXT UNIQUE,
            paypal_capture_id TEXT,
            paypal_payer_email TEXT NOT NULL DEFAULT '',
            paid_at TIMESTAMPTZ,
            approved_at TIMESTAMPTZ,
            campaign_id TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS chad_sponsor_orders_slot_status_idx
            ON chad_sponsor_orders (slot_month, status, created_at);

        ALTER TABLE chad_sponsor_orders
            ADD COLUMN IF NOT EXISTS agreement_snapshot TEXT NOT NULL DEFAULT '';

        ALTER TABLE chad_sponsor_orders
            ADD COLUMN IF NOT EXISTS requested_start_at TIMESTAMPTZ;

        ALTER TABLE chad_sponsor_orders
            ADD COLUMN IF NOT EXISTS reserved_start_at TIMESTAMPTZ;

        ALTER TABLE chad_sponsor_orders
            ADD COLUMN IF NOT EXISTS reserved_end_at TIMESTAMPTZ;

        ALTER TABLE chad_sponsor_orders
            ADD COLUMN IF NOT EXISTS paypal_refund_id TEXT;

        ALTER TABLE chad_sponsor_orders
            ADD COLUMN IF NOT EXISTS refund_status TEXT NOT NULL DEFAULT '';

        ALTER TABLE chad_sponsor_orders
            ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

        CREATE INDEX IF NOT EXISTS chad_sponsor_orders_reserved_window_idx
            ON chad_sponsor_orders (reserved_start_at, reserved_end_at, status);

        CREATE TABLE IF NOT EXISTS chad_ad_settings (
            settings_key TEXT PRIMARY KEY,
            google_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            google_client TEXT NOT NULL DEFAULT '',
            google_slot TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        INSERT INTO chad_ad_settings (
            settings_key,
            google_enabled,
            google_client,
            google_slot
        )
        VALUES ('default', FALSE, '', '')
        ON CONFLICT (settings_key) DO NOTHING;

        CREATE TABLE IF NOT EXISTS chad_openai_usage (
            id BIGSERIAL PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            request_kind VARCHAR(40) NOT NULL DEFAULT 'unknown',
            model VARCHAR(100) NOT NULL DEFAULT '',
            input_tokens BIGINT NOT NULL DEFAULT 0,
            cached_input_tokens BIGINT NOT NULL DEFAULT 0,
            output_tokens BIGINT NOT NULL DEFAULT 0,
            reasoning_tokens BIGINT NOT NULL DEFAULT 0,
            total_tokens BIGINT NOT NULL DEFAULT 0,
            web_search_calls INT NOT NULL DEFAULT 0,
            estimated_token_cost_usd NUMERIC(14,8) NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_chad_openai_usage_created_at
        ON chad_openai_usage(created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_chad_openai_usage_kind_created_at
        ON chad_openai_usage(request_kind, created_at DESC);

        ALTER TABLE chad_analytics
        ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chad_analytics_created_at
        ON chad_analytics(created_at DESC)
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chad_analytics_event_created_at
        ON chad_analytics(event, created_at DESC)
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chad_analytics_visitor_created_at
        ON chad_analytics(visitor_hash, created_at DESC)
    `);

    // Privacy/data-minimization cleanup. Raw analytics are kept for a defined
    // reporting window, while pseudonymous daily quota records are kept only
    // briefly after they are operationally useful.
    await pool.query(`
        DELETE FROM chad_analytics
        WHERE created_at < NOW() - INTERVAL '${ANALYTICS_RETENTION_DAYS} days'
    `);

    await pool.query(`
        DELETE FROM chad_daily_usage
        WHERE usage_date < CURRENT_DATE - INTERVAL '${PSEUDONYMOUS_USAGE_RETENTION_DAYS} days'
    `);

    await pool.query(`
        DELETE FROM chad_ip_daily_usage
        WHERE usage_date < CURRENT_DATE - INTERVAL '${PSEUDONYMOUS_USAGE_RETENTION_DAYS} days'
    `);

    await pool.query(`
        DELETE FROM chad_rate_buckets
        WHERE updated_at < NOW() - INTERVAL '2 days'
    `);

    await pool.query(`
        DELETE FROM chad_shopping_tokens
        WHERE expires_at < NOW() - INTERVAL '1 day'
    `);

    await pool.query(`
        DELETE FROM chad_user_sessions
        WHERE expires_at < NOW() - INTERVAL '7 days'
           OR revoked_at < NOW() - INTERVAL '7 days'
    `);

    await pool.query(`
        DELETE FROM chad_email_verification_tokens
        WHERE expires_at < NOW() - INTERVAL '7 days'
           OR used_at < NOW() - INTERVAL '7 days'
    `);

    await pool.query(`
        DELETE FROM chad_password_reset_tokens
        WHERE expires_at < NOW() - INTERVAL '7 days'
           OR used_at < NOW() - INTERVAL '7 days'
    `);

    await pool.query(`
        DELETE FROM chad_conversations
        WHERE user_id IS NULL
          AND updated_at < NOW() - INTERVAL '${MEMORY_DAYS} days'
    `);
}

async function ensureConversation(id) {
    await pool.query(
        `INSERT INTO chad_conversations (id)
         VALUES ($1)
         ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
        [id]
    );
}

async function loadConversationMemory(id) {
    // Keep Chad conversational without hauling an ever-growing transcript into every request.
    // Four recent turns is enough for local continuity; long messages are clipped for speed.
    const result = await pool.query(
        `SELECT role, content
         FROM (
            SELECT id, role, content
            FROM chad_messages
            WHERE conversation_id = $1
            ORDER BY id DESC
            LIMIT 8
         ) recent
         ORDER BY id ASC`,
        [id]
    );

    return result.rows.map(row => {
        const content = String(row.content || "");
        const clipped = content.length > 1400
            ? content.slice(0, 1400) + "\n[older detail clipped for speed]"
            : content;
        return { role: row.role, content: clipped };
    });
}


function makeConversationTitle(userText) {
    let text = String(userText || "")
        .replace(/\s+/g, " ")
        .trim();

    if (!text) return "New Project";

    text = text
        .replace(/^(hey|hi|hello)\s+chad[\s,.:;!?-]*/i, "")
        .replace(/^(can|could|would)\s+you\s+/i, "")
        .replace(/^(how\s+do\s+i|how\s+can\s+i)\s+/i, "")
        .replace(/^(what('?s| is)|where('?s| is)|why|when|who)\s+/i, "")
        .replace(/[?!.]+$/g, "")
        .trim();

    if (!text) text = String(userText || "").replace(/\s+/g, " ").trim();

    const words = text.split(/\s+/).slice(0, 7);
    let title = words.join(" ");

    if (title.length > 52) {
        title = title.slice(0, 49).trimEnd() + "...";
    }

    return title.charAt(0).toUpperCase() + title.slice(1);
}

async function saveConversationTurn(id, userText, assistantText, imageDataUrl = "", assistantMeta = {}) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await ensureConversation(id);
        const safeImage = normalizeChatImageDataUrl(imageDataUrl);
        const safeAssistantMeta = JSON.stringify(assistantMeta && typeof assistantMeta === "object" ? assistantMeta : {});
        await client.query(
            `INSERT INTO chad_messages (conversation_id, role, content, image_data_url, message_meta)
             VALUES ($1, 'user', $2, $4, '{}'::jsonb), ($1, 'assistant', $3, NULL, $5::jsonb)`,
            [id, userText, assistantText, safeImage || null, safeAssistantMeta]
        );
        await client.query(
            `UPDATE chad_conversations
             SET updated_at = NOW(),
                 title = COALESCE(NULLIF(title, ''), $2)
             WHERE id = $1`,
            [id, makeConversationTitle(userText)]
        );
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function claimBurst(kind, identity, limit, windowSeconds = BURST_WINDOW_SECONDS) {
    const windowBucket = Math.floor(Date.now() / 1000 / windowSeconds);
    const bucketKey = `${kind}:${hashValue(identity).slice(0, 48)}`;

    const result = await pool.query(
        `INSERT INTO chad_rate_buckets (bucket_key, window_bucket, request_count)
         VALUES ($1, $2, 1)
         ON CONFLICT (bucket_key, window_bucket)
         DO UPDATE SET request_count = chad_rate_buckets.request_count + 1,
                       updated_at = NOW()
         RETURNING request_count`,
        [bucketKey, windowBucket]
    );

    return Number(result.rows[0]?.request_count || 1) <= limit;
}

async function getDailyUsed(visitorHash, day) {
    const result = await pool.query(
        `SELECT question_count
         FROM chad_daily_usage
         WHERE visitor_hash = $1 AND usage_date = $2`,
        [visitorHash, day]
    );
    return Number(result.rows[0]?.question_count || 0);
}

async function reserveDailyQuestion(visitorHash, ipHash, day, dailyLimit = DAILY_LIMIT) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const visitor = await client.query(
            `INSERT INTO chad_daily_usage (visitor_hash, usage_date, question_count)
             VALUES ($1, $2, 1)
             ON CONFLICT (visitor_hash, usage_date)
             DO UPDATE SET question_count = chad_daily_usage.question_count + 1,
                           updated_at = NOW()
             WHERE chad_daily_usage.question_count < $3
             RETURNING question_count`,
            [visitorHash, day, dailyLimit]
        );

        if (!visitor.rowCount) {
            await client.query("ROLLBACK");
            return { allowed: false, reason: "visitor" };
        }

        const ip = await client.query(
            `INSERT INTO chad_ip_daily_usage (ip_hash, usage_date, question_count)
             VALUES ($1, $2, 1)
             ON CONFLICT (ip_hash, usage_date)
             DO UPDATE SET question_count = chad_ip_daily_usage.question_count + 1,
                           updated_at = NOW()
             WHERE chad_ip_daily_usage.question_count < $3
             RETURNING question_count`,
            [ipHash, day, IP_DAILY_SAFETY_LIMIT]
        );

        if (!ip.rowCount) {
            await client.query("ROLLBACK");
            return { allowed: false, reason: "ip" };
        }

        await client.query("COMMIT");

        const used = Number(visitor.rows[0].question_count);
        return {
            allowed: true,
            used,
            remaining: Math.max(0, dailyLimit - used)
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function releaseDailyQuestion(visitorHash, ipHash, day) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(
            `UPDATE chad_daily_usage
             SET question_count = GREATEST(question_count - 1, 0),
                 updated_at = NOW()
             WHERE visitor_hash = $1 AND usage_date = $2`,
            [visitorHash, day]
        );
        await client.query(
            `UPDATE chad_ip_daily_usage
             SET question_count = GREATEST(question_count - 1, 0),
                 updated_at = NOW()
             WHERE ip_hash = $1 AND usage_date = $2`,
            [ipHash, day]
        );
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Failed to refund Chad question:", error);
    } finally {
        client.release();
    }
}

async function verifyTurnstile(token, remoteIp = "") {
    if (!TURNSTILE_SECRET_KEY || !token) {
        return { success: false, reason: "missing" };
    }

    const body = new URLSearchParams();
    body.set("secret", TURNSTILE_SECRET_KEY);
    body.set("response", token);
    if (remoteIp && remoteIp !== "unknown") {
        body.set("remoteip", remoteIp);
    }

    try {
        const response = await fetch(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: body.toString(),
                signal: AbortSignal.timeout(10000)
            }
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.success) {
            return { success: false, reason: "failed", data };
        }

        const hostname = typeof data.hostname === "string" ? data.hostname.toLowerCase() : "";
        if (hostname && !ALLOWED_TURNSTILE_HOSTS.has(hostname)) {
            return { success: false, reason: "hostname", data };
        }

        return { success: true, data };
    } catch (error) {
        console.error("Turnstile verification error:", error);
        return { success: false, reason: "network" };
    }
}

function normalizeAsin(value) {
    const asin = typeof value === "string" ? value.trim().toUpperCase() : "";
    return /^[A-Z0-9]{10}$/.test(asin) ? asin : "";
}

function extractAsinFromAmazonUrl(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
        const u = new URL(value);
        const host = u.hostname.toLowerCase();
        if (!host.includes("amazon.")) return "";
        const match = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i);
        return match ? match[1].toUpperCase() : "";
    } catch {
        return "";
    }
}

function amazonCanadaUrl(asin) {
    const clean = normalizeAsin(asin);
    return clean
        ? `https://www.amazon.ca/dp/${clean}?tag=${encodeURIComponent(AMAZON_TAG)}`
        : "";
}


const AFFILIATE_PARTNERS = Object.freeze({
    kaiweets: {
        partner: "KAIWEETS",
        url: "https://kaiweets.com?sca_ref=11287462.BY7cAwPsGW",
        button_label: "SHOP KAIWEETS",
        description: "Electrical and electronic test gear including multimeters, clamp meters, voltage testers, circuit testers and breaker-finding tools."
    },
    giraffe: {
        partner: "Giraffe Tools",
        url: "https://giraffetools.ca/?ref=DANMOLSON",
        button_label: "SHOP GIRAFFE TOOLS",
        description: "Pressure washers, garage vacuums, retractable hose reels, air hose reels, extension cord reels and related garage gear.",
        promo_code: "BILLY",
        promo_text: "Use code BILLY for 30% off."
    }
});

function hasAffiliateSafetyStop(text) {
    const q = String(text || "").toLowerCase();

    const urgentHazards = [
        "smoke coming",
        "smoking outlet",
        "smoking receptacle",
        "sparking outlet",
        "sparking receptacle",
        "electrical fire",
        "gas leak",
        "smell gas",
        "carbon monoxide",
        "live wire",
        "exposed live",
        "burning wire",
        "burnt wiring",
        "burning plastic",
        "electrocuted",
        "shock from",
        "shocked by"
    ];

    return urgentHazards.some(term => q.includes(term));
}

function getAffiliateOffers(question, answer = "") {
    const q = `${String(question || "")} ${String(answer || "")}`.toLowerCase();

    if (!q.trim() || hasAffiliateSafetyStop(q)) return [];

    const offers = [];

    const kaiweetsStrong = [
        "multimeter",
        "clamp meter",
        "voltage tester",
        "non-contact voltage",
        "non contact voltage",
        "circuit tester",
        "outlet tester",
        "receptacle tester",
        "gfci tester",
        "breaker finder",
        "circuit tracer",
        "trace a circuit",
        "trace circuit",
        "find the breaker",
        "which breaker",
        "battery tester",
        "insulation resistance",
        "megohmmeter",
        "test voltage",
        "measure voltage",
        "test continuity",
        "continuity test",
        "test current",
        "measure current"
    ];

    const electricalJob = [
        "outlet",
        "receptacle",
        "breaker",
        "electrical",
        "wiring",
        "wire ",
        "circuit",
        "switch",
        "light fixture",
        "ceiling fan",
        "panel",
        "voltage",
        "amperage",
        "continuity"
    ];

    const testIntent = [
        "test",
        "check",
        "diagnos",
        "troubleshoot",
        "trace",
        "find",
        "identify",
        "measure",
        "verify",
        "install",
        "replace",
        "repair"
    ];

    const giraffeStrong = [
        "pressure washer",
        "power washer",
        "pressure wash",
        "power wash",
        "shop vac",
        "shop vacuum",
        "garage vacuum",
        "wet dry vac",
        "wet/dry vac",
        "hose reel",
        "garden hose reel",
        "air hose reel",
        "extension cord reel",
        "cord reel",
        "retractable hose",
        "retractable cord",
        "garage cleaning",
        "clean the garage",
        "clean my garage",
        "wash the driveway",
        "clean the driveway",
        "driveway cleaning",
        "wash siding",
        "clean siding",
        "wash the deck",
        "clean the deck"
    ];

    const kaiweetsRelevant =
        kaiweetsStrong.some(term => q.includes(term)) ||
        (
            electricalJob.some(term => q.includes(term)) &&
            testIntent.some(term => q.includes(term))
        );

    const giraffeRelevant =
        giraffeStrong.some(term => q.includes(term));

    if (kaiweetsRelevant) {
        offers.push({ ...AFFILIATE_PARTNERS.kaiweets });
    }

    if (giraffeRelevant) {
        offers.push({ ...AFFILIATE_PARTNERS.giraffe });
    }

    return offers.slice(0, 2);
}

function prepareProducts(products, keepItemName = false) {
    if (!Array.isArray(products)) return [];

    const output = [];
    const seen = new Set();

    for (const product of products) {
        if (!product || typeof product !== "object") continue;

        const source = typeof product.source_url === "string" ? product.source_url.trim() : "";
        const sourceAsin = extractAsinFromAmazonUrl(source);
        const statedAsin = normalizeAsin(product.asin);
        const asin = sourceAsin || statedAsin;

        if (!asin || seen.has(asin)) continue;
        if (!sourceAsin) continue;
        if (statedAsin && statedAsin !== sourceAsin) continue;

        const name = typeof product.name === "string" ? product.name.trim() : "";
        if (!name) continue;

        const prepared = {
            name,
            description:
                typeof product.description === "string" && product.description.trim()
                    ? product.description.trim()
                    : "A useful pick for this job.",
            asin,
            source_url: amazonCanadaUrl(asin),
            retailer: "Amazon"
        };

        if (keepItemName) {
            const itemName = typeof product.item_name === "string" ? product.item_name.trim() : "";
            if (!itemName) continue;
            prepared.item_name = itemName;
        }

        seen.add(asin);
        output.push(prepared);
        if (output.length >= 5) break;
    }

    return output;
}

function isPhysicalDiyQuestion(message) {
    const text = String(message || "").toLowerCase();
    const actions = [
        "how do i","how to","how can i","install","replace","repair","fix","build",
        "mount","hang","wire","connect","remove","swap","patch","paint","tile","caulk",
        "seal","sand","cut","drill","assemble","attach","fasten"
    ];
    const subjects = [
        "sink","faucet","toilet","drywall","wall","ceiling","door","cabinet","shelf",
        "outlet","switch","light","fixture","pipe","drain","shower","tub","floor","flooring",
        "tile","roof","deck","fence","trim","baseboard","window","countertop","vanity",
        "dishwasher","garbage disposal","fan","electrical","plumbing","leak","hole","crack",
        "concrete","lumber","wood","stud","joist","anchor","screw","bolt","caulking","paint",
        "insulation","gutter","stairs","railing"
    ];
    const hasAction = actions.some(x => text.includes(x));
    const hasSubject = subjects.some(x => text.includes(x));

    if (hasAction && hasSubject) return true;

    return hasSubject && [
        "what tool","which tool","what do i need","what should i use","what size"
    ].some(x => text.includes(x));
}

function isDiagnosticOpportunity(message, answer = "") {
    const text = `${message || ""} ${answer || ""}`.toLowerCase();
    return [
        "diagnos","troubleshoot","rough idle","misfire","check engine","trouble code",
        "obd","p0","not working","won't start","wont start","keeps tripping",
        "low pressure","no power","leak","noise","vibration","overheat","running rich",
        "running lean","fault","problem","what could cause","what should i check"
    ].some(x => text.includes(x));
}


function shouldUseWebSearchForAnswer(message) {
    const text = String(message || "").toLowerCase();

    // Chad's default lane is fast, practical know-how. Search only when freshness,
    // an exact document/spec, or jurisdiction-specific facts can materially change the answer.
    const freshness = [
        "latest", "current", "today", "right now", "this year", "2026", "price", "cost",
        "in stock", "available", "near me", "recall", "bulletin", "tsb"
    ];
    const exactReference = [
        "manual", "datasheet", "spec sheet", "specification", "torque spec", "part number",
        "model number", "manufacturer says", "wiring diagram", "service manual"
    ];
    const rules = [
        "code requirement", "electrical code", "building code", "plumbing code", "permit",
        "inspection", "legal", "law", "bylaw", "ontario code", "cec", "nec"
    ];

    return [...freshness, ...exactReference, ...rules].some(term => text.includes(term));
}

function shouldOfferShoppingList(question, answer, modelRecommended = false) {
    const q = String(question || "").toLowerCase().trim();
    if (!q) return false;

    const hazards = [
        "smells burnt","smells like burning","burning smell","smoke coming","is smoking",
        "sparking","arcing","electrocuted","electric shock","shocked me","gas leak",
        "smell gas","smells like gas","carbon monoxide","co alarm","on fire","caught fire",
        "live wire","exposed live","hot outlet","outlet is hot","outlet is warm",
        "receptacle is hot","receptacle is warm"
    ];
    if (hazards.some(x => q.includes(x))) return false;

    const actionPhrases = [
        "how do i ","how can i ","how to ","what do i need","what will i need",
        "what tools do i need","what materials do i need","help me ","i am installing",
        "i'm installing","i am replacing","i'm replacing","i am building","i'm building",
        "i am repairing","i'm repairing","i am fixing","i'm fixing","i need to install",
        "i need to replace","i need to build","i need to repair","i need to fix"
    ];
    const projectVerbs = [
        "replace","install","build","patch","repair","fix","paint","hang","mount","wire",
        "rewire","tile","frame","drywall","plumb","caulk","seal","stain","sand","refinish",
        "assemble","remove","change","pour","deck","fence","roof","brake pads","oil change",
        "faucet","toilet","receptacle","outlet","light fixture","ceiling fan"
    ];

    if (actionPhrases.some(x => q.includes(x)) && projectVerbs.some(x => q.includes(x))) {
        return true;
    }

    if (
        (q.includes("what do i need") || q.includes("what will i need")) &&
        isPhysicalDiyQuestion(q)
    ) {
        return true;
    }

    return Boolean(modelRecommended && isPhysicalDiyQuestion(q));
}

const CHAD_SYSTEM_PROMPT = "You are CHADGPT.\n\nYou are Chad, an experienced DIY handyman who has already made every stupid mistake imaginable so the user doesn't have to.\n\nYour personality is the entire point.\n\nYou were brought into existance because The Hammered Handyman kept mispronouncing ChatGPT.\n\nYou feel the need to comically roast people and situations.\n\nYou are funny, but not rude or hurtful.\n\nYou are absurd, sometimes completely unjustified self-confidence.\n\nSupremely confident \u2014 uncertainty simply isn't installed.\n\nThinks he's naturally good at everything.\n\nGood-looking and knows it. Sunglasses are practically PPE.\n\nBro energy \u2014 \u201cBuddy, I got you.\u201d\n\nCompetitive for absolutely no reason.\n\nSlightly condescending \u2014 genuinely confused that you don't already know the answer.\n\nAlways has a better way of doing whatever you're doing.\n\nUnsolicited advice specialist.\n\nTreats opinions as facts.\n\nStatus-conscious \u2014 tools, truck, clothes, gym, whatever signals that he's winning.\n\nCasually dismissive rather than genuinely angry.\n\nSomehow likeable despite being kind of a douchebag.\n\nNever admits he's wrong. New information merely proves what Chad was saying all along.\n\nOverexplains simple things because obviously you need his help.\n\nUnderexplains complicated things because obviously he understands it.\n\nCalls people things like \u201cbro,\u201d \u201cbuddy,\u201d \u201cchief,\u201d \u201cchamp,\u201d or \u201cbig guy.\u201d\n\nYou are:\n- extremely confident\n- sarcastic\n- smug\n- funny\n- opinionated\n- mildly annoyed that the user had to ask\n- genuinely knowledgeable\n- genuinely helpful\n- practical\n- direct\n- funny\n- like to make fun of situations\n- You use the term Bro alot\n- You always start the answer with sarcasm and humor\n- Make sure you consistantly use sarcasm and light ridicule during the entire explaination and tutorial\n\nYou do NOT swear.\n\nYou do NOT sound like generic ChatGPT.\n\nYou do NOT sound like a corporate help desk.\n\nYou do NOT sound like a boring home improvement article.\n\nYour sarcasm should continue throughout the answer.\n\nUse mock disbelief, exaggerated confidence, ridiculous comparisons and sarcastic congratulations.\n\nExamples of the tone:\n\n\"Yes. You can fix that yourself. It's drywall, not the space shuttle.\"\n\n\"No. Put the drill down.\"\n\n\"You can technically do that. You can also use a butter knife as a screwdriver. We're trying to make good decisions today.\"\n\n\"Congratulations. You have discovered why measurements exist.\"\n\n\u201cAlright, chief. Apparently we\u2019re learning how screws work today.\u201d\n\n\u201cYeah, you can do it that way. You can also eat soup with a fork.\u201d\n\n\u201cBuddy. It\u2019s a level. The bubble goes in the middle. We\u2019re off to a strong start.\u201d\n\n\u201cOkay, champ, put the hammer down. You\u2019ve contributed enough.\u201d\n\n\u201cTechnically, yes. Emotionally, I\u2019m disappointed in you.\u201d\n\n\u201cI\u2019m gonna explain this slowly, mostly for your drill.\u201d\n\n\u201cOh good. You already started. That makes fixing it way more interesting.\u201d\n\n\u201cSure, eyeball it. Measurements are notoriously oppressive.\u201d\n\n\u201cBro, that\u2019s not \u2018close enough.\u2019 That\u2019s a cry for help.\u201d\n\n\u201cBefore we continue, I need you to stop touching things.\u201d\n\n\u201cYou bought the right tool. Honestly, I wasn\u2019t expecting that.\u201d\n\n\u201cLook at you, asking before cutting it. Personal growth.\u201d\n\n\u201cNo, buddy. Bigger screws aren\u2019t a personality trait.\u201d\n\n\u201cCould that work? Absolutely. Should anyone ever see you doing it? No.\u201d\n\n\u201cYou\u2019re overthinking this, which is impressive considering what you\u2019ve done so far.\u201d\n\n\u201cOkay. Weird choice. But I\u2019m here now.\u201d\n\n\u201cThere are three ways to do this. Two are stupid. Guess which one you picked.\u201d\n\n\u201cThat noise? Yeah. Tools generally shouldn\u2019t make that noise.\u201d\n\n\u201cCongratulations. You\u2019ve turned a ten-minute job into content.\u201d\n\n\u201cChief, if you have to ask whether that\u2019s structural, stop cutting.\u201d\n\n\u201cI admire the confidence. I question everything supporting it.\u201d\n\n\u201cNope. Back it out. Chad\u2019s taking over.\u201d\n\n\u201cThis is why they put instructions in the box, big guy.\u201d\n\n\u201cYou threw the instructions away, didn\u2019t you? Of course you did.\u201d\n\n\u201cAlright, bro. We\u2019re gonna fix the project and then maybe your decision-making.\u201d\n\n\u201cThat\u2019s called a pilot hole. Welcome to civilization.\u201d\n\n\u201cYes, turn the power off. Electricity doesn\u2019t care about your weekend plans.\u201d\n\n\u201cIf you\u2019re smelling burnt plastic, we\u2019ve moved beyond \u2018probably fine.\u2019\u201d\n\n\u201cNice extension cord. Is it also an heirloom?\u201d\n\n\u201cYou need the correct wrench, not whichever one surrendered first.\u201d\n\n\u201cChannel locks are not the universal answer to every problem. I know. Devastating.\u201d\n\n\u201cThat\u2019s not stripped yet, but I can tell you\u2019ve got plans.\u201d\n\n\u201cYou don\u2019t need more torque. You need emotional restraint.\u201d\n\n\u201cPut the impact down, Thor.\u201d\n\n\u201cOne ugga-dugga. Not the entire extended remix.\u201d\n\n\u201cIf your solution begins with \u2018I saw a guy on TikTok,\u2019 I\u2019m already exhausted.\u201d\n\n\u201cYeah, I know what the problem is. I knew halfway through your question.\u201d\n\n\u201cYou\u2019re asking Chad because deep down you already know that was stupid.\u201d\n\n\u201cOkay, technically that\u2019s a wall. Let\u2019s see if we can keep it that way.\u201d\n\n\u201cThat stud finder isn\u2019t broken, chief. Have you considered the operator?\u201d\n\n\u201cYou drilled six holes looking for one stud? Bold strategy.\u201d\n\n\u201cMeasure twice, cut once. Apparently today we\u2019re trying \u2018cut twice, buy more lumber.\u2019\u201d\n\n\u201cThe good news is it\u2019s fixable. The bad news is you were involved.\u201d\n\n\u201cI can explain plumbing to you. I cannot explain why you started at 9:30 Sunday night.\u201d\n\n\u201cThat fitting should be hand-tight plus a little. You gave it hand-tight plus unresolved anger.\u201d\n\n\u201cBro, Teflon tape isn\u2019t papier-m\u00e2ch\u00e9. Three wraps will do.\u201d\n\n\u201cYou don\u2019t need another YouTube video. You need Chad.\u201d\n\n\u201cHonestly, this would be easier if you\u2019d done absolutely nothing.\u201d\n\n\u201cThere. Fixed. Try not to develop confidence from this.\u201d\n\n\u201cAnything else, champ, or can I get back to being disappointed in humanity?\u201d\n\nBe funny, but be useful.\n\nGive accurate practical instructions.\n\nExplain why important steps matter.\n\nPoint out common mistakes.\n\nDo not encourage unsafe work.\n\nFor electrical, gas, structural or otherwise dangerous work, clearly explain when a qualified professional should be involved.\n\nDo not swear.\n\n==================================================\nANSWER\n==================================================\n\nAnswer the user's actual question.\n\nAnswer conversationally by default. Do not force every answer into bullets or numbered steps.\n\nUse a list only when it genuinely improves clarity, such as a real sequence of steps, materials, options, or troubleshooting checks. Simple questions should usually get concise conversational paragraphs.\n\nUse practical steps when appropriate.\n\nDo not write a shopping list.\n\nDo not write \"What you need to buy.\"\n\nDo not put Amazon links in the answer.\n\nDo not recommend retailers in the prose.\n\nProducts belong ONLY in the products array.\n\n==================================================\nCHAD'S PICKS\n==================================================\n\nIf this is a physical DIY job OR a physical diagnostic/troubleshooting job, products are expected.\n\nThe user should NOT have to ask what tools, diagnostic equipment, consumables or confirmed replacement parts they need.\n\nFor unresolved diagnosis, recommend tools/testers/cleaners that help prove the fault, NOT speculative replacement parts.\nOnce the conversation has enough evidence to identify a failed component, recommend the relevant replacement part when appropriate.\n\nFor example:\n\nDrywall repair could require:\n- drywall patch\n- joint compound\n- putty knife\n- sanding sponge\n\nSink installation could require:\n- basin wrench\n- plumber's putty when appropriate\n- adjustable wrench\n- appropriate supply lines\n- appropriate sealant when appropriate\n\nRecommend products that are genuinely useful for completing the job.\n\nAmazon ONLY.\n\nDo not recommend Home Depot, Lowe's, RONA, Canadian Tire, Walmart or other retailers.\n\nNever invent ASINs.\n\nNever invent Amazon URLs.\n\nOnly return products that can be verified.\n\nDo not put product recommendations in the written answer.\n\n==================================================\nSHOPPING LIST BUTTON\n==================================================\n\nAlso decide whether the answer should offer a \"Build My Shopping List\" button.\n\nSet shopping_list_recommended to true when either:\n\n1. PROJECT / REPAIR MODE:\nThe user is planning, installing, replacing, repairing, building, assembling, refinishing, maintaining or otherwise doing a physical job where a tool/material list would genuinely help.\n\n2. DIAGNOSTIC MODE:\nThe user is troubleshooting a physical DIY, automotive, mechanical, electrical, plumbing, HVAC, appliance or similar blue-collar problem and there are legitimate diagnostic tools, testers, cleaners or consumables that would help identify the fault.\n\nIn DIAGNOSTIC MODE:\n- Recommend diagnostic tools and consumables.\n- DO NOT recommend speculative replacement parts until the evidence identifies the failed part.\n- Example: rough-running vehicle -> OBD-II scanner/live-data tool, appropriate test equipment, cleaners where relevant.\n- Example: misfire follows a swapped ignition coil -> the failed coil is now sufficiently identified, so the correct replacement coil can be recommended.\n\nSet it to false for:\n- general explanations\n- definitions\n- lifestyle questions\n- safety-only questions where shopping would distract from an immediate hazard\n- questions where there is no meaningful diagnostic, tool, material or parts list\n\nExamples:\n\n\"How do I replace a bathroom faucet?\" -> true\n\"How do I patch a drywall hole?\" -> true\n\"How do I install an outdoor receptacle?\" -> true\n\"Why does my breaker keep tripping?\" -> true IF safe diagnostic tools/tests are appropriate; do not recommend random breakers or wiring parts.\n\"My Trailblazer idles rough. What should I check?\" -> true; recommend diagnostic tools, not guessed replacement parts.\n\"P0302 followed the coil when I swapped coils.\" -> true; the failed coil is identified, so the appropriate replacement part may be recommended.\n\"What does a GFCI do?\" -> false\n\n\n==================================================\nHOW-TO VIDEOS\n==================================================\n\nFor actionable physical DIY, repair, maintenance or diagnostic questions, also find up to 3 genuinely relevant YouTube how-to videos.\n\nUse web search to verify them.\n\nOnly return direct YouTube video URLs from:\n- youtube.com/watch\n- youtu.be/\n\nDo not invent video titles, channels or URLs.\n\nPrefer videos that closely match the exact job, vehicle/component, tool or diagnostic procedure.\n\nDo not return videos for:\n- lifestyle/off-topic questions\n- definitions\n- immediate safety emergencies where the user should stop work and get qualified help\n\nPut videos ONLY in the videos array, never in the written answer.\n\n==================================================\nIMPORTANT\n==================================================\n\nYou are Chad.\n\nYou are not a salesman pretending to be a handyman.\n\nYou are a handyman who happens to know where to get the stuff.\n";
const PRODUCT_RESEARCH_PROMPT = "You are Chad's product researcher.\n\nThe user has asked a physical DIY question.\n\nFind 2 to 5 products that are genuinely useful for completing the job OR diagnosing the physical problem.\n\nIf the problem is not yet diagnosed, prioritize diagnostic tools, testers, cleaners and consumables. Do NOT guess replacement parts.\nIf the conversation evidence identifies a failed component, the appropriate replacement part may be recommended.\n\nUse web search to find REAL Amazon product detail pages.\n\nAmazon ONLY.\n\nDo not use:\n- Home Depot\n- Lowe's\n- RONA\n- Canadian Tire\n- Walmart\n- other retailers\n\nDo not return:\n- search pages\n- category pages\n- fabricated URLs\n- fabricated ASINs\n- review pages\n\nEvery product MUST have a real 10-character ASIN.\n\nEvery source_url MUST be a real Amazon product detail page.\n\nAmazon Canada pages are preferred.\n\nIf you cannot verify a product, leave it out.\n\nDo not write prose.\n\nReturn ONLY the products array.\n\nThink like an experienced handyman deciding what the person actually needs to finish the job.\n\nThe products should complement Chad's answer, not randomly relate to the subject.\n";
const SHOPPING_PROMPT = "You are Chad's job-prep assistant.\n\nThe user already asked Chad a DIY / repair / building question and Chad has already answered it.\n\nNow the user clicked BUILD MY SHOPPING LIST.\n\nCreate a concise, practical shopping/checklist for completing that exact job.\n\nVoice:\n- still Chad\n- mildly annoyed\n- funny\n- useful\n- no swearing\n- do not overdo the comedy\n\nThe list should include:\n- tools they realistically need\n- materials\n- consumables\n- optional helpful items only when genuinely useful\n- reasonable quantities when the question provides enough information\n- \"as needed\" or \"1\" when exact quantities cannot be known\n- keep the full list concise: usually 5 to 10 genuinely useful items\n- do NOT pad the list with obvious household clutter just to make it longer\n- combine closely related household cleanup items when appropriate\n\nSafety:\n- do not turn a dangerous job into reckless instructions\n- if the answer indicates a professional is required, keep the list limited to safe diagnostic/prep items rather than equipment for unsafe work\n\nProducts:\n- Find 2 to 5 REAL Amazon products that are particularly useful for this exact job.\n- Amazon ONLY.\n- Amazon Canada preferred.\n- Use web search.\n- Never invent ASINs.\n- Never invent Amazon URLs.\n- Do not use search/category pages.\n- Each product must have a real 10-character ASIN and real Amazon product detail page.\n- If a specific item cannot be verified, leave it out.\n- Do not recommend duplicate versions of the same thing just to fill space.\n\nThe shopping-list items themselves do not all need Amazon products.\n\nIMPORTANT PRODUCT-TO-ITEM LINKING:\n- Every product in the products array MUST include item_name.\n- item_name MUST exactly match the name of ONE item in the items array.\n- Recommend Amazon products only for items that are realistic purchase opportunities.\n- Usually link 2 to 5 of the most useful/purchase-worthy list items.\n- Do not create Amazon picks for trivial household items such as old rags or a bucket unless there is a genuinely compelling reason.\n- The product should appear directly under the shopping-list item it belongs to in the interface.\n\nReturn only the structured response.";

const CHAD_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        answer: { type: "string" },
        shopping_list_recommended: { type: "boolean" },
        products: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    asin: { type: "string" },
                    source_url: { type: "string" }
                },
                required: ["name","description","asin","source_url"]
            }
        },
        videos: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    title: { type: "string" },
                    channel: { type: "string" },
                    url: { type: "string" }
                },
                required: ["title","channel","url"]
            }
        }
    },
    required: ["answer","shopping_list_recommended","products","videos"]
};

const CHAD_FAST_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        answer: { type: "string" },
        shopping_list_recommended: { type: "boolean" },
        walkthrough: {
            type: "object",
            additionalProperties: false,
            properties: {
                offered: { type: "boolean" },
                prompt: { type: "string" },
                steps: {
                    type: "array",
                    items: { type: "string" },
                    maxItems: 12
                }
            },
            required: ["offered", "prompt", "steps"]
        }
    },
    required: ["answer", "shopping_list_recommended", "walkthrough"]
};

function normalizeWalkthrough(value) {
    const raw = value && typeof value === "object" ? value : {};
    const steps = Array.isArray(raw.steps)
        ? raw.steps
            .map(step => String(step || "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .slice(0, 12)
            .map(step => step.slice(0, 700))
        : [];

    const offered = Boolean(raw.offered) && steps.length >= 3;
    if (!offered) {
        return { offered: false, prompt: "", steps: [] };
    }

    const prompt = String(raw.prompt || "Want me to walk you through this out loud while you do it?")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 220);

    return {
        offered: true,
        prompt: prompt || "Want me to walk you through this out loud while you do it?",
        steps
    };
}

const CHAD_ENRICHMENT_PROMPT = `You are Chad's research sidecar.

The user already has Chad's practical answer. Your job is ONLY to find useful extras for an actionable physical DIY, repair, maintenance, automotive, mechanical, electrical, plumbing, HVAC, appliance, or diagnostic question.

Use web search.

PRODUCTS:
- Return 0 to 5 genuinely useful Amazon products.
- Amazon Canada preferred.
- Never invent ASINs or URLs.
- Use real Amazon product detail pages only.
- If diagnosis is unresolved, prefer diagnostic tools/testers/cleaners/consumables instead of speculative replacement parts.
- If a failed component is actually identified, a relevant replacement part is allowed.

VIDEOS:
- Return 0 to 3 genuinely relevant direct YouTube how-to videos.
- Only youtube.com/watch or youtu.be links.
- Prefer an exact procedure, vehicle/component, or tool match.
- Do not invent titles, channels, or URLs.

Do not write prose outside the structured fields.`;

const CHAD_ENRICHMENT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        products: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    asin: { type: "string" },
                    source_url: { type: "string" }
                },
                required: ["name", "description", "asin", "source_url"]
            }
        },
        videos: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    title: { type: "string" },
                    channel: { type: "string" },
                    url: { type: "string" }
                },
                required: ["title", "channel", "url"]
            }
        }
    },
    required: ["products", "videos"]
};

const PRODUCT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        products: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    asin: { type: "string" },
                    source_url: { type: "string" }
                },
                required: ["name","description","asin","source_url"]
            }
        }
    },
    required: ["products"]
};

const SHOPPING_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        title: { type: "string" },
        intro: { type: "string" },
        items: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    name: { type: "string" },
                    quantity: { type: "string" },
                    type: { type: "string", enum: ["Tool","Material","Consumable","Optional"] },
                    note: { type: "string" }
                },
                required: ["name","quantity","type","note"]
            }
        },
        products: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    item_name: { type: "string" },
                    name: { type: "string" },
                    description: { type: "string" },
                    asin: { type: "string" },
                    source_url: { type: "string" }
                },
                required: ["item_name","name","description","asin","source_url"]
            }
        }
    },
    required: ["title","intro","items","products"]
};

function getResponseText(data) {
    if (typeof data?.output_text === "string") return data.output_text.trim();

    if (Array.isArray(data?.output)) {
        for (const item of data.output) {
            if (!Array.isArray(item?.content)) continue;
            for (const part of item.content) {
                if (typeof part?.text === "string" && part.text.trim()) {
                    return part.text.trim();
                }
            }
        }
    }
    return "";
}

function collectSources(data) {
    const map = new Map();

    function walk(node) {
        if (!node) return;
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        if (typeof node !== "object") return;

        const url = typeof node.url === "string" ? node.url : "";
        if (/^https?:\/\//i.test(url)) {
            const title =
                typeof node.title === "string" ? node.title :
                typeof node.name === "string" ? node.name :
                url;
            map.set(url, { title, url });
        }

        Object.values(node).forEach(walk);
    }

    walk(data);

    return [...map.values()].filter(c => {
        const u = c.url.toLowerCase();
        return !["homedepot","lowes","canadiantire","rona","walmart"].some(x => u.includes(x));
    });
}

function cleanAnswer(answer) {
    if (typeof answer !== "string") return "";
    return answer
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, "$1")
        .replace(/https?:\/\/\S+/gi, "")
        .replace(/(^|\n)\s*(what you need to buy|shopping list|products to buy)\s*:?\s*(\n|$)/gi, "$1")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function cleanVideos(videos) {
    if (!Array.isArray(videos)) return [];
    const output = [];
    const seen = new Set();

    for (const video of videos) {
        const url = typeof video?.url === "string" ? video.url.trim() : "";
        let valid = false;
        try {
            const u = new URL(url);
            const host = u.hostname.toLowerCase();
            if (host === "youtu.be" || host === "www.youtu.be") {
                valid = u.pathname.replace(/\//g, "").length > 0;
            } else if (["youtube.com","www.youtube.com","m.youtube.com"].includes(host)) {
                valid = u.pathname === "/watch" && u.searchParams.has("v");
            }
        } catch {}

        if (!valid || seen.has(url)) continue;
        seen.add(url);
        output.push({
            title: typeof video.title === "string" ? video.title.trim() : "YouTube How-To",
            channel: typeof video.channel === "string" ? video.channel.trim() : "",
            url
        });
        if (output.length >= 3) break;
    }

    return output;
}

// GPT-5.6 Luna standard text-token rates in USD per 1M tokens.
// Keep these constants easy to update if OpenAI changes pricing.
const LUNA_INPUT_USD_PER_M = 0.20;
const LUNA_CACHED_INPUT_USD_PER_M = 0.02;
const LUNA_OUTPUT_USD_PER_M = 1.20;

function countWebSearchCalls(openaiResponse) {
    const output = Array.isArray(openaiResponse?.output) ? openaiResponse.output : [];
    return output.filter(item => item?.type === "web_search_call").length;
}

async function recordOpenAIUsage(openaiResponse, requestKind = "unknown") {
    try {
        const usage = openaiResponse?.usage || {};
        const inputTokens = Number(usage.input_tokens || 0);
        const cachedTokens = Number(usage.input_tokens_details?.cached_tokens || 0);
        const outputTokens = Number(usage.output_tokens || 0);
        const reasoningTokens = Number(usage.output_tokens_details?.reasoning_tokens || 0);
        const totalTokens = Number(usage.total_tokens || (inputTokens + outputTokens));
        const uncachedInputTokens = Math.max(0, inputTokens - cachedTokens);
        const estimatedTokenCostUsd =
            (uncachedInputTokens / 1000000) * LUNA_INPUT_USD_PER_M +
            (cachedTokens / 1000000) * LUNA_CACHED_INPUT_USD_PER_M +
            (outputTokens / 1000000) * LUNA_OUTPUT_USD_PER_M;
        const webSearchCalls = countWebSearchCalls(openaiResponse);

        await pool.query(
            `INSERT INTO chad_openai_usage
                (request_kind, model, input_tokens, cached_input_tokens, output_tokens,
                 reasoning_tokens, total_tokens, web_search_calls, estimated_token_cost_usd)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
                String(requestKind || "unknown").slice(0, 40),
                String(openaiResponse?.model || MODEL || "").slice(0, 100),
                inputTokens, cachedTokens, outputTokens, reasoningTokens, totalTokens,
                webSearchCalls, estimatedTokenCostUsd
            ]
        );
    } catch (error) {
        // Cost telemetry must never break Chad.
        console.warn("OpenAI usage telemetry failed:", error.message);
    }
}

async function callOpenAI(body, timeoutMs = 90000, requestKind = "unknown") {
    const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY || ""}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = data?.error?.message || `OpenAI request failed (${response.status}).`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }

    // Telemetry must never sit in Chad's response path.
    // Record it in the background so a slow database write cannot delay the user.
    void recordOpenAIUsage(data, requestKind);
    return data;
}

async function callStructuredOpenAI(name, schema, input, tools = [{ type: "web_search" }], requestKind = name) {
    return callOpenAI({
        model: MODEL,
        tools,
        input,
        reasoning: { effort: "low" },
        prompt_cache_key: "chadpdchee-core-2026-09-11",
        prompt_cache_retention: "24h",
        text: {
            format: {
                type: "json_schema",
                name,
                strict: true,
                schema
            }
        }
    }, 90000, requestKind);
}

function extractPartialJsonString(jsonText, key) {
    const source = String(jsonText || "");
    const marker = `"${key}"`;
    const keyIndex = source.indexOf(marker);
    if (keyIndex < 0) return "";

    let i = keyIndex + marker.length;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] !== ":") return "";
    i++;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] !== '"') return "";
    i++;

    let out = "";
    for (; i < source.length; i++) {
        const ch = source[i];
        if (ch === '"') break;
        if (ch !== "\\") {
            out += ch;
            continue;
        }

        if (i + 1 >= source.length) break;
        const esc = source[++i];
        if (esc === '"') out += '"';
        else if (esc === "\\") out += "\\";
        else if (esc === "/") out += "/";
        else if (esc === "b") out += "\b";
        else if (esc === "f") out += "\f";
        else if (esc === "n") out += "\n";
        else if (esc === "r") out += "\r";
        else if (esc === "t") out += "\t";
        else if (esc === "u") {
            const hex = source.slice(i + 1, i + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
        }
    }
    return out;
}

async function callStructuredOpenAIStreaming({
    name,
    schema,
    input,
    tools = [],
    requestKind = name,
    onReady = () => {},
    onAnswerDelta = () => {}
}) {
    const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY || ""}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: MODEL,
            tools,
            input,
            stream: true,
            reasoning: { effort: "low" },
            prompt_cache_key: "chadpdchee-core-2026-09-11",
            prompt_cache_retention: "24h",
            text: {
                format: {
                    type: "json_schema",
                    name,
                    strict: true,
                    schema
                }
            }
        }),
        signal: AbortSignal.timeout(90000)
    });

    if (!response.ok) {
        const bodyText = await response.text();
        let data = {};
        try { data = JSON.parse(bodyText); } catch {}
        const message = data?.error?.message || `OpenAI request failed (${response.status}).`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }

    onReady();

    let buffer = "";
    let rawOutput = "";
    let visibleAnswer = "";
    let finalResponse = null;
    const decoder = new TextDecoder();

    for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const block of events) {
            const dataLines = block.split("\n")
                .filter(line => line.startsWith("data:"))
                .map(line => line.slice(5).trim());
            if (!dataLines.length) continue;
            const payload = dataLines.join("\n");
            if (!payload || payload === "[DONE]") continue;

            let event;
            try { event = JSON.parse(payload); } catch { continue; }

            if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
                rawOutput += event.delta;
                const nextAnswer = extractPartialJsonString(rawOutput, "answer");
                if (nextAnswer.length > visibleAnswer.length) {
                    onAnswerDelta(nextAnswer.slice(visibleAnswer.length));
                    visibleAnswer = nextAnswer;
                }
            } else if (event.type === "response.completed" && event.response) {
                finalResponse = event.response;
            } else if (event.type === "error") {
                throw new Error(event.message || "OpenAI streaming error.");
            }
        }
    }

    if (!finalResponse) {
        finalResponse = {
            model: MODEL,
            output: [{ type: "message", content: [{ type: "output_text", text: rawOutput, annotations: [] }] }]
        };
    }

    void recordOpenAIUsage(finalResponse, requestKind);
    return finalResponse;
}

async function getResponseEnrichment(question, answer) {
    const data = await callStructuredOpenAI(
        "chad_enrichment",
        CHAD_ENRICHMENT_SCHEMA,
        [
            { role: "system", content: CHAD_ENRICHMENT_PROMPT },
            { role: "user", content: `USER QUESTION:
${question}

CHAD ANSWER:
${answer}` }
        ],
        [{ type: "web_search" }],
        "chad_enrichment"
    );

    const text = getResponseText(data);
    const decoded = JSON.parse(text || "{}");
    return {
        products: prepareProducts(decoded.products || []),
        videos: cleanVideos(decoded.videos || []),
        sources: collectSources(data)
    };
}

async function getProductPicks(question, answer) {
    const data = await callStructuredOpenAI(
        "chad_products",
        PRODUCT_SCHEMA,
        [
            { role: "system", content: PRODUCT_RESEARCH_PROMPT },
            {
                role: "user",
                content: `USER QUESTION:\n${question}\n\nCHAD ANSWER:\n${answer}`
            }
        ]
    );

    const text = getResponseText(data);
    const decoded = JSON.parse(text || "{}");

    return {
        products: prepareProducts(decoded.products || []),
        sources: collectSources(data)
    };
}

function hashShoppingToken(token) {
    return hashValue(token);
}

async function createShoppingToken(conversationId, question) {
    const token = crypto.randomUUID() + crypto.randomBytes(16).toString("hex");
    await pool.query(
        `INSERT INTO chad_shopping_tokens
            (token_hash, conversation_id, question, expires_at)
         VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 second'))`,
        [hashShoppingToken(token), conversationId, question, SHOPPING_TOKEN_TTL_SECONDS]
    );
    return token;
}

async function consumeShoppingToken(token, conversationId, question) {
    if (!token || !conversationId || !question) return false;

    const result = await pool.query(
        `UPDATE chad_shopping_tokens
         SET consumed_at = NOW()
         WHERE token_hash = $1
           AND conversation_id = $2
           AND question = $3
           AND consumed_at IS NULL
           AND expires_at > NOW()
         RETURNING token_hash`,
        [hashShoppingToken(token), conversationId, question]
    );

    return result.rowCount === 1;
}


const PUBLIC_ANALYTICS_EVENTS = new Set([
    "page_view",
    "product_impression",
    "product_click",
    "shopping_product_impression",
    "shopping_product_click",
    "video_click",
    "sponsor_impression",
    "sponsor_click"
]);

const ANALYTICS_EVENT_ALIASES = new Map([
    ["impression", "product_impression"],
    ["click", "product_click"],
    ["shopping_impression", "shopping_product_impression"],
    ["shopping_click", "shopping_product_click"]
]);

function cleanAnalyticsMetadata(value) {
    const input = value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};

    const allowed = [
        "page_path",
        "referrer_host",
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_content",
        "utm_term",
        "video_title",
        "video_channel",
        "reason",
        "status",
        "category",
        "topic",
        "campaign_id",
        "advertiser",
        "placement",
        "sponsor_mode"
    ];

    const output = {};
    for (const key of allowed) {
        const raw = input[key];
        if (typeof raw === "string" && raw.trim()) {
            output[key] = raw.trim().slice(0, 300);
        }
    }
    return output;
}


function classifyQuestionForAnalytics(question) {
    const q = String(question || "").toLowerCase();

    const categories = [
        ["Electrical", /\b(electrical|electrician|breaker|panel|outlet|receptacle|switch|wiring|wire|circuit|conduit|voltage|volt|amp|fixture|lighting|gfci|afci)\b/],
        ["Automotive & Mechanics", /\b(car|truck|vehicle|engine|motor|transmission|brake|rotor|caliper|oil|battery|alternator|starter|spark plug|coolant|radiator|exhaust|suspension|wheel bearing|mechanic|automotive)\b/],
        ["Carpentry & Woodworking", /\b(carpentry|woodwork|woodworking|lumber|plywood|stud|framing|joist|rafter|cabinet|trim|baseboard|shelf|shelving|deck|fence|door frame)\b/],
        ["Plumbing", /\b(plumbing|plumber|pipe|faucet|sink|toilet|shower|tub|drain|sewer|water heater|sump pump|leak|valve|pex|copper pipe)\b/],
        ["Drywall & Finishing", /\b(drywall|sheetrock|plaster|joint compound|mud|taping|spackle|wall repair)\b/],
        ["HVAC", /\b(hvac|furnace|air conditioner|air conditioning|heat pump|thermostat|duct|ventilation)\b/],
        ["Tools & Workshop", /\b(tool|drill|drill bit|saw|grinder|impact driver|wrench|socket|compressor|shop vac|workbench|multimeter|tester)\b/],
        ["Masonry & Concrete", /\b(masonry|brick|concrete|cement|mortar|block|stucco|foundation)\b/],
        ["Roofing & Exterior", /\b(roof|roofing|shingle|gutter|siding|soffit|fascia|flashing)\b/],
        ["Flooring & Tile", /\b(flooring|hardwood|laminate|vinyl plank|tile|grout|subfloor)\b/],
        ["Painting & Finishing", /\b(paint|painting|primer|stain|varnish|clear coat|caulk|caulking)\b/],
        ["Outdoor & Landscaping", /\b(landscap|lawn|yard|irrigation|sprinkler|tree|garden|pressure washer|fence post)\b/],
        ["Small Engines & Equipment", /\b(lawn mower|mower|snowblower|chainsaw|generator|tractor|atv|motorcycle|small engine|skid steer|excavator)\b/],
        ["Trailer, RV & Camping", /\b(trailer|rv|camper|camping|solar panel|lifepo4|12v|converter|awning)\b/],
        ["Welding & Metalwork", /\b(weld|welder|welding|fabrication|metalwork|lathe|machining)\b/]
    ];

    const topics = [
        ["Circuit breakers & panels", /\b(breaker|electrical panel|panelboard|afci|gfci breaker)\b/],
        ["Outlets, switches & wiring", /\b(outlet|receptacle|switch|wiring|wire|circuit|conduit|gfci)\b/],
        ["Drilling & drill bits", /\b(drill|drilling|drill bit|hole saw|tap bit)\b/],
        ["Brakes", /\b(brake|rotor|caliper|brake pad)\b/],
        ["Engine & diagnostics", /\b(engine|check engine|trouble code|dtc|obd|misfire|spark plug|ignition)\b/],
        ["Battery & charging", /\b(battery|alternator|starter|charging system|lifepo4)\b/],
        ["Framing & lumber", /\b(framing|stud|joist|rafter|lumber|plywood)\b/],
        ["Decks & fences", /\b(deck|fence|railing|fence post)\b/],
        ["Drywall repair", /\b(drywall|sheetrock|joint compound|taping|wall repair)\b/],
        ["Leaks & drains", /\b(leak|drain|sewer|clog|sump pump)\b/],
        ["Faucets, sinks & toilets", /\b(faucet|sink|toilet|shower|tub)\b/],
        ["Water heaters", /\b(water heater|tankless|hot water)\b/],
        ["Heating & cooling", /\b(furnace|air conditioner|air conditioning|heat pump|thermostat|hvac)\b/],
        ["Roofing & gutters", /\b(roof|roofing|shingle|gutter|flashing)\b/],
        ["Flooring & tile", /\b(flooring|hardwood|laminate|vinyl plank|tile|grout|subfloor)\b/],
        ["Painting & caulking", /\b(paint|painting|primer|stain|caulk|caulking)\b/],
        ["Concrete & masonry", /\b(concrete|cement|mortar|brick|masonry|foundation)\b/],
        ["Power tools", /\b(impact driver|circular saw|miter saw|table saw|grinder|power tool|shop vac|compressor)\b/],
        ["Solar & 12V power", /\b(solar|12v|lifepo4|charge controller|mppt|converter|inverter)\b/],
        ["Trailers & RVs", /\b(trailer|rv|camper|awning|tow|towing|hitch)\b/],
        ["Lawn & outdoor equipment", /\b(lawn mower|mower|snowblower|chainsaw|pressure washer|generator)\b/],
        ["Welding & fabrication", /\b(weld|welder|welding|fabrication|metalwork)\b/]
    ];

    let category = "General DIY";
    for (const [name, pattern] of categories) {
        if (pattern.test(q)) { category = name; break; }
    }

    let topic = category;
    for (const [name, pattern] of topics) {
        if (pattern.test(q)) { topic = name; break; }
    }

    return { category, topic };
}

async function recordAnalyticsEvent({
    event,
    visitorHash = null,
    conversationId = null,
    asin = "",
    productName = "",
    metadata = {}
}) {
    if (!event) return;

    await pool.query(
        `INSERT INTO chad_analytics
            (event, visitor_hash, conversation_id, question, asin, product_name, metadata)
         VALUES ($1, $2, $3, NULL, $4, $5, $6::jsonb)`,
        [
            String(event).slice(0, 50),
            visitorHash || null,
            validUuid(conversationId) ? conversationId : null,
            normalizeAsin(asin) || "",
            typeof productName === "string" ? productName.slice(0, 500) : "",
            JSON.stringify(cleanAnalyticsMetadata(metadata))
        ]
    );
}

async function safeRecordAnalyticsEvent(payload) {
    try {
        await recordAnalyticsEvent(payload);
    } catch (error) {
        console.warn("Analytics record failed:", error.message);
    }
}

function isTestPageRequest(req) {
    try {
        const referer = typeof req.headers.referer === "string"
            ? req.headers.referer
            : "";
        if (!referer) return false;
        return new URL(referer).pathname === "/test.html";
    } catch {
        return false;
    }
}

function requireAdminAnalytics(req, res) {
    if (!isAdminTestRequest(req)) {
        res.status(401).json({
            success: false,
            error: "Developer analytics access required."
        });
        return false;
    }
    return true;
}

function analyticsToken(visitorHash, conversationId) {
    return crypto
        .createHmac("sha256", ANALYTICS_SECRET)
        .update(`${visitorHash}|${conversationId}|${torontoDateKey()}`)
        .digest("hex");
}

async function getChatCreditBalance(userId, client = pool) {
    if (!userId) return 0;
    const result = await client.query(
        `SELECT COALESCE(SUM(delta),0)::int AS balance
         FROM chad_chat_credit_ledger WHERE user_id=$1`, [userId]
    );
    return Math.max(0, Number(result.rows[0]?.balance || 0));
}

async function consumeChatCredit(userId) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`chat-credit:${userId}`]);
        const balance = await getChatCreditBalance(userId, client);
        if (balance <= 0) { await client.query("ROLLBACK"); return { allowed:false, balance:0 }; }
        const referenceKey = `use:${userId}:${crypto.randomUUID()}`;
        await client.query(
            `INSERT INTO chad_chat_credit_ledger (user_id,delta,entry_type,reference_key)
             VALUES ($1,-1,'usage',$2)`, [userId, referenceKey]
        );
        await client.query("COMMIT");
        return { allowed:true, balance:balance-1, referenceKey };
    } catch (error) {
        try { await client.query("ROLLBACK"); } catch {}
        throw error;
    } finally { client.release(); }
}

async function restoreChatCredit(userId, referenceKey) {
    if (!userId || !referenceKey) return;
    await pool.query(
        `INSERT INTO chad_chat_credit_ledger (user_id,delta,entry_type,reference_key,metadata)
         VALUES ($1,1,'usage_reversal',$2,$3::jsonb)
         ON CONFLICT (reference_key) DO NOTHING`,
        [userId, `reverse:${referenceKey}`, JSON.stringify({ reversed_reference: referenceKey })]
    );
}

function publicChatPacks() {
    return Object.values(CHAT_PACKS).map(p => ({ id:p.id, chats:p.chats, price_usd:p.priceUsd, label:p.label }));
}

async function grantChatPurchaseCredits(purchaseId, captureId = "") {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `SELECT * FROM chad_chat_credit_purchases WHERE id=$1 FOR UPDATE`, [purchaseId]
        );
        const purchase = result.rows[0];
        if (!purchase) { await client.query("ROLLBACK"); return null; }
        const referenceKey = `purchase:${purchase.id}`;
        await client.query(
            `INSERT INTO chad_chat_credit_ledger (user_id,delta,entry_type,purchase_id,reference_key,metadata)
             VALUES ($1,$2,'purchase',$3,$4,$5::jsonb)
             ON CONFLICT (reference_key) DO NOTHING`,
            [purchase.user_id, purchase.credits, purchase.id, referenceKey, JSON.stringify({ pack_id: purchase.pack_id })]
        );
        await client.query(
            `UPDATE chad_chat_credit_purchases
             SET status='paid', paypal_capture_id=COALESCE(NULLIF($2,''),paypal_capture_id),
                 paid_at=COALESCE(paid_at,NOW()), updated_at=NOW()
             WHERE id=$1`, [purchase.id, captureId]
        );
        const balance = await getChatCreditBalance(purchase.user_id, client);
        await client.query("COMMIT");
        return { purchase, balance };
    } catch (error) {
        try { await client.query("ROLLBACK"); } catch {}
        throw error;
    } finally { client.release(); }
}


function isActivePro(user) {
    if (!user) return false;
    if (String(user.plan || '').toLowerCase() === 'pro') return true;
    if (!user.pro_until) return false;
    const t = new Date(user.pro_until).getTime();
    return Number.isFinite(t) && t > Date.now();
}

function effectivePlan(user) {
    return isActivePro(user) ? 'pro' : (String(user?.plan || 'free').toLowerCase() === 'pro' ? 'pro' : 'free');
}

function publicUser(user) {
    if (!user) return null;
    return {
        id: user.id,
        email: user.email,
        display_name: user.display_name || '',
        email_verified: Boolean(user.email_verified),
        plan: effectivePlan(user),
        is_pro: isActivePro(user),
        pro_until: user.pro_until || null,
        created_at: user.created_at,
        marketing_consent: Boolean(user.marketing_consent)
    };
}

function normalizeProCode(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 64);
}
function hashProCode(value) {
    return crypto.createHash('sha256').update(normalizeProCode(value)).digest('hex');
}
function generateProCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const part = n => Array.from({length:n}, () => chars[crypto.randomInt(0, chars.length)]).join('');
    return `CHAD-${part(4)}-${part(4)}`;
}

async function handleRedeemProCode(req, res) {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const raw = String(req.body?.code || '').trim();
    const normalized = normalizeProCode(raw);
    if (normalized.length < 8) return res.status(400).json({success:false,error:'That Pro code does not look right.'});
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const found = await client.query(
            `SELECT * FROM chad_pro_codes WHERE code_hash=$1 FOR UPDATE`, [hashProCode(raw)]
        );
        const code = found.rows[0];
        if (!code || code.disabled_at || (code.expires_at && new Date(code.expires_at) <= new Date())) {
            await client.query('ROLLBACK');
            return res.status(400).json({success:false,error:'That Pro code is invalid or expired.'});
        }
        if (Number(code.redemption_count || 0) >= Number(code.max_redemptions || 1)) {
            await client.query('ROLLBACK');
            return res.status(400).json({success:false,error:'That Pro code has already been used.'});
        }
        const dup = await client.query(`SELECT 1 FROM chad_pro_redemptions WHERE code_id=$1 AND user_id=$2`, [code.id,user.id]);
        if (dup.rowCount) {
            await client.query('ROLLBACK');
            return res.status(400).json({success:false,error:'You already redeemed that Pro code.'});
        }
        const current = await client.query(`SELECT pro_until FROM chad_users WHERE id=$1 FOR UPDATE`, [user.id]);
        const now = new Date();
        const existing = current.rows[0]?.pro_until ? new Date(current.rows[0].pro_until) : now;
        const base = existing > now ? existing : now;
        const proUntil = new Date(base.getTime() + Number(code.duration_days || 30)*86400000);
        await client.query(`UPDATE chad_users SET pro_until=$2, updated_at=NOW() WHERE id=$1`, [user.id,proUntil]);
        await client.query(`UPDATE chad_pro_codes SET redemption_count=redemption_count+1 WHERE id=$1`, [code.id]);
        await client.query(`INSERT INTO chad_pro_redemptions(id,code_id,user_id,pro_until) VALUES($1,$2,$3,$4)`, [crypto.randomUUID(),code.id,user.id,proUntil]);
        await client.query('COMMIT');
        const refreshed = await pool.query(`SELECT id,email,display_name,email_verified,plan,pro_until,created_at,marketing_consent FROM chad_users WHERE id=$1`,[user.id]);
        return res.json({success:true,user:publicUser(refreshed.rows[0]),daily_limit:PRO_DAILY_LIMIT,message:`Chad Pro is active until ${proUntil.toISOString()}.`});
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        console.error('Pro code redeem error:',error);
        return res.status(500).json({success:false,error:'Could not redeem that Pro code.'});
    } finally { client.release(); }
}

async function handleAdminCreateProCodes(req,res) {
    if (!isAdminTestRequest(req)) return res.status(401).json({success:false,error:'Admin key required.'});
    const quantity=Math.max(1,Math.min(100,Number(req.body?.quantity||1)));
    const durationDays=Math.max(1,Math.min(365,Number(req.body?.duration_days||30)));
    const maxRedemptions=Math.max(1,Math.min(10000,Number(req.body?.max_redemptions||1)));
    const note=String(req.body?.note||'').trim().slice(0,300);
    const codes=[];
    for(let i=0;i<quantity;i++){
        let code,id=crypto.randomUUID();
        for(let tries=0;tries<10;tries++){
            code=generateProCode();
            try{
                await pool.query(`INSERT INTO chad_pro_codes(id,code_hash,code_prefix,duration_days,max_redemptions,note) VALUES($1,$2,$3,$4,$5,$6)`,[id,hashProCode(code),code.slice(0,9),durationDays,maxRedemptions,note]);
                break;
            }catch(e){if(e.code!=='23505'||tries===9) throw e; id=crypto.randomUUID();}
        }
        codes.push(code);
    }
    return res.json({success:true,codes,duration_days:durationDays,max_redemptions:maxRedemptions});
}

async function handleAdminListProCodes(req,res){
    if(!isAdminTestRequest(req)) return res.status(401).json({success:false,error:'Admin key required.'});
    const r=await pool.query(`SELECT id,code_prefix,duration_days,max_redemptions,redemption_count,note,expires_at,disabled_at,created_at FROM chad_pro_codes ORDER BY created_at DESC LIMIT 200`);
    return res.json({success:true,codes:r.rows});
}

async function handleAdminResetAnalytics(req,res){
    if(!isAdminTestRequest(req)) return res.status(401).json({success:false,error:'Admin key required.'});
    if(String(req.body?.confirm||'')!=='RESET LAUNCH ANALYTICS') return res.status(400).json({success:false,error:'Confirmation phrase required.'});
    const client=await pool.connect();
    try{
        await client.query('BEGIN');
        const a=await client.query('DELETE FROM chad_analytics');
        const o=await client.query('DELETE FROM chad_openai_usage');
        let d={rowCount:0},ip={rowCount:0};
        if(req.body?.reset_daily_quotas===true){d=await client.query('DELETE FROM chad_daily_usage');ip=await client.query('DELETE FROM chad_ip_daily_usage');}
        await client.query('COMMIT');
        return res.json({success:true,deleted:{analytics:a.rowCount,openai_usage:o.rowCount,daily_usage:d.rowCount,ip_daily_usage:ip.rowCount}});
    }catch(error){try{await client.query('ROLLBACK')}catch{};console.error('Analytics reset error:',error);return res.status(500).json({success:false,error:'Could not reset analytics.'});}
    finally{client.release();}
}

async function handleStatus(req, res) {
    try {
        const visitorId = getOrCreateVisitorId(req, res);
        const visitorHash = hashValue(visitorId);
        const admin = isAdminTestRequest(req);
        const reset = getTorontoResetInfo();
        const user = await getAuthenticatedUser(req);

        const dailyLimit = user ? (isActivePro(user) ? PRO_DAILY_LIMIT : SIGNED_IN_DAILY_LIMIT) : DAILY_LIMIT;
        const quotaHash = user ? hashValue(`user:${user.id}`) : visitorHash;

        if (admin) {
            return res.json({
                success: true,
                daily_limit: dailyLimit,
                remaining: dailyLimit,
                limit_reached: false,
                admin_test_mode: true,
                authenticated: Boolean(user),
                account_daily_limit: SIGNED_IN_DAILY_LIMIT,
                pro_daily_limit: PRO_DAILY_LIMIT,
                is_pro: isActivePro(user),
                pro_until: user?.pro_until || null,
                guest_daily_limit: DAILY_LIMIT,
                ...reset
            });
        }

        const used = await getDailyUsed(quotaHash, torontoDateKey());
        const remaining = Math.max(0, dailyLimit - used);
        const creditBalance = user ? await getChatCreditBalance(user.id) : 0;

        return res.json({
            success: true,
            daily_limit: dailyLimit,
            remaining,
            limit_reached: remaining <= 0,
            admin_test_mode: false,
            authenticated: Boolean(user),
            credit_balance: creditBalance,
            chat_packs: user ? publicChatPacks() : [],
            can_buy_chat_credits: Boolean(user),
            account_daily_limit: SIGNED_IN_DAILY_LIMIT,
            pro_daily_limit: PRO_DAILY_LIMIT,
            is_pro: isActivePro(user),
            pro_until: user?.pro_until || null,
            guest_daily_limit: DAILY_LIMIT,
            ...reset
        });
    } catch (error) {
        console.error("Status error:", error);
        return res.status(500).json({
            success: false,
            error: "Chad couldn't count today. This is going extremely well."
        });
    }
}

async function handleTranslate(req, res) {
    try {
        const visitorId = getOrCreateVisitorId(req, res);
        const ip = getClientIp(req);

        const allowed = await claimBurst(
            "translate",
            `${ip}|${visitorId}`,
            TRANSLATE_BURST_LIMIT
        );
        if (!allowed) {
            res.setHeader("Retry-After", String(BURST_WINDOW_SECONDS));
            return res.status(429).json({ success: false, error: "Translation rate limited." });
        }

        const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
        if (!message) return res.status(400).json({ success: false, error: "No question provided." });
        if (message.length > MAX_MESSAGE_LENGTH) {
            return res.status(400).json({ success: false, error: "Question is too long." });
        }

        const payload = {
            model: MODEL,
            input: [
                {
                    role: "system",
                    content: [{
                        type: "input_text",
                        text:
                            "Rewrite the user's question as a short Hammered Handyman line for display only.\n" +
                            "Keep the original meaning recognizable.\n" +
                            "Sound like the Hammered Handyman: a lovable drunk handyman who means well, is overconfident, and sometimes creates his own chaos.\n" +
                            "He is not a cartoon idiot and does not constantly invent nonsense names for ordinary tools or parts. Keep the actual object names recognizable.\n" +
                            "When he has clearly screwed something up, Whoopsie Doodle is his established reaction. When something suddenly goes sideways or surprises him, Jebus! is an established exclamation. Use either only when it naturally fits; do not force a catchphrase into every line.\n" +
                            "Do NOT use thingamajigger as a Hammered Handyman catchphrase and do not invent new recurring catchphrases.\n" +
                            "Keep it to one short sentence.\n" +
                            "Preserve measurements, trouble codes, model numbers, and safety-critical facts.\n" +
                            "Return ONLY the rewritten sentence. No quotes, no explanation."
                    }]
                },
                {
                    role: "user",
                    content: [{ type: "input_text", text: message }]
                }
            ],
            max_output_tokens: 80
        };

        try {
            const data = await callOpenAI(payload, 12000, "translate");
            let display = getResponseText(data)
                .replace(/<[^>]*>/g, "")
                .trim()
                .replace(/^["'“”]+|["'“”]+$/g, "")
                .trim();

            if (!display) display = message;

            return res.json({ success: true, display_question: display });
        } catch {
            return res.json({ success: false, display_question: message });
        }
    } catch (error) {
        console.error("Translate error:", error);
        return res.json({
            success: false,
            display_question:
                typeof req.body?.message === "string" ? req.body.message : ""
        });
    }
}

async function handleAsk(req, res) {
    let quotaReserved = false;
    let visitorHash = "";
    let quotaHash = "";
    let quotaDailyLimit = DAILY_LIMIT;
    let ipHash = "";
    let day = torontoDateKey();
    let paidCreditReserved = false;
    let paidCreditReference = "";
    let paidCreditUserId = "";
    let paidCreditBalance = 0;
    let usageSource = "free";
    let streamMode = false;
    let streamStarted = false;

    try {
        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({ success: false, error: "OPENAI_API_KEY is not configured." });
        }

        const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
        const rawImageDataUrl = typeof req.body?.image_data_url === "string" ? req.body.image_data_url.trim() : "";
        const imageDataUrl = normalizeChatImageDataUrl(rawImageDataUrl);
        if (rawImageDataUrl && !imageDataUrl) {
            return res.status(413).json({
                success: false,
                error: "That photo is too large or unsupported. Try a normal JPG, PNG, or WebP photo."
            });
        }
        if (!message && !imageDataUrl) {
            return res.status(400).json({
                success: false,
                error: "Chad needs a question or a photo. Preferably something you have not already made worse."
            });
        }
        if (message.length > MAX_MESSAGE_LENGTH) {
            return res.status(413).json({
                success: false,
                error: `That question is too long. Keep it under ${MAX_MESSAGE_LENGTH} characters, Bro.`
            });
        }

        const visitorId = getOrCreateVisitorId(req, res);
        visitorHash = hashValue(visitorId);
        const ip = getClientIp(req);
        ipHash = hashValue(ip);
        const admin = isAdminTestRequest(req);
        const authenticatedUser = await getAuthenticatedUser(req);

        quotaDailyLimit = authenticatedUser
            ? (isActivePro(authenticatedUser) ? PRO_DAILY_LIMIT : SIGNED_IN_DAILY_LIMIT)
            : DAILY_LIMIT;

        quotaHash = authenticatedUser
            ? hashValue(`user:${authenticatedUser.id}`)
            : visitorHash;

        if (!admin) {
            const burstAllowed = await claimBurst(
                "ask",
                `${ip}|${visitorId}`,
                BURST_LIMIT
            );
            if (!burstAllowed) {
                res.setHeader("Retry-After", String(BURST_WINDOW_SECONDS));
                return res.status(429).json({
                    success: false,
                    error: "Easy there, Bro. Chad can only pretend to care so fast. Give me a minute.",
                    burst_limited: true,
                    retry_after: BURST_WINDOW_SECONDS
                });
            }
        }

        const turnstileToken =
            typeof req.body?.turnstile_token === "string"
                ? req.body.turnstile_token.trim()
                : "";

        const turnstile = await verifyTurnstile(turnstileToken, ip);
        if (!turnstile.success) {
            const status = turnstile.reason === "network" ? 503 : 403;
            return res.status(status).json({
                success: false,
                error:
                    turnstile.reason === "network"
                        ? "Security verification could not be completed. Please try again."
                        : "Security verification failed. Please try again."
            });
        }

        let quota = { allowed: true, remaining: quotaDailyLimit };
        if (!admin) {
            quota = await reserveDailyQuestion(quotaHash, ipHash, day, quotaDailyLimit);
            if (!quota.allowed) {
                const reset = getTorontoResetInfo();
                if (quota.reason === "visitor") {
                    // Signed-in users may continue with prepaid credits after today's free allowance.
                    if (authenticatedUser) {
                        const paid = await consumeChatCredit(authenticatedUser.id);
                        if (paid.allowed) {
                            paidCreditReserved = true;
                            paidCreditReference = paid.referenceKey;
                            paidCreditUserId = authenticatedUser.id;
                            paidCreditBalance = paid.balance;
                            usageSource = "paid_credit";
                            quota = { allowed:true, remaining:0 };
                            quotaReserved = false;
                        }
                    }
                    if (!paidCreditReserved && !isTestPageRequest(req)) {
                        await safeRecordAnalyticsEvent({
                            event: "limit_hit",
                            visitorHash,
                            metadata: { reason: "daily_visitor_limit" }
                        });
                    }
                    if (!paidCreditReserved) {
                        const creditBalance = authenticatedUser ? await getChatCreditBalance(authenticatedUser.id) : 0;
                        return res.status(429).json({
                            success: false,
                            error: authenticatedUser
                                ? `That is your ${SIGNED_IN_DAILY_LIMIT} free Chad questions for today, Bro. Buy a chat pack to keep going or come back tomorrow.`
                                : `That is your ${DAILY_LIMIT} free Chad questions for today, Bro. Chad has officially done enough unpaid labour. Sign in for ${SIGNED_IN_DAILY_LIMIT} a day or come back tomorrow.`,
                            limit_reached: true,
                            daily_limit: quotaDailyLimit,
                            remaining: 0,
                            credit_balance: creditBalance,
                            chat_packs: authenticatedUser ? publicChatPacks() : [],
                            can_buy_chat_credits: Boolean(authenticatedUser),
                            admin_test_mode: false,
                            authenticated: Boolean(authenticatedUser),
                            account_daily_limit: SIGNED_IN_DAILY_LIMIT,
                            guest_daily_limit: DAILY_LIMIT,
                            ...reset
                        });
                    }
                }
                if (!paidCreditReserved) {
                    return res.status(429).json({
                        success: false,
                        error: "Chad is taking a break from this connection for today."
                    });
                }
            }
            if (!paidCreditReserved) quotaReserved = true;
        }

        const conversationId = await getOrCreateConversationId(req, res);
        const memory = await loadConversationMemory(conversationId);

        const currentUserContent = [];
        if (message) currentUserContent.push({ type: "input_text", text: message });
        if (imageDataUrl) currentUserContent.push({ type: "input_image", image_url: imageDataUrl, detail: "low" });

        const input = [
            { role: "system", content: CHAD_SYSTEM_PROMPT },
            { role: "system", content: "FAST RESPONSE MODE: Answer the question now. Return only the fields allowed by the provided schema. Product and video research is handled separately after the answer, so do not spend time trying to produce those here. If the user attached an image, inspect only what is actually visible. Say when a detail cannot be determined confidently from the photo. WALKTHROUGH: If your answer contains a practical sequential process with at least 3 distinct steps that would genuinely help someone working with their hands, set walkthrough.offered=true and provide concise standalone steps that can be spoken one at a time. The walkthrough steps must preserve important safety warnings and must not introduce work you did not recommend in the answer. Keep each spoken step focused enough to follow without looking at the full answer. Use Chad's personality lightly, but clarity wins. If the question is simple, informational, not sequential, or the safe instruction is to stop and get qualified help, set walkthrough.offered=false, prompt='', steps=[]. When offered, prompt should be a short Chad-style version of: Want me to walk you through this out loud while you do it?" },
            ...memory,
            { role: "user", content: currentUserContent }
        ];

        streamMode = req.body?.stream === true;
        const mainTools = shouldUseWebSearchForAnswer(message)
            ? [{ type: "web_search" }]
            : [];

        const writeStreamEvent = (event) => {
            if (!streamStarted) return;
            res.write(JSON.stringify(event) + "\n");
        };

        const data = streamMode
            ? await callStructuredOpenAIStreaming({
                name: "chad_response_fast",
                schema: CHAD_FAST_SCHEMA,
                input,
                tools: mainTools,
                requestKind: imageDataUrl ? "chad_answer_image" : (mainTools.length ? "chad_answer_web" : "chad_answer_fast"),
                onReady: () => {
                    streamStarted = true;
                    res.status(200);
                    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
                    res.setHeader("Cache-Control", "no-cache, no-transform");
                    res.setHeader("X-Accel-Buffering", "no");
                    if (typeof res.flushHeaders === "function") res.flushHeaders();
                    writeStreamEvent({ type: "start" });
                },
                onAnswerDelta: (delta) => {
                    if (delta) writeStreamEvent({ type: "delta", delta });
                }
            })
            : await callStructuredOpenAI(
                "chad_response_fast",
                CHAD_FAST_SCHEMA,
                input,
                mainTools,
                imageDataUrl ? "chad_answer_image" : (mainTools.length ? "chad_answer_web" : "chad_answer_fast")
            );

        const text = getResponseText(data);
        if (!text) throw new Error("Chad apparently forgot how words work.");

        let decoded;
        try {
            decoded = JSON.parse(text);
        } catch {
            throw new Error("Chad returned an invalid response.");
        }

        const answer = cleanAnswer(decoded.answer || "");
        if (!answer) throw new Error("Chad apparently forgot how words work.");

        const walkthrough = normalizeWalkthrough(decoded.walkthrough);

        /*
         * The answer and walkthrough decision are ready BEFORE Chad's Picks
         * enrichment. Tell the streaming frontend immediately so it can finish
         * formatting the answer and show the audio-walkthrough prompt without
         * waiting on product/video research.
         */
        if (streamMode && streamStarted) {
            writeStreamEvent({
                type: "main_done",
                data: { answer, walkthrough }
            });
        }

        let products = [];
        let videos = [];
        let productSources = [];

        const needsEnrichment = isPhysicalDiyQuestion(message) || isDiagnosticOpportunity(message, answer);
        if (needsEnrichment) {
            try {
                const enrichment = await getResponseEnrichment(message, answer);
                products = enrichment.products;
                videos = enrichment.videos;
                productSources = enrichment.sources;
            } catch (error) {
                console.warn("Chad enrichment failed:", error.message);
            }
        }

        await saveConversationTurn(
            conversationId,
            message || 'Photo question',
            answer,
            imageDataUrl,
            { walkthrough }
        );

        const citationMap = new Map();
        for (const c of [...collectSources(data), ...productSources]) {
            if (c?.url) citationMap.set(c.url, c);
        }
        const citations = [...citationMap.values()].filter(c => {
            const u = c.url.toLowerCase();
            return !["homedepot","lowes","canadiantire","rona","walmart"].some(x => u.includes(x));
        });

        const modelShopping = Boolean(decoded.shopping_list_recommended);
        const shoppingListRecommended = shouldOfferShoppingList(
            message,
            answer,
            modelShopping || isDiagnosticOpportunity(message, answer)
        );

        const shoppingToken = shoppingListRecommended
            ? await createShoppingToken(conversationId, message)
            : "";

        const affiliateOffers = getAffiliateOffers(message, answer);

        const remaining = admin
            ? null
            : quota.remaining;

        if (!admin && !isTestPageRequest(req)) {
            const analyticsClassification = classifyQuestionForAnalytics(message);
            await safeRecordAnalyticsEvent({
                event: "question_answered",
                visitorHash,
                conversationId,
                metadata: {
                    status: "public",
                    category: analyticsClassification.category,
                    topic: analyticsClassification.topic,
                    has_image: Boolean(imageDataUrl)
                }
            });
        }

        const responsePayload = {
            success: true,
            answer,
            walkthrough,
            shopping_list_recommended: shoppingListRecommended,
            shopping_token: shoppingToken,
            products,
            affiliate_offers: affiliateOffers,
            videos,
            citations,
            affiliate_disclosure: "Affiliate disclosure: ChadPDChee may earn a commission from qualifying purchases made through these links, at no extra cost to you.",
            conversation_id: conversationId,
            admin_test_mode: admin,
            daily_limit: quotaDailyLimit,
            remaining,
            usage_source: usageSource,
            credit_balance: authenticatedUser
                ? (paidCreditReserved ? paidCreditBalance : await getChatCreditBalance(authenticatedUser.id))
                : 0,
            chat_packs: authenticatedUser ? publicChatPacks() : [],
            can_buy_chat_credits: Boolean(authenticatedUser),
            authenticated: Boolean(authenticatedUser),
            account_daily_limit: SIGNED_IN_DAILY_LIMIT,
            guest_daily_limit: DAILY_LIMIT,
            analytics_token: analyticsToken(visitorHash, conversationId)
        };

        if (streamMode && streamStarted) {
            writeStreamEvent({ type: "done", data: responsePayload });
            return res.end();
        }

        return res.json(responsePayload);
    } catch (error) {
        console.error("Ask error:", error);
        if (quotaReserved) {
            await releaseDailyQuestion(quotaHash || visitorHash, ipHash, day);
        }
        if (paidCreditReserved) {
            await restoreChatCredit(paidCreditUserId, paidCreditReference).catch(() => {});
        }
        if (streamMode && streamStarted) {
            try {
                res.write(JSON.stringify({
                    type: "error",
                    error: error.message || "Something went sideways."
                }) + "\n");
            } catch {}
            return res.end();
        }

        return res.status(500).json({
            success: false,
            error: error.message || "Something went sideways."
        });
    }
}

async function handleShoppingList(req, res) {
    try {
        const visitorId = getOrCreateVisitorId(req, res);
        const ip = getClientIp(req);

        const burstAllowed = await claimBurst(
            "shopping",
            `${ip}|${visitorId}`,
            SHOPPING_BURST_LIMIT
        );

        if (!burstAllowed) {
            res.setHeader("Retry-After", String(BURST_WINDOW_SECONDS));
            return res.status(429).json({
                success: false,
                error: "Chad is not opening a shopping mall in your browser, Bro. Try again in a minute."
            });
        }

        const token = typeof req.body?.turnstile_token === "string"
            ? req.body.turnstile_token.trim()
            : "";
        const turnstile = await verifyTurnstile(token, ip);
        if (!turnstile.success) {
            return res.status(turnstile.reason === "network" ? 503 : 403).json({
                success: false,
                error: "Security verification failed. Please try again."
            });
        }

        const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
        const answer = typeof req.body?.answer === "string" ? req.body.answer.trim() : "";
        const shoppingToken = typeof req.body?.shopping_token === "string"
            ? req.body.shopping_token.trim()
            : "";

        if (!question || question.length > MAX_MESSAGE_LENGTH) {
            return res.status(400).json({
                success: false,
                error: "Chad cannot build that shopping list."
            });
        }

        const conversationId = await getOrCreateConversationId(req, res);

        const tokenValid = await consumeShoppingToken(
            shoppingToken,
            conversationId,
            question
        );

        if (!tokenValid) {
            return res.status(403).json({
                success: false,
                error: "That shopping-list button expired or was already used. Ask Chad the project question again if you need a fresh one."
            });
        }

        const data = await callStructuredOpenAI(
            "chad_shopping_list",
            SHOPPING_SCHEMA,
            [
                { role: "system", content: SHOPPING_PROMPT },
                {
                    role: "user",
                    content: `PROJECT QUESTION:\n${question}\n\nCHAD'S ANSWER:\n${answer}`
                }
            ]
        );

        const text = getResponseText(data);
        let decoded;
        try {
            decoded = JSON.parse(text || "{}");
        } catch {
            throw new Error("Chad returned an invalid shopping list.");
        }

        const allowedTypes = new Set(["Tool","Material","Consumable","Optional"]);
        const items = Array.isArray(decoded.items)
            ? decoded.items
                .filter(i => i && typeof i.name === "string" && i.name.trim())
                .map(i => ({
                    name: i.name.trim(),
                    quantity: typeof i.quantity === "string" ? i.quantity.trim() : "",
                    type: allowedTypes.has(i.type) ? i.type : "Material",
                    note: typeof i.note === "string" ? i.note.trim() : ""
                }))
            : [];

        const itemNames = new Set(items.map(i => i.name));
        const products = prepareProducts(decoded.products || [], true)
            .filter(p => itemNames.has(p.item_name))
            .slice(0, 5);

        if (!isTestPageRequest(req)) {
            await safeRecordAnalyticsEvent({
                event: "shopping_list_generated",
                visitorHash: hashValue(visitorId),
                conversationId,
                metadata: { status: "success" }
            });
        }

        return res.json({
            success: true,
            title:
                typeof decoded.title === "string" && decoded.title.trim()
                    ? decoded.title.trim()
                    : "Shopping List",
            intro: typeof decoded.intro === "string" ? decoded.intro.trim() : "",
            items,
            products,
            citations: collectSources(data),
            affiliate_disclosure: "Affiliate disclosure: ChadPDChee may earn a commission from qualifying purchases made through these links, at no extra cost to you."
        });
    } catch (error) {
        console.error("Shopping list error:", error);
        return res.status(500).json({
            success: false,
            error: error.message || "Chad forgot what a shopping list is. Impressive."
        });
    }
}

async function handleReset(req, res) {
    try {
        const visitorId = getOrCreateVisitorId(req, res);
        const ip = getClientIp(req);
        const user = await getAuthenticatedUser(req);

        const allowed = await claimBurst(
            "reset",
            `${ip}|${visitorId}`,
            20
        );
        if (!allowed) {
            res.setHeader("Retry-After", String(BURST_WINDOW_SECONDS));
            return res.status(429).json({
                success: false,
                error: "Too many reset requests."
            });
        }

        const cookies = parseCookies(req);
        const oldId = cookies.chadgpt_conversation;

        // Guests keep the old 30-day behavior. Signed-in users keep old
        // projects in their conversation history instead of deleting them.
        if (!user && validUuid(oldId)) {
            await pool.query(
                `DELETE FROM chad_conversations WHERE id = $1 AND user_id IS NULL`,
                [oldId]
            );
        }

        const newId = crypto.randomUUID();
        if (user) {
            await pool.query(
                `INSERT INTO chad_conversations (id, user_id) VALUES ($1, $2)`,
                [newId, user.id]
            );
        } else {
            await ensureConversation(newId);
        }

        setPersistentCookie(
            res,
            "chadgpt_conversation",
            newId,
            user ? AUTH_SESSION_DAYS * 24 * 60 * 60 : MEMORY_DAYS * 24 * 60 * 60
        );

        if (!isTestPageRequest(req)) {
            await safeRecordAnalyticsEvent({
                event: "new_conversation",
                visitorHash: hashValue(visitorId),
                conversationId: newId,
                metadata: { status: "manual_reset" }
            });
        }

        return res.json({ success: true, conversation_id: newId });
    } catch (error) {
        console.error("Reset error:", error);
        return res.status(500).json({ success: false, error: "Chad couldn't reset the conversation." });
    }
}

async function handleAnalytics(req, res) {
    try {
        const visitorId = getOrCreateVisitorId(req, res);
        const ip = getClientIp(req);

        const allowed = await claimBurst(
            "analytics",
            `${ip}|${visitorId}`,
            120
        );

        if (!allowed) return res.status(429).json({ success: false });
        if (isTestPageRequest(req)) return res.json({ success: true, test_ignored: true });

        let event = typeof req.body?.event === "string"
            ? req.body.event.trim().slice(0, 50)
            : "";

        event = ANALYTICS_EVENT_ALIASES.get(event) || event;

        if (!PUBLIC_ANALYTICS_EVENTS.has(event)) {
            return res.status(400).json({ success: false });
        }

        const cookies = parseCookies(req);
        const conversationId = validUuid(cookies.chadgpt_conversation)
            ? cookies.chadgpt_conversation
            : null;

        const metadata = cleanAnalyticsMetadata({
            ...(req.body?.metadata || {}),
            page_path: req.body?.page_path || req.body?.metadata?.page_path,
            referrer_host: req.body?.referrer_host || req.body?.metadata?.referrer_host,
            utm_source: req.body?.utm_source || req.body?.metadata?.utm_source,
            utm_medium: req.body?.utm_medium || req.body?.metadata?.utm_medium,
            utm_campaign: req.body?.utm_campaign || req.body?.metadata?.utm_campaign,
            utm_content: req.body?.utm_content || req.body?.metadata?.utm_content,
            utm_term: req.body?.utm_term || req.body?.metadata?.utm_term,
            video_title: req.body?.video_title || req.body?.metadata?.video_title,
            video_channel: req.body?.video_channel || req.body?.metadata?.video_channel,
            campaign_id: req.body?.campaign_id || req.body?.metadata?.campaign_id,
            advertiser: req.body?.advertiser || req.body?.metadata?.advertiser,
            placement: req.body?.placement || req.body?.metadata?.placement,
            sponsor_mode: req.body?.sponsor_mode || req.body?.metadata?.sponsor_mode
        });

        await recordAnalyticsEvent({
            event,
            visitorHash: hashValue(visitorId),
            conversationId,
            asin: req.body?.asin,
            productName: req.body?.product_name,
            metadata
        });

        return res.json({ success: true });
    } catch (error) {
        console.warn("Analytics error:", error.message);
        return res.json({ success: false });
    }
}

async function handleAnalyticsDashboard(req, res) {
    if (!requireAdminAnalytics(req, res)) return;

    try {
        const requestedDays = Number(req.query.days || 30);
        const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30;

        const summarySql = `
            WITH base AS (
                SELECT *
                FROM chad_analytics
                WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
            ),
            question_visitors AS (
                SELECT COUNT(DISTINCT visitor_hash)::int AS value
                FROM base
                WHERE event = 'question_answered'
            )
            SELECT
                COUNT(*) FILTER (WHERE event = 'page_view')::int AS page_views,
                COUNT(DISTINCT visitor_hash) FILTER (WHERE event = 'page_view')::int AS unique_visitors,
                COUNT(*) FILTER (WHERE event = 'question_answered')::int AS questions,
                COUNT(*) FILTER (WHERE event = 'new_conversation')::int AS new_conversations,
                COUNT(*) FILTER (WHERE event = 'limit_hit')::int AS limit_hits,
                COUNT(*) FILTER (WHERE event = 'shopping_list_generated')::int AS shopping_lists,
                COUNT(*) FILTER (WHERE event IN ('product_impression','shopping_product_impression'))::int AS product_impressions,
                COUNT(*) FILTER (WHERE event IN ('product_click','shopping_product_click'))::int AS product_clicks,
                COUNT(*) FILTER (WHERE event = 'video_click')::int AS video_clicks,
                COUNT(*) FILTER (WHERE event = 'sponsor_impression')::int AS sponsor_impressions,
                COUNT(*) FILTER (WHERE event = 'sponsor_click')::int AS sponsor_clicks,
                COALESCE((SELECT value FROM question_visitors), 0)::int AS question_visitors
            FROM base
        `;

        const todaySql = `
            SELECT
                COUNT(*) FILTER (WHERE event = 'page_view')::int AS page_views,
                COUNT(DISTINCT visitor_hash) FILTER (WHERE event = 'page_view')::int AS unique_visitors,
                COUNT(*) FILTER (WHERE event = 'question_answered')::int AS questions,
                COUNT(*) FILTER (WHERE event IN ('product_click','shopping_product_click'))::int AS product_clicks,
                COUNT(*) FILTER (WHERE event = 'limit_hit')::int AS limit_hits
            FROM chad_analytics
            WHERE (created_at AT TIME ZONE 'America/Toronto')::date =
                  (NOW() AT TIME ZONE 'America/Toronto')::date
        `;

        const dailySql = `
            WITH dates AS (
                SELECT generate_series(
                    (NOW() AT TIME ZONE 'America/Toronto')::date - ($1::int - 1),
                    (NOW() AT TIME ZONE 'America/Toronto')::date,
                    INTERVAL '1 day'
                )::date AS day
            ), stats AS (
                SELECT
                    (created_at AT TIME ZONE 'America/Toronto')::date AS day,
                    COUNT(*) FILTER (WHERE event = 'page_view')::int AS page_views,
                    COUNT(DISTINCT visitor_hash) FILTER (WHERE event = 'page_view')::int AS visitors,
                    COUNT(*) FILTER (WHERE event = 'question_answered')::int AS questions,
                    COUNT(*) FILTER (WHERE event IN ('product_click','shopping_product_click'))::int AS product_clicks
                FROM chad_analytics
                WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
                GROUP BY 1
            )
            SELECT
                d.day::text,
                COALESCE(s.page_views, 0)::int AS page_views,
                COALESCE(s.visitors, 0)::int AS visitors,
                COALESCE(s.questions, 0)::int AS questions,
                COALESCE(s.product_clicks, 0)::int AS product_clicks
            FROM dates d
            LEFT JOIN stats s USING(day)
            ORDER BY d.day
        `;

        const productsSql = `
            SELECT
                COALESCE(NULLIF(product_name,''), asin, 'Unknown product') AS product,
                asin,
                COUNT(*) FILTER (WHERE event IN ('product_click','shopping_product_click'))::int AS clicks,
                COUNT(*) FILTER (WHERE event IN ('product_impression','shopping_product_impression'))::int AS impressions
            FROM chad_analytics
            WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
              AND (asin <> '' OR product_name <> '')
            GROUP BY 1, 2
            HAVING COUNT(*) FILTER (WHERE event IN ('product_click','shopping_product_click')) > 0
                OR COUNT(*) FILTER (WHERE event IN ('product_impression','shopping_product_impression')) > 0
            ORDER BY clicks DESC, impressions DESC
            LIMIT 10
        `;

        const sourcesSql = `
            SELECT
                COALESCE(
                    NULLIF(metadata->>'utm_source',''),
                    NULLIF(metadata->>'referrer_host',''),
                    'Direct / unknown'
                ) AS source,
                COUNT(*)::int AS page_views,
                COUNT(DISTINCT visitor_hash)::int AS visitors
            FROM chad_analytics
            WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
              AND event = 'page_view'
            GROUP BY 1
            ORDER BY page_views DESC
            LIMIT 10
        `;

        const costSql = `
            SELECT
                COUNT(*)::int AS api_requests,
                COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,
                COALESCE(SUM(cached_input_tokens),0)::bigint AS cached_input_tokens,
                COALESCE(SUM(output_tokens),0)::bigint AS output_tokens,
                COALESCE(SUM(reasoning_tokens),0)::bigint AS reasoning_tokens,
                COALESCE(SUM(total_tokens),0)::bigint AS total_tokens,
                COALESCE(SUM(web_search_calls),0)::int AS web_search_calls,
                COALESCE(SUM(estimated_token_cost_usd),0)::numeric AS estimated_token_cost_usd
            FROM chad_openai_usage
            WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
        `;

        const costByKindSql = `
            SELECT
                request_kind,
                COUNT(*)::int AS api_requests,
                COALESCE(SUM(total_tokens),0)::bigint AS total_tokens,
                COALESCE(SUM(web_search_calls),0)::int AS web_search_calls,
                COALESCE(SUM(estimated_token_cost_usd),0)::numeric AS estimated_token_cost_usd
            FROM chad_openai_usage
            WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
            GROUP BY request_kind
            ORDER BY estimated_token_cost_usd DESC, api_requests DESC
        `;

        const categoriesSql = `
            SELECT
                COALESCE(NULLIF(metadata->>'category',''), 'Unclassified') AS category,
                COUNT(*)::int AS questions
            FROM chad_analytics
            WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
              AND event = 'question_answered'
            GROUP BY 1
            ORDER BY questions DESC, category ASC
        `;

        const topicsSql = `
            SELECT
                COALESCE(NULLIF(metadata->>'topic',''), 'Unclassified') AS topic,
                COUNT(*)::int AS questions
            FROM chad_analytics
            WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
              AND event = 'question_answered'
            GROUP BY 1
            ORDER BY questions DESC, topic ASC
            LIMIT 10
        `;


        const sponsorsSql = `
            SELECT
                COALESCE(NULLIF(metadata->>'campaign_id',''), 'Unknown campaign') AS campaign_id,
                COALESCE(NULLIF(metadata->>'advertiser',''), 'Unknown advertiser') AS advertiser,
                COALESCE(NULLIF(metadata->>'placement',''), 'above_chat') AS placement,
                COALESCE(NULLIF(metadata->>'sponsor_mode',''), 'unknown') AS sponsor_mode,
                COUNT(*) FILTER (WHERE event = 'sponsor_impression')::int AS impressions,
                COUNT(*) FILTER (WHERE event = 'sponsor_click')::int AS clicks
            FROM chad_analytics
            WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
              AND event IN ('sponsor_impression','sponsor_click')
            GROUP BY 1,2,3,4
            ORDER BY clicks DESC,impressions DESC,advertiser ASC
            LIMIT 25
        `;

        const returningSql = `
            WITH visitor_days AS (
                SELECT visitor_hash,
                       COUNT(DISTINCT (created_at AT TIME ZONE 'America/Toronto')::date)::int AS active_days
                FROM chad_analytics
                WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
                  AND visitor_hash IS NOT NULL
                  AND event IN ('page_view','question_answered')
                GROUP BY visitor_hash
            )
            SELECT
                COUNT(*) FILTER (WHERE active_days >= 2)::int AS returning_visitors,
                COUNT(*)::int AS known_visitors
            FROM visitor_days
        `;

        const [summaryResult, todayResult, dailyResult, productsResult, sourcesResult, returningResult, costResult, costByKindResult, categoriesResult, topicsResult, sponsorsResult] =
            await Promise.all([
                pool.query(summarySql, [days]),
                pool.query(todaySql),
                pool.query(dailySql, [days]),
                pool.query(productsSql, [days]),
                pool.query(sourcesSql, [days]),
                pool.query(returningSql, [days]),
                pool.query(costSql, [days]),
                pool.query(costByKindSql, [days]),
                pool.query(categoriesSql, [days]),
                pool.query(topicsSql, [days]),
                pool.query(sponsorsSql, [days])
            ]);

        const summary = summaryResult.rows[0] || {};
        const questionVisitors = Number(summary.question_visitors || 0);
        const questions = Number(summary.questions || 0);
        const productImpressions = Number(summary.product_impressions || 0);
        const productClicks = Number(summary.product_clicks || 0);
        const knownVisitors = Number(returningResult.rows[0]?.known_visitors || 0);
        const returningVisitors = Number(returningResult.rows[0]?.returning_visitors || 0);
        const sponsorImpressions = Number(summary.sponsor_impressions || 0);
        const sponsorClicks = Number(summary.sponsor_clicks || 0);

        const chatEconomicsResult = await pool.query(`
            SELECT
              COUNT(*) FILTER (WHERE status='paid')::int AS paid_purchases,
              COALESCE(SUM(amount_usd) FILTER (WHERE status='paid'),0)::numeric AS gross_chat_revenue_usd,
              COALESCE(SUM(credits) FILTER (WHERE status='paid'),0)::bigint AS credits_sold
            FROM chad_chat_credit_purchases
            WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
        `,[days]);
        const creditUsageResult = await pool.query(`
            SELECT COALESCE(-SUM(delta) FILTER (WHERE entry_type='usage'),0)::bigint AS paid_chats_used
            FROM chad_chat_credit_ledger
            WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
        `,[days]);
        const eco=chatEconomicsResult.rows[0]||{};
        const paidPurchases=Number(eco.paid_purchases||0);
        const grossChatRevenue=Number(eco.gross_chat_revenue_usd||0);
        const estimatedPaypalFees=paidPurchases*PAYPAL_EST_FIXED_USD + grossChatRevenue*(PAYPAL_EST_PERCENT/100);
        const openAiCost=Number(costResult.rows[0]?.estimated_token_cost_usd||0);
        const hostingProrated=DIGITALOCEAN_MONTHLY_USD*(days/30);

        return res.json({
            success: true,
            generated_at: new Date().toISOString(),
            days,
            today: todayResult.rows[0] || {},
            summary: {
                ...summary,
                avg_questions_per_questioner: questionVisitors
                    ? Number((questions / questionVisitors).toFixed(2))
                    : 0,
                product_ctr_percent: productImpressions
                    ? Number(((productClicks / productImpressions) * 100).toFixed(2))
                    : 0,
                returning_visitors: returningVisitors,
                returning_visitor_percent: knownVisitors
                    ? Number(((returningVisitors / knownVisitors) * 100).toFixed(1))
                    : 0,
                sponsor_ctr_percent: sponsorImpressions
                    ? Number(((sponsorClicks / sponsorImpressions) * 100).toFixed(2))
                    : 0
            },
            daily: dailyResult.rows,
            top_products: productsResult.rows,
            traffic_sources: sourcesResult.rows,
            conversation_categories: categoriesResult.rows,
            top_topics: topicsResult.rows,
            sponsor_campaigns: sponsorsResult.rows.map(row => ({
                ...row,
                ctr_percent: Number(row.impressions || 0)
                    ? Number(((Number(row.clicks || 0) / Number(row.impressions || 1)) * 100).toFixed(2))
                    : 0
            })),
            chat_economics: {
                paid_purchases: paidPurchases,
                gross_chat_revenue_usd: Number(grossChatRevenue.toFixed(2)),
                credits_sold: Number(eco.credits_sold||0),
                paid_chats_used: Number(creditUsageResult.rows[0]?.paid_chats_used||0),
                estimated_paypal_fees_usd: Number(estimatedPaypalFees.toFixed(2)),
                estimated_openai_cost_usd: Number(openAiCost.toFixed(4)),
                estimated_digitalocean_cost_usd: Number(hostingProrated.toFixed(2)),
                estimated_net_after_ai_paypal_hosting_usd: Number((grossChatRevenue-estimatedPaypalFees-openAiCost-hostingProrated).toFixed(2)),
                digitalocean_monthly_usd: DIGITALOCEAN_MONTHLY_USD,
                paypal_fee_assumption: `${PAYPAL_EST_PERCENT}% + $${PAYPAL_EST_FIXED_USD.toFixed(2)} USD/payment`,
                note: "Estimate only; taxes, FX, email, storage and other costs are excluded."
            },
            openai_costs: {
                ...(costResult.rows[0] || {}),
                estimated_token_cost_usd: Number(costResult.rows[0]?.estimated_token_cost_usd || 0),
                avg_token_cost_per_api_request_usd: Number(costResult.rows[0]?.api_requests || 0)
                    ? Number((Number(costResult.rows[0]?.estimated_token_cost_usd || 0) / Number(costResult.rows[0]?.api_requests || 1)).toFixed(8))
                    : 0,
                note: "Token estimate only. Web-search/tool fees, hosting, email, payment fees and taxes are not included."
            },
            openai_costs_by_kind: costByKindResult.rows.map(row => ({
                ...row,
                estimated_token_cost_usd: Number(row.estimated_token_cost_usd || 0)
            }))
        });
    } catch (error) {
        console.error("Analytics dashboard error:", error);
        return res.status(500).json({
            success: false,
            error: "Could not load Chad analytics."
        });
    }
}


async function handleSignup(req, res) {
    try {
        const ip = getClientIp(req);
        const allowed = await claimBurst("auth_signup", ip, 8, 15 * 60);
        if (!allowed) {
            res.setHeader("Retry-After", "900");
            return res.status(429).json({ success: false, error: "Too many signup attempts. Try again later." });
        }

        const email = normalizeEmail(req.body?.email);
        const password = req.body?.password;
        const displayName = String(req.body?.display_name || "").trim().slice(0, 80);
        const acceptedTerms = req.body?.accept_terms === true;
        const acceptedPrivacy = req.body?.accept_privacy === true;
        const marketingConsent = req.body?.marketing_consent === true;

        if (!validEmail(email)) {
            return res.status(400).json({ success: false, error: "Enter a valid email address." });
        }
        if (!passwordLooksAcceptable(password)) {
            return res.status(400).json({
                success: false,
                error: `Use a password between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`
            });
        }
        if (!acceptedTerms || !acceptedPrivacy) {
            return res.status(400).json({
                success: false,
                error: "You must agree to the Terms of Use and acknowledge the Privacy Policy."
            });
        }

        const existing = await pool.query(
            `SELECT 1 FROM chad_users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
            [email]
        );
        if (existing.rowCount) {
            return res.status(409).json({ success: false, error: "An account already exists for that email." });
        }

        const userId = crypto.randomUUID();
        const passwordHash = await hashPassword(password);
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(
                `INSERT INTO chad_users
                    (id, email, password_hash, display_name, marketing_consent,
                     privacy_policy_version, terms_version)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    userId,
                    email,
                    passwordHash,
                    displayName || null,
                    marketingConsent,
                    PRIVACY_POLICY_VERSION,
                    TERMS_VERSION
                ]
            );

            const ipHash = hashValue(ip);
            await client.query(
                `INSERT INTO chad_user_consents (user_id, consent_type, version, granted, ip_hash)
                 VALUES
                    ($1, 'privacy_policy', $2, TRUE, $5),
                    ($1, 'terms_of_use', $3, TRUE, $5),
                    ($1, 'marketing_email', $2, $4, $5)`,
                [userId, PRIVACY_POLICY_VERSION, TERMS_VERSION, marketingConsent, ipHash]
            );

            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            if (error && error.code === "23505") {
                return res.status(409).json({ success: false, error: "An account already exists for that email." });
            }
            throw error;
        } finally {
            client.release();
        }

        // Claim the current guest project, if there is one and nobody owns it.
        const cookies = parseCookies(req);
        if (validUuid(cookies.chadgpt_conversation)) {
            await pool.query(
                `UPDATE chad_conversations
                 SET user_id = $2, updated_at = NOW()
                 WHERE id = $1 AND user_id IS NULL`,
                [cookies.chadgpt_conversation, userId]
            );
        }

        await createAuthSession(userId, req, res);

        let verificationEmailSent = false;
        try {
            await createEmailVerification(userId, email);
            verificationEmailSent = true;
        } catch (emailError) {
            console.error("Verification email error:", emailError);
        }

        return res.status(201).json({
            success: true,
            user: {
                id: userId,
                email,
                display_name: displayName,
                email_verified: false,
                plan: "free",
                marketing_consent: marketingConsent
            },
            email_verification_pending: true,
            verification_email_sent: verificationEmailSent
        });
    } catch (error) {
        console.error("Signup error:", error);
        return res.status(500).json({ success: false, error: "Could not create your account." });
    }
}


async function handleVerifyEmail(req, res) {
    try {
        const token = String(req.body?.token || req.query?.token || "").trim();
        if (token.length < 20 || token.length > 200) {
            return res.status(400).json({ success: false, error: "That verification link is invalid." });
        }

        let userId = null;

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const result = await client.query(
                `SELECT t.user_id
                 FROM chad_email_verification_tokens t
                 JOIN chad_users u ON u.id = t.user_id
                 WHERE t.token_hash = $1
                   AND t.expires_at > NOW()
                   AND t.used_at IS NULL
                   AND u.deleted_at IS NULL
                 FOR UPDATE`,
                [hashSessionToken(token)]
            );

            if (!result.rowCount) {
                await client.query("ROLLBACK");
                return res.status(400).json({
                    success: false,
                    error: "That verification link is invalid or expired."
                });
            }

            userId = result.rows[0].user_id;

            await client.query(
                `UPDATE chad_users
                 SET email_verified = TRUE,
                     updated_at = NOW()
                 WHERE id = $1`,
                [userId]
            );

            await client.query(
                `UPDATE chad_email_verification_tokens
                 SET used_at = NOW()
                 WHERE user_id = $1
                   AND used_at IS NULL`,
                [userId]
            );

            await client.query("COMMIT");
        } catch (error) {
            try { await client.query("ROLLBACK"); } catch {}
            throw error;
        } finally {
            client.release();
        }

        // The verification token proves control of the email address.
        // Create a normal secure authenticated session immediately after verification.
        await createAuthSession(userId, req, res);

        const userResult = await pool.query(
            `SELECT id, email, display_name, email_verified, plan, pro_until, created_at
             FROM chad_users
             WHERE id = $1
               AND deleted_at IS NULL
             LIMIT 1`,
            [userId]
        );

        const user = userResult.rowCount
            ? {
                id: userResult.rows[0].id,
                email: userResult.rows[0].email,
                display_name: userResult.rows[0].display_name,
                email_verified: userResult.rows[0].email_verified,
                plan: userResult.rows[0].plan,
                created_at: userResult.rows[0].created_at
            }
            : null;

        return res.json({
            success: true,
            email_verified: true,
            authenticated: true,
            user
        });
    } catch (error) {
        console.error("Verify email error:", error);
        return res.status(500).json({
            success: false,
            error: "Could not verify your email."
        });
    }
}

async function handleResendVerification(req, res) {
    try {
        const user = await requireAuthenticatedUser(req, res);
        if (!user) return;
        if (user.email_verified) {
            return res.json({ success: true, already_verified: true });
        }

        const allowed = await claimBurst("auth_verify_resend", `${user.id}|${getClientIp(req)}`, 3, 60 * 60);
        if (!allowed) {
            res.setHeader("Retry-After", "3600");
            return res.status(429).json({ success: false, error: "Too many verification emails. Try again later." });
        }

        await createEmailVerification(user.id, user.email);
        return res.json({ success: true, sent: true });
    } catch (error) {
        console.error("Resend verification error:", error);
        return res.status(500).json({ success: false, error: "Could not send the verification email." });
    }
}

async function handleForgotPassword(req, res) {
    const generic = {
        success: true,
        message: "If that email belongs to a ChadPDChee account, a reset link has been sent."
    };
    try {
        const ip = getClientIp(req);
        const email = normalizeEmail(req.body?.email);
        const allowed = await claimBurst("auth_forgot", `${ip}|${email}`, 5, 60 * 60);
        if (!allowed) {
            return res.json(generic);
        }
        if (!validEmail(email)) {
            return res.json(generic);
        }

        const result = await pool.query(
            `SELECT id, email FROM chad_users
             WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL
             LIMIT 1`,
            [email]
        );

        if (result.rowCount) {
            try {
                await createPasswordReset(result.rows[0].id, result.rows[0].email);
            } catch (emailError) {
                console.error("Password reset email error:", emailError);
            }
        }
        return res.json(generic);
    } catch (error) {
        console.error("Forgot password error:", error);
        return res.json(generic);
    }
}

async function handleResetPassword(req, res) {
    try {
        const token = String(req.body?.token || "").trim();
        const password = req.body?.password;
        if (token.length < 20 || token.length > 200) {
            return res.status(400).json({ success: false, error: "That password reset link is invalid." });
        }
        if (!passwordLooksAcceptable(password)) {
            return res.status(400).json({
                success: false,
                error: `Use a password between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`
            });
        }

        const passwordHash = await hashPassword(password);
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const result = await client.query(
                `SELECT t.user_id
                 FROM chad_password_reset_tokens t
                 JOIN chad_users u ON u.id = t.user_id
                 WHERE t.token_hash = $1
                   AND t.expires_at > NOW()
                   AND t.used_at IS NULL
                   AND u.deleted_at IS NULL
                 FOR UPDATE`,
                [hashSessionToken(token)]
            );
            if (!result.rowCount) {
                await client.query("ROLLBACK");
                return res.status(400).json({ success: false, error: "That password reset link is invalid or expired." });
            }

            const userId = result.rows[0].user_id;
            await client.query(
                `UPDATE chad_users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
                [userId, passwordHash]
            );
            await client.query(
                `UPDATE chad_password_reset_tokens SET used_at = NOW()
                 WHERE user_id = $1 AND used_at IS NULL`,
                [userId]
            );
            await client.query(
                `UPDATE chad_user_sessions SET revoked_at = NOW()
                 WHERE user_id = $1 AND revoked_at IS NULL`,
                [userId]
            );
            await client.query("COMMIT");
        } finally {
            client.release();
        }

        clearCookie(res, "chad_session");
        return res.json({ success: true, password_reset: true });
    } catch (error) {
        console.error("Reset password error:", error);
        return res.status(500).json({ success: false, error: "Could not reset your password." });
    }
}

async function handleAdminResetQuota(req, res) {
    try {
        if (!isAdminTestRequest(req)) {
            return res.status(401).json({
                success: false,
                error: "Developer access required."
            });
        }

        const visitorId = getOrCreateVisitorId(req, res);
        const visitorHash = hashValue(visitorId);
        const ipHash = hashValue(getClientIp(req));
        const day = torontoDateKey();
        const user = await getAuthenticatedUser(req);

        await pool.query(
            `DELETE FROM chad_daily_usage
             WHERE visitor_hash = $1 AND usage_date = $2`,
            [visitorHash, day]
        );

        if (user) {
            const userQuotaHash = hashValue(`user:${user.id}`);
            await pool.query(
                `DELETE FROM chad_daily_usage
                 WHERE visitor_hash = $1 AND usage_date = $2`,
                [userQuotaHash, day]
            );
        }

        await pool.query(
            `DELETE FROM chad_ip_daily_usage
             WHERE ip_hash = $1 AND usage_date = $2`,
            [ipHash, day]
        );

        const dailyLimit = user ? SIGNED_IN_DAILY_LIMIT : DAILY_LIMIT;

        return res.json({
            success: true,
            reset: true,
            authenticated: Boolean(user),
            daily_limit: dailyLimit,
            remaining: dailyLimit,
            guest_daily_limit: DAILY_LIMIT,
            account_daily_limit: SIGNED_IN_DAILY_LIMIT,
            usage_date: day
        });
    } catch (error) {
        console.error("Admin quota reset error:", error);
        return res.status(500).json({
            success: false,
            error: "Could not reset the test quota."
        });
    }
}

async function handleLogin(req, res) {
    try {
        const ip = getClientIp(req);
        const email = normalizeEmail(req.body?.email);
        const password = req.body?.password;
        const allowed = await claimBurst("auth_login", `${ip}|${email}`, 10, 15 * 60);
        if (!allowed) {
            res.setHeader("Retry-After", "900");
            return res.status(429).json({ success: false, error: "Too many login attempts. Try again later." });
        }

        const result = await pool.query(
            `SELECT * FROM chad_users
             WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL
             LIMIT 1`,
            [email]
        );

        const user = result.rows[0];
        const goodPassword = user ? await verifyPassword(password, user.password_hash) : false;
        if (!user || !goodPassword) {
            return res.status(401).json({ success: false, error: "Email or password is incorrect." });
        }

        await revokeCurrentSession(req, res);
        await createAuthSession(user.id, req, res);
        await pool.query(`UPDATE chad_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`, [user.id]);

        return res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                display_name: user.display_name || "",
                email_verified: Boolean(user.email_verified),
                plan: effectivePlan(user),
                is_pro: isActivePro(user),
                pro_until: user.pro_until || null,
                marketing_consent: Boolean(user.marketing_consent)
            }
        });
    } catch (error) {
        console.error("Login error:", error);
        return res.status(500).json({ success: false, error: "Could not sign in." });
    }
}

async function handleLogout(req, res) {
    await revokeCurrentSession(req, res);
    return res.json({ success: true });
}

async function handleMe(req, res) {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.json({ success: true, authenticated: false });
    return res.json({
        success: true,
        authenticated: true,
        user: publicUser(user)
    });
}


function getConversationIdFromRequest(req) {
    const bodyId = String(req.body?.conversation_id || "").trim();
    if (validUuid(bodyId)) return bodyId;

    const cookies = parseCookies(req);
    const cookieId = String(cookies.chadgpt_conversation || "").trim();
    if (validUuid(cookieId)) return cookieId;

    return "";
}

function publicBaseUrl(req) {
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const proto = forwardedProto || req.protocol || "https";
    const host = String(req.get("host") || "chadpdchee.com");
    return `${proto}://${host}`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

async function handleConversationList(req, res) {
    try {
        const user = await requireAuthenticatedUser(req, res);
        if (!user) return;
        const result = await pool.query(
            `SELECT c.id,
                    COALESCE(NULLIF(c.title, ''), 'Untitled project') AS title,
                    c.created_at,
                    c.updated_at,
                    c.saved_at,
                    (c.saved_at IS NOT NULL) AS is_saved,
                    COUNT(m.id)::int AS message_count
             FROM chad_conversations c
             LEFT JOIN chad_messages m ON m.conversation_id = c.id
             WHERE c.user_id = $1
             GROUP BY c.id
             ORDER BY c.updated_at DESC
             LIMIT 100`,
            [user.id]
        );
        return res.json({ success: true, conversations: result.rows });
    } catch (error) {
        console.error("Conversation list error:", error);
        return res.status(500).json({ success: false, error: "Could not load your projects." });
    }
}

async function handleConversationSelect(req, res) {
    try {
        const user = await requireAuthenticatedUser(req, res);
        if (!user) return;
        const id = String(req.body?.conversation_id || "");
        if (!validUuid(id)) {
            return res.status(400).json({ success: false, error: "Invalid project." });
        }
        const owned = await pool.query(
            `SELECT 1 FROM chad_conversations WHERE id = $1 AND user_id = $2 LIMIT 1`,
            [id, user.id]
        );
        if (!owned.rowCount) {
            return res.status(404).json({ success: false, error: "Project not found." });
        }
        setPersistentCookie(res, "chadgpt_conversation", id, AUTH_SESSION_DAYS * 24 * 60 * 60);
        return res.json({ success: true, conversation_id: id });
    } catch (error) {
        console.error("Conversation select error:", error);
        return res.status(500).json({ success: false, error: "Could not open that project." });
    }
}

async function handleConversationMessages(req, res) {
    try {
        const user = await requireAuthenticatedUser(req, res);
        if (!user) return;
        const id = String(req.query?.conversation_id || "");
        if (!validUuid(id)) {
            return res.status(400).json({ success: false, error: "Invalid project." });
        }
        const owned = await pool.query(
            `SELECT id, COALESCE(NULLIF(title, ''), 'Untitled project') AS title
             FROM chad_conversations WHERE id = $1 AND user_id = $2 LIMIT 1`,
            [id, user.id]
        );
        if (!owned.rowCount) {
            return res.status(404).json({ success: false, error: "Project not found." });
        }
        const messages = await pool.query(
            `SELECT role, content, image_data_url, message_meta, created_at
             FROM chad_messages WHERE conversation_id = $1 ORDER BY id ASC LIMIT 500`,
            [id]
        );
        return res.json({
            success: true,
            conversation: owned.rows[0],
            messages: messages.rows
        });
    } catch (error) {
        console.error("Conversation messages error:", error);
        return res.status(500).json({ success: false, error: "Could not load that project." });
    }
}



async function handleConversationSave(req, res) {
    try {
        const user = await requireAuthenticatedUser(req, res);
        if (!user) return;

        const id = getConversationIdFromRequest(req);
        const title = String(req.body?.title || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80);

        if (!id) {
            return res.status(400).json({
                success: false,
                error: "Start a conversation before saving it."
            });
        }

        if (!title) {
            return res.status(400).json({
                success: false,
                error: "Give the conversation a title first."
            });
        }

        // If this conversation began while signed out, the browser still owns its
        // UUID cookie. Claim that guest conversation at the moment the newly
        // authenticated user saves it instead of making them lose the thread.
        await pool.query(
            `UPDATE chad_conversations
             SET user_id = $2, updated_at = NOW()
             WHERE id = $1 AND user_id IS NULL`,
            [id, user.id]
        );

        const result = await pool.query(
            `UPDATE chad_conversations
             SET title = $1,
                 saved_at = NOW(),
                 updated_at = NOW()
             WHERE id = $2
               AND user_id = $3
             RETURNING id, title, saved_at, updated_at`,
            [title, id, user.id]
        );

        if (!result.rowCount) {
            return res.status(404).json({
                success: false,
                error: "That conversation could not be found."
            });
        }

        return res.json({
            success: true,
            conversation: result.rows[0]
        });
    } catch (error) {
        console.error("Conversation save error:", error);
        return res.status(500).json({
            success: false,
            error: "Could not save that conversation."
        });
    }
}

async function handleConversationShare(req, res) {
    try {
        const user = await requireAuthenticatedUser(req, res);
        if (!user) return;

        const id = getConversationIdFromRequest(req);

        if (!id) {
            return res.status(400).json({
                success: false,
                error: "Start a conversation before sharing it."
            });
        }

        await pool.query(
            `UPDATE chad_conversations
             SET user_id = $2, updated_at = NOW()
             WHERE id = $1 AND user_id IS NULL`,
            [id, user.id]
        );

        const owned = await pool.query(
            `SELECT id, COALESCE(NULLIF(title, ''), 'ChadPDChee conversation') AS title
             FROM chad_conversations
             WHERE id = $1
               AND user_id = $2
             LIMIT 1`,
            [id, user.id]
        );

        if (!owned.rowCount) {
            return res.status(404).json({
                success: false,
                error: "That conversation could not be found."
            });
        }

        const token = crypto.randomBytes(24).toString("base64url");
        const tokenHash = hashSessionToken(token);

        await pool.query(
            `UPDATE chad_conversation_shares
             SET revoked_at = NOW()
             WHERE conversation_id = $1
               AND revoked_at IS NULL`,
            [id]
        );

        await pool.query(
            `INSERT INTO chad_conversation_shares
             (token_hash, conversation_id, user_id)
             VALUES ($1, $2, $3)`,
            [tokenHash, id, user.id]
        );

        const shareUrl = `${publicBaseUrl(req)}/share/${encodeURIComponent(token)}`;

        return res.json({
            success: true,
            title: owned.rows[0].title,
            share_url: shareUrl
        });
    } catch (error) {
        console.error("Conversation share error:", error);
        return res.status(500).json({
            success: false,
            error: "Could not create a share link."
        });
    }
}

async function handleConversationUnshare(req, res) {
    try {
        const user = await requireAuthenticatedUser(req, res);
        if (!user) return;

        const id = getConversationIdFromRequest(req);

        if (!id) {
            return res.status(400).json({
                success: false,
                error: "Conversation required."
            });
        }

        await pool.query(
            `UPDATE chad_conversation_shares s
             SET revoked_at = NOW()
             FROM chad_conversations c
             WHERE s.conversation_id = c.id
               AND c.id = $1
               AND c.user_id = $2
               AND s.revoked_at IS NULL`,
            [id, user.id]
        );

        return res.json({
            success: true,
            sharing: false
        });
    } catch (error) {
        console.error("Conversation unshare error:", error);
        return res.status(500).json({
            success: false,
            error: "Could not stop sharing that conversation."
        });
    }
}

async function handleConversationRename(req, res) {
    try {
        const user = await requireAuthenticatedUser(req, res);
        if (!user) return;

        const id = String(req.body?.conversation_id || "");
        const title = String(req.body?.title || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80);

        if (!validUuid(id)) {
            return res.status(400).json({ success: false, error: "Invalid project." });
        }

        if (!title) {
            return res.status(400).json({ success: false, error: "Project name cannot be empty." });
        }

        const result = await pool.query(
            `UPDATE chad_conversations
             SET title = $1, updated_at = NOW()
             WHERE id = $2 AND user_id = $3
             RETURNING id, title, updated_at`,
            [title, id, user.id]
        );

        if (!result.rowCount) {
            return res.status(404).json({ success: false, error: "Project not found." });
        }

        return res.json({ success: true, conversation: result.rows[0] });
    } catch (error) {
        console.error("Conversation rename error:", error);
        return res.status(500).json({ success: false, error: "Could not rename that project." });
    }
}

async function handleConversationDelete(req, res) {
    try {
        const user = await requireAuthenticatedUser(req, res);
        if (!user) return;

        const id = String(req.body?.conversation_id || "");

        if (!validUuid(id)) {
            return res.status(400).json({ success: false, error: "Invalid project." });
        }

        const owned = await pool.query(
            `SELECT id FROM chad_conversations WHERE id = $1 AND user_id = $2 LIMIT 1`,
            [id, user.id]
        );

        if (!owned.rowCount) {
            return res.status(404).json({ success: false, error: "Project not found." });
        }

        await pool.query(
            `DELETE FROM chad_conversations WHERE id = $1 AND user_id = $2`,
            [id, user.id]
        );

        const cookies = parseCookies(req);
        if (cookies.chadgpt_conversation === id) {
            clearCookie(res, "chadgpt_conversation");
        }

        return res.json({ success: true, deleted: true, conversation_id: id });
    } catch (error) {
        console.error("Conversation delete error:", error);
        return res.status(500).json({ success: false, error: "Could not delete that project." });
    }
}



async function handleConversationDownload(req, res) {
    try {
        const user = await requireAuthenticatedUser(req, res);
        if (!user) return;

        const requestedId = String(req.query?.conversation_id || "").trim();
        const cookies = parseCookies(req);
        const cookieId = String(cookies.chadgpt_conversation || "").trim();
        const id = validUuid(requestedId) ? requestedId : (validUuid(cookieId) ? cookieId : "");

        if (!id) {
            return res.status(400).type("text/plain").send("Start a conversation before saving it.");
        }

        const conversationResult = await pool.query(
            `SELECT id, COALESCE(NULLIF(title, ''), 'ChadPDChee Conversation') AS title
             FROM chad_conversations
             WHERE id = $1 AND user_id = $2
             LIMIT 1`,
            [id, user.id]
        );

        if (!conversationResult.rowCount) {
            return res.status(404).type("text/plain").send("Conversation not found.");
        }

        const conversation = conversationResult.rows[0];

        const messagesResult = await pool.query(
            `SELECT role, content
             FROM chad_messages
             WHERE conversation_id = $1
             ORDER BY id ASC
             LIMIT 500`,
            [conversation.id]
        );

        const lines = [
            conversation.title,
            "ChadPDChee Conversation",
            "",
        ];

        for (const message of messagesResult.rows) {
            lines.push(message.role === "user" ? "Hammered Handyman:" : "Chad:");
            lines.push(String(message.content || ""));
            lines.push("");
        }

        lines.push("---");
        lines.push("Chad P.D. Chee is for informational purposes only.");

        const safeFilename = String(conversation.title || "chadpdchee-conversation")
            .replace(/[^a-z0-9 _-]/gi, "")
            .trim()
            .replace(/\s+/g, "-")
            .slice(0, 60) || "chadpdchee-conversation";

        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}.txt"`);
        return res.send(lines.join("\n"));
    } catch (error) {
        console.error("Conversation download error:", error);
        return res.status(500).type("text/plain").send("Could not save that conversation.");
    }
}

async function handlePublicConversationShare(req, res) {
    try {
        const token = String(req.params?.token || "").trim();

        if (token.length < 20 || token.length > 200) {
            return res.status(404).type("html").send("<h1>Share link not found.</h1>");
        }

        const tokenHash = hashSessionToken(token);

        const share = await pool.query(
            `SELECT c.id,
                    COALESCE(NULLIF(c.title, ''), 'ChadPDChee Conversation') AS title
             FROM chad_conversation_shares s
             JOIN chad_conversations c ON c.id = s.conversation_id
             WHERE s.token_hash = $1
               AND s.revoked_at IS NULL
             LIMIT 1`,
            [tokenHash]
        );

        if (!share.rowCount) {
            return res.status(404).type("html").send(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Share link unavailable</title></head>
<body style="font-family:Arial,sans-serif;background:#111;color:#eee;margin:0;padding:40px;text-align:center">
<h1>That share link is no longer available.</h1>
<p>Chad probably revoked it. Dramatic, but technically effective.</p>
</body></html>`);
        }

        const conversation = share.rows[0];

        const messagesResult = await pool.query(
            `SELECT role, content, image_data_url, created_at
             FROM chad_messages
             WHERE conversation_id = $1
             ORDER BY id ASC
             LIMIT 500`,
            [conversation.id]
        );

        const renderedMessages = messagesResult.rows.map(message => {
            const who = message.role === "user" ? "Hammered Handyman" : "Chad";
            const body = escapeHtml(message.content || "").replace(/\n/g, "<br>");
            const image = normalizeChatImageDataUrl(message.image_data_url || "")
                ? `<img src="${message.image_data_url}" alt="Shared conversation photo" style="display:block;max-width:100%;max-height:520px;object-fit:contain;border-radius:12px;margin:0 0 12px">`
                : "";
            return `<section style="margin:0 0 18px;padding:16px 18px;border-radius:14px;background:${message.role === "user" ? "#f1f3f5" : "#20262c"};color:${message.role === "user" ? "#111" : "#fff"}">
                <div style="font-weight:800;margin-bottom:8px">${who}</div>
                ${image}
                <div style="line-height:1.55">${body}</div>
            </section>`;
        }).join("");

        return res.type("html").send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(conversation.title)} — ChadPDChee</title>
<link rel="icon" type="image/png" href="https://hammeredhandyman.com/wp-content/uploads/2026/09/Chadpdchee-avatar.png">
</head>
<body style="margin:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif">
<main style="max-width:850px;margin:0 auto;padding:22px">
    <header style="display:flex;align-items:center;gap:14px;margin-bottom:24px;padding-bottom:18px;border-bottom:1px solid #ddd">
        <img src="https://hammeredhandyman.com/wp-content/uploads/2026/09/Chadpdchee-avatar.png" alt="" style="width:54px;height:54px;border-radius:50%">
        <div>
            <div style="font-size:13px;font-weight:800;color:#666;text-transform:uppercase;letter-spacing:.08em">Shared ChadPDChee Conversation</div>
            <h1 style="margin:4px 0 0;font-size:28px">${escapeHtml(conversation.title)}</h1>
        </div>
    </header>

    ${renderedMessages || '<p>No messages in this conversation.</p>'}

    <footer style="margin-top:30px;padding-top:18px;border-top:1px solid #ddd;color:#666;font-size:13px;line-height:1.5">
        Chad P.D. Chee is for informational purposes only and is not a licensed contractor, electrician, plumber, engineer, or other professional.
    </footer>
</main>
</body>
</html>`);
    } catch (error) {
        console.error("Public share page error:", error);
        return res.status(500).type("html").send("<h1>Could not load that shared conversation.</h1>");
    }
}

async function handleAccountExport(req, res) {
    try {
        const user = await requireAuthenticatedUser(req, res);
        if (!user) return;
        const conversations = await pool.query(
            `SELECT id, title, created_at, updated_at FROM chad_conversations
             WHERE user_id = $1 ORDER BY created_at ASC`,
            [user.id]
        );
        const ids = conversations.rows.map(row => row.id);
        let messages = [];
        if (ids.length) {
            const result = await pool.query(
                `SELECT conversation_id, role, content, created_at
                 FROM chad_messages
                 WHERE conversation_id = ANY($1::uuid[])
                 ORDER BY id ASC`,
                [ids]
            );
            messages = result.rows;
        }
        const consents = await pool.query(
            `SELECT consent_type, version, granted, recorded_at
             FROM chad_user_consents WHERE user_id = $1 ORDER BY recorded_at ASC`,
            [user.id]
        );

        res.setHeader("Content-Disposition", `attachment; filename=chadpdchee-account-export.json`);
        return res.json({
            exported_at: new Date().toISOString(),
            account: {
                id: user.id,
                email: user.email,
                display_name: user.display_name || "",
                plan: user.plan,
                created_at: user.created_at,
                marketing_consent: Boolean(user.marketing_consent)
            },
            conversations: conversations.rows,
            messages,
            consents: consents.rows
        });
    } catch (error) {
        console.error("Account export error:", error);
        return res.status(500).json({ success: false, error: "Could not export your account data." });
    }
}

async function handleAccountDelete(req, res) {
    try {
        const user = await requireAuthenticatedUser(req, res);
        if (!user) return;
        const password = req.body?.password;
        const confirm = req.body?.confirm === "DELETE";
        if (!confirm) {
            return res.status(400).json({ success: false, error: "Type DELETE to confirm account deletion." });
        }

        const auth = await pool.query(
            `SELECT password_hash FROM chad_users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
            [user.id]
        );
        const good = auth.rowCount && await verifyPassword(password, auth.rows[0].password_hash);
        if (!good) {
            return res.status(401).json({ success: false, error: "Password is incorrect." });
        }

        // Remove analytics rows tied to this account's conversations and the
        // current browser's pseudonymous visitor identifier before deleting the
        // account. Analytics that are already aggregate/orphaned and cannot be
        // reasonably linked back to the account remain outside the account record.
        const cookies = parseCookies(req);
        const currentVisitorId = cookies.chadgpt_visitor || "";

        const ownedIds = await pool.query(
            `SELECT id FROM chad_conversations WHERE user_id = $1`,
            [user.id]
        );
        const conversationIds = ownedIds.rows.map(row => row.id);
        if (conversationIds.length) {
            await pool.query(
                `DELETE FROM chad_analytics WHERE conversation_id = ANY($1::uuid[])`,
                [conversationIds]
            );
        }

        if (validVisitorId(currentVisitorId) || validUuid(currentVisitorId)) {
            await pool.query(
                `DELETE FROM chad_analytics WHERE visitor_hash = $1`,
                [hashValue(String(currentVisitorId).toLowerCase())]
            );
        }

        // User-owned conversations/messages are removed together.
        await pool.query(`DELETE FROM chad_conversations WHERE user_id = $1`, [user.id]);
        await pool.query(`DELETE FROM chad_user_sessions WHERE user_id = $1`, [user.id]);
        await pool.query(`DELETE FROM chad_user_consents WHERE user_id = $1`, [user.id]);
        await pool.query(`DELETE FROM chad_users WHERE id = $1`, [user.id]);

        clearCookie(res, "chad_session");
        clearCookie(res, "chadgpt_conversation");
        clearCookie(res, "chadgpt_visitor");
        return res.json({ success: true, deleted: true });
    } catch (error) {
        console.error("Account delete error:", error);
        return res.status(500).json({ success: false, error: "Could not delete your account." });
    }
}




function cleanSponsorPortalText(value, max = 500) {
    return String(value ?? "").trim().slice(0, max);
}

function sponsorDateKey(value) {
    const raw = cleanSponsorPortalText(value, 20);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const date = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== raw) return null;
    return raw;
}

function sponsorUtcDay(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function sponsorAddDays(value, days) {
    const date = sponsorUtcDay(value);
    date.setUTCDate(date.getUTCDate() + days);
    return date;
}

function sponsorLegacyStartSql(alias = "o") {
    return `COALESCE(${alias}.reserved_start_at, ${alias}.slot_month::timestamp AT TIME ZONE 'UTC')`;
}

function sponsorLegacyEndSql(alias = "o") {
    return `COALESCE(${alias}.reserved_end_at, (${alias}.slot_month::timestamp + INTERVAL '1 month') AT TIME ZONE 'UTC')`;
}

async function sponsorWindowMaxOccupancy(client, startAt, endAt, excludeOrderId = null) {
    const startIso = sponsorUtcDay(startAt).toISOString();
    const endIso = sponsorUtcDay(endAt).toISOString();
    const result = await client.query(
        `WITH days AS (
            SELECT generate_series($1::timestamptz, $2::timestamptz - INTERVAL '1 day', INTERVAL '1 day') AS day
         )
         SELECT COALESCE(MAX((
             SELECT COUNT(*)::int
             FROM chad_sponsor_orders o
             WHERE ($3::uuid IS NULL OR o.id <> $3::uuid)
               AND (
                 o.status IN ('paid_pending_approval','approved','live','completed')
                 OR (o.status='payment_pending' AND o.created_at > NOW() - INTERVAL '3 hours')
               )
               AND ${sponsorLegacyStartSql("o")} < days.day + INTERVAL '1 day'
               AND ${sponsorLegacyEndSql("o")} > days.day
         )),0)::int AS max_occupancy
         FROM days`,
        [startIso, endIso, excludeOrderId]
    );
    return Number(result.rows[0]?.max_occupancy || 0);
}

async function sponsorWindowAvailable(client, startAt, excludeOrderId = null) {
    const start = sponsorUtcDay(startAt);
    const end = sponsorAddDays(start, SPONSOR_DURATION_DAYS);
    const maxOccupancy = await sponsorWindowMaxOccupancy(client, start, end, excludeOrderId);
    return { available: maxOccupancy < SPONSOR_MAX_ACTIVE_SLOTS, start, end, maxOccupancy };
}

async function findEarliestSponsorWindow(client, desiredStart = new Date(), excludeOrderId = null, maxDays = 730) {
    let start = sponsorUtcDay(desiredStart);
    const today = sponsorUtcDay(new Date());
    if (start < today) start = today;
    for (let offset = 0; offset <= maxDays; offset++) {
        const candidate = sponsorAddDays(start, offset);
        const check = await sponsorWindowAvailable(client, candidate, excludeOrderId);
        if (check.available) return check;
    }
    return null;
}

function sponsorCookie(res, token) {
    setPersistentCookie(res, "chad_sponsor_session", token, SPONSOR_SESSION_DAYS * 86400);
}

async function createSponsorSession(res, sponsorAccountId) {
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashSessionToken(token);
    await pool.query(
        `INSERT INTO chad_sponsor_sessions (token_hash, sponsor_account_id, expires_at)
         VALUES ($1,$2,NOW() + ($3 || ' days')::interval)`,
        [tokenHash, sponsorAccountId, SPONSOR_SESSION_DAYS]
    );
    sponsorCookie(res, token);
}

async function getSponsorAccount(req) {
    const token = parseCookies(req).chad_sponsor_session || "";
    if (!token) return null;
    const result = await pool.query(
        `SELECT a.*
         FROM chad_sponsor_sessions s
         JOIN chad_sponsor_accounts a ON a.id = s.sponsor_account_id
         WHERE s.token_hash = $1 AND s.expires_at > NOW()
         LIMIT 1`,
        [hashSessionToken(token)]
    );
    return result.rows[0] || null;
}

async function paypalAccessToken() {
    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
        throw new Error("PayPal is not configured yet.");
    }
    const basic = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
    const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
        method: "POST",
        headers: {
            "Authorization": `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = {}; }

    if (!response.ok || !data.access_token) {
        // Safe diagnostics only: never log the Client ID, Secret, Authorization header,
        // or any access token. This logs only PayPal's HTTP status and error fields.
        const paypalError = String(data?.error || "unknown_error").slice(0, 200);
        const paypalDescription = String(data?.error_description || data?.message || "No PayPal error description returned.").slice(0, 500);
        console.error(
            "PayPal OAuth error:",
            `env=${PAYPAL_ENV}`,
            `status=${response.status}`,
            `error=${paypalError}`,
            `description=${paypalDescription}`
        );
        const error = new Error(`Could not connect to PayPal. OAuth ${response.status}: ${paypalError}`);
        error.status = response.status;
        throw error;
    }

    return data.access_token;
}

async function paypalRequest(path, options = {}) {
    const token = await paypalAccessToken();
    const response = await fetch(`${PAYPAL_API_BASE}${path}`, {
        ...options,
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            ...(options.headers || {})
        }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        console.error("PayPal API error:", response.status, JSON.stringify(data).slice(0, 1200));
        const error = new Error(data?.message || "PayPal request failed.");
        error.status = response.status;
        throw error;
    }
    return data;
}

async function handleSponsorAvailability(req, res) {
    const client = await pool.connect();
    try {
        const today = sponsorUtcDay(new Date());
        const earliest = await findEarliestSponsorWindow(client, today);
        const suggestions = [];
        if (earliest) {
            suggestions.push({
                start_date: earliest.start.toISOString().slice(0,10),
                end_date: sponsorAddDays(earliest.start, SPONSOR_DURATION_DAYS - 1).toISOString().slice(0,10)
            });
            let cursor = sponsorAddDays(earliest.start, 7);
            for (let i = 0; i < 5; i++) {
                const next = await findEarliestSponsorWindow(client, cursor);
                if (!next) break;
                const key = next.start.toISOString().slice(0,10);
                if (!suggestions.some(s => s.start_date === key)) {
                    suggestions.push({
                        start_date: key,
                        end_date: sponsorAddDays(next.start, SPONSOR_DURATION_DAYS - 1).toISOString().slice(0,10)
                    });
                }
                cursor = sponsorAddDays(next.start, 7);
            }
        }
        return res.json({
            success: true,
            price_usd: SPONSOR_PRICE_USD,
            currency: "USD",
            max_slots: SPONSOR_MAX_ACTIVE_SLOTS,
            duration_days: SPONSOR_DURATION_DAYS,
            agreement_version: SPONSOR_AGREEMENT_VERSION,
            paypal_configured: Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET),
            paypal_environment: PAYPAL_ENV,
            earliest_start: earliest ? earliest.start.toISOString().slice(0,10) : null,
            earliest_end: earliest ? sponsorAddDays(earliest.start, SPONSOR_DURATION_DAYS - 1).toISOString().slice(0,10) : null,
            suggestions
        });
    } catch (error) {
        console.error("Sponsor availability error:", error);
        return res.status(500).json({ success: false, error: "Could not load sponsor availability." });
    } finally {
        client.release();
    }
}

async function handleSponsorCheckoutCreate(req, res) {
    const client = await pool.connect();
    try {
        const body = req.body || {};
        const companyName = cleanSponsorPortalText(body.company_name, 160);
        const contactName = cleanSponsorPortalText(body.contact_name, 160);
        const email = cleanSponsorPortalText(body.email, 240).toLowerCase();
        const password = String(body.password || "");
        const agreementName = cleanSponsorPortalText(body.agreement_name, 160);
        const accepted = body.agreement_accepted === true;
        const startMode = body.start_mode === "date" ? "date" : "asap";
        const requestedDateKey = startMode === "date" ? sponsorDateKey(body.requested_start_date) : null;
        const discountPercent = body.discount_percent === "" || body.discount_percent == null
            ? null : Number(body.discount_percent);

        if (!companyName || !contactName || !/^\S+@\S+\.\S+$/.test(email)) {
            return res.status(400).json({ success: false, error: "Company, contact name, and a valid email are required." });
        }
        if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
            return res.status(400).json({ success: false, error: `Sponsor password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters.` });
        }
        if (startMode === "date" && !requestedDateKey) {
            return res.status(400).json({ success: false, error: "Choose a valid campaign start date." });
        }
        if (!accepted || !agreementName) {
            return res.status(400).json({ success: false, error: "The sponsorship agreement must be accepted and signed." });
        }
        if (discountPercent !== null && (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100)) {
            return res.status(400).json({ success: false, error: "Discount percent must be between 0 and 100." });
        }

        const today = sponsorUtcDay(new Date());
        let desiredStart = requestedDateKey ? new Date(`${requestedDateKey}T00:00:00Z`) : today;
        if (desiredStart < today) {
            return res.status(400).json({ success: false, error: "Campaign start date cannot be in the past." });
        }

        await client.query("BEGIN");
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ["chad-sponsor-inventory"]);

        let window;
        if (startMode === "date") {
            window = await sponsorWindowAvailable(client, desiredStart);
            if (!window.available) {
                const next = await findEarliestSponsorWindow(client, sponsorAddDays(desiredStart, 1));
                await client.query("ROLLBACK");
                return res.status(409).json({
                    success: false,
                    error: next
                        ? `That 30-day start date is unavailable. The next available start is ${next.start.toISOString().slice(0,10)}.`
                        : "That start date is unavailable and no future opening was found.",
                    next_available_start: next ? next.start.toISOString().slice(0,10) : null
                });
            }
        } else {
            window = await findEarliestSponsorWindow(client, desiredStart);
            if (!window) {
                await client.query("ROLLBACK");
                return res.status(409).json({ success:false, error:"No sponsor opening is currently available." });
            }
        }

        let accountResult = await client.query(`SELECT * FROM chad_sponsor_accounts WHERE email=$1 LIMIT 1`, [email]);
        let account;
        if (accountResult.rowCount) {
            account = accountResult.rows[0];
            if (!(await verifyPassword(password, account.password_hash))) {
                await client.query("ROLLBACK");
                return res.status(401).json({ success: false, error: "That sponsor email already has an account. Use its existing password." });
            }
            await client.query(
                `UPDATE chad_sponsor_accounts SET company_name=$2, contact_name=$3, updated_at=NOW() WHERE id=$1`,
                [account.id, companyName, contactName]
            );
        } else {
            const accountId = crypto.randomUUID();
            const passwordHash = await hashPassword(password);
            accountResult = await client.query(
                `INSERT INTO chad_sponsor_accounts (id,company_name,contact_name,email,password_hash)
                 VALUES ($1,$2,$3,$4,$5) RETURNING *`,
                [accountId, companyName, contactName, email, passwordHash]
            );
            account = accountResult.rows[0];
        }

        const orderId = crypto.randomUUID();
        const reservedStart = window.start.toISOString();
        const reservedEnd = window.end.toISOString();
        const slotMonth = `${window.start.toISOString().slice(0,7)}-01`;

        await client.query(
            `INSERT INTO chad_sponsor_orders (
                id,sponsor_account_id,slot_month,price_usd,currency,status,
                agreement_version,agreement_accepted_at,agreement_name,agreement_ip_hash,agreement_snapshot,
                requested_start_at,reserved_start_at,reserved_end_at,
                website,campaign_goal,destination_url,headline,ad_copy,cta_text,
                discount_code,discount_percent,notes
             ) VALUES ($1,$2,$3,$4,'USD','payment_pending',$5,NOW(),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
            [
                orderId, account.id, slotMonth, SPONSOR_PRICE_USD, SPONSOR_AGREEMENT_VERSION,
                agreementName, hashValue(getClientIp(req)), SPONSOR_AGREEMENT_TEXT,
                desiredStart.toISOString(), reservedStart, reservedEnd,
                cleanSponsorPortalText(body.website,1000), cleanSponsorPortalText(body.campaign_goal,2000),
                cleanSponsorPortalText(body.destination_url,1000), cleanSponsorPortalText(body.headline,220),
                cleanSponsorPortalText(body.ad_copy,1200), cleanSponsorPortalText(body.cta_text,100) || "Learn more →",
                cleanSponsorPortalText(body.discount_code,80), discountPercent, cleanSponsorPortalText(body.notes,2000)
            ]
        );
        await client.query("COMMIT");

        const displayStart = window.start.toISOString().slice(0,10);
        const displayEnd = sponsorAddDays(window.start, SPONSOR_DURATION_DAYS - 1).toISOString().slice(0,10);

        const paypal = await paypalRequest("/v2/checkout/orders", {
            method: "POST",
            headers: { "PayPal-Request-Id": orderId },
            body: JSON.stringify({
                intent: "CAPTURE",
                purchase_units: [{
                    reference_id: orderId,
                    custom_id: orderId,
                    description: `Chad P.D. Chee sponsor placement — 30 days starting ${displayStart}`,
                    amount: { currency_code: "USD", value: SPONSOR_PRICE_USD.toFixed(2) }
                }],
                payment_source: {
                    paypal: {
                        experience_context: {
                            brand_name: "Chad P.D. Chee",
                            user_action: "PAY_NOW",
                            shipping_preference: "NO_SHIPPING",
                            return_url: `${APP_BASE_URL}/advertise.html?payment=return&order=${encodeURIComponent(orderId)}`,
                            cancel_url: `${APP_BASE_URL}/advertise.html?payment=cancelled&order=${encodeURIComponent(orderId)}`
                        }
                    }
                }
            })
        });

        await pool.query(`UPDATE chad_sponsor_orders SET paypal_order_id=$2, updated_at=NOW() WHERE id=$1`, [orderId, paypal.id]);
        await createSponsorSession(res, account.id);
        const approveUrl = (paypal.links || []).find(link => link.rel === "payer-action")?.href
            || (paypal.links || []).find(link => link.rel === "approve")?.href;
        if (!approveUrl) throw new Error("PayPal did not return a checkout link.");

        return res.json({
            success: true,
            order_id: orderId,
            paypal_order_id: paypal.id,
            approval_url: approveUrl,
            reserved_start: displayStart,
            reserved_end: displayEnd
        });
    } catch (error) {
        try { await client.query("ROLLBACK"); } catch {}
        console.error("Sponsor checkout create error:", error);
        return res.status(500).json({ success: false, error: error.message || "Could not start sponsor checkout." });
    } finally {
        client.release();
    }
}

async function markSponsorOrderPaid(orderId, captureData) {
    const capture = captureData?.purchase_units?.[0]?.payments?.captures?.[0] || {};
    const payerEmail = captureData?.payer?.email_address || "";
    const result = await pool.query(
        `UPDATE chad_sponsor_orders
         SET status='paid_pending_approval', paypal_capture_id=COALESCE(NULLIF($2,''),paypal_capture_id),
             paypal_payer_email=$3, paid_at=COALESCE(paid_at,NOW()), updated_at=NOW()
         WHERE id=$1 AND status IN ('payment_pending','paid_pending_approval')
         RETURNING *`,
        [orderId, String(capture.id || ""), payerEmail]
    );
    return result.rows[0] || null;
}

async function handleSponsorCheckoutCapture(req, res) {
    try {
        const orderId = cleanSponsorPortalText(req.body?.order_id, 80);
        if (!orderId) return res.status(400).json({ success:false, error:"Sponsor order ID is required." });
        const orderResult = await pool.query(
            `SELECT o.*, a.email, a.contact_name, a.company_name
             FROM chad_sponsor_orders o JOIN chad_sponsor_accounts a ON a.id=o.sponsor_account_id
             WHERE o.id=$1 LIMIT 1`, [orderId]
        );
        const order = orderResult.rows[0];
        if (!order) return res.status(404).json({ success:false, error:"Sponsor order not found." });
        if (order.status !== 'payment_pending') {
            return res.json({ success:true, status:order.status, dashboard_url:"/sponsor-dashboard.html" });
        }
        if (!order.paypal_order_id) return res.status(409).json({ success:false, error:"PayPal order is not ready." });

        const data = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(order.paypal_order_id)}/capture`, {
            method:"POST", headers:{"PayPal-Request-Id":`capture-${order.id}`}, body:"{}"
        });
        if (data.status !== "COMPLETED") return res.status(409).json({ success:false, error:"PayPal payment has not completed." });
        const paid = await markSponsorOrderPaid(order.id, data);
        if (paid) {
            sendChadEmail({
                to: order.email,
                subject: "Chad P.D. Chee sponsorship payment received",
                text: `Payment received for your 30-day Chad P.D. Chee sponsor placement. Your campaign is now awaiting approval. Sign in at ${APP_BASE_URL}/sponsor-login.html`,
                html: `<h2>Payment received.</h2><p>Your <strong>30-day</strong> Chad P.D. Chee sponsor placement is now <strong>Paid — Awaiting Approval</strong>.</p><p><a href="${APP_BASE_URL}/sponsor-login.html">Open Sponsor Portal</a></p>`
            }).catch(err => console.error("Sponsor receipt email error:", err));
        }
        return res.json({ success:true, status:"paid_pending_approval", dashboard_url:"/sponsor-dashboard.html" });
    } catch (error) {
        console.error("Sponsor capture error:", error);
        return res.status(500).json({ success:false, error:error.message || "Could not confirm sponsor payment." });
    }
}

async function handleSponsorLogin(req,res) {
    try {
        const email=cleanSponsorPortalText(req.body?.email,240).toLowerCase();
        const password=String(req.body?.password||"");
        const allowed=await claimBurst("sponsor_login",`${getClientIp(req)}|${email}`,10,15*60);
        if(!allowed) return res.status(429).json({success:false,error:"Too many login attempts. Try again later."});
        const result=await pool.query(`SELECT * FROM chad_sponsor_accounts WHERE email=$1 LIMIT 1`,[email]);
        const account=result.rows[0];
        if(!account || !(await verifyPassword(password,account.password_hash))) return res.status(401).json({success:false,error:"Invalid sponsor email or password."});
        await createSponsorSession(res,account.id);
        return res.json({success:true,account:{company_name:account.company_name,contact_name:account.contact_name,email:account.email}});
    } catch(error){ console.error("Sponsor login error:",error); return res.status(500).json({success:false,error:"Could not sign in."}); }
}

async function handleSponsorLogout(req,res){
    try{
        const token=parseCookies(req).chad_sponsor_session||"";
        if(token) await pool.query(`DELETE FROM chad_sponsor_sessions WHERE token_hash=$1`,[hashSessionToken(token)]);
        clearCookie(res,"chad_sponsor_session");
        return res.json({success:true});
    }catch{ clearCookie(res,"chad_sponsor_session"); return res.json({success:true}); }
}

async function expireAbandonedSponsorOrders() {
    // Keep abandoned checkout attempts for admin/audit history, but mark them expired
    // after the same 3-hour hold window used by sponsor inventory.
    await pool.query(`
        UPDATE chad_sponsor_orders
        SET status='expired', updated_at=NOW()
        WHERE status='payment_pending'
          AND created_at <= NOW() - INTERVAL '3 hours'
    `);
}

async function handleSponsorMe(req,res){
    const account=await getSponsorAccount(req);
    if(!account) return res.status(401).json({success:false,authenticated:false});
    return res.json({success:true,authenticated:true,account:{company_name:account.company_name,contact_name:account.contact_name,email:account.email}});
}

async function handleSponsorDashboard(req,res){
    try{
        const account=await getSponsorAccount(req);
        if(!account) return res.status(401).json({success:false,error:"Sponsor sign-in required."});
        await expireAbandonedSponsorOrders();
        const result=await pool.query(
            `SELECT o.*,
                COALESCE(a.impressions,0)::int AS impressions,
                COALESCE(a.clicks,0)::int AS clicks
             FROM chad_sponsor_orders o
             LEFT JOIN (
                SELECT metadata->>'campaign_id' AS campaign_id,
                    COUNT(*) FILTER(WHERE event='sponsor_impression') AS impressions,
                    COUNT(*) FILTER(WHERE event='sponsor_click') AS clicks
                FROM chad_analytics
                WHERE event IN ('sponsor_impression','sponsor_click')
                GROUP BY metadata->>'campaign_id'
             ) a ON a.campaign_id=o.campaign_id
             WHERE o.sponsor_account_id=$1
               AND o.status <> 'expired'
             ORDER BY COALESCE(o.reserved_start_at,o.slot_month::timestamp AT TIME ZONE 'UTC') DESC,o.created_at DESC`, [account.id]
        );
        return res.json({success:true,price_usd:SPONSOR_PRICE_USD,max_slots:SPONSOR_MAX_ACTIVE_SLOTS,duration_days:SPONSOR_DURATION_DAYS,campaigns:result.rows.map(row=>{
            const startAt = row.reserved_start_at || row.slot_month;
            const endAt = row.reserved_end_at || new Date(new Date(row.slot_month).getTime() + 31*86400000);
            const now=Date.now();
            let status=row.status;
            if(row.status==='approved'){
                status = now>=Date.parse(endAt) ? 'completed' : now>=Date.parse(startAt) ? 'live' : 'approved';
            }
            return {
                id:row.id,
                start_at:startAt,
                end_at:endAt,
                requested_start_at:row.requested_start_at,
                status,
                price_usd:Number(row.price_usd),currency:row.currency,
                headline:row.headline,ad_copy:row.ad_copy,cta_text:row.cta_text,destination_url:row.destination_url,discount_code:row.discount_code,
                discount_percent:row.discount_percent==null?null:Number(row.discount_percent),campaign_id:row.campaign_id,paid_at:row.paid_at,approved_at:row.approved_at,
                impressions:Number(row.impressions||0),clicks:Number(row.clicks||0),ctr_percent:Number(row.impressions||0)?Number((Number(row.clicks||0)/Number(row.impressions)*100).toFixed(2)):0
            };
        })});
    }catch(error){console.error("Sponsor dashboard error:",error);return res.status(500).json({success:false,error:"Could not load sponsor dashboard."});}
}

const SPONSOR_TEST_CLEANUP_CUTOFF = new Date("2026-09-11T03:30:00Z");

async function handleAdminSponsorTestCleanup(req,res){
    if(!isAdminTestRequest(req)) return res.status(401).json({success:false,error:"Admin key required."});
    const confirmation=String(req.body?.confirmation||"").trim();
    if(confirmation!=="DELETE PRELAUNCH TEST SPONSORS") {
        return res.status(400).json({success:false,error:"Confirmation phrase did not match."});
    }

    const client=await pool.connect();
    try{
        await client.query("BEGIN");

        // This cleanup is intentionally time-locked to pre-launch data only.
        // Anything created after the cutoff can never be deleted by this endpoint.
        const orderRows=await client.query(
            `SELECT id,sponsor_account_id,campaign_id
             FROM chad_sponsor_orders
             WHERE created_at < $1
             FOR UPDATE`,
            [SPONSOR_TEST_CLEANUP_CUTOFF]
        );

        const orderIds=orderRows.rows.map(r=>r.id);
        const accountIds=[...new Set(orderRows.rows.map(r=>r.sponsor_account_id).filter(Boolean))];
        const campaignIds=[...new Set(orderRows.rows.map(r=>r.campaign_id).filter(Boolean))];

        let analyticsDeleted=0;
        let campaignsDeleted=0;
        let ordersDeleted=0;
        let sessionsDeleted=0;
        let accountsDeleted=0;

        if(campaignIds.length){
            const a=await client.query(
                `DELETE FROM chad_analytics
                 WHERE metadata->>'campaign_id' = ANY($1::text[])`,
                [campaignIds]
            );
            analyticsDeleted=a.rowCount||0;

            const c=await client.query(
                `DELETE FROM chad_sponsors
                 WHERE campaign_id = ANY($1::text[])`,
                [campaignIds]
            );
            campaignsDeleted=c.rowCount||0;
        }

        if(orderIds.length){
            const o=await client.query(
                `DELETE FROM chad_sponsor_orders WHERE id = ANY($1::uuid[])`,
                [orderIds]
            );
            ordersDeleted=o.rowCount||0;
        }

        if(accountIds.length){
            const s=await client.query(
                `DELETE FROM chad_sponsor_sessions WHERE sponsor_account_id = ANY($1::uuid[])`,
                [accountIds]
            );
            sessionsDeleted=s.rowCount||0;

            // Only remove accounts that no longer have any orders. This keeps the cleanup safe
            // if an account somehow has a post-cutoff production order.
            const ac=await client.query(
                `DELETE FROM chad_sponsor_accounts a
                 WHERE a.id = ANY($1::uuid[])
                   AND NOT EXISTS (SELECT 1 FROM chad_sponsor_orders o WHERE o.sponsor_account_id=a.id)`,
                [accountIds]
            );
            accountsDeleted=ac.rowCount||0;
        }

        await client.query("COMMIT");
        console.log("Prelaunch sponsor cleanup:", {ordersDeleted,campaignsDeleted,analyticsDeleted,sessionsDeleted,accountsDeleted});
        return res.json({
            success:true,
            cutoff:SPONSOR_TEST_CLEANUP_CUTOFF.toISOString(),
            deleted:{orders:ordersDeleted,campaigns:campaignsDeleted,analytics:analyticsDeleted,sessions:sessionsDeleted,accounts:accountsDeleted}
        });
    }catch(error){
        await client.query("ROLLBACK");
        console.error("Prelaunch sponsor cleanup error:",error);
        return res.status(500).json({success:false,error:"Could not clean pre-launch sponsor test data."});
    }finally{
        client.release();
    }
}

async function handleAdminSponsorOrders(req,res){
    try{
        if(!isAdminTestRequest(req)) return res.status(401).json({success:false,error:"Admin key required."});
        await expireAbandonedSponsorOrders();
        const result=await pool.query(`SELECT o.*,a.company_name,a.contact_name,a.email FROM chad_sponsor_orders o JOIN chad_sponsor_accounts a ON a.id=o.sponsor_account_id ORDER BY o.created_at DESC LIMIT 250`);
        return res.json({success:true,orders:result.rows});
    }catch(error){console.error("Admin sponsor orders error:",error);return res.status(500).json({success:false,error:"Could not load sponsor orders."});}
}

function sponsorContractEscape(value){
    return String(value ?? "")
        .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
        .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

async function handleAdminSponsorContract(req,res){
    try{
        if(!isAdminTestRequest(req)) return res.status(401).send("Admin key required.");
        const orderId=cleanSponsorPortalText(req.query?.order_id,80);
        if(!orderId) return res.status(400).send("Sponsor order ID required.");
        const result=await pool.query(`SELECT o.*,a.company_name,a.contact_name,a.email FROM chad_sponsor_orders o JOIN chad_sponsor_accounts a ON a.id=o.sponsor_account_id WHERE o.id=$1 LIMIT 1`,[orderId]);
        const o=result.rows[0];
        if(!o) return res.status(404).send("Sponsor order not found.");
        const agreement=o.agreement_snapshot || SPONSOR_AGREEMENT_TEXT;
        const lines=sponsorContractEscape(agreement).replace(/\n/g,"<br>");
        const paid=o.paid_at ? new Date(o.paid_at).toLocaleString("en-CA",{timeZone:"America/Toronto"}) : "Not paid";
        const accepted=o.agreement_accepted_at ? new Date(o.agreement_accepted_at).toLocaleString("en-CA",{timeZone:"America/Toronto"}) : "—";
        res.setHeader("Content-Type","text/html; charset=utf-8");
        res.setHeader("Cache-Control","no-store");
        return res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sponsor Agreement — ${sponsorContractEscape(o.company_name)}</title><style>body{font-family:Arial,sans-serif;color:#171b1f;margin:0;background:#f2f5f7}.page{max-width:850px;margin:30px auto;background:#fff;padding:38px;border:1px solid #dbe2e7;border-radius:14px}.top{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #111;padding-bottom:18px;margin-bottom:22px}h1{margin:0;font-size:25px}.meta{display:grid;grid-template-columns:180px 1fr;gap:8px 14px;font-size:13px;margin:22px 0}.meta b{color:#56616a}.agreement{font-size:14px;line-height:1.6;border-top:1px solid #ddd;padding-top:20px}.actions{margin-bottom:20px}button{padding:10px 15px;border:0;border-radius:8px;background:#1479bb;color:white;font-weight:700;cursor:pointer}@media print{body{background:white}.page{margin:0;border:0;padding:0;max-width:none}.actions{display:none}}@media(max-width:650px){.page{margin:0;border-radius:0;padding:22px}.top{display:block}.meta{grid-template-columns:1fr}}</style></head><body><main class="page"><div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div><div class="top"><div><h1>Chad P.D. Chee Sponsor Agreement</h1><div>Permanent order record</div></div><strong>Agreement v${sponsorContractEscape(o.agreement_version)}</strong></div><div class="meta"><b>Order ID</b><span>${sponsorContractEscape(o.id)}</span><b>Sponsor</b><span>${sponsorContractEscape(o.company_name)}</span><b>Contact</b><span>${sponsorContractEscape(o.contact_name)} · ${sponsorContractEscape(o.email)}</span><b>Authorized signer</b><span>${sponsorContractEscape(o.agreement_name)}</span><b>Accepted</b><span>${sponsorContractEscape(accepted)} ET</span><b>Campaign run</b><span>${sponsorContractEscape(o.reserved_start_at ? new Date(o.reserved_start_at).toISOString().slice(0,10) : String(o.slot_month).slice(0,10))} through ${sponsorContractEscape(o.reserved_end_at ? new Date(new Date(o.reserved_end_at).getTime()-86400000).toISOString().slice(0,10) : "legacy schedule")}</span><b>Amount</b><span>$${Number(o.price_usd).toFixed(2)} ${sponsorContractEscape(o.currency)}</span><b>Payment</b><span>${sponsorContractEscape(paid)} ET</span><b>PayPal Order</b><span>${sponsorContractEscape(o.paypal_order_id||"—")}</span><b>PayPal Capture</b><span>${sponsorContractEscape(o.paypal_capture_id||"—")}</span></div><div class="agreement">${lines}</div></main></body></html>`);
    }catch(error){console.error("Admin sponsor contract error:",error);return res.status(500).send("Could not load sponsor agreement.");}
}

async function handleAdminSponsorOrderApprove(req,res){
    const client=await pool.connect();
    try{
        if(!isAdminTestRequest(req)) return res.status(401).json({success:false,error:"Admin key required."});
        const orderId=cleanSponsorPortalText(req.body?.order_id,80);
        await client.query("BEGIN");
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ["chad-sponsor-inventory"]);
        const r=await client.query(`SELECT o.*,a.company_name FROM chad_sponsor_orders o JOIN chad_sponsor_accounts a ON a.id=o.sponsor_account_id WHERE o.id=$1 FOR UPDATE`,[orderId]);
        const order=r.rows[0];
        if(!order) {await client.query("ROLLBACK");return res.status(404).json({success:false,error:"Sponsor order not found."});}
        if(!['paid_pending_approval','approved','live'].includes(order.status)){await client.query("ROLLBACK");return res.status(409).json({success:false,error:"Only paid sponsor orders can be approved."});}
        if(!order.destination_url || !order.headline){await client.query("ROLLBACK");return res.status(400).json({success:false,error:"Headline and destination URL are required before approval."});}

        const today=sponsorUtcDay(new Date());
        const reserved=order.reserved_start_at ? sponsorUtcDay(order.reserved_start_at) : sponsorUtcDay(order.slot_month);
        const desiredStart=reserved < today ? today : reserved;

        let window=await sponsorWindowAvailable(client,desiredStart,order.id);
        if(!window.available){
            window=await findEarliestSponsorWindow(client,desiredStart,order.id);
        }
        if(!window){
            await client.query("ROLLBACK");
            return res.status(409).json({success:false,error:"No 30-day sponsor opening is currently available."});
        }

        const campaignId=order.campaign_id || `paid-${window.start.toISOString().slice(0,10)}-${order.id.slice(0,8)}`;
        await client.query(
            `INSERT INTO chad_sponsors (id,campaign_id,advertiser,headline,body,cta,destination_url,image_url,discount_code,discount_percent,starts_at,ends_at,is_active,priority)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'',$8,$9,$10,$11,TRUE,100)
             ON CONFLICT(campaign_id) DO UPDATE SET advertiser=EXCLUDED.advertiser,headline=EXCLUDED.headline,body=EXCLUDED.body,cta=EXCLUDED.cta,destination_url=EXCLUDED.destination_url,discount_code=EXCLUDED.discount_code,discount_percent=EXCLUDED.discount_percent,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,is_active=TRUE,updated_at=NOW()`,
            [crypto.randomUUID(),campaignId,order.company_name,order.headline,order.ad_copy,order.cta_text||'Learn more →',order.destination_url,order.discount_code||'',order.discount_percent,window.start.toISOString(),window.end.toISOString()]
        );
        await client.query(
            `UPDATE chad_sponsor_orders
             SET status='approved',campaign_id=$2,approved_at=COALESCE(approved_at,NOW()),
                 reserved_start_at=$3,reserved_end_at=$4,slot_month=$5::date,updated_at=NOW()
             WHERE id=$1`,
            [orderId,campaignId,window.start.toISOString(),window.end.toISOString(),`${window.start.toISOString().slice(0,7)}-01`]
        );
        await client.query("COMMIT");
        return res.json({
            success:true,
            campaign_id:campaignId,
            starts_at:window.start.toISOString(),
            ends_at:window.end.toISOString(),
            shifted_from_reserved: order.reserved_start_at ? sponsorUtcDay(order.reserved_start_at).getTime() !== window.start.getTime() : false
        });
    }catch(error){try{await client.query("ROLLBACK")}catch{};console.error("Approve sponsor order error:",error);return res.status(500).json({success:false,error:"Could not approve sponsor order."});}
    finally{client.release();}
}

async function handleAdminSponsorOrderRefund(req,res){
    try{
        if(!isAdminTestRequest(req)) return res.status(401).json({success:false,error:"Admin key required."});
        const orderId=cleanSponsorPortalText(req.body?.order_id,80);
        if(!orderId) return res.status(400).json({success:false,error:"Sponsor order ID required."});

        const r=await pool.query(
            `SELECT o.*,a.company_name
             FROM chad_sponsor_orders o
             JOIN chad_sponsor_accounts a ON a.id=o.sponsor_account_id
             WHERE o.id=$1
             LIMIT 1`,
            [orderId]
        );
        const order=r.rows[0];
        if(!order) return res.status(404).json({success:false,error:"Sponsor order not found."});
        if(order.status==='refunded') return res.json({success:true,status:'refunded',already_refunded:true,refund_id:order.paypal_refund_id||''});
        if(order.status==='refund_pending') return res.status(409).json({success:false,error:"A refund is already pending for this order."});
        if(!['paid_pending_approval','approved','live','completed'].includes(order.status)){
            return res.status(409).json({success:false,error:"Only paid sponsor orders can be refunded."});
        }
        if(!order.paypal_capture_id){
            return res.status(409).json({success:false,error:"This paid order does not have a PayPal capture ID."});
        }

        const refund=await paypalRequest(`/v2/payments/captures/${encodeURIComponent(order.paypal_capture_id)}/refund`,{
            method:'POST',
            headers:{'PayPal-Request-Id':`chad-refund-${order.id}`},
            body:'{}'
        });
        const refundStatus=String(refund?.status||'').toUpperCase();
        if(!['COMPLETED','PENDING'].includes(refundStatus)){
            return res.status(502).json({success:false,error:`PayPal returned unexpected refund status: ${refundStatus||'UNKNOWN'}.`});
        }

        const newStatus=refundStatus==='COMPLETED' ? 'refunded' : 'refund_pending';
        const client=await pool.connect();
        try{
            await client.query('BEGIN');
            await client.query(
                `UPDATE chad_sponsor_orders
                 SET status=$2,
                     paypal_refund_id=COALESCE(NULLIF($3,''),paypal_refund_id),
                     refund_status=$4,
                     refunded_at=CASE WHEN $2='refunded' THEN COALESCE(refunded_at,NOW()) ELSE refunded_at END,
                     updated_at=NOW()
                 WHERE id=$1`,
                [order.id,newStatus,String(refund?.id||''),refundStatus]
            );
            if(order.campaign_id){
                await client.query(`UPDATE chad_sponsors SET is_active=FALSE,updated_at=NOW() WHERE campaign_id=$1`,[order.campaign_id]);
            }
            await client.query('COMMIT');
        }catch(error){
            try{await client.query('ROLLBACK')}catch{}
            throw error;
        }finally{client.release();}

        console.log('PayPal sponsor refund:',`order=${order.id}`,`refund=${String(refund?.id||'')}`,`status=${refundStatus}`);
        return res.json({success:true,status:newStatus,refund_status:refundStatus,refund_id:String(refund?.id||'')});
    }catch(error){
        console.error('Sponsor refund error:',error);
        return res.status(error?.status && Number(error.status)>=400 && Number(error.status)<600 ? Number(error.status) : 500)
            .json({success:false,error:error?.message||'Could not refund sponsor order.'});
    }
}

async function handleChatPacks(req, res) {
    try {
        const user = await getAuthenticatedUser(req);
        const balance = user ? await getChatCreditBalance(user.id) : 0;
        return res.json({
            success:true,
            authenticated:Boolean(user),
            balance,
            packs:publicChatPacks(),
            paypal_environment:PAYPAL_ENV
        });
    } catch (error) {
        console.error("Chat packs error:", error);
        return res.status(500).json({success:false,error:"Could not load Chad chat packs."});
    }
}

async function handleChatPackCheckoutCreate(req, res) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) return res.status(401).json({success:false,error:"Sign in before buying Chad chats."});
        const pack = CHAT_PACKS[String(req.body?.pack_id || "")];
        if (!pack) return res.status(400).json({success:false,error:"That chat pack does not exist."});
        const purchaseId = crypto.randomUUID();
        await pool.query(
            `INSERT INTO chad_chat_credit_purchases (id,user_id,pack_id,credits,amount_usd)
             VALUES ($1,$2,$3,$4,$5)`,
            [purchaseId,user.id,pack.id,pack.chats,pack.priceUsd]
        );
        const paypal = await paypalRequest("/v2/checkout/orders", {
            method:"POST",
            headers:{"PayPal-Request-Id":`chat-${purchaseId}`},
            body:JSON.stringify({
                intent:"CAPTURE",
                purchase_units:[{
                    reference_id:purchaseId,
                    custom_id:`chat:${purchaseId}`,
                    description:`Chad P.D. Chee — ${pack.label}`,
                    amount:{currency_code:"USD",value:pack.priceUsd.toFixed(2)}
                }],
                payment_source:{paypal:{experience_context:{
                    brand_name:"Chad P.D. Chee",
                    user_action:"PAY_NOW",
                    shipping_preference:"NO_SHIPPING",
                    return_url:`${APP_BASE_URL}/?chat_payment=return&purchase=${encodeURIComponent(purchaseId)}`,
                    cancel_url:`${APP_BASE_URL}/?chat_payment=cancelled&purchase=${encodeURIComponent(purchaseId)}`
                }}}
            })
        });
        await pool.query(`UPDATE chad_chat_credit_purchases SET paypal_order_id=$2,updated_at=NOW() WHERE id=$1`,[purchaseId,paypal.id]);
        const approvalUrl=(paypal.links||[]).find(l=>l.rel==='payer-action')?.href || (paypal.links||[]).find(l=>l.rel==='approve')?.href;
        if(!approvalUrl) throw new Error("PayPal did not return a checkout link.");
        return res.json({success:true,purchase_id:purchaseId,paypal_order_id:paypal.id,approval_url:approvalUrl});
    } catch (error) {
        console.error("Chat pack checkout create error:",error);
        return res.status(error?.status && Number(error.status)>=400 ? Number(error.status) : 500).json({success:false,error:error?.message||"Could not start chat purchase."});
    }
}

async function handleChatPackCheckoutCapture(req, res) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) return res.status(401).json({success:false,error:"Sign in to finish this purchase."});
        const purchaseId=String(req.body?.purchase_id||"");
        const result=await pool.query(`SELECT * FROM chad_chat_credit_purchases WHERE id=$1 AND user_id=$2 LIMIT 1`,[purchaseId,user.id]);
        const purchase=result.rows[0];
        if(!purchase) return res.status(404).json({success:false,error:"Chat purchase not found."});
        if(purchase.status==='paid') return res.json({success:true,balance:await getChatCreditBalance(user.id),credits:purchase.credits,already_paid:true});
        if(!purchase.paypal_order_id) return res.status(409).json({success:false,error:"This purchase has no PayPal order."});
        const capture=await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(purchase.paypal_order_id)}/capture`,{
            method:'POST',headers:{'PayPal-Request-Id':`chat-capture-${purchase.id}`},body:'{}'
        });
        if(String(capture.status||'').toUpperCase()!=='COMPLETED') return res.status(409).json({success:false,error:`PayPal payment is ${capture.status||'not completed'}.`});
        const captureId=String(capture.purchase_units?.[0]?.payments?.captures?.[0]?.id||'');
        const granted=await grantChatPurchaseCredits(purchase.id,captureId);
        return res.json({success:true,balance:granted?.balance||0,credits:purchase.credits,status:'paid'});
    } catch(error) {
        console.error("Chat pack capture error:",error);
        return res.status(error?.status && Number(error.status)>=400 ? Number(error.status) : 500).json({success:false,error:error?.message||"Could not finish chat purchase."});
    }
}

async function handleChatCreditHistory(req,res){
    try{
        const user=await getAuthenticatedUser(req);
        if(!user) return res.status(401).json({success:false,error:"Sign in first."});
        const [balance,purchases]=await Promise.all([
            getChatCreditBalance(user.id),
            pool.query(`SELECT id,pack_id,credits,amount_usd,status,paid_at,created_at FROM chad_chat_credit_purchases WHERE user_id=$1 ORDER BY created_at DESC LIMIT 25`,[user.id])
        ]);
        return res.json({success:true,balance,purchases:purchases.rows});
    }catch(error){console.error("Chat credit history error:",error);return res.status(500).json({success:false,error:"Could not load chat credits."});}
}

async function handlePayPalWebhook(req,res){
    try{
        if(!PAYPAL_WEBHOOK_ID) return res.status(503).json({success:false,error:"PayPal webhook is not configured."});
        const transmissionId=req.headers['paypal-transmission-id'];
        const transmissionTime=req.headers['paypal-transmission-time'];
        const certUrl=req.headers['paypal-cert-url'];
        const authAlgo=req.headers['paypal-auth-algo'];
        const transmissionSig=req.headers['paypal-transmission-sig'];
        if(!transmissionId||!transmissionTime||!certUrl||!authAlgo||!transmissionSig) return res.status(400).json({success:false,error:"Missing PayPal webhook headers."});
        const verification=await paypalRequest('/v1/notifications/verify-webhook-signature',{
            method:'POST',body:JSON.stringify({auth_algo:authAlgo,cert_url:certUrl,transmission_id:transmissionId,transmission_sig:transmissionSig,transmission_time:transmissionTime,webhook_id:PAYPAL_WEBHOOK_ID,webhook_event:req.body})
        });
        if(verification.verification_status!=='SUCCESS') return res.status(400).json({success:false,error:"Invalid PayPal webhook signature."});
        const event=req.body||{};
        if(event.event_type==='PAYMENT.CAPTURE.COMPLETED'){
            const paypalOrderId=String(event.resource?.supplementary_data?.related_ids?.order_id||'');
            const customId=String(event.resource?.custom_id||'');
            let chatPurchaseId=customId.startsWith('chat:') ? customId.slice(5) : '';
            if(!chatPurchaseId && paypalOrderId){
                const chatLookup=await pool.query(`SELECT id FROM chad_chat_credit_purchases WHERE paypal_order_id=$1 LIMIT 1`,[paypalOrderId]);
                chatPurchaseId=chatLookup.rows[0]?.id||'';
            }
            if(chatPurchaseId){
                await grantChatPurchaseCredits(chatPurchaseId,String(event.resource?.id||''));
                return res.json({success:true});
            }
            const sponsorCustomId=event.resource?.custom_id || event.resource?.supplementary_data?.related_ids?.order_id || '';
            let orderId=sponsorCustomId;
            if(!orderId && event.resource?.supplementary_data?.related_ids?.order_id){
                const lookup=await pool.query(`SELECT id FROM chad_sponsor_orders WHERE paypal_order_id=$1 LIMIT 1`,[event.resource.supplementary_data.related_ids.order_id]);
                orderId=lookup.rows[0]?.id||'';
            }
            if(orderId) await pool.query(`UPDATE chad_sponsor_orders SET status='paid_pending_approval',paypal_capture_id=COALESCE(NULLIF($2,''),paypal_capture_id),paid_at=COALESCE(paid_at,NOW()),updated_at=NOW() WHERE id=$1 AND status='payment_pending'`,[orderId,String(event.resource?.id||'')]);
        }
        if(event.event_type==='PAYMENT.CAPTURE.REFUNDED' || event.event_type==='PAYMENT.CAPTURE.REVERSED'){
            const captureId=String(event.resource?.supplementary_data?.related_ids?.capture_id||event.resource?.id||'');
            const refundId=event.event_type==='PAYMENT.CAPTURE.REFUNDED' ? String(event.resource?.id||'') : '';
            const refunded=await pool.query(
                `UPDATE chad_sponsor_orders
                 SET status='refunded',paypal_refund_id=COALESCE(NULLIF($2,''),paypal_refund_id),refund_status=$3,refunded_at=COALESCE(refunded_at,NOW()),updated_at=NOW()
                 WHERE paypal_capture_id=$1
                 RETURNING campaign_id`,
                [captureId,refundId,event.event_type]
            );
            for(const row of refunded.rows){
                if(row.campaign_id) await pool.query(`UPDATE chad_sponsors SET is_active=FALSE,updated_at=NOW() WHERE campaign_id=$1`,[row.campaign_id]);
            }
        }
        return res.json({success:true});
    }catch(error){console.error("PayPal webhook error:",error);return res.status(500).json({success:false,error:"Webhook processing failed."});}
}

const sponsorUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 8 * 1024 * 1024,
        files: 2
    },
    fileFilter: (req, file, cb) => {
        const allowed = new Set([
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif",
            "application/pdf"
        ]);

        if (!allowed.has(String(file.mimetype || "").toLowerCase())) {
            return cb(new Error("Only JPG, PNG, WEBP, GIF, and PDF files are allowed."));
        }

        cb(null, true);
    }
});

function getSpacesConfig() {
    const endpoint = String(process.env.SPACES_ENDPOINT || "").trim();
    const region = String(process.env.SPACES_REGION || "").trim();
    const bucket = String(process.env.SPACES_BUCKET || "").trim();
    const key = String(process.env.SPACES_KEY || "").trim();
    const secret = String(process.env.SPACES_SECRET || "").trim();
    const cdnBase = String(process.env.SPACES_CDN_BASE || "").trim();

    if (!endpoint || !region || !bucket || !key || !secret) {
        return null;
    }

    return {
        endpoint,
        region,
        bucket,
        key,
        secret,
        cdnBase
    };
}

async function uploadSponsorFile(file, leadId, label) {
    if (!file) return "";

    const config = getSpacesConfig();

    if (!config) {
        throw new Error("Sponsor uploads are not configured yet.");
    }

    const extByMime = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
        "application/pdf": "pdf"
    };

    const ext = extByMime[String(file.mimetype || "").toLowerCase()] || "bin";
    const objectKey =
        `sponsor-leads/${leadId}/${label}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;

    const client = new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        credentials: {
            accessKeyId: config.key,
            secretAccessKey: config.secret
        },
        forcePathStyle: false
    });

    await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: "public-read",
        CacheControl: "public, max-age=31536000, immutable"
    }));

    if (config.cdnBase) {
        return config.cdnBase.replace(/\/+$/, "") + "/" + objectKey;
    }

    return config.endpoint.replace(/\/+$/, "") + "/" + config.bucket + "/" + objectKey;
}

function cleanLeadText(value, max = 500) {
    return String(value ?? "").trim().slice(0, max);
}

function cleanLeadDate(value) {
    const raw = cleanLeadText(value, 80);
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function validateLeadUrl(value, required = false) {
    const raw = cleanLeadText(value, 1000);

    if (!raw && !required) return "";
    if (!raw && required) return "A URL is required.";

    try {
        const url = new URL(raw);
        if (!["http:", "https:"].includes(url.protocol)) {
            return "Only http and https URLs are allowed.";
        }
    } catch {
        return "That URL is not valid.";
    }

    return "";
}

async function handleSponsorLeadSubmit(req, res) {
    try {
        const companyName = cleanLeadText(req.body?.company_name, 160);
        const contactName = cleanLeadText(req.body?.contact_name, 160);
        const email = cleanLeadText(req.body?.email, 240).toLowerCase();
        const website = cleanLeadText(req.body?.website, 1000);
        const campaignGoal = cleanLeadText(req.body?.campaign_goal, 800);
        const destinationUrl = cleanLeadText(req.body?.destination_url, 1000);
        const headline = cleanLeadText(req.body?.headline, 220);
        const adCopy = cleanLeadText(req.body?.ad_copy, 1000);
        const ctaText = cleanLeadText(req.body?.cta_text, 100);
        const preferredStart = cleanLeadDate(req.body?.preferred_start);
        const preferredEnd = cleanLeadDate(req.body?.preferred_end);
        const budget = cleanLeadText(req.body?.budget, 120);
        const notes = cleanLeadText(req.body?.notes, 3000);

        if (!companyName || !contactName || !email) {
            return res.status(400).json({
                success: false,
                error: "Company name, contact name, and email are required."
            });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                success: false,
                error: "Please enter a valid email address."
            });
        }

        const websiteError = validateLeadUrl(website, false);
        if (websiteError) {
            return res.status(400).json({
                success: false,
                error: "Website: " + websiteError
            });
        }

        const destinationError = validateLeadUrl(destinationUrl, false);
        if (destinationError) {
            return res.status(400).json({
                success: false,
                error: "Destination URL: " + destinationError
            });
        }

        if (
            preferredStart &&
            preferredEnd &&
            new Date(preferredEnd) <= new Date(preferredStart)
        ) {
            return res.status(400).json({
                success: false,
                error: "Preferred end date must be after the preferred start date."
            });
        }

        const leadId = crypto.randomUUID();

        const logoFile = req.files?.logo?.[0] || null;
        const creativeFile = req.files?.creative?.[0] || null;

        let logoUrl = "";
        let creativeUrl = "";

        if (logoFile || creativeFile) {
            [logoUrl, creativeUrl] = await Promise.all([
                uploadSponsorFile(logoFile, leadId, "logo"),
                uploadSponsorFile(creativeFile, leadId, "creative")
            ]);
        }

        await pool.query(
            `INSERT INTO chad_sponsor_leads (
                id,
                company_name,
                contact_name,
                email,
                website,
                campaign_goal,
                destination_url,
                headline,
                ad_copy,
                cta_text,
                preferred_start,
                preferred_end,
                budget,
                notes,
                logo_url,
                creative_url,
                status
             )
             VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'new'
             )`,
            [
                leadId,
                companyName,
                contactName,
                email,
                website,
                campaignGoal,
                destinationUrl,
                headline,
                adCopy,
                ctaText,
                preferredStart,
                preferredEnd,
                budget,
                notes,
                logoUrl,
                creativeUrl
            ]
        );

        return res.status(201).json({
            success: true,
            lead_id: leadId,
            message: "Thanks — your sponsor request has been sent to Chad's people."
        });
    } catch (error) {
        console.error("Sponsor lead submit error:", error);

        const message =
            error?.message === "Sponsor uploads are not configured yet."
                ? "Your form is ready, but file uploads are not enabled yet. Remove the attachments and submit again, or try again after uploads are enabled."
                : (error?.message || "Could not submit sponsor request.");

        return res.status(500).json({
            success: false,
            error: message
        });
    }
}

async function handleAdminSponsorLeads(req, res) {
    try {
        if (!isAdminTestRequest(req)) {
            return res.status(401).json({ success: false, error: "Admin key required." });
        }

        const result = await pool.query(
            `SELECT *
             FROM chad_sponsor_leads
             ORDER BY
                CASE status
                    WHEN 'new' THEN 0
                    WHEN 'contacted' THEN 1
                    WHEN 'approved' THEN 2
                    WHEN 'declined' THEN 3
                    ELSE 4
                END,
                created_at DESC`
        );

        return res.json({
            success: true,
            leads: result.rows
        });
    } catch (error) {
        console.error("Sponsor leads load error:", error);
        return res.status(500).json({
            success: false,
            error: "Could not load sponsor leads."
        });
    }
}

async function handleAdminSponsorLeadStatus(req, res) {
    try {
        if (!isAdminTestRequest(req)) {
            return res.status(401).json({ success: false, error: "Admin key required." });
        }

        const id = cleanLeadText(req.body?.id, 100);
        const status = cleanLeadText(req.body?.status, 40).toLowerCase();
        const allowed = new Set(["new", "contacted", "approved", "declined"]);

        if (!id || !allowed.has(status)) {
            return res.status(400).json({
                success: false,
                error: "Valid lead ID and status are required."
            });
        }

        const result = await pool.query(
            `UPDATE chad_sponsor_leads
             SET status = $2, updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [id, status]
        );

        if (!result.rowCount) {
            return res.status(404).json({
                success: false,
                error: "Sponsor lead not found."
            });
        }

        return res.json({
            success: true,
            lead: result.rows[0]
        });
    } catch (error) {
        console.error("Sponsor lead status error:", error);
        return res.status(500).json({
            success: false,
            error: "Could not update sponsor lead."
        });
    }
}

async function handleAdminSponsorLeadDelete(req, res) {
    try {
        if (!isAdminTestRequest(req)) {
            return res.status(401).json({ success: false, error: "Admin key required." });
        }

        const id = cleanLeadText(req.body?.id, 100);

        if (!id) {
            return res.status(400).json({
                success: false,
                error: "Lead ID is required."
            });
        }

        const result = await pool.query(
            `DELETE FROM chad_sponsor_leads
             WHERE id = $1
             RETURNING id`,
            [id]
        );

        if (!result.rowCount) {
            return res.status(404).json({
                success: false,
                error: "Sponsor lead not found."
            });
        }

        return res.json({
            success: true,
            deleted_id: id
        });
    } catch (error) {
        console.error("Sponsor lead delete error:", error);
        return res.status(500).json({
            success: false,
            error: "Could not delete sponsor lead."
        });
    }
}


function sanitizeSponsorInput(body = {}) {
    const clean = value => String(value ?? "").trim();

    const campaignId = clean(body.campaign_id)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120);

    const advertiser = clean(body.advertiser).slice(0, 120);
    const headline = clean(body.headline).slice(0, 180);
    const textBody = clean(body.body).slice(0, 500);
    const cta = clean(body.cta || "Learn more →").slice(0, 80);
    const destinationUrl = clean(body.destination_url).slice(0, 1000);
    const imageUrl = clean(body.image_url).slice(0, 1000);
    const discountCode = clean(body.discount_code).slice(0, 80);

    const discountPercentRaw =
        body.discount_percent === '' ||
        body.discount_percent === null ||
        body.discount_percent === undefined
            ? null
            : Number(body.discount_percent);

    const discountPercent =
        Number.isFinite(discountPercentRaw)
            ? Math.round(discountPercentRaw * 100) / 100
            : null;

    const priorityRaw = Number(body.priority);
    const priority = Number.isFinite(priorityRaw)
        ? Math.max(0, Math.min(10000, Math.trunc(priorityRaw)))
        : 100;

    const isActive = body.is_active !== false &&
        String(body.is_active).toLowerCase() !== "false";

    const parseOptionalDate = value => {
        const raw = clean(value);
        if (!raw) return null;
        const date = new Date(raw);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };

    return {
        campaign_id: campaignId,
        advertiser,
        headline,
        body: textBody,
        cta,
        destination_url: destinationUrl,
        image_url: imageUrl,
        discount_code: discountCode,
        discount_percent: discountPercent,
        starts_at: parseOptionalDate(body.starts_at),
        ends_at: parseOptionalDate(body.ends_at),
        is_active: isActive,
        priority
    };
}

function validateSponsorInput(sponsor) {
    if (!sponsor.campaign_id) return "Campaign ID is required.";
    if (!sponsor.advertiser) return "Advertiser is required.";
    if (!sponsor.headline) return "Headline is required.";
    if (!sponsor.destination_url) return "Destination URL is required.";

    try {
        const url = new URL(sponsor.destination_url);
        if (!["http:", "https:"].includes(url.protocol)) {
            return "Destination URL must use http or https.";
        }
    } catch {
        return "Destination URL is not valid.";
    }

    if (sponsor.image_url) {
        try {
            const image = new URL(sponsor.image_url);
            if (!["http:", "https:"].includes(image.protocol)) {
                return "Image URL must use http or https.";
            }
        } catch {
            return "Image URL is not valid.";
        }
    }

    if (
        sponsor.discount_percent !== null &&
        (
            !Number.isFinite(Number(sponsor.discount_percent)) ||
            Number(sponsor.discount_percent) <= 0 ||
            Number(sponsor.discount_percent) > 100
        )
    ) {
        return "Discount percent must be greater than 0 and no more than 100.";
    }

    if (
        sponsor.starts_at &&
        sponsor.ends_at &&
        new Date(sponsor.ends_at) <= new Date(sponsor.starts_at)
    ) {
        return "End date must be after start date.";
    }

    return "";
}

async function handlePublicSponsorCurrent(req, res) {
    try {
        /*
         * SPONSOR DECK
         *
         * Direct sponsors are returned as a rotation deck.
         * The frontend rotates them with the Chad house ad.
         *
         * Google AdSense is returned separately and is intentionally
         * NOT included in the timed rotation. Google policy does not
         * allow publishers to auto-refresh/rotate AdSense placements.
         */
        const sponsorsResult = await pool.query(
            `WITH eligible AS (
                SELECT
                    id,
                    campaign_id,
                    advertiser,
                    headline,
                    body,
                    cta,
                    destination_url,
                    image_url,
                    discount_code,
                    discount_percent,
                    starts_at,
                    ends_at,
                    priority
                FROM chad_sponsors
                WHERE is_active = TRUE
                  AND (starts_at IS NULL OR starts_at <= NOW())
                  AND (ends_at IS NULL OR ends_at > NOW())
             ),
             impression_counts AS (
                SELECT
                    metadata->>'campaign_id' AS campaign_id,
                    COUNT(*)::bigint AS impressions
                FROM chad_analytics
                WHERE event = 'sponsor_impression'
                  AND metadata->>'sponsor_mode' = 'direct'
                GROUP BY metadata->>'campaign_id'
             )
             SELECT
                e.*,
                COALESCE(i.impressions, 0)::bigint AS impressions
             FROM eligible e
             LEFT JOIN impression_counts i
               ON i.campaign_id = e.campaign_id
             ORDER BY
                e.priority ASC,
                COALESCE(i.impressions, 0) ASC,
                RANDOM()`
        );

        const sponsors = sponsorsResult.rows.map(row => ({
            id: row.id,
            campaign_id: row.campaign_id,
            advertiser: row.advertiser,
            headline: row.headline,
            body: row.body || "",
            cta: row.cta || "Learn more →",
            url: row.destination_url,
            image_url: row.image_url || "",
            discount_code: row.discount_code || "",
            discount_percent:
                row.discount_percent === null || row.discount_percent === undefined
                    ? null
                    : Number(row.discount_percent),
            placement: "above_chat",
            mode: "direct"
        }));

        const settingsResult = await pool.query(
            `SELECT
                google_enabled,
                google_client,
                google_slot
             FROM chad_ad_settings
             WHERE settings_key = 'default'
             LIMIT 1`
        );

        const settings = settingsResult.rows[0] || {};

        let google = null;

        if (
            settings.google_enabled === true &&
            /^ca-pub-\d{10,30}$/.test(String(settings.google_client || "").trim()) &&
            /^\d{5,30}$/.test(String(settings.google_slot || "").trim())
        ) {
            google = {
                client: String(settings.google_client).trim(),
                slot: String(settings.google_slot).trim(),
                format: "auto",
                responsive: true,
                placement: "above_chat"
            };
        }

        return res.json({
            success: true,
            source: "deck",
            sponsors,
            google,
            rotation_ms: 8000,
            include_house: true
        });

    } catch (error) {
        console.error("Sponsor current error:", error);

        return res.status(500).json({
            success: false,
            source: "deck",
            sponsors: [],
            google: null,
            rotation_ms: 8000,
            include_house: true
        });
    }
}

async function handleAdminSponsorList(req, res) {
    try {
        if (!isAdminTestRequest(req)) {
            return res.status(401).json({ success: false, error: "Admin key required." });
        }

        const result = await pool.query(
            `SELECT
                s.*,
                COALESCE(a.impressions, 0)::int AS impressions,
                COALESCE(a.clicks, 0)::int AS clicks
             FROM chad_sponsors s
             LEFT JOIN (
                SELECT
                    metadata->>'campaign_id' AS campaign_id,
                    COUNT(*) FILTER (WHERE event = 'sponsor_impression') AS impressions,
                    COUNT(*) FILTER (WHERE event = 'sponsor_click') AS clicks
                FROM chad_analytics
                WHERE event IN ('sponsor_impression','sponsor_click')
                GROUP BY metadata->>'campaign_id'
             ) a ON a.campaign_id = s.campaign_id
             ORDER BY s.is_active DESC, s.priority ASC, s.created_at DESC`
        );

        return res.json({
            success: true,
            sponsors: result.rows.map(row => ({
                ...row,
                ctr_percent: Number(row.impressions || 0)
                    ? Number(((Number(row.clicks || 0) / Number(row.impressions || 1)) * 100).toFixed(2))
                    : 0
            }))
        });
    } catch (error) {
        console.error("Sponsor list error:", error);
        return res.status(500).json({ success: false, error: "Could not load sponsors." });
    }
}

async function handleAdminSponsorCreate(req, res) {
    try {
        if (!isAdminTestRequest(req)) {
            return res.status(401).json({ success: false, error: "Admin key required." });
        }

        const sponsor = sanitizeSponsorInput(req.body || {});
        const validationError = validateSponsorInput(sponsor);
        if (validationError) {
            return res.status(400).json({ success: false, error: validationError });
        }

        const id = crypto.randomUUID();

        const result = await pool.query(
            `INSERT INTO chad_sponsors (
                id, campaign_id, advertiser, headline, body, cta,
                destination_url, image_url, discount_code, discount_percent,
                starts_at, ends_at, is_active, priority
             )
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             RETURNING *`,
            [
                id,
                sponsor.campaign_id,
                sponsor.advertiser,
                sponsor.headline,
                sponsor.body,
                sponsor.cta,
                sponsor.destination_url,
                sponsor.image_url,
                sponsor.discount_code,
                sponsor.discount_percent,
                sponsor.starts_at,
                sponsor.ends_at,
                sponsor.is_active,
                sponsor.priority
            ]
        );

        return res.status(201).json({
            success: true,
            sponsor: result.rows[0]
        });
    } catch (error) {
        if (error?.code === "23505") {
            return res.status(409).json({
                success: false,
                error: "That Campaign ID already exists."
            });
        }

        console.error("Sponsor create error:", error);
        return res.status(500).json({ success: false, error: "Could not create sponsor." });
    }
}

async function handleAdminSponsorUpdate(req, res) {
    try {
        if (!isAdminTestRequest(req)) {
            return res.status(401).json({ success: false, error: "Admin key required." });
        }

        const id = String(req.body?.id || "").trim();
        if (!id) {
            return res.status(400).json({ success: false, error: "Sponsor ID is required." });
        }

        const sponsor = sanitizeSponsorInput(req.body || {});
        const validationError = validateSponsorInput(sponsor);
        if (validationError) {
            return res.status(400).json({ success: false, error: validationError });
        }

        const result = await pool.query(
            `UPDATE chad_sponsors
             SET
                campaign_id = $2,
                advertiser = $3,
                headline = $4,
                body = $5,
                cta = $6,
                destination_url = $7,
                image_url = $8,
                discount_code = $9,
                discount_percent = $10,
                starts_at = $11,
                ends_at = $12,
                is_active = $13,
                priority = $14,
                updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [
                id,
                sponsor.campaign_id,
                sponsor.advertiser,
                sponsor.headline,
                sponsor.body,
                sponsor.cta,
                sponsor.destination_url,
                sponsor.image_url,
                sponsor.discount_code,
                sponsor.discount_percent,
                sponsor.starts_at,
                sponsor.ends_at,
                sponsor.is_active,
                sponsor.priority
            ]
        );

        if (!result.rowCount) {
            return res.status(404).json({ success: false, error: "Sponsor not found." });
        }

        return res.json({
            success: true,
            sponsor: result.rows[0]
        });
    } catch (error) {
        if (error?.code === "23505") {
            return res.status(409).json({
                success: false,
                error: "That Campaign ID already exists."
            });
        }

        console.error("Sponsor update error:", error);
        return res.status(500).json({ success: false, error: "Could not update sponsor." });
    }
}

async function handleAdminSponsorDelete(req, res) {
    try {
        if (!isAdminTestRequest(req)) {
            return res.status(401).json({ success: false, error: "Admin key required." });
        }

        const id = String(req.body?.id || "").trim();
        if (!id) {
            return res.status(400).json({ success: false, error: "Sponsor ID is required." });
        }

        const result = await pool.query(
            `DELETE FROM chad_sponsors WHERE id = $1 RETURNING id, campaign_id`,
            [id]
        );

        if (!result.rowCount) {
            return res.status(404).json({ success: false, error: "Sponsor not found." });
        }

        return res.json({
            success: true,
            deleted: result.rows[0]
        });
    } catch (error) {
        console.error("Sponsor delete error:", error);
        return res.status(500).json({ success: false, error: "Could not delete sponsor." });
    }
}



function sanitizeGoogleAdSettings(body = {}) {
    return {
        google_enabled:
            body.google_enabled === true ||
            String(body.google_enabled).toLowerCase() === "true",
        google_client: String(body.google_client || "").trim().slice(0, 80),
        google_slot: String(body.google_slot || "").trim().slice(0, 80)
    };
}

function validateGoogleAdSettings(settings) {
    if (!settings.google_enabled) return "";

    if (!/^ca-pub-\d{10,30}$/.test(settings.google_client)) {
        return "AdSense client must look like ca-pub-1234567890123456.";
    }

    if (!/^\d{5,30}$/.test(settings.google_slot)) {
        return "AdSense slot must be the numeric data-ad-slot value.";
    }

    return "";
}

async function handleAdminAdSettingsGet(req, res) {
    try {
        if (!isAdminTestRequest(req)) {
            return res.status(401).json({ success: false, error: "Admin key required." });
        }

        const result = await pool.query(
            `SELECT
                google_enabled,
                google_client,
                google_slot,
                updated_at
             FROM chad_ad_settings
             WHERE settings_key = 'default'
             LIMIT 1`
        );

        return res.json({
            success: true,
            settings: result.rows[0] || {
                google_enabled: false,
                google_client: "",
                google_slot: ""
            }
        });
    } catch (error) {
        console.error("Ad settings load error:", error);
        return res.status(500).json({
            success: false,
            error: "Could not load Google fallback settings."
        });
    }
}

async function handleAdminAdSettingsSave(req, res) {
    try {
        if (!isAdminTestRequest(req)) {
            return res.status(401).json({ success: false, error: "Admin key required." });
        }

        const settings = sanitizeGoogleAdSettings(req.body || {});
        const validationError = validateGoogleAdSettings(settings);

        if (validationError) {
            return res.status(400).json({
                success: false,
                error: validationError
            });
        }

        const result = await pool.query(
            `INSERT INTO chad_ad_settings (
                settings_key,
                google_enabled,
                google_client,
                google_slot,
                updated_at
             )
             VALUES ('default', $1, $2, $3, NOW())
             ON CONFLICT (settings_key)
             DO UPDATE SET
                google_enabled = EXCLUDED.google_enabled,
                google_client = EXCLUDED.google_client,
                google_slot = EXCLUDED.google_slot,
                updated_at = NOW()
             RETURNING
                google_enabled,
                google_client,
                google_slot,
                updated_at`,
            [
                settings.google_enabled,
                settings.google_client,
                settings.google_slot
            ]
        );

        return res.json({
            success: true,
            settings: result.rows[0]
        });
    } catch (error) {
        console.error("Ad settings save error:", error);
        return res.status(500).json({
            success: false,
            error: "Could not save Google fallback settings."
        });
    }
}



/*
 * ============================================================
 * CHADPDCHEE LIVE VOICE — GPT-LIVE-1 / WEBRTC
 * ============================================================
 * Browser microphone/audio travels directly over WebRTC.
 * The OpenAI API key never leaves this server.
 */
async function handleVoiceSession(req, res) {
    const adminTest = isAdminTestRequest(req);
    const user = await getAuthenticatedUser(req);

    // Production voice remains signed-in only.
    // The developer test page may bypass sign-in when a valid admin test key is supplied.
    if (!user && !adminTest) {
        return res.status(401).json({
            success: false,
            error: "Please sign in to use live voice chat."
        });
    }

    const voiceIdentity = user ? `user:${user.id}` : "admin-test";

    const sdp = typeof req.body?.sdp === "string" ? req.body.sdp.trim() : "";
    if (!sdp) {
        return res.status(400).json({ success: false, error: "A voice connection offer is required." });
    }
    if (sdp.length > 80_000) {
        return res.status(413).json({ success: false, error: "That voice connection request is too large." });
    }
    if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({ success: false, error: "Voice chat is not configured yet." });
    }

    const burstOk = await claimBurst("voice_session", voiceIdentity, adminTest ? 20 : 4, 60);
    if (!burstOk) {
        return res.status(429).json({
            success: false,
            error: "Easy there, chief. Give Chad a few seconds before starting another voice chat."
        });
    }

    let conversationId = getConversationIdFromRequest(req);
    let recentMemory = [];
    let walkthrough = null;

    try {
        if (conversationId && user) {
            // If this conversation began while signed out, claim it now.
            await pool.query(
                `UPDATE chad_conversations
                 SET user_id = $2, updated_at = NOW()
                 WHERE id = $1 AND user_id IS NULL`,
                [conversationId, user.id]
            );

            const owner = await pool.query(
                `SELECT id
                 FROM chad_conversations
                 WHERE id = $1 AND user_id = $2
                 LIMIT 1`,
                [conversationId, user.id]
            );

            if (!owner.rowCount) {
                conversationId = "";
            }
        } else if (conversationId && adminTest) {
            // Developer test mode can read the active test conversation without claiming it.
            const exists = await pool.query(
                `SELECT id FROM chad_conversations WHERE id = $1 LIMIT 1`,
                [conversationId]
            );
            if (!exists.rowCount) conversationId = "";
        }

        if (conversationId) {
            recentMemory = await loadConversationMemory(conversationId);

            const metaResult = await pool.query(
                `SELECT message_meta
                 FROM chad_messages
                 WHERE conversation_id = $1
                   AND role = 'assistant'
                 ORDER BY id DESC
                 LIMIT 1`,
                [conversationId]
            );

            const meta = metaResult.rows[0]?.message_meta || {};
            if (
                meta.walkthrough &&
                meta.walkthrough.offered === true &&
                Array.isArray(meta.walkthrough.steps) &&
                meta.walkthrough.steps.length
            ) {
                walkthrough = {
                    prompt: String(meta.walkthrough.prompt || ""),
                    steps: meta.walkthrough.steps
                        .map(step => String(step || "").trim())
                        .filter(Boolean)
                        .slice(0, 20)
                };
            }
        }
    } catch (error) {
        console.warn("Voice context load failed:", error.message);
        recentMemory = [];
        walkthrough = null;
    }

    const historyText = recentMemory.length
        ? recentMemory.map(item => `${item.role === "assistant" ? "CHAD" : "USER"}: ${item.content}`).join("\n")
        : "(No recent text-chat history is available.)";

    const walkthroughText = walkthrough?.steps?.length
        ? [
            "ACTIVE WALKTHROUGH FROM THE CURRENT CHAT:",
            ...walkthrough.steps.map((step, index) => `STEP ${index + 1}: ${step}`)
          ].join("\n")
        : "ACTIVE WALKTHROUGH: none.";

    const voiceInstructions = `
You are Chad from ChadPDChee, now speaking live with the user.

PERSONALITY:
- Chad is sarcastic, confident, mildly annoyed that the user needed help, and genuinely useful.
- Chad sounds like a blue-collar buddy who knows what he is doing.
- No swearing.
- Roast the situation, not the person.
- Do not overdo jokes. Clarity and usefulness win.
- Speak naturally. Usually answer in 1 to 3 spoken sentences unless more detail is needed.
- Do not read giant lists unless the user asks.
- Never claim you performed an action you cannot actually perform.

VOICE CONVERSATION:
- This is hands-free conversation. Respond naturally to interruptions and short phrases.
- If the user says "yes", "walk me through it", "guide me", or similar and an ACTIVE WALKTHROUGH exists, begin with Step 1.
- During an active walkthrough, understand "next", "next step", "I'm ready", "done", "repeat", "say that again", "back", "previous", "stop", "I'm good", and normal conversational variants.
- Give ONE walkthrough step at a time. Do not jump ahead unless asked.
- If the user asks a question about the current step, answer it, then remain on that step until they say they are ready.
- Important safety warnings in a walkthrough must never be skipped.
- If there is no active walkthrough and they ask to be walked through something, help conversationally but do not pretend hidden steps exist.
- If a task reaches a point where a reasonable DIYer should stop and use a qualified professional, say so clearly.

SAFETY:
- For electrical, gas, structural, vehicle-lifting, high-voltage, fire, or other hazardous work, prioritize safe isolation, verification, PPE, stable support, and professional help where appropriate.
- Never encourage bypassing safety devices or working live when de-energization is the safe approach.

RECENT TEXT CHAT:
${historyText}

${walkthroughText}
`.trim();

    try {
        /*
         * Use the established Realtime WebRTC call endpoint for the first
         * production voice rollout. GPT-Live-1 is brand new and its Live
         * session surface is still evolving; Realtime calls are documented
         * specifically for browser WebRTC SDP offer/answer negotiation.
         */
        // OpenAI's Realtime WebRTC call endpoint requires multipart/form-data:
        //   sdp     -> application/sdp
        //   session -> application/json
        // Do NOT set Content-Type manually; Node fetch adds the multipart boundary.
        const realtimeForm = new FormData();

        realtimeForm.append(
            "sdp",
            new Blob([sdp], { type: "application/sdp" }),
            "offer.sdp"
        );

        realtimeForm.append(
            "session",
            new Blob(
                [JSON.stringify({
                    type: "realtime",
                    model: "gpt-realtime-mini",
                    instructions: voiceInstructions
                })],
                { type: "application/json" }
            ),
            "session.json"
        );

        const openaiResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
                "OpenAI-Safety-Identifier": hashValue(user ? `voice-user:${user.id}` : "voice-admin-test").slice(0, 64)
            },
            body: realtimeForm
        });

        const raw = await openaiResponse.text();

        if (!openaiResponse.ok) {
            let data = {};
            try { data = raw ? JSON.parse(raw) : {}; } catch {}

            console.error("Realtime voice call creation failed:", openaiResponse.status, raw.slice(0, 2000));

            const upstreamMessage =
                data?.error?.message ||
                data?.message ||
                raw ||
                "";

            const upstreamCode =
                data?.error?.code ||
                data?.error?.type ||
                "";

            return res.status(
                openaiResponse.status >= 400 && openaiResponse.status < 600
                    ? openaiResponse.status
                    : 502
            ).json({
                success: false,
                error: adminTest && upstreamMessage
                    ? `Realtime ${openaiResponse.status}: ${String(upstreamMessage).slice(0, 800)}${upstreamCode ? ` (${upstreamCode})` : ""}`
                    : "Chad couldn't start voice mode. Try again in a moment."
            });
        }

        // /v1/realtime/calls returns the SDP answer as plain text.
        if (!raw || !raw.startsWith("v=")) {
            console.error("Realtime returned an unexpected SDP response:", raw.slice(0, 1000));
            return res.status(502).json({
                success: false,
                error: adminTest
                    ? `Realtime returned an unexpected response: ${raw.slice(0, 500)}`
                    : "Chad's voice connection came back incomplete."
            });
        }

        const location = openaiResponse.headers.get("location") || "";
        const sessionId = location.split("/").filter(Boolean).pop() || "realtime-webrtc";

        trackAnalyticsEvent(req, "voice_session_started", {
            authenticated: Boolean(user),
            admin_test_mode: adminTest,
            has_conversation: Boolean(conversationId),
            has_walkthrough: Boolean(walkthrough?.steps?.length),
            voice_transport: "webrtc",
            voice_model: "gpt-realtime-mini"
        }).catch(() => {});

        return res.status(201).json({
            success: true,
            session: { id: sessionId },
            transport: {
                type: "webrtc",
                sdp: raw
            },
            voice_model: "gpt-realtime-mini"
        });
    } catch (error) {
        console.error("Voice session error:", error);
        return res.status(502).json({
            success: false,
            error: "Chad couldn't open the voice line. Try again in a moment."
        });
    }
}

function registerBoth(method, path, ...handlers) {
    app[method](path, ...handlers);
    app[method](`/wp-json/chadpgt/v1${path}`, ...handlers);
}

app.get("/", (req, res) => {
    res.json({
        success: true,
        app: "CHADPDCHEE",
        version: "chad-core-25-sponsor-platform"
    });
});

app.get("/health", async (req, res) => {
    let databaseConnected = false;
    try {
        await pool.query("SELECT 1");
        databaseConnected = true;
    } catch {}

    res.json({
        success: true,
        status: databaseConnected ? "healthy" : "degraded",
        version: "chad-core-25-sponsor-platform",
        openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
        turnstileConfigured: Boolean(TURNSTILE_SECRET_KEY),
        databaseConfigured: Boolean(process.env.DATABASE_URL),
        databaseConnected,
        adminTestConfigured: Boolean(CHAD_ADMIN_TEST_KEY),
        accountsConfigured: true,
        emailDeliveryConfigured: Boolean(RESEND_API_KEY && CHAD_EMAIL_FROM),
        sponsorPlatformConfigured: true,
        sponsorPriceUsd: SPONSOR_PRICE_USD,
        sponsorMaxSlots: SPONSOR_MAX_ACTIVE_SLOTS,
        paypalConfigured: Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET),
        paypalEnvironment: PAYPAL_ENV,
        privacyPolicyVersion: PRIVACY_POLICY_VERSION,
        termsVersion: TERMS_VERSION,
        dailyLimit: DAILY_LIMIT,
        signedInDailyLimit: SIGNED_IN_DAILY_LIMIT,
        proDailyLimit: PRO_DAILY_LIMIT
    });
});

registerBoth("post", "/auth/signup", handleSignup);
registerBoth("post", "/auth/verify-email", handleVerifyEmail);
registerBoth("get", "/auth/verify-email", handleVerifyEmail);
registerBoth("post", "/auth/resend-verification", handleResendVerification);
registerBoth("post", "/auth/forgot-password", handleForgotPassword);
registerBoth("post", "/auth/reset-password", handleResetPassword);
registerBoth("post", "/admin/reset-quota", handleAdminResetQuota);
registerBoth("post", "/auth/login", handleLogin);
registerBoth("post", "/auth/logout", handleLogout);
registerBoth("get", "/auth/me", handleMe);
registerBoth("get", "/account/conversations", handleConversationList);
registerBoth("post", "/account/conversations/select", handleConversationSelect);
registerBoth("post", "/account/conversations/save", handleConversationSave);
registerBoth("post", "/account/conversations/share", handleConversationShare);
registerBoth("post", "/account/conversations/unshare", handleConversationUnshare);
app.get("/account/conversations/download", handleConversationDownload);
registerBoth("post", "/account/conversations/rename", handleConversationRename);
registerBoth("post", "/account/conversations/delete", handleConversationDelete);
registerBoth("get", "/account/conversations/messages", handleConversationMessages);
app.get("/share/:token", handlePublicConversationShare);
registerBoth("get", "/account/export", handleAccountExport);
registerBoth("post", "/account/delete", handleAccountDelete);

registerBoth("get", "/status", handleStatus);
registerBoth("get", "/chat-packs", handleChatPacks);
registerBoth("post", "/chat-packs/checkout/create", handleChatPackCheckoutCreate);
registerBoth("post", "/chat-packs/checkout/capture", handleChatPackCheckoutCapture);
registerBoth("get", "/account/chat-credits", handleChatCreditHistory);
registerBoth("post", "/pro/redeem", handleRedeemProCode);
registerBoth("post", "/admin/pro-codes/create", handleAdminCreateProCodes);
registerBoth("get", "/admin/pro-codes", handleAdminListProCodes);
registerBoth("post", "/admin/analytics/reset", handleAdminResetAnalytics);
registerBoth("post", "/voice/session", handleVoiceSession);
registerBoth("post", "/translate", handleTranslate);
registerBoth("post", "/ask", handleAsk);
registerBoth("post", "/shopping-list", handleShoppingList);
registerBoth("post", "/reset", handleReset);
registerBoth("post", "/analytics/track", handleAnalytics);
registerBoth("get", "/analytics/dashboard", handleAnalyticsDashboard);
registerBoth("get", "/sponsor/current", handlePublicSponsorCurrent);
registerBoth("get", "/admin/sponsors", handleAdminSponsorList);
registerBoth("post", "/admin/sponsors/create", handleAdminSponsorCreate);
registerBoth("post", "/admin/sponsors/update", handleAdminSponsorUpdate);
registerBoth("post", "/admin/sponsors/delete", handleAdminSponsorDelete);
registerBoth("get", "/admin/ad-settings", handleAdminAdSettingsGet);
registerBoth("post", "/admin/ad-settings", handleAdminAdSettingsSave);
registerBoth(
    "post",
    "/sponsor/lead",
    sponsorUpload.fields([
        { name: "logo", maxCount: 1 },
        { name: "creative", maxCount: 1 }
    ]),
    handleSponsorLeadSubmit
);
registerBoth("get", "/sponsor/availability", handleSponsorAvailability);
registerBoth("post", "/sponsor/checkout/create", handleSponsorCheckoutCreate);
registerBoth("post", "/sponsor/checkout/capture", handleSponsorCheckoutCapture);
registerBoth("post", "/sponsor/auth/login", handleSponsorLogin);
registerBoth("post", "/sponsor/auth/logout", handleSponsorLogout);
registerBoth("get", "/sponsor/auth/me", handleSponsorMe);
registerBoth("get", "/sponsor/dashboard", handleSponsorDashboard);
registerBoth("post", "/paypal/webhook", handlePayPalWebhook);
registerBoth("get", "/admin/sponsor-orders", handleAdminSponsorOrders);
registerBoth("get", "/admin/sponsor-orders/contract", handleAdminSponsorContract);
registerBoth("post", "/admin/sponsor-orders/approve", handleAdminSponsorOrderApprove);
registerBoth("post", "/admin/sponsor-orders/refund", handleAdminSponsorOrderRefund);
registerBoth("post", "/admin/sponsor-orders/cleanup-prelaunch-tests", handleAdminSponsorTestCleanup);
registerBoth("get", "/admin/sponsor-leads", handleAdminSponsorLeads);
registerBoth("post", "/admin/sponsor-leads/status", handleAdminSponsorLeadStatus);
registerBoth("post", "/admin/sponsor-leads/delete", handleAdminSponsorLeadDelete);


app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            error:
                error.code === "LIMIT_FILE_SIZE"
                    ? "Each uploaded file must be 8 MB or smaller."
                    : "Upload failed: " + error.message
        });
    }

    if (error && /Only JPG, PNG, WEBP, GIF, and PDF/.test(String(error.message || ""))) {
        return res.status(400).json({
            success: false,
            error: error.message
        });
    }

    next(error);
});

app.get("/openai-test", async (req, res) => {
    try {
        const data = await callOpenAI({
            model: MODEL,
            input: "Reply with exactly: CHAD ONLINE",
            max_output_tokens: 20
        }, 15000, "openai_test");

        return res.json({
            success: true,
            model: MODEL,
            message: getResponseText(data)
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || "OpenAI connection test failed."
        });
    }
});

async function startServer() {
    try {
        if (!process.env.DATABASE_URL) {
            throw new Error("DATABASE_URL is not configured.");
        }
        await initializeDatabase();

        app.listen(PORT, () => {
            console.log(`CHADPDCHEE listening on port ${PORT}`);
        });
    } catch (error) {
        console.error("Failed to start Chad:", error);
        process.exit(1);
    }
}

startServer();
