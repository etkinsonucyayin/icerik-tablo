const OpenAI = require("openai").default;

// ─── Bloom Taksonomisi Fiil Havuzu ───────────────────────────────────────────
const BLOOM_MAP = {
  hatırla: ["tanımla", "listele", "say", "belirt", "adlandır", "eşleştir"],
  anla: ["açıkla", "özetle", "yorumla", "sınıflandır", "karşılaştır", "örneklendir"],
  uygula: ["hesapla", "çöz", "kullan", "göster", "uygula", "gerçekleştir"],
  analiz: ["ayırt et", "incele", "sorgula", "çözümle", "ilişkilendir", "test et"],
  değerlendir: ["savun", "eleştir", "gerekçelendir", "yargıla", "tartış", "seç"],
  yarat: ["tasarla", "geliştir", "oluştur", "planla", "üret", "öner"],
};

function detectBloomLevel(outcomeText = "") {
  const t = outcomeText.toLowerCase();
  for (const [level, verbs] of Object.entries(BLOOM_MAP)) {
    if (verbs.some((v) => t.includes(v))) return level;
  }
  return "anla"; // varsayılan
}

// ─── İçerik türü → Storyline etkileşim önerisi ───────────────────────────────
function pickContentMode(contentType = "") {
  const t = String(contentType).toLowerCase();
  if (t.includes("simülasyon") || t.includes("simulasyon")) return "simulation";
  if (t.includes("etkileşim") || t.includes("interaktif") || t.includes("oyun")) return "interactive";
  if (t.includes("video") || t.includes("belgesel") || t.includes("film")) return "video";
  if (t.includes("ses")) return "audio";
  return "general";
}

// ─── Bloom seviyesine göre önerilen Storyline etkileşimleri ──────────────────
function getStorylineInteractions(bloomLevel, mode) {
  const interactions = {
    hatırla: [
      "Flashcard (ön yüz: kavram, arka yüz: tanım) — Slide Layer ile",
      "Eşleştirme sorusu (Drag-and-Drop, Freeform)",
      "Boşluk doldurma (Fill in the Blank)",
    ],
    anla: [
      "Tıklamalı infografik (Hotspot ile katmanlı açıklama — her hotspot ayrı layer)",
      "Senaryo tabanlı çoktan seçmeli (branching olmadan, dönüt layerlı)",
      "Accordion (sekme) etkileşimi — her sekme bir kavram grubu",
    ],
    uygula: [
      "Adım adım süreç simülasyonu (Next/Back trigger ile kilitli geçiş)",
      "Sürükle-bırak sıralama (Drag-and-Drop, doğru sıra kontrolü)",
      "Senaryo tabanlı karar noktası (branching scenario, 2 dal)",
    ],
    analiz: [
      "Vaka analizi: 3 farklı senaryo dalı (T/F + kısa açıklama dönütü)",
      "Karşılaştırma matrisi (tıklanabilir hücreler, layer bazlı bilgi)",
      "Sınıflama/kategori oyunu (Drag-and-Drop, birden fazla hedef kutu)",
    ],
    değerlendir: [
      "Kanıt değerlendirme etkileşimi (slider: Güçlü Kanıt ↔ Zayıf Kanıt)",
      "Görüş tartışması: Katılıyor/Katılmıyor + gerekçe yazma alanı",
      "Çoklu senaryo dalı (her karar farklı sonuç, son slide özet)",
    ],
    yarat: [
      "Yapı taşı sürükleme (bileşen birleştirme simülasyonu)",
      "Boş şablon doldurma (text entry + AI dönütü veya model cevap)",
      "Proje planlama şeması (adımları doğru sıraya yerleştirme)",
    ],
  };
  return (interactions[bloomLevel] || interactions["anla"]).slice(0, 3);
}

// ─── Kazanım kodu ayrıştırıcı ─────────────────────────────────────────────────
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

// ─── Sınıf seviyesine göre dil/bilişsel profil ───────────────────────────────
function getCognitiveProfile(grade = "") {
  const g = parseInt(grade) || 0;
  if (g <= 2) return { stage: "somut işlemsel öncesi", lang: "3-4 kelimelik kısa cümleler, somut nesneler, ses efektleri ön planda", maxSlides: 5 };
  if (g <= 4) return { stage: "somut işlemsel", lang: "basit cümleler, hikâye çerçevesi, görsel ağırlıklı", maxSlides: 6 };
  if (g <= 8) return { stage: "geçiş dönemi", lang: "orta karmaşıklıkta cümleler, kavramsal bağlantılar kurulabilir", maxSlides: 8 };
  return { stage: "soyut işlemsel", lang: "analitik dil, soyut kavramlar, kaynak gösterme beklenir", maxSlides: 10 };
}

// ─── Ana handler ──────────────────────────────────────────────────────────────
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
    const ebaUrl = String(row["EBA_URL"] ?? "").trim();

    const mode = row.forceMode ? String(row.forceMode) : pickContentMode(contentType);
    const bloomLevel = detectBloomLevel(outcome);
    const cogProfile = getCognitiveProfile(grade);
    const codeInfo = analyzeOutcomeCode(outcome);
    const storylineInteractions = getStorylineInteractions(bloomLevel, mode);

    // ── AŞAMA 1: Pedagojik Analiz (hızlı, düşük token) ──────────────────────
    const analysisPrompt = `
Sen MEB TYMM müfredatına hâkim bir öğretim tasarımcısısın.
Şu kazanımı Bloom taksonomisine göre analiz et ve JSON döndür:

Kazanım: "${outcome}"
Ders: ${course}, Sınıf: ${grade}. Ünite: ${unit}
Açıklama/Kısıt: ${desc}

JSON formatı (başka hiçbir şey yazma):
{
  "bloomLevel": "tespit ettiğin seviye (Türkçe)",
  "bloomVerb": "kazanımdaki eylem fiili",
  "prerequisiteKnowledge": "öğrencinin bu kazanım için bilmesi gereken 2-3 ön bilgi (virgülle)",
  "commonMisconceptions": "bu konuda öğrencilerin sıkça yaptığı 2 kavram yanılgısı",
  "tymm_skill": "TYMM'deki en yakın 21.yy becerisi (örn: eleştirel düşünme, yaratıcılık, dijital okuryazarlık)",
  "tymm_value": "TYMM Erdem-Değer-Eylem çerçevesindeki en yakın değer",
  "suggestedNarrative": "Bu içerik için 1 cümlelik yaratıcı çerçeveleme önerisi (örn: 'Bir su damlasının yolculuğu' gibi)",
  "redLines": "Müfredat kısıtı gereği kesinlikle girilmemesi gereken 2-3 konu/kavram"
}`;

    let pedagogyData = {};
    try {
      const analysisResp = await openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0.1,
        max_tokens: 600,
        messages: [{ role: "user", content: analysisPrompt }],
      });
      const rawJson = analysisResp.choices?.[0]?.message?.content || "{}";
      const clean = rawJson.replace(/```json|```/g, "").trim();
      pedagogyData = JSON.parse(clean);
    } catch (_) {
      pedagogyData = { bloomLevel, tymm_skill: "—", commonMisconceptions: "—", suggestedNarrative: "—", redLines: "—" };
    }

    // ── AŞAMA 2: Tam Senaryo Üretimi ─────────────────────────────────────────
    const systemInstruction = `
Sen MEB Talim Terbiye Kurulu Başkanlığı (TTKB) e-içerik standartlarını ve TYMM felsefesini içselleştirmiş, 
Articulate Storyline 360 konusunda uzman bir Baş Öğretim Tasarımcısısın.

TEMEL PRENSİPLERİN:
- Bloom taksonomisinin tespit edilen seviyesine uygun ETKİLEŞİM tasarlarsın — düşük seviye için hatırlama oyunları, yüksek seviye için dal-budak senaryolar.
- Yazara HAZIR TASLAK METİN iskeletleri verirsin. "[Buraya metin yazın]" değil, "[örn: Su üç hâlde bulunabilir: ______, ______ ve ______.]" gibi yapılar önerirsin.
- Yapımcıya Storyline 360'a özgü teknik yönergeler verirsin: hangi slayt türü, hangi trigger, hangi layer, hangi variable adı kullanılacak.
- TTKB kırmızı çizgilerini net belirtirsin; soyut uyarı değil somut örnek verirsin.
- EBA teknik standartlarını hatırlatırken dosya boyutu, SCORM 1.2 completion trigger, font gömme gibi somut detaylar eklersin.
- Dönütler her zaman AÇIKLAYICI olur. "Tebrikler!" yazan içerik TTKB'den döner.

YASAKLAR:
- "Bu bölümde şunları öğreneceksiniz" gibi pasif giriş slaytları önerme.
- Tek bir slide'a 3'ten fazla bilgi birimi sıkıştırma (chunking ihlali).
- Genel geçer "iyi iş!" "çok doğru!" gibi içi boş dönüt önerileri.
`;

    const slideSuggestions = cogProfile.maxSlides;
    const interactionList = storylineInteractions.map((i, idx) => `${idx + 1}. ${i}`).join("\n");

    const userPrompt = `
## GİRDİLER
- **Sınıf:** ${grade}. Sınıf | **Ders:** ${course} | **Ünite:** ${unit}
- **Kazanım:** ${outcome}${codeInfo ? ` (Kod: ${codeInfo.raw})` : ""}
- **İçerik Türü:** ${contentType} | **Mod:** ${mode}
- **Açıklama/Kısıt:** ${desc || "(belirtilmemiş)"}

## PEDAGOJİK ANALİZ SONUÇLARI (Aşama 1'den)
- Bloom Seviyesi: **${pedagogyData.bloomLevel || bloomLevel}** (eylem fiili: "${pedagogyData.bloomVerb || "—"}")
- Ön Bilgi Gereksinimleri: ${pedagogyData.prerequisiteKnowledge || "—"}
- Yaygın Kavram Yanılgıları: ${pedagogyData.commonMisconceptions || "—"}
- TYMM Becerisi: ${pedagogyData.tymm_skill || "—"} | TYMM Değeri: ${pedagogyData.tymm_value || "—"}
- Önerilen İçerik Çerçevesi: "${pedagogyData.suggestedNarrative || "—"}"
- Müfredat Kırmızı Çizgileri: ${pedagogyData.redLines || "—"}
- Bilişsel Profil: ${cogProfile.stage} — ${cogProfile.lang}

## BU BLOOM SEVİYESİ İÇİN ÖNERİLEN STORYLİNE ETKİLEŞİMLERİ
${interactionList}

---

## LÜTFEN AŞAĞIDA BELİRTİLEN FORMATTA TAM SENARYO ÜRETİÇ

### BÖLÜM A — YAZARA: MÜFREDAT SINIRI ve DİL REHBERİ

**Bu içerikte MUTLAKA yer alması gerekenler:**
(Kazanımı tam karşılayan 3-5 kavram/beceri, somut örneklerle)

**Bu içerikte KESİNLİKLE yer almaması gerekenler:**
(Kırmızı çizgiler — soyut uyarı değil, somut örnek ver: "X kavramından bahsetme çünkü Y sınıfın müfredatında Z. ünitede işleniyor")

**Dil ve Ton Rehberi:**
(Bu sınıf düzeyi için cümle uzunluğu, kelime tercihi, aktif/pasif ses önerileri)

**TYMM Entegrasyonu:**
(${pedagogyData.tymm_skill || "ilgili beceri"} bu içeriğe nasıl entegre edilir — somut öneri)

---

### BÖLÜM B — EKRAN EKRAN STORYBOARD (Maks. ${slideSuggestions} ekran)

Her ekran için şu yapıyı kullan:

---
**EKRAN [N]: [Ekranın amacını anlatan kısa başlık]**
*Ekran Türü: [Storyline'da hangi slide type — Normal Slide / Freeform Drag-Drop / Freeform Pick One / Hotspot / Fill in Blank]*

📐 **YAPIMCI İÇİN — Storyline Teknik Yönergesi:**
- Slide yapısı: [Base layer + kaç tane layer olacak, layer isimleri]
- Trigger'lar: [Hangi nesneye ne trigger eklenecek — örn: "Doğru kutuya bırakıldığında → Show Layer 'Doğru Dönüt' göster, variable 'score' +1 artır"]
- Variable'lar: [Kullanılacak variable adları ve tipleri — örn: dogruSayisi (Number), denemeSayaci (Number)]
- Animasyon: [Nesnelerin giriş/çıkış animasyonları]
- Medya: [Ses, görsel, video önerileri — EBA'ya uygun boyut notu]

✍️ **YAZARA — Metin İskeleti:**
- Ana metin: [Hazır taslak — boş bırakma, öğrencinin göreceği metni YAZAR sıfırdan yazmak yerine sadece tamamlasın diye başlangıç ver. Örn: "_________, canlıların temel yapı taşıdır. Bir hücre; ________, ________ ve ________ gibi bölümlerden oluşur."]
- Soru kökü (varsa): [Çeldiricisi güçlü soru taslağı — doğru cevap açıkça işaretlenmiş]
- Doğru cevap dönütü: [Neden doğru olduğunu açıklayan 2 cümle taslağı]
- Yanlış cevap dönütü: [Hangi kavram yanılgısını gidereceğini belirten yönlendirici 2 cümle taslağı — özellikle "${pedagogyData.commonMisconceptions}" yanılgısına dikkat]
---

(Yukarıdaki formatta TÜM ekranları üret. Yazara bırakılan alanlarda gerçekten taslak metin ver.)

---

### BÖLÜM C — SCORM & EBA TEKNİK KONTROL LİSTESİ (Yapımcı için)

1. **Completion Trigger:** [Storyline'da hangi koşulda %100 tamamlandı sayılacak — örn: "Results slide görüntülendiğinde" veya "Tüm layer'lar ziyaret edildiğinde"]
2. **Dosya Boyutu:** [Hangi medyaların sıkıştırılması gerektiği — mp3 max 128kbps, görsel max 150KB vb.]
3. **Font Gömme:** [Kullanılacak fontların Storyline'a nasıl gömüleceği]
4. **Erişilebilirlik:** [Alt text zorunlu nesneler, tab sırası, renk kontrastı minimum oranı]
5. **EBA Test:** [EBA'ya yüklemeden önce SCORM Cloud'da test edilmesi gereken kritik davranışlar]
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.3, // Biraz daha yüksek — yaratıcı öneri için
      max_tokens: 4000,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: userPrompt },
      ],
    });

    const text = completion.choices?.[0]?.message?.content || "Boş yanıt";

    return res.status(200).json({
      title: `${grade}. Sınıf ${course} — ${outcome.substring(0, 60)}...`,
      text,
      meta: {
        grade, course, unit, outcome, contentType, mode,
        bloomLevel: pedagogyData.bloomLevel || bloomLevel,
        tymm_skill: pedagogyData.tymm_skill || null,
        suggestedNarrative: pedagogyData.suggestedNarrative || null,
        outcomeCode: codeInfo?.raw || null,
        cognitiveStage: cogProfile.stage,
        storylineInteractions,
        ebaUrl: ebaUrl || null,
      },
    });
  } catch (error) {
    return res.status(500).json({
      title: "AI Hatası",
      error: error?.message || String(error),
    });
  }
};
