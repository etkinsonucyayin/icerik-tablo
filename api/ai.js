const OpenAI = require("openai").default;

/**
 * İçerik türü sınıflandırma (CSV'deki "E-İÇERİK TÜRÜ" alanına göre)
 */
function pickContentMode(contentType = "") {
  const t = String(contentType).toLowerCase();

  if (t.includes("simülasyon") || t.includes("simulasyon")) return "simulation";
  if (t.includes("etkileşim") || t.includes("interaktif") || t.includes("oyun"))
    return "interactive";
  if (t.includes("video") || t.includes("belgesel") || t.includes("film"))
    return "video";
  if (t.includes("ses")) return "audio";

  return "general";
}

/**
 * Kazanım kodunu (varsa) yakalamak için basit analiz:
 * Örn: "HB.3.1.1." / "FEN.8.2.3" / "T.7.3.2" vb.
 * Not: MEB'de kod standartları değişken olabilir; bu yüzden "best-effort".
 */
function analyzeOutcomeCode(outcomeText = "") {
  const text = String(outcomeText || "").trim();

  // En yaygın biçim: HARF(.HARF)* . SINIF . BÖLÜM . KAZANIM
  // Örn HB.3.1.1  |  F.8.2.3  |  T.7.3.2  |  MAT.10.1.2
  const m = text.match(/\b([A-ZÇĞİÖŞÜ]{1,6})\s*\.?\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,3})\b/u);
  if (!m) return null;

  return {
    raw: m[0],
    prefix: m[1],
    gradeFromCode: m[2],
    strandOrUnit: m[3],
    outcomeIndex: m[4],
  };
}

/**
 * Storyline çıktı şablonu
 * - YAZARIN GÖREVİ sadece metin/soru içeren slaytlarda
 * - Yapımcı (Storyline ekibi) için teknik uygulanabilirlik yüksek
 */
function storylineTemplate(mode) {
  const common = `
ZORUNLU FORMAT (Articulate Storyline 360 / SCORM / EBA)

Storyboard yapısı:
Scene → Slide listesi

HER SLIDE için mutlaka yaz:
• Slide adı
• Amaç
• Görsel / asset listesi (varsa telif/üretim notu)
• Etkileşim türü (varsa)
• Storyline uygulama notu (trigger / layer / state / variable)
• Erişilebilirlik notu (alt metin, klavye kullanımı, renk kontrastı vb.)

EK KURAL (ÇİFT KANAL):
- YAZARIN GÖREVİ sadece şu durumlarda eklenir:
  (a) ekranda okunacak metin varsa, (b) soru/ölçme varsa, (c) doğru-yanlış geri bildirim metni varsa,
  (d) seslendirme metni gerekiyorsa.
- Metin/soru yoksa YAZARIN GÖREVİ yazma (sadece yapımcı notları yeterli).

YAZARIN GÖREVİ (sadece metin/soru içeren slaytlarda):
• [YAZAR DOLDURACAK] Ekran metni (sınıf seviyesine uygun)
• [YAZAR DOLDURACAK] 1-2 gerçek yaşam örneği (kısa)
• [YAZAR DOLDURACAK] Kavram/terim açıklamaları (gerekirse)
• [YAZAR DOLDURACAK] Soru kökü + seçenekler (varsa)
• [YAZAR DOLDURACAK] Doğru geri bildirim metni (varsa)
• [YAZAR DOLDURACAK] Yanlış geri bildirim metni (varsa)

YAPIMCININ GÖREVİ (her slaytta):
• Trigger / Layer / State / Variable planı
• Medya yerleşimi + optimizasyon
• SCORM completion önerisi (SCORM 1.2; completion ölçütü)
• EBA için yayınlama/performans notu
`;

  if (mode === "video") {
    return `
İÇERİK TÜRÜ: VIDEO / BELGESEL

Beklenen çıktı:
• Video storyboard (sahneler, kamera/görsel plan, seslendirme)
• Storyline içine yerleştirme planı (giriş ekranı + oynatıcı + kontrol)
• Video sonu ölçme / kısa pekiştirme

` + common;
  }

  if (mode === "interactive") {
    return `
İÇERİK TÜRÜ: ETKİLEŞİMLİ İÇERİK

Beklenen çıktı:
• Öğrenci akışı (başla → etkileşim → geri bildirim → pekiştirme → ölçme)
• Etkileşim kuralları (doğru/yanlış, ipucu, tekrar, puan)
• Buton/hotspot tasarımı
• Puan/ilerleme mantığı (progress, score vb.)

` + common;
  }

  if (mode === "simulation") {
    return `
İÇERİK TÜRÜ: SİMÜLASYON

Beklenen çıktı:
• Simülasyon amacı ve sınırları
• Parametreler (kullanıcı girdileri) ve değişkenler
• Aşamalar (adım adım)
• Sonuç ekranı ve geri bildirim

` + common;
  }

  if (mode === "audio") {
    return `
İÇERİK TÜRÜ: SES / ANLATIM

Beklenen çıktı:
• Sesli anlatım akışı (bölümler)
• (Varsa) ekranda eşlik eden metin/infografik planı
• Ses efektleri / vurgu notları

` + common;
  }

  return common;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ title: "Hata", error: "Method not allowed" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        title: "AI Hatası",
        error: "OPENAI_API_KEY bulunamadı",
      });
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

    const mode = row.forceMode ? String(row.forceMode) : pickContentMode(contentType);
    const template = storylineTemplate(mode);

    const codeInfo = analyzeOutcomeCode(outcome);

    const userPrompt = `
ROLÜN
Sen MEB için çalışan kıdemli bir e-öğrenme tasarımcısı ve eğitim teknolojileri uzmanısın.
Çıktın hem e-içerik yapımcısının (Storyline/SCORM) uygulayacağı kadar teknik, hem de yazarın/öğretmenin
nerede neyi düzenleyeceğini anlayacağı kadar yönlendirici olmalı.

KAYNAK ÇERÇEVESİ (TYMM + öğretim programı yaklaşımı)
- Türkiye Yüzyılı Maarif Modeli (TYMM) öğretim programlarının genel yaklaşımıyla uyumlu kal:
  • kazanım odaklılık, yaş düzeyi, aşamalılık
  • değerler/becerilerle uyum
  • hedef dışına taşmama, konu kapsamını gereksiz genişletmeme
- Öğretim programı sınırlarını belirlerken "açıklama + kazanım + sınıf seviyesi" dışına çıkma.
- Emin olmadığın detaylarda muhafazakâr ol: sadece verilen metne sadık kal.

E-İÇERİK KRİTERLERİ (özet)
• pedagojik uygunluk • hedef ile uyum • etkileşim • geri bildirim
• ölçme değerlendirme • erişilebilirlik • teknik kalite

ASLA
• açıklamada olmayan yeni etkinlik/amaç uydurma
• içerik türünü değiştirme
• kazanım dışı konu ekleme

GİRDİLER
- Sınıf: ${grade}
- Ders: ${course}
- Ünite/Tema/Alan: ${unit}
- Kazanım: ${outcome}
- İçerik Türü (sütun): ${contentType}
- Sıra No: ${sıra}
- Seçilen Açıklama: ${desc}

KAZANIM KODU ANALİZİ (best-effort)
${codeInfo ? `- Yakalanan kod: ${codeInfo.raw}
- Kısaltma/prefix: ${codeInfo.prefix}
- Koddan sınıf: ${codeInfo.gradeFromCode}
- Alan/ünite ipucu: ${codeInfo.strandOrUnit}
- Kazanım sıra: ${codeInfo.outcomeIndex}
` : `- Kazanım kodu net yakalanamadı. Yine de metindeki kazanım ifadesini esas al.`}

İSTENEN ÇIKTI (SIRAYLA, BAŞLIKLARLA)

1) SEÇİLEN SENARYO TALEBİ (1-2 satır)
Açıklamadaki hangi ifadeyi esas aldığını yaz.

2) TYMM / ÖĞRETİM PROGRAMI SINIRLILIKLARI (madde madde)
- Bu kazanım ve sınıf düzeyinde içerikte NELER yapılmamalı?
- Konu kapsamı nerede bitmeli?
- Dil/örnek düzeyi (yaşa uygunluk) sınırı.
- (Varsa) değer/beceri vurgusu: kazanımı destekleyecek kadar, aşırı genellemeden.

3) PEDAGOJİK ANALİZ (kısa ve net)
- Öğrenme hedefi (kazanıma göre)
- Önkoşul bilgi/yanılgılar (2-3 madde)
- Öğrenci düzeyi uyarlaması (bu sınıf için)

4) İÇERİK TASARIM STRATEJİSİ
- İçerik türü neden uygun? (video/etkileşim/simülasyon/ses)
- Öğrenci akışı (başla→öğren→uygula→pekiştir→ölç)
- Geri bildirim yaklaşımı

5) STORYLINE SENARYOSU (Scene → Slide)
${template}

Önemli: "YAZARIN GÖREVİ" sadece metin/soru içeren slaytlarda yer alacak.
Yazarın dolduracağı yerleri mutlaka [YAZAR DOLDURACAK: ...] etiketiyle işaretle.

6) ÖLÇME-DEĞERLENDİRME
- En az 3 soru (içerik türüne uygun: video sonrası kısa ölçme / etkileşim içi kontrol vb.)
- Doğru/yanlış geri bildirim metinleri (yazar bloğu olan slaytlarda)

7) TESLİM KONTROL LİSTESİ (10-14 madde)
- pedagojik uygunluk, erişilebilirlik, medya optimizasyonu, SCORM completion, EBA uyumu vb.

8) AÇIKLAMAYA UYGUNLUK (3 madde)
Açıklamadaki şartları nasıl karşıladığını madde madde yaz.

9) ÜRETİM TAHMİNLERİ
- Tahmini video süresi (varsa)
- Tahmini öğrenci etkileşim süresi
- Tahmini geliştirme süresi (Storyline üretimi + test + SCORM paket)

Çıktı dili: Türkçe. Madde madde. Teknik ekip için uygulanabilir.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.35,
      messages: [
        {
          role: "system",
          content:
            "Sen MEB için e-içerik üretim senaryosu hazırlayan kıdemli instructional designer'sın. Açıklamaya ve kazanıma sadık kalır; hedef dışına taşmaz; uygulanabilir Storyline/SCORM yönergesi üretirsin.",
        },
        { role: "user", content: userPrompt },
      ],
    });

    const text = completion.choices?.[0]?.message?.content || "Boş yanıt";

    return res.status(200).json({
      title: "E-İçerik Senaryo Dokümanı",
      text,
      meta: {
        grade,
        course,
        unit,
        outcome,
        contentType,
        mode,
        outcomeCode: codeInfo?.raw || null,
      },
    });
  } catch (error) {
    return res.status(500).json({
      title: "AI Hatası",
      error: error?.message || String(error),
    });
  }
};
