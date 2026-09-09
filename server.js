const express = require("express");

const app = express();

app.use(express.json({ limit: "12kb" }));

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
        status: "healthy"
    });
});

const port = process.env.PORT || 8080;

app.listen(port, "0.0.0.0", () => {
    console.log(`CHADPDG running on port ${port}`);
});
