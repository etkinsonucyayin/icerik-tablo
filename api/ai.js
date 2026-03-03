export default async function handler(req, res) {

if (req.method !== "POST") {
  return res.status(405).json({ error: "Only POST" });
}

const body = req.body;

const prompt = `
Sınıf: ${body["SINIF"]}
Ders: ${body["DERS ADI"]}
Ünite: ${body["ÜNİTE/TEMA/ ÖĞRENME ALANI"]}
Kazanım: ${body["KAZANIM/ÖĞRENME ÇIKTISI/BÖLÜM"]}
Açıklama: ${body["AÇIKLAMA"]}

Yukarıdaki bilgilerden birini seç ve ${body["SINIF"]}. sınıf seviyesine uygun,
uygulanabilir bir sınıf içi öğretim senaryosu oluştur.
`;

const response = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
  },
  body: JSON.stringify({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: "Sen bir öğretim tasarımcısısın." },
      { role: "user", content: prompt }
    ]
  })
});

const data = await response.json();

res.status(200).json({
  title: "AI Senaryosu",
  text: data.choices[0].message.content
});
}
