import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { handleConvertRequest } from "./src/lib/convert";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  // API to convert Google Maps URL to coordinates (on Vercel this is api/convert.ts)
  app.post("/api/convert", async (req, res) => {
    const { status, body } = await handleConvertRequest(req.body);
    res.status(status).json(body);
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
    // Hashed build assets never change → cache forever; index.html must always be revalidated
    app.use("/assets", express.static(path.join(distPath, "assets"), { immutable: true, maxAge: "1y" }));
    app.use(express.static(distPath, { maxAge: "1h", index: false }));
    app.get("*", (req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
