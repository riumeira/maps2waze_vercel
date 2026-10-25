// Vercel serverless function: POST /api/convert (same contract as the Express route in server.ts)
import { handleConvertRequest } from "../src/lib/convert.js";

interface VercelRequest {
  method?: string;
  body?: unknown;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { status, body } = await handleConvertRequest(req.body);
  res.status(status).json(body);
}
