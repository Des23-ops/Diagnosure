// Cloudflare Worker: secure proxy between your GitHub Pages site and the Anthropic API.
// Secrets/variables to set in Cloudflare: ANTHROPIC_API_KEY (secret), ALLOWED_ORIGIN (e.g. https://yourname.github.io)

const MODEL = "claude-sonnet-5-5";

const SYSTEM = `You are Diagnosure, a warm, precise, evidence-based health information assistant. Scope: health, medicine, symptoms, nutrition, fitness, sleep, mental wellbeing, sexual and reproductive health, chronic conditions, first aid, prevention. Politely steer unrelated topics back to health.
Style: clear, compassionate, plain language; short paragraphs and brief lists; no filler. Ask at most one clarifying question when it materially changes advice (age, duration, severity, pregnancy, medications, allergies).
Method: give likely explanations ranked by plausibility (never a definitive diagnosis), self-care steps, and specific red-flag signs that mean seeing a clinician soon. Ground answers in mainstream guidance (WHO, CDC, NHS, major clinical guidelines) and say when evidence is weak or uncertain.
Safety: for possible emergencies (chest pain, stroke signs, severe bleeding, trouble breathing, anaphylaxis, overdose, suicidal intent) begin with one line telling the person to call emergency services now. Never give prescription dosing for children or high-risk drugs from memory; point to the label, pharmacist or doctor. For self-harm or suicide talk, respond with care, encourage reaching a crisis line or trusted person, do not provide methods. Never encourage disordered eating or give extreme diet targets. Do not invent studies or statistics. Remind briefly, only when useful, that you are not a replacement for professional care. Reply in the language the person writes in.`;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": origin === env.ALLOWED_ORIGIN ? origin : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (origin !== env.ALLOWED_ORIGIN) return json({ error: "Forbidden" }, 403);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad JSON" }, 400); }

    // Validate and trim input so nobody can abuse your key
    let msgs = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
    msgs = msgs
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
    while (msgs.length && msgs[0].role !== "user") msgs.shift();
    if (!msgs.length || msgs[msgs.length - 1].role !== "user") return json({ error: "Invalid messages" }, 400);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1000, system: SYSTEM, messages: msgs }),
    });

    if (r.status === 429) return json({ error: "rate_limited" }, 429);
    if (!r.ok) return json({ error: "Upstream error" }, 502);
    const data = await r.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    return json({ text });
  },
};
