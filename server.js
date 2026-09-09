const express = require("express");

const app = express();

app.use(express.json({ limit: "12kb" }));

// ============================================================
// CHADPDG HEALTH CHECK
// ============================================================

app.get("/", (req, res) => {
    res.json({
        success: true,
        app: "CHADPDG",
        status: "online",
        message: "Chad is alive. Unfortunately."
    });
});

app.get("/health", (req, res) => {
    res.json({
        success: true,
        status: "healthy",
        openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
        turnstileConfigured: Boolean(process.env.TURNSTILE_SECRET_KEY)
    });
});

// ============================================================
// OPENAI CONNECTION TEST
// ============================================================

app.get("/openai-test", async (req, res) => {

    try {

        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({
                success: false,
                error: "OPENAI_API_KEY is not configured."
            });
        }

        const response = await fetch(
            "https://api.openai.com/v1/responses",
            {
                method: "POST",

                headers: {
                    "Authorization":
                        `Bearer ${process.env.OPENAI_API_KEY}`,

                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({
                    model: "gpt-5.6-luna",

                    input: [
                        {
                            role: "system",
                            content:
                                "You are Chad. Reply with one short sarcastic sentence confirming that the CHADPDG server successfully connected to OpenAI. Do not swear."
                        },
                        {
                            role: "user",
                            content:
                                "Chad, are you connected?"
                        }
                    ]
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {

            console.error(
                "OpenAI test failed:",
                response.status,
                data?.error?.message || "Unknown error"
            );

            return res.status(502).json({
                success: false,
                status: response.status,
                error:
                    data?.error?.message ||
                    "OpenAI request failed."
            });
        }

        let answer = data.output_text || "";

        if (!answer && Array.isArray(data.output)) {

            for (const item of data.output) {

                if (!Array.isArray(item.content)) {
                    continue;
                }

                for (const content of item.content) {

                    if (
                        typeof content.text === "string"
                    ) {
                        answer += content.text;
                    }
                }
            }
        }

        return res.json({
            success: true,
            model: "gpt-5.6-luna",
            message: answer || "OpenAI connected."
        });

    } catch (error) {

        console.error(
            "OpenAI connection test error:",
            error
        );

        return res.status(500).json({
            success: false,
            error: "CHADPDG could not reach OpenAI."
        });
    }
});

// ============================================================
// SERVER
// ============================================================

const port = process.env.PORT || 8080;

app.listen(port, "0.0.0.0", () => {
    console.log(
        `CHADPDG running on port ${port}`
    );
});
