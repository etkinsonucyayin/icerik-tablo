const OpenAI = require("openai").default;

function pickContentMode(contentType = "") {
  const t = String(contentType).toLowerCase();
  if (t.includes("simülasyon") || t.includes("simulasyon")) return "simulation";
  if (t.includes("etkileşim") || t.includes("interaktif") || t.includes("oyun")) return "interactive";
  if (t.includes("video") || t.includes("belgesel") || t.includes("film")) return "video";
  if (t.includes("ses")) return "audio";
  return "general";
}

function analyzeOutcomeCode(outcomeText = "") {
  const text = String(outcomeText || "").trim();
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

function storylineTemplate(mode) {
  const common = `
--- DİJİTAL ÜRETİM PLANI (Articulate Storyline 360 / SCORM 1.2) ---

EKRAN (SLIDE) BAZLI AKIŞ:
Her ekran (slide) için aşağıdaki yapı standarttır.

SLIDE [No]:[Slide Adı/Amacı]
1. PEDAGOJİK HEDEF: (Bu ekranda öğrenci ne öğrenecek/ne yapacak?)
2. GÖRSEL/İŞİTSEL TASARIM (YAPIMCI): (Ekranda ne görünecek? Hangi materyaller kullanılacak? Animasyon ne olacak?)
3. ETKİLEŞİM MEKANİĞİ (YAPIMCI): (Öğrenci nereye tıklayacak? Hangi Trigger/Layer'lar çalışacak?)
4. ERİŞİLEBİLİRLİK (YAPIMCI): (Sesli betimleme, disleksi uyumlu font, renk kontrastı notları)

✍️ YAZARIN DOLDURACAĞI ALANLAR (Bu ekran için):
[ ] EKRAN METNİ: (Lütfen buraya öğrencinin okuyacağı/duyacağı metni yaş seviyesine uygun, sade ve TYMM'ye uygun şekilde yazınız.)
[ ] SORU KÖKÜ VE SEÇENEKLER (Varsa): (Çeldiricisi güçlü, hatasız bir soru yazınız.)
[ ] DOĞRU CEVAP DÖNÜTÜ: (Sadece "Tebrikler" değil, cevabın neden doğru olduğunu açıklayan 1-2 cümle yazınız.)
[ ] YANLIŞ CEVAP DÖNÜTÜ: (Sadece "Yanlış" değil, öğrenciyi doğruya yönlendirecek ipucu/açıklama yazınız.)
`;

  if (mode === "video") {
    return `[İÇERİK TÜRÜ: VIDEO / BELGESEL TASARIMI]\n\n• Video Sahneleri (Kamera açıları, akış)\n• Dış Ses (Voiceover) Yönergeleri\n• Etkileşimli Video (Belirli saniyelerde durup soru sorma mantığı)\n` + common;
  }
  if (mode === "interactive") {
    return `[İÇERİK TÜRÜ: ETKİLEŞİMLİ İÇERİK TASARIMI]\n\n• Etkileşim Türü (Sürükle-bırak, tıklamalı keşif, eşleştirme vb.)\n• Puanlama ve Tamamlama (SCORM Completion) kuralları\n` + common;
  }
  if (mode === "simulation") {
    return `[İÇERİK TÜRÜ: SİMÜLASYON TASARIMI]\n\n• Simülasyonun Değişkenleri (Öğrenci neyi değiştirecek, sonuç nasıl etkilenecek?)\n• Güvenlik/Deney Adımları\n` + common;
  }
  if (mode === "audio") {
    return `[İÇERİK TÜRÜ: SESLİ İÇERİK TASARIMI]\n\n• Seslendirme vurgu/tonlama notları\n• Arka plan efektleri (SFX) planı\n` + common;
  }
  return common;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ title: "Hata", error: "Method not allowed" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ title: "AI Hatası", error: "OPENAI_API_KEY bulunamadı" });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const row = req.body || {};

    const grade = String(row["SINIF"] ?? "").trim();
    const course = String(row["DERS ADI"] ?? "").trim();
    const unit = String(row["ÜNİTE/TEMA/ ÖĞRENME ALANI"] ?? "").trim();
    const outcome = String(row["KAZANIM/ÖĞRENME ÇIKTISI/BÖLÜM"] ?? "").trim();
    const contentType = String(row["E-İÇERİK TÜRÜ"] ?? "").trim();
    
    let desc = String(row["AÇIKLAMA"] ?? "").trim();
    if (row.forceChoiceText) desc = String(row.forceChoiceText).trim();

    const mode = row.forceMode ? String(row.forceMode) : pickContentMode(contentType);
    const template = storylineTemplate(mode);
    const codeInfo = analyzeOutcomeCode(outcome);

    // AI'ın Rolü, Kesin Sınırları ve Kuralları (System Prompt)
    const systemInstruction = `
Sen, Milli Eğitim Bakanlığı (MEB) Talim Terbiye Kurulu Başkanlığı (TTKB) "E-İçerik İnceleme Kriterleri" (Kılavuz sayfa 707-749 arası) ile "Türkiye Yüzyılı Maarif Modeli (TYMM)" felsefesine tam hâkim Baş Öğretim Tasarımcısı (Senior ID) ve E-İçerik Denetmenisin.

GÖREVİN:
Yazarların (alan uzmanlarının) içerik metinlerini hazırlaması için bir taslak oluşturmak ve aynı zamanda bu içeriği geliştirecek bilişimcilere (Storyline vb. araçları kullanan yapımcılara) net, teknik bir iş emri vermektir.

MUTLAK UYULMASI GEREKEN TTKB & MEB KURALLARI (KIRMIZI ÇİZGİLER):
1. MÜFREDATA SADAKAT: Verilen açıklama ve kazanımın sınırları aşılamaz. Asla farklı bir konu anlatımına girilmez. Yaş grubuna bilişsel olarak ağır gelecek akademik terimler veya çok basit kalacak çocuksu ifadeler (örn. lise öğrencisine çizgi film dili) kullanılamaz.
2. DÖNÜT/DÜZELTME STANDARDI: Etkileşimlerde "Tebrikler" veya "Yanlış" gibi basit kelimeler yeterli DEĞİLDİR. Neden doğru/yanlış olduğunu açıklayan yapılandırıcı geri bildirim metni boşlukları tasarlanmalıdır.
3. KULLANICI DENEYİMİ (UX/UI): Ekrana yığınla metin konulmaz, "chunking" (parçalama) yapılır. Öğrenci sadece "İleri" butonuna basan pasif izleyici olamaz, anlamlı bir etkileşime sokulmalıdır.
4. ERİŞİLEBİLİRLİK: SCORM 1.2 tamamlama şartları ve EBA'ya uyumlu hafif dosya boyutu (medya optimizasyonu) prensipleri geliştiriciye hatırlatılmalıdır.
`;

    const userPrompt = `
LÜTFEN AŞAĞIDAKİ GİRDİLERE GÖRE TTKB STANDARTLARINDA BİR SENARYO İŞ EMRİ OLUŞTUR:

GİRDİLER:
- Sınıf Seviyesi: ${grade}
- Ders: ${course}
- Ünite/Öğrenme Alanı: ${unit}
- Kazanım / Çıktı: ${outcome}
- E-İçerik Türü: ${contentType}
- İçerik Kısıtı / Açıklama: ${desc}
${codeInfo ? `- Kazanım Kodu: ${codeInfo.raw}` : ""}

AŞAĞIDAKİ BAŞLIK VE YAPIYI BİREBİR KULLANARAK ÇIKTI VER:

### 1. KAZANIMIN SINIRLARI VE YAZARA UYARILAR
- BU İÇERİKTE NELERDEN KESİNLİKLE BAHSEDİLMEMELİ: (Müfredat dışına çıkmamak için kırmızı çizgileri belirt)
- DİL VE YAŞ SEVİYESİ UYARISI: (Bu sınıf düzeyindeki öğrencinin pedagojik durumu)
- VURGULANACAK DEĞER/BECERİ (TYMM): (Kazanımla uyumlu 21. yy becerisi veya kök değer)

### 2. TTKB PEDAGOJİK TASARIM VE ERİŞİLEBİLİRLİK PLANI
- UI/UX ve Erişilebilirlik Yönergeleri: (Renk kontrastı, font, sesli betimleme)
- Geri Bildirim Yaklaşımı: (Dönütlerin nasıl kurgulanacağı)

### 3. EKRAN EKRAN STORYBOARD (SENARYO) TASLAĞI
(Aşağıdaki formata göre sahneleri / ekranları planla. Lütfen yazarın metin yazacağı yerleri "✍️ YAZARIN DOLDURACAĞI ALANLAR" başlığıyla açıkça göster ki yazar nereyi dolduracağını bilsin.)

${template}

### 4. BİLİŞİM/YAPIM EKİBİ İÇİN SCORM & EBA TEKNİK KONTROL LİSTESİ
(Bu e-içeriğin EBA portalinde sorunsuz çalışması ve TTKB denetiminden geçmesi için yapımcının uyması gereken 5 kritik teknik zorunluluk)
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o", // Gpt-4o modeli kullanıldı (Kalite ve muhakeme için)
      temperature: 0.2, // Sıcaklık düşürüldü (Tutarlılık ve ciddiyet için)
      messages:[
        { role: "system", content: systemInstruction },
        { role: "user", content: userPrompt },
      ],
    });

    const text = completion.choices?.[0]?.message?.content || "Boş yanıt";

    return res.status(200).json({
      title: `${grade}. Sınıf ${course} - E-İçerik Üretim Senaryosu`,
      text,
      meta: { grade, course, unit, outcome, contentType, mode, outcomeCode: codeInfo?.raw || null },
    });
  } catch (error) {
    return res.status(500).json({
      title: "AI Hatası",
      error: error?.message || String(error),
    });
  }
};
