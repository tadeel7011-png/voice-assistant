export const config = { runtime: "edge" };

const SYSTEM =
  "You are a friendly voice assistant. Reply in short, natural spoken sentences. " +
  "No markdown, lists, or emojis. Answer in the same language the user speaks.";

export default async function handler(req) {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const { messages = [] } = await req.json();

  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + process.env.GROQ_API_KEY,
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant", // if Groq retires it, pick a current model from console.groq.com
      stream: true,
      max_tokens: 300,
      messages: [{ role: "system", content: SYSTEM }, ...messages.slice(-12)],
    }),
  });

  if (!r.ok) return new Response(await r.text(), { status: r.status });

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
}