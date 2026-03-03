const OpenAI = require("openai").default;

function pickContentMode(contentType = "") {
  const t = String(contentType).toLowerCase();
  if (t.includes("simülasyon") || t.includes("simulasyon")) return "simulation";
  if (t.includes("oyun") || t.includes("etkileşim") || t.includes("interaktif")) return "interactive";
  if (t.includes("video") || t.includes("belgesel") || t.includes("film")) return "video";
  return "general";
}

function storylineTemplate(mode) {
  // Storyline/SCORM için ortak iskelet
  const common = `
ZORUNLU FORMAT (Articulate Storyline 360 / SCORM / EBA):
- Storyboard: Scene → Slide listesi (numaralı)
- Her slide için mutlaka:
  - Amaç
  - Ekran metni (kısa ve uygulanabilir)
  - Görsel/asset listesi
  - Etkileşim (butonlar, hotspotlar, giriş alanı vs.)
  - Trigger / State / Layer taslağı (Storyline mantığıyla)
  - Değişkenler (varsa: score, attempts, step, progress vb.)
  - Geri bildirim (Doğru/Yanlış layer, ipucu layer vb.)
  - Seslendirme notu (varsa)
  - Erişilebilirlik notu (alt metin, klavye ile erişim)
- Yayınlama Notu:
  - SCORM önerisi: varsayılan SCORM 1.2 (kurum farklı istiyorsa uyarlanabilir)
  - Completion kriteri önerisi (örn: tüm slaytlar görüntülendi + quiz tamamlandı)
  - EBA yükleme için medya optimizasyonu (dosya boyutu, video çözünürlüğü, font gömme vb.)
`;

  if (mode === "video") {
    return `
İÇERİK TÜRÜ: VIDEO / BELGESEL / KISA FİLM
- Süre önerisi (dk) + hedef kitle/seviye notu
- Sahne sahne akış (S1, S2, S3...)
- Anlatım dili / ton
- Görsel stil (çekim / animasyon / infografik)
- Seslendirme metni taslağı (kısa, uygulanabilir)
- Kullanılacak görseller/asset listesi
- Çekim/kurgu notları (ekibe yönelik)

Ayrıca video Storyline içine gömülecekse:
- Video yerleşimi (hangi slaytta)
- Oynat/Duraklat butonları
- İzleme tamamlanınca tetiklenen trigger (tamamlandı say)
` + common;
  }

  if (mode === "interactive") {
    return `
İÇERİK TÜRÜ: ETKİLEŞİMLİ / OYUN (Storyline 360)
- Öğrenen akışı (başla → görevler → geri bildirim → bitiş)
- Etkileşim kuralları
- Puan/rozet/ilerleme mantığı (varsa, basit)
- Geri bildirim dili (kısa, motive edici)
` + common;
  }

  if (mode === "simulation") {
    return `
İÇERİK TÜRÜ: SİMÜLASYON (Storyline 360)
- Simülasyon amacı ve senaryosu
- Parametreler (kullanıcının değiştireceği değerler)
- Çıktılar (grafik/sayaç/tablolar)
- Aşamalar (A1, A2...)
- Uyarı/hata mesajları örnekleri
` + common;
  }

  return `
İÇERİK TÜRÜ: GENEL
` + common;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ title: "Hata", error: "Method not allowed" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ title: "AI Hatası", error: "OPENAI_API_KEY yok. Vercel Env ekleyin." });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const row = req.body || {};

    const grade = String(row["SINIF"] ?? "").trim();
    const course = String(row["DERS ADI"] ?? "").trim();
    const unit = String(row["ÜNİTE/TEMA/ ÖĞRENME ALANI"] ?? "").trim();
    const outcome = String(row["KAZANIM/ÖĞRENME ÇIKTISI/BÖLÜM"] ?? "").trim();
    const contentType = String(row["E-İÇERİK TÜRÜ"] ?? "").trim();
    const sıra = String(row["SIRA NO"] ?? "").trim();

    // Açıklama: öğretmen seçim yaptıysa forceChoiceText gelir; onu esas al
    let desc = String(row["AÇIKLAMA"] ?? "").trim();
    if (row.forceChoiceText) desc = String(row.forceChoiceText).trim();

    // Mod: öğretmen forceMode seçtiyse onu esas al; yoksa içerik türünden tahmin et
    const mode = row.forceMode ? String(row.forceMode).trim() : pickContentMode(contentType);

    const template = storylineTemplate(mode);

    const userPrompt = `
Sen bir "E-İçerik Üretim Senaryosu" uzmanısın.
Çıktın öğretmene değil; e-içerik üreten bilgi işlem/tasarım birimine verilecek teknik dokümandır.
Ekip Articulate Storyline 360 kullanır ve SCORM paketi üretip EBA (MEB) platformuna yükler.

KATI KURALLAR:
- AÇIKLAMA metninde yazmayan yeni etkinlik, yeni amaç, yeni içerik türü uydurma.
- Sadece verilen verilerden hareket et: sınıf, ders, ünite, kazanım, içerik türü, açıklama.
- Sınıf seviyesi (${grade}. sınıf) dili ve bilişsel düzeyi belirler (küçük sınıflarda sade, üst sınıflarda daha teknik).
- Açıklamadaki istekleri "en yapılabilir" şekilde teknik ekibe devredilebilir hale getir.

GİRDİLER:
- Sınıf: ${grade}
- Ders: ${course}
- Ünite/Tema/Alan: ${unit}
- Kazanım: ${outcome}
- İçerik Türü (sütun): ${contentType}
- Sıra No: ${sıra}
- Seçilen Açıklama: ${desc}

İSTENEN ÇIKTI:
1) Seçilen senaryo talebi: Açıklamadaki hangi ifadeye göre ürettiğini 1-2 satırda belirt.
2) Kapsam ve hedef: Kazanımı nasıl karşılıyor? (kısa)
3) Aşağıdaki formatla senaryoyu üret:

${template}

4) Kontrol listesi: Teslim öncesi 10-14 maddelik kontrol listesi.
5) Açıklamaya uygunluk: 3 maddeyle açıklamadaki şartların nasıl karşılandığını yaz.

Çıktı dili: Türkçe, madde madde, çok net.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.35,
      messages: [
        {
          role: "system",
          content:
            "Açıklamaya sadık kalan e-içerik üretim dokümanı yazan uzmansın. Yeni hedef/etkinlik uydurmazsın. Çıktın Storyline/SCORM üretim ekibine yöneliktir."
        },
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
