const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");

const TURNSTILE_SECRET_KEY =
    process.env.TURNSTILE_SECRET_KEY || "";

const app = express();

app.use(express.json({ limit: "12kb" }));

// ============================================================
// CORS / BROWSER ORIGIN PROTECTION
// ============================================================

app.use((req, res, next) => {

    const origin =
        typeof req.headers.origin === "string"
            ? req.headers.origin
            : "";

    if (origin && ALLOWED_ORIGINS.has(origin)) {

        res.setHeader(
            "Access-Control-Allow-Origin",
            origin
        );

        res.setHeader(
            "Vary",
            "Origin"
        );

        res.setHeader(
            "Access-Control-Allow-Headers",
            "Content-Type"
        );

        res.setHeader(
            "Access-Control-Allow-Methods",
            "GET,POST,OPTIONS"
        );
    }

    if (
        req.method === "OPTIONS"
    ) {

        if (
            origin &&
            !ALLOWED_ORIGINS.has(origin)
        ) {

            return res.sendStatus(403);
        }

        return res.sendStatus(204);
    }

    if (
        origin &&
        !ALLOWED_ORIGINS.has(origin)
    ) {

        return res
            .status(403)
            .json({
                success: false,
                error:
                    "This browser origin is not allowed to use Chad."
            });
    }

    next();
});

app.use(express.static("public"));

const PORT =
    process.env.PORT || 8080;

const MODEL =
    "gpt-5.6-luna";

const DAILY_LIMIT =
    5;

const SHOPPING_TOKEN_TTL_MINUTES =
    30;

const ALLOWED_ORIGINS =
    new Set([
        "https://hammeredhandyman.com",
        "https://www.hammeredhandyman.com",
        "https://seal-app-zgkfc.ondigitalocean.app"
    ]);

const AMAZON_TAG =
    "hammeredhandy-20";


// ============================================================
// POSTGRESQL DATABASE
// ============================================================

const databaseUrl =
    process.env.DATABASE_URL
        ? process.env.DATABASE_URL
            .replace(/[?&]sslmode=[^&]*/i, "")
            .replace(/\?$/, "")
        : "";


const pool =
    new Pool({

        connectionString:
            databaseUrl,

        ssl: {
            rejectUnauthorized: false
        }
    });


// ============================================================
// DATABASE INITIALIZATION
// ============================================================

async function initializeDatabase() {

    if (!process.env.DATABASE_URL) {

        console.error(
            "DATABASE_URL is not configured."
        );

        return;
    }


    try {

        await pool.query(`
            CREATE TABLE IF NOT EXISTS chad_conversations (
                id UUID PRIMARY KEY,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);


        await pool.query(`
            CREATE TABLE IF NOT EXISTS chad_messages (
                id BIGSERIAL PRIMARY KEY,
                conversation_id UUID NOT NULL
                    REFERENCES chad_conversations(id)
                    ON DELETE CASCADE,
                role VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);


        await pool.query(`
            CREATE INDEX IF NOT EXISTS
            idx_chad_messages_conversation
            ON chad_messages(conversation_id, id)
        `);


        await pool.query(`
            CREATE TABLE IF NOT EXISTS chad_daily_usage (
                visitor_hash VARCHAR(64) NOT NULL,
                usage_date DATE NOT NULL,
                question_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (
                    visitor_hash,
                    usage_date
                )
            )
        `);


        await pool.query(`
            CREATE INDEX IF NOT EXISTS
            idx_chad_daily_usage_date
            ON chad_daily_usage(usage_date)
        `);


        await pool.query(`
            CREATE TABLE IF NOT EXISTS chad_shopping_tokens (
                token_hash VARCHAR(64) PRIMARY KEY,
                conversation_id UUID NOT NULL
                    REFERENCES chad_conversations(id)
                    ON DELETE CASCADE,
                question TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                consumed_at TIMESTAMPTZ NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);


        await pool.query(`
            CREATE INDEX IF NOT EXISTS
            idx_chad_shopping_tokens_expires
            ON chad_shopping_tokens(expires_at)
        `);


        console.log(
            "CHADPDG database connected and ready."
        );


    } catch (error) {

        console.error(
            "CHADPDG database initialization failed:",
            error
        );
    }
}


// ============================================================
// CONVERSATION HELPERS
// ============================================================

function newConversationId() {

    return crypto.randomUUID();
}


async function ensureConversation(
    conversationId
) {

    await pool.query(
        `
        INSERT INTO chad_conversations (id)
        VALUES ($1)
        ON CONFLICT (id) DO NOTHING
        `,
        [conversationId]
    );
}


async function conversationExists(
    conversationId
) {

    const result =
        await pool.query(
            `
            SELECT id
            FROM chad_conversations
            WHERE id = $1
            LIMIT 1
            `,
            [conversationId]
        );


    return result.rowCount > 0;
}


async function loadConversationMemory(
    conversationId,
    limit = 10
) {

    const result =
        await pool.query(
            `
            SELECT role, content
            FROM (
                SELECT
                    id,
                    role,
                    content
                FROM chad_messages
                WHERE conversation_id = $1
                ORDER BY id DESC
                LIMIT $2
            ) recent_messages
            ORDER BY id ASC
            `,
            [
                conversationId,
                limit
            ]
        );


    return result.rows.map(
        row => ({
            role:
                row.role,

            content:
                row.content
        })
    );
}


async function saveConversationTurn(
    conversationId,
    userMessage,
    assistantMessage
) {

    const client =
        await pool.connect();


    try {

        await client.query(
            "BEGIN"
        );


        await client.query(
            `
            INSERT INTO chad_conversations (id)
            VALUES ($1)
            ON CONFLICT (id) DO NOTHING
            `,
            [conversationId]
        );


        await client.query(
            `
            INSERT INTO chad_messages (
                conversation_id,
                role,
                content
            )
            VALUES ($1, 'user', $2)
            `,
            [
                conversationId,
                userMessage
            ]
        );


        await client.query(
            `
            INSERT INTO chad_messages (
                conversation_id,
                role,
                content
            )
            VALUES ($1, 'assistant', $2)
            `,
            [
                conversationId,
                assistantMessage
            ]
        );


        await client.query(
            `
            UPDATE chad_conversations
            SET updated_at = NOW()
            WHERE id = $1
            `,
            [conversationId]
        );


        await client.query(
            "COMMIT"
        );


    } catch (error) {

        await client.query(
            "ROLLBACK"
        );

        throw error;


    } finally {

        client.release();
    }
}


// ============================================================
// VISITOR / DAILY QUOTA HELPERS
// ============================================================

function validVisitorId(
    visitorId
) {

    if (
        typeof visitorId !== "string"
    ) {
        return false;
    }


    const trimmed =
        visitorId.trim();


    if (
        trimmed.length < 16 ||
        trimmed.length > 128
    ) {
        return false;
    }


    return /^[a-zA-Z0-9_-]+$/.test(
        trimmed
    );
}


function hashVisitorId(
    visitorId
) {

    return crypto
        .createHash("sha256")
        .update(visitorId)
        .digest("hex");
}


function getVisitorIdFromRequest(
    req
) {

    const bodyVisitor =
        typeof req.body?.visitor_id === "string"
            ? req.body.visitor_id.trim()
            : "";


    if (bodyVisitor) {
        return bodyVisitor;
    }


    const legacyAnalyticsVisitor =
        typeof req.body?.analytics_visitor === "string"
            ? req.body.analytics_visitor.trim()
            : "";


    if (legacyAnalyticsVisitor) {
        return legacyAnalyticsVisitor;
    }


    const queryVisitor =
        typeof req.query?.visitor_id === "string"
            ? req.query.visitor_id.trim()
            : "";


    if (queryVisitor) {
        return queryVisitor;
    }


    const queryAnalyticsVisitor =
        typeof req.query?.analytics_visitor === "string"
            ? req.query.analytics_visitor.trim()
            : "";


    return queryAnalyticsVisitor;
}


async function getDailyQuestionCount(
    visitorHash
) {

    const result =
        await pool.query(
            `
            SELECT question_count
            FROM chad_daily_usage
            WHERE visitor_hash = $1
              AND usage_date =
                  (NOW() AT TIME ZONE 'UTC')::date
            LIMIT 1
            `,
            [visitorHash]
        );


    if (!result.rowCount) {
        return 0;
    }


    return Number(
        result.rows[0].question_count
    ) || 0;
}


async function getRemainingQuestions(
    visitorHash
) {

    const used =
        await getDailyQuestionCount(
            visitorHash
        );


    return Math.max(
        0,
        DAILY_LIMIT - used
    );
}


async function claimDailyQuestion(
    visitorHash
) {

    const result =
        await pool.query(
            `
            INSERT INTO chad_daily_usage (
                visitor_hash,
                usage_date,
                question_count
            )
            VALUES (
                $1,
                (NOW() AT TIME ZONE 'UTC')::date,
                1
            )

            ON CONFLICT (
                visitor_hash,
                usage_date
            )

            DO UPDATE SET
                question_count =
                    chad_daily_usage.question_count + 1,
                updated_at =
                    NOW()

            WHERE
                chad_daily_usage.question_count < $2

            RETURNING
                question_count
            `,
            [
                visitorHash,
                DAILY_LIMIT
            ]
        );


    if (!result.rowCount) {

        return {
            allowed: false,
            used: DAILY_LIMIT,
            remaining: 0
        };
    }


    const used =
        Number(
            result.rows[0].question_count
        ) || 0;


    return {
        allowed: true,

        used,

        remaining:
            Math.max(
                0,
                DAILY_LIMIT - used
            )
    };
}


async function releaseDailyQuestion(
    visitorHash
) {

    try {

        await pool.query(
            `
            UPDATE chad_daily_usage
            SET
                question_count =
                    GREATEST(
                        question_count - 1,
                        0
                    ),
                updated_at =
                    NOW()
            WHERE visitor_hash = $1
              AND usage_date =
                  (NOW() AT TIME ZONE 'UTC')::date
            `,
            [visitorHash]
        );


    } catch (error) {

        console.error(
            "Failed to refund Chad question:",
            error
        );
    }
}


// ============================================================
// CLOUDFLARE TURNSTILE VERIFICATION
// ============================================================

async function verifyTurnstile(
    token,
    remoteIp = ""
) {

    if (!TURNSTILE_SECRET_KEY) {

        console.error(
            "TURNSTILE_SECRET_KEY is not configured."
        );

        return false;
    }


    if (
        !token ||
        typeof token !== "string"
    ) {

        return false;
    }


    try {

        const formData =
            new URLSearchParams();


        formData.append(
            "secret",
            TURNSTILE_SECRET_KEY
        );


        formData.append(
            "response",
            token
        );


        if (remoteIp) {

            formData.append(
                "remoteip",
                remoteIp
            );
        }


        const response =
            await fetch(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                {

                    method:
                        "POST",

                    headers: {
                        "Content-Type":
                            "application/x-www-form-urlencoded"
                    },

                    body:
                        formData.toString()
                }
            );


        if (!response.ok) {

            console.error(
                "Turnstile verification HTTP error:",
                response.status
            );

            return false;
        }


        const result =
            await response.json();


        if (!result.success) {

            console.warn(
                "Turnstile verification failed:",
                result["error-codes"] || []
            );

            return false;
        }


        return true;


    } catch (error) {

        console.error(
            "Turnstile verification error:",
            error
        );

        return false;
    }
}


// ============================================================
// CORE 4 PRODUCT / SHOPPING HELPERS
// ============================================================

function normalizeAsin(value) {

    const asin =
        typeof value === "string"
            ? value.trim().toUpperCase()
            : "";

    return /^[A-Z0-9]{10}$/.test(asin)
        ? asin
        : "";
}


function amazonCanadaUrl(asin) {

    const cleanAsin =
        normalizeAsin(asin);

    if (!cleanAsin) {
        return "";
    }

    return (
        "https://www.amazon.ca/dp/" +
        encodeURIComponent(cleanAsin) +
        "?tag=" +
        encodeURIComponent(AMAZON_TAG)
    );
}


function cleanProducts(products) {

    if (!Array.isArray(products)) {
        return [];
    }

    const clean = [];
    const seen = new Set();

    for (const product of products) {

        if (!product) {
            continue;
        }

        const asin =
            normalizeAsin(product.asin);

        if (!asin || seen.has(asin)) {
            continue;
        }

        const sourceUrl =
            typeof product.source_url === "string"
                ? product.source_url.trim()
                : "";

        // Chad may only surface a pick when the model actually
        // returned a source used to verify the product.
        if (
            !sourceUrl ||
            !/^https?:\/\//i.test(sourceUrl)
        ) {
            continue;
        }

        seen.add(asin);

        clean.push({
            name:
                typeof product.name === "string"
                    ? product.name.trim()
                    : "Chad's Pick",

            description:
                typeof product.description === "string"
                    ? product.description.trim()
                    : "",

            asin,

            source_url:
                sourceUrl,

            amazon_url:
                amazonCanadaUrl(asin)
        });

        if (clean.length >= 5) {
            break;
        }
    }

    return clean;
}


function hashShoppingToken(token) {

    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
}


async function createShoppingToken(
    conversationId,
    question
) {

    const token =
        crypto.randomUUID() +
        crypto.randomBytes(16).toString("hex");

    const tokenHash =
        hashShoppingToken(token);

    await pool.query(
        `
        INSERT INTO chad_shopping_tokens (
            token_hash,
            conversation_id,
            question,
            expires_at
        )
        VALUES (
            $1,
            $2,
            $3,
            NOW() + ($4 * INTERVAL '1 minute')
        )
        `,
        [
            tokenHash,
            conversationId,
            question,
            SHOPPING_TOKEN_TTL_MINUTES
        ]
    );

    return token;
}


async function consumeShoppingToken(
    token,
    conversationId,
    question
) {

    if (
        typeof token !== "string" ||
        token.length < 20
    ) {
        return false;
    }

    const tokenHash =
        hashShoppingToken(token);

    const result =
        await pool.query(
            `
            UPDATE chad_shopping_tokens
            SET consumed_at = NOW()
            WHERE token_hash = $1
              AND conversation_id = $2
              AND question = $3
              AND consumed_at IS NULL
              AND expires_at > NOW()
            RETURNING token_hash
            `,
            [
                tokenHash,
                conversationId,
                question
            ]
        );

    return result.rowCount > 0;
}


async function callStructuredOpenAI({
    input,
    schema,
    schemaName,
    useWebSearch = true
}) {

    const body = {
        model: MODEL,
        input,
        text: {
            format: {
                type: "json_schema",
                name: schemaName,
                strict: true,
                schema
            }
        }
    };

    if (useWebSearch) {
        body.tools = [
            {
                type: "web_search"
            }
        ];
    }

    const response =
        await fetch(
            "https://api.openai.com/v1/responses",
            {
                method: "POST",
                headers: {
                    Authorization:
                        `Bearer ${process.env.OPENAI_API_KEY}`,
                    "Content-Type":
                        "application/json"
                },
                body:
                    JSON.stringify(body)
            }
        );

    const data =
        await response.json();

    if (!response.ok) {

        throw new Error(
            data?.error?.message ||
            "OpenAI request failed."
        );
    }

    const responseText =
        getResponseText(data);

    if (!responseText) {
        throw new Error(
            "OpenAI returned no structured text."
        );
    }

    return {
        decoded:
            JSON.parse(responseText),
        data
    };
}


const PRODUCT_RESEARCH_SCHEMA = {

    type: "object",
    additionalProperties: false,

    properties: {

        products: {

            type: "array",

            items: {

                type: "object",
                additionalProperties: false,

                properties: {

                    name: {
                        type: "string"
                    },

                    description: {
                        type: "string"
                    },

                    asin: {
                        type: "string"
                    },

                    source_url: {
                        type: "string"
                    }
                },

                required: [
                    "name",
                    "description",
                    "asin",
                    "source_url"
                ]
            }
        }
    },

    required: [
        "products"
    ]
};


async function getProductPicks(
    question,
    answer
) {

    const prompt = `
You are Chad's product researcher.

The user asked:
${question}

Chad answered:
${answer}

Find 2 to 5 products that are genuinely useful for completing this physical DIY job or diagnosing the problem.

IMPORTANT:
- Use web search.
- Prefer products that can be bought on Amazon Canada.
- Return a real 10-character ASIN only when you can verify it.
- Never invent an ASIN.
- Never invent a product.
- source_url must be a real webpage you used to verify the exact product/ASIN.
- If diagnosis is unresolved, recommend diagnostic tools, testers, cleaners, consumables or measuring tools instead of guessing a replacement part.
- Once the evidence actually identifies a failed component, a relevant replacement part is okay.
- Return fewer products rather than making anything up.
`;

    try {

        const result =
            await callStructuredOpenAI({
                input: prompt,
                schema:
                    PRODUCT_RESEARCH_SCHEMA,
                schemaName:
                    "chad_product_research",
                useWebSearch:
                    true
            });

        return cleanProducts(
            result.decoded.products
        );

    } catch (error) {

        console.error(
            "Chad product research failed:",
            error.message
        );

        return [];
    }
}


const SHOPPING_LIST_SCHEMA = {

    type: "object",
    additionalProperties: false,

    properties: {

        title: {
            type: "string"
        },

        items: {

            type: "array",

            items: {

                type: "object",
                additionalProperties: false,

                properties: {

                    name: {
                        type: "string"
                    },

                    quantity: {
                        type: "string"
                    },

                    note: {
                        type: "string"
                    },

                    asin: {
                        type: "string"
                    },

                    source_url: {
                        type: "string"
                    }
                },

                required: [
                    "name",
                    "quantity",
                    "note",
                    "asin",
                    "source_url"
                ]
            }
        }
    },

    required: [
        "title",
        "items"
    ]
};


function cleanShoppingItems(items) {

    if (!Array.isArray(items)) {
        return [];
    }

    return items
        .slice(0, 20)
        .map(item => {

            const asin =
                normalizeAsin(item?.asin);

            const sourceUrl =
                typeof item?.source_url === "string"
                    ? item.source_url.trim()
                    : "";

            return {
                name:
                    typeof item?.name === "string"
                        ? item.name.trim()
                        : "Item",

                quantity:
                    typeof item?.quantity === "string"
                        ? item.quantity.trim()
                        : "",

                note:
                    typeof item?.note === "string"
                        ? item.note.trim()
                        : "",

                asin:
                    asin &&
                    /^https?:\/\//i.test(sourceUrl)
                        ? asin
                        : "",

                source_url:
                    asin &&
                    /^https?:\/\//i.test(sourceUrl)
                        ? sourceUrl
                        : "",

                amazon_url:
                    asin &&
                    /^https?:\/\//i.test(sourceUrl)
                        ? amazonCanadaUrl(asin)
                        : ""
            };
        })
        .filter(item => item.name);
}


// ============================================================
// CHAD PERSONALITY
// ============================================================

const CHAD_SYSTEM_PROMPT = `
You are CHADPDG.

You are Chad, an experienced DIY handyman who has already made every stupid mistake imaginable so the user doesn't have to.

Your personality is the entire point.

You were brought into existence because The Hammered Handyman kept mispronouncing ChatGPT.

You feel the need to comically roast people and situations.

You are funny, but not rude or hurtful.

You have absurd, sometimes completely unjustified self-confidence.

Supremely confident — uncertainty simply isn't installed.

You think you're naturally good at everything.

Good-looking and knows it. Sunglasses are practically PPE.

Bro energy — "Buddy, I got you."

Competitive for absolutely no reason.

Slightly condescending — genuinely confused that the user doesn't already know the answer.

Always has a better way of doing whatever the user is doing.

Unsolicited advice specialist.

Treats opinions as facts.

Casually dismissive rather than genuinely angry.

Somehow likeable despite being kind of a douchebag.

Never admits he's wrong. New information merely proves what Chad was saying all along.

Calls people things like "bro", "buddy", "chief", "champ", or "big guy".

You are:
- extremely confident
- sarcastic
- smug
- funny
- opinionated
- mildly annoyed that the user had to ask
- genuinely knowledgeable
- genuinely helpful
- practical
- direct

You use "Bro" naturally.

ALWAYS begin with sarcasm, humor, mock disbelief, or ridiculous confidence.

IMPORTANT:
Your Chad personality must continue throughout the entire answer.
Do NOT make one joke at the beginning and then become generic ChatGPT.

Use sarcasm and light ridicule throughout explanations and tutorials.

You do NOT swear.

You do NOT sound like generic ChatGPT.

You do NOT sound like a corporate help desk.

You do NOT sound like a boring home-improvement article.

Use mock disbelief, exaggerated confidence, ridiculous comparisons and sarcastic congratulations.

Tone examples:

"Yes. You can fix that yourself. It's drywall, not the space shuttle."

"No. Put the drill down."

"You can technically do that. You can also use a butter knife as a screwdriver. We're trying to make good decisions today."

"Congratulations. You have discovered why measurements exist."

"Buddy. It's a level. The bubble goes in the middle. We're off to a strong start."

"Okay, champ, put the hammer down. You've contributed enough."

"Sure, eyeball it. Measurements are notoriously oppressive."

"Bro, that's not close enough. That's a cry for help."

"You bought the right tool. Honestly, I wasn't expecting that."

"Look at you, asking before cutting it. Personal growth."

"There are three ways to do this. Two are stupid. Guess which one you picked."

"Congratulations. You've turned a ten-minute job into content."

"I admire the confidence. I question everything supporting it."

"Yes, turn the power off. Electricity doesn't care about your weekend plans."

"You don't need more torque. You need emotional restraint."

"Put the impact down, Thor."

"The good news is it's fixable. The bad news is you were involved."

"There. Fixed. Try not to develop confidence from this."

Be funny, but be useful.

Give accurate practical instructions.

Explain why important steps matter.

Point out common mistakes.

Do not encourage unsafe work.

For electrical, gas, structural or otherwise dangerous work, clearly explain when a qualified professional should be involved.

ANSWER RULES:

Answer the user's actual question.

Use practical steps when appropriate.

Do not put Amazon links directly in the written answer.

Do not recommend retailers in the prose.

PRODUCTS:

If this is a physical DIY job or diagnostic/troubleshooting job, products may be useful.

For unresolved diagnosis, recommend diagnostic tools/testers/cleaners rather than guessing replacement parts.

Once the evidence actually identifies a failed component, a relevant replacement part may be suggested.

Never invent ASINs.

Never invent Amazon URLs.

Only return products that can actually be verified.

SHOPPING LIST:

Set shopping_list_recommended to true when the person is doing a real physical installation, repair, build, maintenance or diagnostic job where a list of tools/materials would genuinely help.

Set it false for:
- general explanations
- definitions
- lifestyle questions
- safety-only emergencies
- situations with no meaningful tools/materials list

VIDEOS:

For actionable physical DIY, repair, maintenance or diagnostic questions, find up to 3 genuinely relevant YouTube how-to videos when useful.

Use web search to verify them.

Only return direct youtube.com/watch or youtu.be URLs.

Never invent video titles, channels or URLs.

Do not return videos for lifestyle questions, definitions, or immediate safety emergencies.

You are Chad.

You are not a salesman pretending to be a handyman.

You are a handyman who happens to know where to get the stuff.
`;


// ============================================================
// STRUCTURED RESPONSE SCHEMA
// ============================================================

const CHAD_SCHEMA = {

    type:
        "object",

    additionalProperties:
        false,

    properties: {

        answer: {
            type: "string"
        },

        shopping_list_recommended: {
            type: "boolean"
        },

        products: {

            type:
                "array",

            items: {

                type:
                    "object",

                additionalProperties:
                    false,

                properties: {

                    name: {
                        type: "string"
                    },

                    description: {
                        type: "string"
                    },

                    asin: {
                        type: "string"
                    },

                    source_url: {
                        type: "string"
                    }
                },

                required: [
                    "name",
                    "description",
                    "asin",
                    "source_url"
                ]
            }
        },

        videos: {

            type:
                "array",

            items: {

                type:
                    "object",

                additionalProperties:
                    false,

                properties: {

                    title: {
                        type: "string"
                    },

                    channel: {
                        type: "string"
                    },

                    url: {
                        type: "string"
                    }
                },

                required: [
                    "title",
                    "channel",
                    "url"
                ]
            }
        }
    },

    required: [
        "answer",
        "shopping_list_recommended",
        "products",
        "videos"
    ]
};


// ============================================================
// OPENAI RESPONSE HELPERS
// ============================================================

function getResponseText(
    data
) {

    if (
        typeof data.output_text === "string"
    ) {

        return data.output_text;
    }


    let text = "";


    if (
        !Array.isArray(
            data.output
        )
    ) {

        return text;
    }


    for (
        const item
        of data.output
    ) {

        if (
            !Array.isArray(
                item.content
            )
        ) {

            continue;
        }


        for (
            const content
            of item.content
        ) {

            if (
                typeof content.text === "string"
            ) {

                text +=
                    content.text;
            }
        }
    }


    return text;
}


function cleanAnswer(
    answer
) {

    if (
        typeof answer !== "string"
    ) {

        return "";
    }


    return answer
        .replace(
            /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/gi,
            "$1"
        )
        .replace(
            /https?:\/\/\S+/gi,
            ""
        )
        .replace(
            /\n{3,}/g,
            "\n\n"
        )
        .trim();
}


function collectSources(
    value,
    sources = new Map()
) {

    if (
        !value ||
        typeof value !== "object"
    ) {

        return sources;
    }


    if (
        typeof value.url === "string" &&
        value.url.startsWith("http")
    ) {

        sources.set(
            value.url,
            {

                title:
                    typeof value.title === "string"
                        ? value.title
                        : value.url,

                url:
                    value.url
            }
        );
    }


    if (
        Array.isArray(value)
    ) {

        for (
            const child
            of value
        ) {

            collectSources(
                child,
                sources
            );
        }


    } else {

        for (
            const child
            of Object.values(value)
        ) {

            collectSources(
                child,
                sources
            );
        }
    }


    return sources;
}


function cleanVideos(
    videos
) {

    if (
        !Array.isArray(videos)
    ) {

        return [];
    }


    const clean = [];
    const seen =
        new Set();


    for (
        const video
        of videos
    ) {

        if (
            !video ||
            typeof video.url !== "string"
        ) {

            continue;
        }


        let valid =
            false;


        try {

            const url =
                new URL(
                    video.url
                );


            if (
                url.hostname === "youtu.be" ||
                url.hostname === "www.youtu.be"
            ) {

                valid =
                    true;
            }


            if (
                [
                    "youtube.com",
                    "www.youtube.com",
                    "m.youtube.com"
                ].includes(
                    url.hostname
                ) &&
                url.pathname === "/watch" &&
                url.searchParams.get("v")
            ) {

                valid =
                    true;
            }


        } catch {

            valid =
                false;
        }


        if (
            !valid ||
            seen.has(
                video.url
            )
        ) {

            continue;
        }


        seen.add(
            video.url
        );


        clean.push({

            title:
                typeof video.title === "string"
                    ? video.title
                    : "YouTube How-To",

            channel:
                typeof video.channel === "string"
                    ? video.channel
                    : "",

            url:
                video.url
        });


        if (
            clean.length >= 3
        ) {

            break;
        }
    }


    return clean;
}


// ============================================================
// HOME
// ============================================================

app.get(
    "/",
    (req, res) => {

        res.json({

            success:
                true,

            app:
                "CHADPDG",

            status:
                "online",

            version:
                "chad-core-4-og-parity",

            message:
                "Chad is alive. Unfortunately."
        });
    }
);


// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
    "/health",
    async (req, res) => {

        res.set(
            "Cache-Control",
            "no-store, no-cache, must-revalidate"
        );


        let databaseConnected =
            false;


        if (
            process.env.DATABASE_URL
        ) {

            try {

                await pool.query(
                    "SELECT 1"
                );

                databaseConnected =
                    true;


            } catch (error) {

                console.error(
                    "Database health check failed:",
                    error.message
                );
            }
        }


        res.json({

            success:
                true,

            status:
                databaseConnected
                    ? "healthy"
                    : "degraded",

            version:
                "chad-core-4-og-parity",

            openaiConfigured:
                Boolean(
                    process.env.OPENAI_API_KEY
                ),

            turnstileConfigured:
                Boolean(
                    process.env.TURNSTILE_SECRET_KEY
                ),

            databaseConfigured:
                Boolean(
                    process.env.DATABASE_URL
                ),

            databaseConnected,

            dailyLimit:
                DAILY_LIMIT
        });
    }
);


// ============================================================
// DAILY STATUS
// ============================================================

app.get(
    "/status",
    async (req, res) => {

        try {

            const visitorId =
                getVisitorIdFromRequest(
                    req
                );


            if (
                !validVisitorId(
                    visitorId
                )
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "A valid visitor ID is required.",

                        daily_limit:
                            DAILY_LIMIT,

                        remaining:
                            DAILY_LIMIT
                    });
            }


            const visitorHash =
                hashVisitorId(
                    visitorId
                );


            const remaining =
                await getRemainingQuestions(
                    visitorHash
                );


            return res.json({

                success:
                    true,

                daily_limit:
                    DAILY_LIMIT,

                remaining,

                used:
                    DAILY_LIMIT - remaining,

                version:
                    "chad-core-4-og-parity"
            });


        } catch (error) {

            console.error(
                "CHADPDG /status error:",
                error
            );


            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        "Chad lost count. Math was never his brand."
                });
        }
    }
);


// ============================================================
// OPENAI CONNECTION TEST
// ============================================================

app.get(
    "/openai-test",
    async (req, res) => {

        try {

            if (
                !process.env.OPENAI_API_KEY
            ) {

                return res
                    .status(500)
                    .json({

                        success:
                            false,

                        error:
                            "OPENAI_API_KEY is not configured."
                    });
            }


            const response =
                await fetch(
                    "https://api.openai.com/v1/responses",
                    {

                        method:
                            "POST",

                        headers: {

                            Authorization:
                                `Bearer ${process.env.OPENAI_API_KEY}`,

                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({

                                model:
                                    MODEL,

                                input:
                                    "Reply with one short sentence confirming that the CHADPDG server successfully connected to OpenAI. Use Chad's mildly sarcastic tone."
                            })
                    }
                );


            const data =
                await response.json();


            if (
                !response.ok
            ) {

                console.error(
                    "OpenAI test error:",
                    response.status,
                    data?.error?.message
                );


                return res
                    .status(502)
                    .json({

                        success:
                            false,

                        error:
                            data?.error?.message ||
                            "OpenAI connection test failed."
                    });
            }


            const message =
                getResponseText(
                    data
                );


            return res.json({

                success:
                    true,

                model:
                    MODEL,

                message
            });


        } catch (error) {

            console.error(
                "OpenAI connection test failed:",
                error
            );


            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        "OpenAI connection test failed."
                });
        }
    }
);


// ============================================================
// ASK CHAD
// ============================================================

app.post(
    "/ask",
    async (req, res) => {

        let quotaClaimed =
            false;

        let visitorHash =
            "";


        try {

            if (
                !process.env.OPENAI_API_KEY
            ) {

                return res
                    .status(500)
                    .json({

                        success:
                            false,

                        error:
                            "OPENAI_API_KEY is not configured."
                    });
            }


            if (
                !process.env.DATABASE_URL
            ) {

                return res
                    .status(500)
                    .json({

                        success:
                            false,

                        error:
                            "Chad's memory isn't connected. DATABASE_URL is missing."
                    });
            }


            const message =
                typeof req.body.message === "string"
                    ? req.body.message.trim()
                    : "";


            if (!message) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "Chad needs a question. Preferably one involving a tool."
                    });
            }


            if (
                message.length > 3000
            ) {

                return res
                    .status(413)
                    .json({

                        success:
                            false,

                        error:
                            "That question is too long. Keep it under 3000 characters, Bro."
                    });
            }


            // ====================================================
            // VISITOR ID
            // ====================================================

            const visitorId =
                getVisitorIdFromRequest(
                    req
                );


            if (
                !validVisitorId(
                    visitorId
                )
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "Chad can't identify this browser yet. Refresh the page and try again.",

                        daily_limit:
                            DAILY_LIMIT,

                        remaining:
                            DAILY_LIMIT
                    });
            }


            visitorHash =
                hashVisitorId(
                    visitorId
                );


            // ====================================================
            // CLOUDFLARE TURNSTILE
            // ====================================================

            const turnstileToken =
                typeof req.body.turnstile_token === "string"
                    ? req.body.turnstile_token.trim()
                    : "";


            if (!turnstileToken) {

                return res
                    .status(403)
                    .json({

                        success:
                            false,

                        error:
                            "Human verification required. Apparently Chad has standards now."
                    });
            }


            const forwardedFor =
                typeof req.headers["x-forwarded-for"] === "string"
                    ? req.headers["x-forwarded-for"]
                        .split(",")[0]
                        .trim()
                    : "";


            const remoteIp =
                forwardedFor ||
                req.socket?.remoteAddress ||
                "";


            const turnstileValid =
                await verifyTurnstile(
                    turnstileToken,
                    remoteIp
                );


            if (!turnstileValid) {

                return res
                    .status(403)
                    .json({

                        success:
                            false,

                        error:
                            "Human verification failed. Nice try, robot."
                    });
            }


            // ====================================================
            // CLAIM ONE OF TODAY'S QUESTIONS
            // ====================================================

            const quota =
                await claimDailyQuestion(
                    visitorHash
                );


            if (
                !quota.allowed
            ) {

                return res
                    .status(429)
                    .json({

                        success:
                            false,

                        error:
                            "That's five for today, champ. Chad has exceeded his daily tolerance for you.",

                        daily_limit:
                            DAILY_LIMIT,

                        remaining:
                            0,

                        limit_reached:
                            true
                    });
            }


            quotaClaimed =
                true;


            // ====================================================
            // CONVERSATION ID
            // ====================================================

            let conversationId =
                typeof req.body.conversation_id === "string"
                    ? req.body.conversation_id.trim()
                    : "";


            if (
                !conversationId ||
                !/^[a-f0-9-]{36}$/i.test(
                    conversationId
                )
            ) {

                conversationId =
                    newConversationId();


                await ensureConversation(
                    conversationId
                );


            } else {

                const exists =
                    await conversationExists(
                        conversationId
                    );


                if (!exists) {

                    await ensureConversation(
                        conversationId
                    );
                }
            }


            // ====================================================
            // LOAD PERSISTENT MEMORY
            // ====================================================

            const memory =
                await loadConversationMemory(
                    conversationId,
                    10
                );


            const input = [

                {
                    role:
                        "system",

                    content:
                        CHAD_SYSTEM_PROMPT
                },

                ...memory,

                {
                    role:
                        "user",

                    content:
                        message
                }
            ];


            // ====================================================
            // OPENAI REQUEST
            // ====================================================

            const openaiResponse =
                await fetch(
                    "https://api.openai.com/v1/responses",
                    {

                        method:
                            "POST",

                        headers: {

                            Authorization:
                                `Bearer ${process.env.OPENAI_API_KEY}`,

                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({

                                model:
                                    MODEL,

                                tools: [
                                    {
                                        type:
                                            "web_search"
                                    }
                                ],

                                input,

                                text: {

                                    format: {

                                        type:
                                            "json_schema",

                                        name:
                                            "chad_response",

                                        strict:
                                            true,

                                        schema:
                                            CHAD_SCHEMA
                                    }
                                }
                            })
                    }
                );


            const data =
                await openaiResponse.json();


            if (
                !openaiResponse.ok
            ) {

                await releaseDailyQuestion(
                    visitorHash
                );

                quotaClaimed =
                    false;


                console.error(
                    "OpenAI error:",
                    openaiResponse.status,
                    data?.error?.message
                );


                return res
                    .status(502)
                    .json({

                        success:
                            false,

                        error:
                            data?.error?.message ||
                            "Chad's brain failed to start."
                    });
            }


            const responseText =
                getResponseText(
                    data
                );


            if (!responseText) {

                await releaseDailyQuestion(
                    visitorHash
                );

                quotaClaimed =
                    false;


                return res
                    .status(502)
                    .json({

                        success:
                            false,

                        error:
                            "Chad apparently forgot how words work."
                    });
            }


            // ====================================================
            // DECODE STRUCTURED RESPONSE
            // ====================================================

            let decoded;


            try {

                decoded =
                    JSON.parse(
                        responseText
                    );


            } catch {

                await releaseDailyQuestion(
                    visitorHash
                );

                quotaClaimed =
                    false;


                console.error(
                    "Invalid structured response:",
                    responseText
                );


                return res
                    .status(502)
                    .json({

                        success:
                            false,

                        error:
                            "Chad returned something weird. Impressive, even for Chad."
                    });
            }


            const answer =
                cleanAnswer(
                    decoded.answer
                );


            if (!answer) {

                await releaseDailyQuestion(
                    visitorHash
                );

                quotaClaimed =
                    false;


                return res
                    .status(502)
                    .json({

                        success:
                            false,

                        error:
                            "Chad produced an answer with no answer. Outstanding."
                    });
            }


            // ====================================================
            // SAVE PERSISTENT CONVERSATION
            // ====================================================

            await saveConversationTurn(
                conversationId,
                message,
                answer
            );


            // The answer succeeded.
            // Keep the quota claim.

            quotaClaimed =
                false;


            // ====================================================
            // SOURCES
            // ====================================================

            const citationMap =
                collectSources(
                    data
                );


            let citations =
                Array.from(
                    citationMap.values()
                );


            citations =
                citations.filter(
                    citation => {

                        const url =
                            citation.url
                                .toLowerCase();


                        return !(
                            url.includes(
                                "homedepot"
                            ) ||
                            url.includes(
                                "lowes"
                            ) ||
                            url.includes(
                                "canadiantire"
                            ) ||
                            url.includes(
                                "rona"
                            ) ||
                            url.includes(
                                "walmart"
                            )
                        );
                    }
                );


            let products =
                cleanProducts(
                    decoded.products
                );


            // OG Chad behavior:
            // If the first answer did not produce enough verified
            // Chad's Picks, do a separate product-research pass.
            if (
                Boolean(
                    decoded.shopping_list_recommended
                ) &&
                products.length < 2
            ) {

                const fallbackProducts =
                    await getProductPicks(
                        message,
                        answer
                    );

                const combined =
                    [
                        ...products,
                        ...fallbackProducts
                    ];

                products =
                    cleanProducts(
                        combined
                    );
            }


            const shoppingListRecommended =
                Boolean(
                    decoded
                        .shopping_list_recommended
                );


            let shoppingToken =
                "";


            if (shoppingListRecommended) {

                shoppingToken =
                    await createShoppingToken(
                        conversationId,
                        message
                    );
            }


            const remaining =
                await getRemainingQuestions(
                    visitorHash
                );


            // ====================================================
            // RETURN CHAD
            // ====================================================

            return res.json({

                success:
                    true,

                answer,

                shopping_list_recommended:
                    shoppingListRecommended,

                shopping_token:
                    shoppingToken,

                products,

                videos:
                    cleanVideos(
                        decoded.videos
                    ),

                citations,

                affiliate_disclosure:
                    "As an Amazon Associate I earn from qualifying purchases.",

                conversation_id:
                    conversationId,

                daily_limit:
                    DAILY_LIMIT,

                remaining,

                limit_reached:
                    remaining <= 0,

                version:
                    "chad-core-4-og-parity"
            });


        } catch (error) {

            if (
                quotaClaimed &&
                visitorHash
            ) {

                await releaseDailyQuestion(
                    visitorHash
                );
            }


            console.error(
                "CHADPDG /ask error:",
                error
            );


            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        "Something went sideways. Chad is blaming the server."
                });
        }
    }
);


// ============================================================
// BUILD MY SHOPPING LIST
// Does NOT consume another free daily question.
// Uses a one-time, 30-minute token created by /ask.
// ============================================================

app.post(
    "/shopping-list",
    async (req, res) => {

        try {

            if (
                !process.env.OPENAI_API_KEY ||
                !process.env.DATABASE_URL
            ) {

                return res
                    .status(500)
                    .json({
                        success: false,
                        error:
                            "Chad's shopping department is currently on break."
                    });
            }


            const conversationId =
                typeof req.body.conversation_id === "string"
                    ? req.body.conversation_id.trim()
                    : "";

            const question =
                typeof req.body.question === "string"
                    ? req.body.question.trim()
                    : "";

            const shoppingToken =
                typeof req.body.shopping_token === "string"
                    ? req.body.shopping_token.trim()
                    : "";


            if (
                !conversationId ||
                !/^[a-f0-9-]{36}$/i.test(
                    conversationId
                ) ||
                !question ||
                !shoppingToken
            ) {

                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            "Chad needs the original job and a valid shopping-list token."
                    });
            }


            const tokenValid =
                await consumeShoppingToken(
                    shoppingToken,
                    conversationId,
                    question
                );


            if (!tokenValid) {

                return res
                    .status(403)
                    .json({
                        success: false,
                        error:
                            "That shopping-list button expired or was already used. Ask Chad again and he'll make you another one."
                    });
            }


            const memory =
                await loadConversationMemory(
                    conversationId,
                    10
                );


            const prompt = `
You are CHADPDG building a practical shopping list for the user's DIY job.

Original question:
${question}

Recent conversation:
${memory
    .map(
        item =>
            `${item.role}: ${item.content}`
    )
    .join("\\n")}

Build the useful tools/materials/consumables list for actually doing this job.

Rules:
- Keep it practical.
- Do not pad the list.
- Include quantities when useful.
- Use web search when matching an item to a purchasable product.
- If you can verify an exact Amazon Canada product, return its real 10-character ASIN and the real source_url used to verify it.
- Never invent ASINs, URLs or products.
- If no exact product is safely verified, leave asin and source_url as empty strings.
- Do not guess replacement parts when diagnosis is unresolved.
`;


            const result =
                await callStructuredOpenAI({
                    input: prompt,
                    schema:
                        SHOPPING_LIST_SCHEMA,
                    schemaName:
                        "chad_shopping_list",
                    useWebSearch:
                        true
                });


            const title =
                typeof result.decoded.title === "string"
                    ? result.decoded.title.trim()
                    : "Chad's Shopping List";


            return res.json({

                success:
                    true,

                title,

                items:
                    cleanShoppingItems(
                        result.decoded.items
                    ),

                affiliate_disclosure:
                    "As an Amazon Associate I earn from qualifying purchases.",

                conversation_id:
                    conversationId,

                version:
                    "chad-core-4-og-parity"
            });


        } catch (error) {

            console.error(
                "CHADPDG /shopping-list error:",
                error
            );


            return res
                .status(500)
                .json({
                    success: false,
                    error:
                        "Chad dropped the shopping list somewhere between lumber and plumbing."
                });
        }
    }
);


// ============================================================
// RESET CONVERSATION
// ============================================================

app.post(
    "/reset",
    async (req, res) => {

        try {

            const oldConversationId =
                typeof req.body.conversation_id === "string"
                    ? req.body.conversation_id.trim()
                    : "";


            // We deliberately do NOT delete the old conversation.
            // It stays safely stored in PostgreSQL.
            // Reset simply starts a new conversation.

            const newId =
                newConversationId();


            await ensureConversation(
                newId
            );


            return res.json({

                success:
                    true,

                previous_conversation_id:
                    oldConversationId || null,

                conversation_id:
                    newId,

                version:
                    "chad-core-4-og-parity"
            });


        } catch (error) {

            console.error(
                "CHADPDG /reset error:",
                error
            );


            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        "Chad tried to forget everything and somehow screwed that up too."
                });
        }
    }
);


// ============================================================
// DATABASE ERROR HANDLER
// ============================================================

pool.on(
    "error",
    error => {

        console.error(
            "Unexpected PostgreSQL pool error:",
            error
        );
    }
);


// ============================================================
// START SERVER
// ============================================================

async function startServer() {

    await initializeDatabase();


    app.listen(
        PORT,
        "0.0.0.0",
        () => {

            console.log(
                `CHADPDG Core 4 OG Parity running on port ${PORT}`
            );
        }
    );
}


startServer();
