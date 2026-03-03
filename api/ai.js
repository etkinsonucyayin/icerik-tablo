const OpenAI = require("openai");

function pickContentMode(contentType = "") {
  const t = String(contentType).toLowerCase();
  if (t.includes("simülasyon") || t.includes("simulasyon")) return "simulation";
  if (t.includes("oyun") || t.includes("etkileşim") || t.includes("interaktif")) return "interactive";
  if (t.includes("video") || t.includes("belgesel") || t.includes("film")) return "video";
  return "general";
}

function formatTemplate(mode) {
  if (mode === "video") return `
TESLİM ŞABLONU (VIDEO):
- Süre (dk) ve hedef kitle notu
- Sahne sahne akış (S1, S2, S3...)
- Anlatım dili / ton
- Görsel stil (animasyon/çekim/infografik)
- Seslendirme metni taslağı (kısa, uygulanabilir)
- Kullanılacak görseller/öğeler listesi
- Prodüksiyon notları (ekibe yönelik)
`;
  if (mode === "interactive") return `
TESLİM ŞABLONU (ETKİLEŞİMLİ/OYUN):
- Öğrenen akışı (başla → görevler → geri bildirim → bitiş)
- Ekranlar ve bileşenler (E1, E2...)
- Etkileşim kuralları
- Geri bildirim / puan / rozet mantığı (varsa)
- İçerik metinleri (kısa örnekler)
- Teknik notlar (web/mobil, veri tutulacak mı vb. basitçe)
`;
  if (mode === "simulation") return `
TESLİM ŞABLONU (SİMÜLASYON):
- Simülasyon amacı ve senaryosu
- Parametreler (kullanıcının değiştireceği değerler)
- Gözlemlenecek çıktılar (grafik/sayaç/tablolar vb.)
- Aşamalar (A1, A2...)
- Hata/uyarı mesajları örnekleri
- Teknik notlar (web/mobil, basit veri akışı)
`;
  return `
TESLİM ŞABLONU (GENEL):
- Amaç ve kapsam
- Akış (adım adım)
- İçerik parçaları listesi
- Teknik notlar
`;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ title: "Hata", error: "Method not allowed" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ title: "AI Hatası", error: "OPENAI_API_KEY tanımlı değil (Vercel Env ekleyin)." });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const row = req.body || {};

    const grade = String(row["SINIF"] ?? "").trim();
    const course = String(row["DERS ADI"] ?? "").trim();
    const unit = String(row["ÜNİTE/TEMA/ ÖĞRENME ALANI"] ?? "").trim();
    const outcome = String(row["KAZANIM/ÖĞRENME ÇIKTISI/BÖLÜM"] ?? "").trim();
    const contentType = String(row["E-İÇERİK TÜRÜ"] ?? "").trim();
    const sıra = String(row["SIRA NO"] ?? "").trim();

    let desc = String(row["AÇIKLAMA"] ?? "").trim();
    if (row.forceChoiceText) desc = String(row.forceChoiceText).trim();

    const mode = row.forceMode ? String(row.forceMode).trim() : pickContentMode(contentType);
    const template = formatTemplate(mode);

    const userPrompt = `
Sen bir "E-İçerik Üretim Senaryosu" uzmanısın.
Çıktın teknik ekibe (video/yazılım/tasarım) verilecek dokümandır.

KATI KURALLAR:
- AÇIKLAMA metninde yazmayan yeni etkinlik/amaç/içerik türü ekleme.
- Sadece verilen verilerden hareket et: sınıf, ders, ünite, kazanım, içerik türü, açıklama.
- Sınıf seviyesi (${grade}. sınıf) dili ve düzeyi belirler.
- Çıktı uygulanabilir, net ve madde madde olsun.

GİRDİLER:
- Sınıf: ${grade}
- Ders: ${course}
- Ünite/Tema/Alan: ${unit}
- Kazanım: ${outcome}
- İçerik Türü (sütun): ${contentType}
- Sıra No: ${sıra}
- (Seçilen) Açıklama: ${desc}

İSTENEN:
1) Seçilen senaryo talebi (1-2 satır)
2) Kapsam ve hedef (kısa)
3) Şablona göre üret:
${template}
4) Kontrol listesi (8-12 madde)
5) Açıklamaya uygunluk (3 madde)

Türkçe yaz.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.35,
      messages: [
        { role: "system", content: "Açıklamaya sadık kalan e-içerik dokümanı yazan uzmansın." },
        { role: "user", content: userPrompt }
      ]
    });

    const text = completion.choices?.[0]?.message?.content || "Boş yanıt";

    return res.status(200).json({
      title: "E-İçerik Senaryo Dokümanı",
      text,
      meta: { grade, course, unit, outcome, contentType, mode }
    });

  } catch (error) {
    return res.status(500).json({
      title: "AI Hatası",
      error: error?.message || String(error)
    });
  }
};
