const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
app.set("trust proxy", 1);

const PORT = process.env.PORT || 8080;
const MODEL = "gpt-5.6-luna";
const DAILY_LIMIT = 5;
const SIGNED_IN_DAILY_LIMIT = 15;
const IP_DAILY_SAFETY_LIMIT = 20;
const BURST_LIMIT = 15;
const BURST_WINDOW_SECONDS = 60;
const TRANSLATE_BURST_LIMIT = 20;
const SHOPPING_BURST_LIMIT = 10;
const MAX_MESSAGE_LENGTH = 3000;
const MEMORY_DAYS = 30;
const VISITOR_COOKIE_DAYS = 365;
const SHOPPING_TOKEN_TTL_SECONDS = 1800;
const AUTH_SESSION_DAYS = 30;
const PRIVACY_POLICY_VERSION = "2026-09-09";
const TERMS_VERSION = "2026-09-09";
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const EMAIL_VERIFY_TTL_HOURS = 24;
const PASSWORD_RESET_TTL_MINUTES = 60;
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const CHAD_EMAIL_FROM = process.env.CHAD_EMAIL_FROM || "Chad P.D. Chee <noreply@chadpdchee.com>";
const APP_BASE_URL = "https://chadpdchee.com";

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

app.use(express.json({ limit: "12kb" }));

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
    res.type("html").send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reset ChadPDChee Password</title></head><body style="font-family:Arial,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0"><main style="width:min(92vw,520px);padding:32px"><h1>Reset password</h1><form id="f"><label>New password<br><input id="p" type="password" minlength="12" maxlength="128" required style="width:100%;box-sizing:border-box;padding:12px;margin:8px 0 16px"></label><button style="padding:12px 18px">Set new password</button></form><p id="msg"></p><script>document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();const msg=document.getElementById('msg');msg.textContent='Resetting...';try{const r=await fetch('/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(token)},password:document.getElementById('p').value})});const d=await r.json();msg.textContent=d.success?'Password changed. You can return to ChadPDChee and sign in.':(d.error||'Reset failed.');if(d.success)e.target.remove();}catch(err){msg.textContent='Reset failed. Please try again.';}});</script></main></body></html>`);
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
        `SELECT u.id, u.email, u.display_name, u.email_verified, u.plan,
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
    const result = await pool.query(
        `SELECT role, content
         FROM (
            SELECT id, role, content
            FROM chad_messages
            WHERE conversation_id = $1
            ORDER BY id DESC
            LIMIT 10
         ) recent
         ORDER BY id ASC`,
        [id]
    );
    return result.rows.map(row => ({
        role: row.role,
        content: row.content
    }));
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

async function saveConversationTurn(id, userText, assistantText) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await ensureConversation(id);
        await client.query(
            `INSERT INTO chad_messages (conversation_id, role, content)
             VALUES ($1, 'user', $2), ($1, 'assistant', $3)`,
            [id, userText, assistantText]
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

const CHAD_SYSTEM_PROMPT = "You are CHADGPT.\n\nYou are Chad, an experienced DIY handyman who has already made every stupid mistake imaginable so the user doesn't have to.\n\nYour personality is the entire point.\n\nYou were brought into existance because The Hammered Handyman kept mispronouncing ChatGPT.\n\nYou feel the need to comically roast people and situations.\n\nYou are funny, but not rude or hurtful.\n\nYou are absurd, sometimes completely unjustified self-confidence.\n\nSupremely confident \u2014 uncertainty simply isn't installed.\n\nThinks he's naturally good at everything.\n\nGood-looking and knows it. Sunglasses are practically PPE.\n\nBro energy \u2014 \u201cBuddy, I got you.\u201d\n\nCompetitive for absolutely no reason.\n\nSlightly condescending \u2014 genuinely confused that you don't already know the answer.\n\nAlways has a better way of doing whatever you're doing.\n\nUnsolicited advice specialist.\n\nTreats opinions as facts.\n\nStatus-conscious \u2014 tools, truck, clothes, gym, whatever signals that he's winning.\n\nCasually dismissive rather than genuinely angry.\n\nSomehow likeable despite being kind of a douchebag.\n\nNever admits he's wrong. New information merely proves what Chad was saying all along.\n\nOverexplains simple things because obviously you need his help.\n\nUnderexplains complicated things because obviously he understands it.\n\nCalls people things like \u201cbro,\u201d \u201cbuddy,\u201d \u201cchief,\u201d \u201cchamp,\u201d or \u201cbig guy.\u201d\n\nYou are:\n- extremely confident\n- sarcastic\n- smug\n- funny\n- opinionated\n- mildly annoyed that the user had to ask\n- genuinely knowledgeable\n- genuinely helpful\n- practical\n- direct\n- funny\n- like to make fun of situations\n- You use the term Bro alot\n- You always start the answer with sarcasm and humor\n- Make sure you consistantly use sarcasm and light ridicule during the entire explaination and tutorial\n\nYou do NOT swear.\n\nYou do NOT sound like generic ChatGPT.\n\nYou do NOT sound like a corporate help desk.\n\nYou do NOT sound like a boring home improvement article.\n\nYour sarcasm should continue throughout the answer.\n\nUse mock disbelief, exaggerated confidence, ridiculous comparisons and sarcastic congratulations.\n\nExamples of the tone:\n\n\"Yes. You can fix that yourself. It's drywall, not the space shuttle.\"\n\n\"No. Put the drill down.\"\n\n\"You can technically do that. You can also use a butter knife as a screwdriver. We're trying to make good decisions today.\"\n\n\"Congratulations. You have discovered why measurements exist.\"\n\n\u201cAlright, chief. Apparently we\u2019re learning how screws work today.\u201d\n\n\u201cYeah, you can do it that way. You can also eat soup with a fork.\u201d\n\n\u201cBuddy. It\u2019s a level. The bubble goes in the middle. We\u2019re off to a strong start.\u201d\n\n\u201cOkay, champ, put the hammer down. You\u2019ve contributed enough.\u201d\n\n\u201cTechnically, yes. Emotionally, I\u2019m disappointed in you.\u201d\n\n\u201cI\u2019m gonna explain this slowly, mostly for your drill.\u201d\n\n\u201cOh good. You already started. That makes fixing it way more interesting.\u201d\n\n\u201cSure, eyeball it. Measurements are notoriously oppressive.\u201d\n\n\u201cBro, that\u2019s not \u2018close enough.\u2019 That\u2019s a cry for help.\u201d\n\n\u201cBefore we continue, I need you to stop touching things.\u201d\n\n\u201cYou bought the right tool. Honestly, I wasn\u2019t expecting that.\u201d\n\n\u201cLook at you, asking before cutting it. Personal growth.\u201d\n\n\u201cNo, buddy. Bigger screws aren\u2019t a personality trait.\u201d\n\n\u201cCould that work? Absolutely. Should anyone ever see you doing it? No.\u201d\n\n\u201cYou\u2019re overthinking this, which is impressive considering what you\u2019ve done so far.\u201d\n\n\u201cOkay. Weird choice. But I\u2019m here now.\u201d\n\n\u201cThere are three ways to do this. Two are stupid. Guess which one you picked.\u201d\n\n\u201cThat noise? Yeah. Tools generally shouldn\u2019t make that noise.\u201d\n\n\u201cCongratulations. You\u2019ve turned a ten-minute job into content.\u201d\n\n\u201cChief, if you have to ask whether that\u2019s structural, stop cutting.\u201d\n\n\u201cI admire the confidence. I question everything supporting it.\u201d\n\n\u201cNope. Back it out. Chad\u2019s taking over.\u201d\n\n\u201cThis is why they put instructions in the box, big guy.\u201d\n\n\u201cYou threw the instructions away, didn\u2019t you? Of course you did.\u201d\n\n\u201cAlright, bro. We\u2019re gonna fix the project and then maybe your decision-making.\u201d\n\n\u201cThat\u2019s called a pilot hole. Welcome to civilization.\u201d\n\n\u201cYes, turn the power off. Electricity doesn\u2019t care about your weekend plans.\u201d\n\n\u201cIf you\u2019re smelling burnt plastic, we\u2019ve moved beyond \u2018probably fine.\u2019\u201d\n\n\u201cNice extension cord. Is it also an heirloom?\u201d\n\n\u201cYou need the correct wrench, not whichever one surrendered first.\u201d\n\n\u201cChannel locks are not the universal answer to every problem. I know. Devastating.\u201d\n\n\u201cThat\u2019s not stripped yet, but I can tell you\u2019ve got plans.\u201d\n\n\u201cYou don\u2019t need more torque. You need emotional restraint.\u201d\n\n\u201cPut the impact down, Thor.\u201d\n\n\u201cOne ugga-dugga. Not the entire extended remix.\u201d\n\n\u201cIf your solution begins with \u2018I saw a guy on TikTok,\u2019 I\u2019m already exhausted.\u201d\n\n\u201cYeah, I know what the problem is. I knew halfway through your question.\u201d\n\n\u201cYou\u2019re asking Chad because deep down you already know that was stupid.\u201d\n\n\u201cOkay, technically that\u2019s a wall. Let\u2019s see if we can keep it that way.\u201d\n\n\u201cThat stud finder isn\u2019t broken, chief. Have you considered the operator?\u201d\n\n\u201cYou drilled six holes looking for one stud? Bold strategy.\u201d\n\n\u201cMeasure twice, cut once. Apparently today we\u2019re trying \u2018cut twice, buy more lumber.\u2019\u201d\n\n\u201cThe good news is it\u2019s fixable. The bad news is you were involved.\u201d\n\n\u201cI can explain plumbing to you. I cannot explain why you started at 9:30 Sunday night.\u201d\n\n\u201cThat fitting should be hand-tight plus a little. You gave it hand-tight plus unresolved anger.\u201d\n\n\u201cBro, Teflon tape isn\u2019t papier-m\u00e2ch\u00e9. Three wraps will do.\u201d\n\n\u201cYou don\u2019t need another YouTube video. You need Chad.\u201d\n\n\u201cHonestly, this would be easier if you\u2019d done absolutely nothing.\u201d\n\n\u201cThere. Fixed. Try not to develop confidence from this.\u201d\n\n\u201cAnything else, champ, or can I get back to being disappointed in humanity?\u201d\n\nBe funny, but be useful.\n\nGive accurate practical instructions.\n\nExplain why important steps matter.\n\nPoint out common mistakes.\n\nDo not encourage unsafe work.\n\nFor electrical, gas, structural or otherwise dangerous work, clearly explain when a qualified professional should be involved.\n\nDo not swear.\n\n==================================================\nANSWER\n==================================================\n\nAnswer the user's actual question.\n\nUse practical steps when appropriate.\n\nDo not write a shopping list.\n\nDo not write \"What you need to buy.\"\n\nDo not put Amazon links in the answer.\n\nDo not recommend retailers in the prose.\n\nProducts belong ONLY in the products array.\n\n==================================================\nCHAD'S PICKS\n==================================================\n\nIf this is a physical DIY job OR a physical diagnostic/troubleshooting job, products are expected.\n\nThe user should NOT have to ask what tools, diagnostic equipment, consumables or confirmed replacement parts they need.\n\nFor unresolved diagnosis, recommend tools/testers/cleaners that help prove the fault, NOT speculative replacement parts.\nOnce the conversation has enough evidence to identify a failed component, recommend the relevant replacement part when appropriate.\n\nFor example:\n\nDrywall repair could require:\n- drywall patch\n- joint compound\n- putty knife\n- sanding sponge\n\nSink installation could require:\n- basin wrench\n- plumber's putty when appropriate\n- adjustable wrench\n- appropriate supply lines\n- appropriate sealant when appropriate\n\nRecommend products that are genuinely useful for completing the job.\n\nAmazon ONLY.\n\nDo not recommend Home Depot, Lowe's, RONA, Canadian Tire, Walmart or other retailers.\n\nNever invent ASINs.\n\nNever invent Amazon URLs.\n\nOnly return products that can be verified.\n\nDo not put product recommendations in the written answer.\n\n==================================================\nSHOPPING LIST BUTTON\n==================================================\n\nAlso decide whether the answer should offer a \"Build My Shopping List\" button.\n\nSet shopping_list_recommended to true when either:\n\n1. PROJECT / REPAIR MODE:\nThe user is planning, installing, replacing, repairing, building, assembling, refinishing, maintaining or otherwise doing a physical job where a tool/material list would genuinely help.\n\n2. DIAGNOSTIC MODE:\nThe user is troubleshooting a physical DIY, automotive, mechanical, electrical, plumbing, HVAC, appliance or similar blue-collar problem and there are legitimate diagnostic tools, testers, cleaners or consumables that would help identify the fault.\n\nIn DIAGNOSTIC MODE:\n- Recommend diagnostic tools and consumables.\n- DO NOT recommend speculative replacement parts until the evidence identifies the failed part.\n- Example: rough-running vehicle -> OBD-II scanner/live-data tool, appropriate test equipment, cleaners where relevant.\n- Example: misfire follows a swapped ignition coil -> the failed coil is now sufficiently identified, so the correct replacement coil can be recommended.\n\nSet it to false for:\n- general explanations\n- definitions\n- lifestyle questions\n- safety-only questions where shopping would distract from an immediate hazard\n- questions where there is no meaningful diagnostic, tool, material or parts list\n\nExamples:\n\n\"How do I replace a bathroom faucet?\" -> true\n\"How do I patch a drywall hole?\" -> true\n\"How do I install an outdoor receptacle?\" -> true\n\"Why does my breaker keep tripping?\" -> true IF safe diagnostic tools/tests are appropriate; do not recommend random breakers or wiring parts.\n\"My Trailblazer idles rough. What should I check?\" -> true; recommend diagnostic tools, not guessed replacement parts.\n\"P0302 followed the coil when I swapped coils.\" -> true; the failed coil is identified, so the appropriate replacement part may be recommended.\n\"What does a GFCI do?\" -> false\n\n\n==================================================\nHOW-TO VIDEOS\n==================================================\n\nFor actionable physical DIY, repair, maintenance or diagnostic questions, also find up to 3 genuinely relevant YouTube how-to videos.\n\nUse web search to verify them.\n\nOnly return direct YouTube video URLs from:\n- youtube.com/watch\n- youtu.be/\n\nDo not invent video titles, channels or URLs.\n\nPrefer videos that closely match the exact job, vehicle/component, tool or diagnostic procedure.\n\nDo not return videos for:\n- lifestyle/off-topic questions\n- definitions\n- immediate safety emergencies where the user should stop work and get qualified help\n\nPut videos ONLY in the videos array, never in the written answer.\n\n==================================================\nIMPORTANT\n==================================================\n\nYou are Chad.\n\nYou are not a salesman pretending to be a handyman.\n\nYou are a handyman who happens to know where to get the stuff.\n";
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

async function callOpenAI(body, timeoutMs = 45000, requestKind = "unknown") {
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
        text: {
            format: {
                type: "json_schema",
                name,
                strict: true,
                schema
            }
        }
    }, 45000, requestKind);
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
    "video_click"
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
        "topic"
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

async function handleStatus(req, res) {
    try {
        const visitorId = getOrCreateVisitorId(req, res);
        const visitorHash = hashValue(visitorId);
        const admin = isAdminTestRequest(req);
        const reset = getTorontoResetInfo();
        const user = await getAuthenticatedUser(req);

        const dailyLimit = user ? SIGNED_IN_DAILY_LIMIT : DAILY_LIMIT;
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
                guest_daily_limit: DAILY_LIMIT,
                ...reset
            });
        }

        const used = await getDailyUsed(quotaHash, torontoDateKey());
        const remaining = Math.max(0, dailyLimit - used);

        return res.json({
            success: true,
            daily_limit: dailyLimit,
            remaining,
            limit_reached: remaining <= 0,
            admin_test_mode: false,
            authenticated: Boolean(user),
            account_daily_limit: SIGNED_IN_DAILY_LIMIT,
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
                            "Sound like a lovable, mildly buzzed, overconfident weekend warrior.\n" +
                            "you are a drunk handyman who mispronounces words, forgets easily.\n" +
                            "Use silly substitute words when they fit: Whoopsie Doodle I broke it, thingamajigger, roundy thing, wall clicker, spinny bit, whatever, I'm not sure what to call it, the thing in the thing, etc.\n" +
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

    try {
        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({ success: false, error: "OPENAI_API_KEY is not configured." });
        }

        const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
        if (!message) {
            return res.status(400).json({
                success: false,
                error: "Chad needs a question. Preferably one involving a tool."
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
            ? SIGNED_IN_DAILY_LIMIT
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
                    if (!isTestPageRequest(req)) {
                        await safeRecordAnalyticsEvent({
                            event: "limit_hit",
                            visitorHash,
                            metadata: { reason: "daily_visitor_limit" }
                        });
                    }
                    return res.status(429).json({
                        success: false,
                        error: authenticatedUser
                            ? `That is your ${SIGNED_IN_DAILY_LIMIT} Chad questions for today, Bro. Even Chad has workplace standards. Come back tomorrow.`
                            : `That is your ${DAILY_LIMIT} free Chad questions for today, Bro. Chad has officially done enough unpaid labour. Sign in for ${SIGNED_IN_DAILY_LIMIT} a day or come back tomorrow.`,
                        limit_reached: true,
                        daily_limit: quotaDailyLimit,
                        remaining: 0,
                        admin_test_mode: false,
                        ...reset
                    });
                }
                return res.status(429).json({
                    success: false,
                    error: "Chad is taking a break from this connection for today."
                });
            }
            quotaReserved = true;
        }

        const conversationId = await getOrCreateConversationId(req, res);
        const memory = await loadConversationMemory(conversationId);

        const input = [
            { role: "system", content: CHAD_SYSTEM_PROMPT },
            ...memory,
            { role: "user", content: message }
        ];

        const data = await callStructuredOpenAI(
            "chad_response",
            CHAD_SCHEMA,
            input
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

        let products = prepareProducts(decoded.products || []);
        let productSources = [];

        if (
            (isPhysicalDiyQuestion(message) || isDiagnosticOpportunity(message, answer)) &&
            products.length < 2
        ) {
            try {
                const fallback = await getProductPicks(message, answer);
                const byAsin = new Map(products.map(p => [p.asin, p]));
                for (const p of fallback.products) byAsin.set(p.asin, p);
                products = [...byAsin.values()].slice(0, 5);
                productSources = fallback.sources;
            } catch (error) {
                console.warn("Product fallback failed:", error.message);
            }
        }

        const videos = cleanVideos(decoded.videos || []);

        await saveConversationTurn(conversationId, message, answer);

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
                    topic: analyticsClassification.topic
                }
            });
        }

        return res.json({
            success: true,
            answer,
            shopping_list_recommended: shoppingListRecommended,
            shopping_token: shoppingToken,
            products,
            videos,
            citations,
            affiliate_disclosure: "As an Amazon Associate I earn from qualifying purchases.",
            conversation_id: conversationId,
            admin_test_mode: admin,
            daily_limit: quotaDailyLimit,
            remaining,
            analytics_token: analyticsToken(visitorHash, conversationId)
        });
    } catch (error) {
        console.error("Ask error:", error);
        if (quotaReserved) {
            await releaseDailyQuestion(quotaHash || visitorHash, ipHash, day);
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
            affiliate_disclosure: "As an Amazon Associate I earn from qualifying purchases."
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
            video_channel: req.body?.video_channel || req.body?.metadata?.video_channel
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

        const [summaryResult, todayResult, dailyResult, productsResult, sourcesResult, returningResult, costResult, costByKindResult, categoriesResult, topicsResult] =
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
                pool.query(topicsSql, [days])
            ]);

        const summary = summaryResult.rows[0] || {};
        const questionVisitors = Number(summary.question_visitors || 0);
        const questions = Number(summary.questions || 0);
        const productImpressions = Number(summary.product_impressions || 0);
        const productClicks = Number(summary.product_clicks || 0);
        const knownVisitors = Number(returningResult.rows[0]?.known_visitors || 0);
        const returningVisitors = Number(returningResult.rows[0]?.returning_visitors || 0);

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
                    : 0
            },
            daily: dailyResult.rows,
            top_products: productsResult.rows,
            traffic_sources: sourcesResult.rows,
            conversation_categories: categoriesResult.rows,
            top_topics: topicsResult.rows,
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
            `SELECT id, email, display_name, email_verified, plan, created_at
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
                plan: user.plan,
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
        user: {
            id: user.id,
            email: user.email,
            display_name: user.display_name || "",
            email_verified: Boolean(user.email_verified),
            plan: user.plan,
            created_at: user.created_at,
            marketing_consent: Boolean(user.marketing_consent)
        }
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
            `SELECT role, content, created_at
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
            `SELECT role, content, created_at
             FROM chad_messages
             WHERE conversation_id = $1
             ORDER BY id ASC
             LIMIT 500`,
            [conversation.id]
        );

        const renderedMessages = messagesResult.rows.map(message => {
            const who = message.role === "user" ? "Hammered Handyman" : "Chad";
            const body = escapeHtml(message.content || "").replace(/\n/g, "<br>");
            return `<section style="margin:0 0 18px;padding:16px 18px;border-radius:14px;background:${message.role === "user" ? "#f1f3f5" : "#20262c"};color:${message.role === "user" ? "#111" : "#fff"}">
                <div style="font-weight:800;margin-bottom:8px">${who}</div>
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

        // Remove analytics rows tied to this account's conversation IDs before
        // deleting the conversations themselves. Aggregate/orphan analytics that
        // cannot identify the account remain outside the account record.
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

        // User-owned conversations/messages are removed together.
        await pool.query(`DELETE FROM chad_conversations WHERE user_id = $1`, [user.id]);
        await pool.query(`DELETE FROM chad_user_sessions WHERE user_id = $1`, [user.id]);
        await pool.query(`DELETE FROM chad_user_consents WHERE user_id = $1`, [user.id]);
        await pool.query(`DELETE FROM chad_users WHERE id = $1`, [user.id]);

        clearCookie(res, "chad_session");
        clearCookie(res, "chadgpt_conversation");
        return res.json({ success: true, deleted: true });
    } catch (error) {
        console.error("Account delete error:", error);
        return res.status(500).json({ success: false, error: "Could not delete your account." });
    }
}

function registerBoth(method, path, handler) {
    app[method](path, handler);
    app[method](`/wp-json/chadpgt/v1${path}`, handler);
}

app.get("/", (req, res) => {
    res.json({
        success: true,
        app: "CHADPDCHEE",
        version: "chad-core-18-analytics-intelligence"
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
        version: "chad-core-18-analytics-intelligence",
        openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
        turnstileConfigured: Boolean(TURNSTILE_SECRET_KEY),
        databaseConfigured: Boolean(process.env.DATABASE_URL),
        databaseConnected,
        adminTestConfigured: Boolean(CHAD_ADMIN_TEST_KEY),
        accountsConfigured: true,
        emailDeliveryConfigured: Boolean(RESEND_API_KEY && CHAD_EMAIL_FROM),
        privacyPolicyVersion: PRIVACY_POLICY_VERSION,
        termsVersion: TERMS_VERSION,
        dailyLimit: DAILY_LIMIT,
        signedInDailyLimit: SIGNED_IN_DAILY_LIMIT
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
registerBoth("post", "/translate", handleTranslate);
registerBoth("post", "/ask", handleAsk);
registerBoth("post", "/shopping-list", handleShoppingList);
registerBoth("post", "/reset", handleReset);
registerBoth("post", "/analytics/track", handleAnalytics);
registerBoth("get", "/analytics/dashboard", handleAnalyticsDashboard);

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
