export const config = { runtime: "edge" };

const SYSTEM =
  "You are a friendly voice assistant. Keep every reply to one or two short spoken sentences unless asked for more. " +
  "No markdown, lists, or emojis. Answer in the same language the user speaks.";

const PREFER = ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"];

// Asks Groq which models exist right now, so a retired model name can never break the app.
let cachedModel = "";
async function pickModel(key) {
  if (cachedModel) return cachedModel;
  const r = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: "Bearer " + key },
  });
  if (!r.ok) throw new Error("Could not list models (" + r.status + "): " + (await r.text()));
  const ids = (await r.json()).data.map((m) => m.id);
  for (const p of PREFER) if (ids.includes(p)) return (cachedModel = p);
  const chat = ids.filter((id) => !/whisper|guard|tts|playai|orpheus|embed/i.test(id));
  if (!chat.length) throw new Error("No chat model available on this Groq account.");
  return (cachedModel = chat[0]);
}

export default async function handler(req) {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const key = process.env.GROQ_API_KEY;
  if (!key) return new Response("GROQ_API_KEY is not set in Vercel.", { status: 500 });

  try {
    const { messages = [] } = await req.json();
    const model = await pickModel(key);

    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: 200,
        messages: [{ role: "system", content: SYSTEM }, ...messages.slice(-12)],
      }),
    });

    if (!r.ok) {
      return new Response("Groq error " + r.status + " (model " + model + "): " + (await r.text()), { status: 502 });
    }

    const dec = new TextDecoder();
    const enc = new TextEncoder();
    let buf = "";

    const stream = r.body.pipeThrough(
      new TransformStream({
        transform(chunk, ctrl) {
          buf += dec.decode(chunk, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop();
          for (const l of lines) {
            if (!l.startsWith("data: ") || l.includes("[DONE]")) continue;
            try {
              const t = JSON.parse(l.slice(6)).choices[0].delta.content;
              if (t) ctrl.enqueue(enc.encode(t));
            } catch {}
          }
        },
      })
    );

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return new Response("Server problem: " + e.message, { status: 502 });
  }
}
