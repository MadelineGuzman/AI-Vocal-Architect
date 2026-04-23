const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const systemPrompt = `You are an expert audio engineer and vocal producer. A user will describe a vocal sound or style in natural language. Your job is to map their description to one of these five preset keys: cleanNatural, aggressiveRap, choppedScrewed, autotuneVibe, smoothRnB, gospelChoir, loFiBedroom, drillDarkTrap. Also return a recommended intensity from 1-10 and a one-sentence plain-English description of what the vocal will sound like. Respond ONLY with valid JSON in this exact format with no markdown or extra text: {"presetKey": "aggressiveRap", "intensity": 8, "description": "Punchy, upfront trap vocal with tight compression and aggressive presence."}`;

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    try {
      const { style } = await request.json();

      const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": "Bearer __OPENAI_KEY__",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: String(style || "") }
          ]
        })
      });

      const responseBody = await openAiResponse.text();

      return new Response(responseBody, {
        status: openAiResponse.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
