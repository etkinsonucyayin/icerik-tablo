const OpenAI = require("openai").default;

function pickContentMode(contentType = "") {
  const t = String(contentType).toLowerCase();

  if (t.includes("simülasyon") || t.includes("simulasyon"))
    return "simulation";

  if (
    t.includes("etkileşim") ||
    t.includes("interaktif") ||
    t.includes("oyun")
  )
    return "interactive";

  if (
    t.includes("video") ||
    t.includes("belgesel") ||
    t.includes("film")
  )
    return "video";

  if (t.includes("ses")) return "audio";

  return "general";
}

function storylineTemplate(mode) {

  const common = `
ZORUNLU FORMAT (Articulate Storyline 360 / SCORM / EBA):

Storyboard yapısı kullan:

Scene → Slide listesi

Her slide için mutlaka yaz:

• Amaç  
• Ekran metni (kısa ve uygulanabilir)  
• Görsel / asset listesi  
• Etkileşim türü  
• Storyline trigger mantığı  
• Layer yapısı  
• State kullanımı  
• Değişkenler (score, progress vb.)  
• Geri bildirim mesajları  
• Seslendirme notu  
• Erişilebilirlik notu (alt metin vb.)

Yayınlama Notu:

• SCORM önerisi: SCORM 1.2  
• Completion kriteri  
• EBA yükleme için medya optimizasyonu  
`;

  if (mode === "video") {
    return `
İÇERİK TÜRÜ: VIDEO / BELGESEL

• Önerilen video süresi
• Sahne akışı
• Kamera / görsel stil
• Seslendirme metni
• Kullanılacak grafik ve animasyonlar
• Storyline içine yerleştirme planı

` + common;
  }

  if (mode === "interactive") {
    return `
İÇERİK TÜRÜ: ETKİLEŞİMLİ İÇERİK

• Öğrenci akışı
• Etkileşim kuralları
• Buton / hotspot tasarımı
• Geri bildirim mesajları
• Puan / ilerleme mantığı

` + common;
  }

  if (mode === "simulation") {
    return `
İÇERİK TÜRÜ: SİMÜLASYON

• Simülasyon amacı
• Kullanıcı parametreleri
• Değişkenler
• Aşamalar
• Sonuç ekranı

` + common;
  }

  if (mode === "audio") {
    return `
İÇERİK TÜRÜ: SES / ANLATIM

• Podcast veya sesli anlatım yapısı
• Konuşma akışı
• Bölümler
• Ses efektleri

` + common;
  }

  return common;
}

module.exports = async function handler(req, res) {

  try {

    if (req.method !== "POST") {
      return res.status(405).json({
        title: "Hata",
        error: "Method not allowed"
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        title: "AI Hatası",
        error: "OPENAI_API_KEY bulunamadı"
      });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const row = req.body || {};

    const grade = String(row["SINIF"] ?? "").trim();
    const course = String(row["DERS ADI"] ?? "").trim();
    const unit = String(row["ÜNİTE/TEMA/ ÖĞRENME ALANI"] ?? "").trim();
    const outcome = String(row["KAZANIM/ÖĞRENME ÇIKTISI/BÖLÜM"] ?? "").trim();
    const contentType = String(row["E-İÇERİK TÜRÜ"] ?? "").trim();
    const sıra = String(row["SIRA NO"] ?? "").trim();

    let desc = String(row["AÇIKLAMA"] ?? "").trim();

    if (row.forceChoiceText)
      desc = String(row.forceChoiceText).trim();

    const mode = row.forceMode
      ? String(row.forceMode)
      : pickContentMode(contentType);

    const template = storylineTemplate(mode);

    const userPrompt = `

ROLÜN:
Sen MEB için e-içerik geliştiren kıdemli bir eğitim teknolojisi uzmanısın.

Uzmanlık alanların:

• MEB öğretim programları
• e-içerik pedagojisi
• Articulate Storyline 360
• SCORM paketleri
• EBA platformu

ÇALIŞMA İLKELERİ

MEB öğretim programı yaklaşımı:

• kazanım odaklı öğretim
• yaş düzeyine uygunluk
• öğrenci aktifliği
• gerçek yaşam bağlantısı

MEB E-İçerik kriterleri:

• pedagojik uygunluk
• öğrenme hedefi ile uyum
• etkileşim
• geri bildirim
• ölçme değerlendirme
• erişilebilirlik
• teknik kalite

ASLA:

• açıklamada olmayan yeni etkinlik uydurma
• yeni hedef ekleme
• içerik türünü değiştirme


GİRDİLER

Sınıf: ${grade}

Ders: ${course}

Ünite: ${unit}

Kazanım: ${outcome}

İçerik türü: ${contentType}

Sıra: ${sıra}

Açıklama:

${desc}


İSTENEN ÇIKTI

ÖNCE:

1️⃣ PEDAGOJİK ANALİZ

• kazanımın öğrenme hedefi
• sınıf seviyesine uygunluk
• hangi becerileri geliştirdiği


2️⃣ İÇERİK TASARIM STRATEJİSİ

• içerik türünün seçilme nedeni
• öğrencinin öğrenme akışı
• öğretim yaklaşımı


3️⃣ STORYLINE SENARYOSU

${template}


4️⃣ ÖLÇME DEĞERLENDİRME

• en az 3 soru
• doğru geri bildirim
• yanlış geri bildirim


5️⃣ TESLİM KONTROL LİSTESİ

10 maddelik kontrol listesi yaz


6️⃣ AÇIKLAMAYA UYGUNLUK

3 madde ile açıklamadaki şartların nasıl karşılandığını açıkla


7️⃣ ÜRETİM TAHMİNLERİ

• Tahmini video süresi
• Tahmini öğrenci etkileşim süresi
• Tahmini geliştirme süresi


Çıktı:

Türkçe

Madde madde

Teknik ekip için uygulanabilir format
`;

    const completion = await openai.chat.completions.create({

      model: "gpt-4o-mini",

      temperature: 0.35,

      messages: [
        {
          role: "system",
          content:
            "MEB için e-içerik üretim senaryosu yazan uzman bir instructional designer'sın."
        },
        {
          role: "user",
          content: userPrompt
        }
      ]

    });

    const text =
      completion.choices?.[0]?.message?.content || "Boş yanıt";

    return res.status(200).json({
      title: "E-İçerik Senaryo Dokümanı",
      text,
      meta: {
        grade,
        course,
        unit,
        outcome,
        contentType,
        mode
      }
    });

  } catch (error) {

    return res.status(500).json({
      title: "AI Hatası",
      error: error?.message || String(error)
    });

  }

};
