const express = require("express");
const crypto = require("crypto");

const app = express();

app.use(express.json({ limit: "12kb" }));
app.use(express.static("public"));

const PORT = process.env.PORT || 8080;
const MODEL = "gpt-5.6-luna";

// ============================================================
// TEMPORARY MEMORY
// ============================================================
// This proves multi-turn Chad now.
// We will replace this Map with persistent database storage.
// A deployment/restart can clear this temporary memory.

const conversations = new Map();

function newConversationId() {
    return crypto.randomUUID();
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
    type: "object",
    additionalProperties: false,

    properties: {

        answer: {
            type: "string"
        },

        shopping_list_recommended: {
            type: "boolean"
        },

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
        },

        videos: {
            type: "array",

            items: {
                type: "object",
                additionalProperties: false,

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
// HELPERS
// ============================================================

function getResponseText(data) {

    if (typeof data.output_text === "string") {
        return data.output_text;
    }

    let text = "";

    if (!Array.isArray(data.output)) {
        return text;
    }

    for (const item of data.output) {

        if (!Array.isArray(item.content)) {
            continue;
        }

        for (const content of item.content) {

            if (typeof content.text === "string") {
                text += content.text;
            }
        }
    }

    return text;
}


function cleanAnswer(answer) {

    if (typeof answer !== "string") {
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


function collectSources(value, sources = new Map()) {

    if (!value || typeof value !== "object") {
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

                url: value.url
            }
        );
    }

    if (Array.isArray(value)) {

        for (const child of value) {
            collectSources(child, sources);
        }

    } else {

        for (const child of Object.values(value)) {
            collectSources(child, sources);
        }
    }

    return sources;
}


function cleanVideos(videos) {

    if (!Array.isArray(videos)) {
        return [];
    }

    const clean = [];
    const seen = new Set();

    for (const video of videos) {

        if (!video || typeof video.url !== "string") {
            continue;
        }

        let valid = false;

        try {

            const url = new URL(video.url);

            if (
                url.hostname === "youtu.be" ||
                url.hostname === "www.youtu.be"
            ) {
                valid = true;
            }

            if (
                [
                    "youtube.com",
                    "www.youtube.com",
                    "m.youtube.com"
                ].includes(url.hostname) &&
                url.pathname === "/watch" &&
                url.searchParams.get("v")
            ) {
                valid = true;
            }

        } catch {
            valid = false;
        }

        if (!valid || seen.has(video.url)) {
            continue;
        }

        seen.add(video.url);

        clean.push({
            title:
                typeof video.title === "string"
                    ? video.title
                    : "YouTube How-To",

            channel:
                typeof video.channel === "string"
                    ? video.channel
                    : "",

            url: video.url
        });

        if (clean.length >= 3) {
            break;
        }
    }

    return clean;
}


// ============================================================
// HOME / HEALTH
// ============================================================

app.get("/", (req, res) => {

    res.json({
        success: true,
        app: "CHADPDG",
        status: "online",
        message:
            "Chad is alive. Unfortunately."
    });
});


app.get("/health", (req, res) => {

    res.set(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
    );

    res.json({
        success: true,
        status: "healthy",
        version: "chad-core-1",
        openaiConfigured:
            Boolean(process.env.OPENAI_API_KEY),
        turnstileConfigured:
            Boolean(process.env.TURNSTILE_SECRET_KEY)
    });
});


// ============================================================
// ASK CHAD
// ============================================================

app.post("/ask", async (req, res) => {

    try {

        if (!process.env.OPENAI_API_KEY) {

            return res.status(500).json({
                success: false,
                error:
                    "OPENAI_API_KEY is not configured."
            });
        }

        const message =
            typeof req.body.message === "string"
                ? req.body.message.trim()
                : "";

        if (!message) {

            return res.status(400).json({
                success: false,
                error:
                    "Chad needs a question. Preferably one involving a tool."
            });
        }

        if (message.length > 3000) {

            return res.status(413).json({
                success: false,
                error:
                    "That question is too long. Keep it under 3000 characters, Bro."
            });
        }

        let conversationId =
            typeof req.body.conversation_id === "string"
                ? req.body.conversation_id.trim()
                : "";

        if (
            !conversationId ||
            !/^[a-f0-9-]{36}$/i.test(conversationId)
        ) {
            conversationId = newConversationId();
        }

        let memory =
            conversations.get(conversationId) || [];

        const input = [
            {
                role: "system",
                content: CHAD_SYSTEM_PROMPT
            },

            ...memory,

            {
                role: "user",
                content: message
            }
        ];

        const openaiResponse = await fetch(
            "https://api.openai.com/v1/responses",
            {
                method: "POST",

                headers: {
                    Authorization:
                        `Bearer ${process.env.OPENAI_API_KEY}`,

                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    model: MODEL,

                    tools: [
                        {
                            type: "web_search"
                        }
                    ],

                    input,

                    text: {

                        format: {

                            type: "json_schema",

                            name: "chad_response",

                            strict: true,

                            schema: CHAD_SCHEMA
                        }
                    }
                })
            }
        );

        const data = await openaiResponse.json();

        if (!openaiResponse.ok) {

            console.error(
                "OpenAI error:",
                openaiResponse.status,
                data?.error?.message
            );

            return res.status(502).json({
                success: false,
                error:
                    data?.error?.message ||
                    "Chad's brain failed to start."
            });
        }

        const responseText =
            getResponseText(data);

        if (!responseText) {

            return res.status(502).json({
                success: false,
                error:
                    "Chad apparently forgot how words work."
            });
        }

        let decoded;

        try {
            decoded = JSON.parse(responseText);
        } catch {

            console.error(
                "Invalid structured response:",
                responseText
            );

            return res.status(502).json({
                success: false,
                error:
                    "Chad returned something weird. Impressive, even for Chad."
            });
        }

        const answer =
            cleanAnswer(decoded.answer);

        if (!answer) {

            return res.status(502).json({
                success: false,
                error:
                    "Chad produced an answer with no answer. Outstanding."
            });
        }

        // --------------------------------------------
        // Save temporary multi-turn conversation
        // --------------------------------------------

        memory.push(
            {
                role: "user",
                content: message
            },
            {
                role: "assistant",
                content: answer
            }
        );

        if (memory.length > 10) {
            memory = memory.slice(-10);
        }

        conversations.set(
            conversationId,
            memory
        );

        // --------------------------------------------
        // Sources
        // --------------------------------------------

        const citationMap =
            collectSources(data);

        let citations =
            Array.from(citationMap.values());

        citations = citations.filter(
            citation => {

                const url =
                    citation.url.toLowerCase();

                return !(
                    url.includes("homedepot") ||
                    url.includes("lowes") ||
                    url.includes("canadiantire") ||
                    url.includes("rona") ||
                    url.includes("walmart")
                );
            }
        );

        // --------------------------------------------
        // Return Chad
        // --------------------------------------------

        return res.json({

            success: true,

            answer,

            shopping_list_recommended:
                Boolean(
                    decoded.shopping_list_recommended
                ),

            products:
                Array.isArray(decoded.products)
                    ? decoded.products.slice(0, 5)
                    : [],

            videos:
                cleanVideos(decoded.videos),

            citations,

            affiliate_disclosure:
                "As an Amazon Associate I earn from qualifying purchases.",

            conversation_id:
                conversationId,

            version:
                "chad-core-1"
        });

    } catch (error) {

        console.error(
            "CHADPDG /ask error:",
            error
        );

        return res.status(500).json({
            success: false,
            error:
                "Something went sideways. Chad is blaming the server."
        });
    }
});


// ============================================================
// RESET CONVERSATION
// ============================================================

app.post("/reset", (req, res) => {

    const conversationId =
        typeof req.body.conversation_id === "string"
            ? req.body.conversation_id
            : "";

    if (conversationId) {
        conversations.delete(conversationId);
    }

    const newId =
        newConversationId();

    res.json({
        success: true,
        conversation_id: newId
    });
});


// ============================================================
// SERVER
// ============================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `CHADPDG Core running on port ${PORT}`
        );
    }
);
