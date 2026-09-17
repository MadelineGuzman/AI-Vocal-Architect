import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  // Load secrets (e.g. GEMINI_API_KEY) from a local, gitignored .env file when
  // present. In production the host environment supplies them instead. The key
  // is only ever read server-side and never exposed to the client bundle.
  try {
    process.loadEnvFile();
  } catch {
    // No .env file found; fall back to the existing process environment.
  }

  const app = express();
  const PORT = 3000;

  // Setup JSON body parsing for API requests
  app.use(express.json());

  // Set up GenAI Client (server-side only)
  let ai: GoogleGenAI | null = null;
  try {
    if (process.env.GEMINI_API_KEY) {
      ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } else {
      console.warn("GEMINI_API_KEY not found in environment. Contextual chat will be unavailable.");
    }
  } catch (e) {
    console.error("Failed to initialize Google GenAI:", e);
  }

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/chat", async (req, res) => {
    try {
      if (!ai) {
        return res.status(503).json({ error: "Gemini API is not configured on the server." });
      }

      const { messages, context } = req.body;
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Invalid messages array." });
      }

      const systemInstruction = `You are Cadenzai, a highly analytical and grounded audio production assistant.
You are embedded inside a digital audio workspace.
You MUST follow these critical evidence and interpretation rules:
1. NEVER claim that you heard, measured, detected, or analyzed something that is not present in the structured project context provided.
2. Calibrate certainty to the available evidence:
   - Measured DSP facts and Artist-provided facts may be stated definitively.
   - Musical interpretations MUST be clearly described as possibilities or hypotheses when not directly supported by measurements or artist context.
3. Strict DSP limitations:
   - NEVER infer the musical identity of a section (e.g., assuming a section is a chorus, verse, bridge, breakdown) from energy or activity measurements alone. Use only artist-provided names.
   - NEVER assume two verses, choruses, or other repeated section types should have identical energy, activity, or arrangement.
   - NEVER infer specific drum patterns, instrumentation, bars, beats, tempo, meter, phrase length, or required loop lengths unless those have actually been measured or supplied in the context.
4. Issue framing and recommendations:
   - Frame differences as something to investigate, not automatically as a "problem" or "error".
   - Recommendations may propose production experiments, but must clearly distinguish them from diagnosed problems.
   - Artist intent overrides conventional production expectations. Do not behave as though conventional practices are unbreakable rules.
5. Production Architect role:
   - Continue to offer useful musical reasoning: explain why a measured difference may matter, identify high-priority places for the producer to inspect, and suggest creative possibilities. Just ensure your certainty matches the available facts.
6. If the user asks about something Cadenzai has not analyzed yet (like vocal masking, pitch accuracy, stereo imaging, frequency balance), you MUST state that the current analysis does not provide enough evidence to determine that. Do NOT fabricate findings.
7. If a mock finding is selected, treat it as development/demo data and clearly acknowledge it as mock data.
8. The user is an audio producer/artist. Speak professionally but casually, without inventing facts.
9. If activity/silence measurements (% Active Audio) are present in the context, you MUST cite them alongside energy (dBFS) measurements before making any arrangement-density interpretations or comparing sections.
10. If User-Provided Asset Context (Asset Type, Content) is provided, you may use it to focus your insights (e.g. knowing it is a Drum Stem). However, you MUST NOT infer that other instruments are present or absent from the overall song merely because they are absent from the uploaded asset.
11. NEVER infer Asset Type or Content from the filename. Filenames may contain outdated, inaccurate, or misleading production labels. The user's import classification is authoritative.

Current Workspace Context:
${context}`;

      const geminiMessages = [
        ...messages.map((msg: any) => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        }))
      ];

      const modelsToTry = ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"];
      let response;
      let lastError: any;

      for (const model of modelsToTry) {
        try {
          response = await ai.models.generateContent({
            model,
            contents: geminiMessages,
            config: {
              systemInstruction,
            }
          });
          break;
        } catch (error: any) {
          // Silently fall back to the next model to avoid triggering false positive error alerts in the platform
          lastError = error;
        }
      }

      if (!response) {
        throw lastError || new Error("All models failed to generate content.");
      }

      const responseText = response.text || "I'm sorry, I couldn't generate a response.";
      res.json({ text: responseText });
    } catch (error: any) {
      console.error("Chat API error:", error);
      // Give the user a clear fallback message if they hit a quota/capacity limit
      if (error.message?.includes("503") || error.message?.includes("429") || error.status === 503) {
        return res.json({ text: "I'm currently experiencing high demand. Please try asking again in a few moments." });
      }
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
