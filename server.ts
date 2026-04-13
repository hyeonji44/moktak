import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // In-memory cache for demonstration (in a real app, use Redis)
  const hitCache: Record<string, { count: number; lastUpdate: number }> = {};

  // API Routes
  app.get("/api/hits/:userId", (req, res) => {
    const { userId } = req.params;
    // In a real app, fetch from DB. Here we just return cached or 0.
    const userHits = hitCache[userId]?.count || 0;
    res.json({ userId, count: userHits });
  });

  app.post("/api/hits/:userId", (req, res) => {
    const { userId } = req.params;
    const { increment = 1 } = req.body;

    if (!hitCache[userId]) {
      hitCache[userId] = { count: 0, lastUpdate: Date.now() };
    }

    hitCache[userId].count += increment;
    hitCache[userId].lastUpdate = Date.now();

    // In a real optimized backend, we would batch these updates to DB every N seconds
    res.json({ success: true, currentCount: hitCache[userId].count });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
