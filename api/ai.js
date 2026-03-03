export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "Only POST" }));
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(500).setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "OPENAI_API_KEY missing in Vercel env vars." }));
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    const prompt = `
Sınıf: ${body["SINIF"]}
Ders: ${body["DERS ADI"]}
Ünite: ${body["ÜNİTE/TEMA/ ÖĞRENME ALANI"]}
Kazanım: ${body["KAZANIM/ÖĞRENME ÇIKTISI/BÖLÜM"]}
Açıklama: ${body["AÇIKLAMA"]}

Yukarıdaki açıklamadaki önerilerden BİRİNİ seç ve ${body["SINIF"]}. sınıf seviyesine uygun, uygulanabilir bir öğretim senaryosu yaz.
`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.7,
        messages: [
          { role: "system", content: "Sen bir öğretim tasarımcısısın." },
          { role: "user", content: prompt },
        ],
      }),
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw_text: text }; }

    if (!r.ok) {
      res.status(r.status).setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({
        error: data?.error?.message || "OpenAI API error",
        details: data
      }));
    }

    const out = data?.choices?.[0]?.message?.content || "Yanıt alınamadı.";
    res.status(200).setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ title: "AI Senaryosu", text: out }));
  } catch (e) {
    res.status(500).setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: String(e) }));
  }
}
