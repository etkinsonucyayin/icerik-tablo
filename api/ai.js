const OpenAI = require("openai").default;

/* ============================================================================
   MEB E-İÇERİK SENARYO ÜRETİM API
   V2 — Tek çağrılı, yapılandırılmış JSON üretim + render mimarisi
   Vercel serverless için: api/ai.js
============================================================================ */

/* ============================================================================
   SABİTLER
============================================================================ */

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const BLOOM_MAP = {
  hatırla: ["tanımla", "listele", "say", "belirt", "adlandır", "eşleştir"],
  anla: ["açıkla", "özetle", "yorumla", "sınıflandır", "karşılaştır", "örneklendir"],
  uygula: ["hesapla", "çöz", "kullan", "göster", "uygula", "gerçekleştir"],
  analiz: ["ayırt et", "incele", "sorgula", "çözümle", "ilişkilendir", "test et"],
  değerlendir: ["savun", "eleştir", "gerekçelendir", "yargıla", "tartış", "seç"],
  yarat: ["tasarla", "geliştir", "oluştur", "planla", "üret", "öner"],
};

const BLOOM_LABELS = {
  hatırla: "Hatırlama",
  anla: "Anlama",
  uygula: "Uygulama",
  analiz: "Analiz",
  değerlendir: "Değerlendirme",
  yarat: "Yaratma",
};

const DEFAULT_SCORM_RULES = {
  completion: "Son değerlendirme ekranı görüntülendiğinde veya tüm zorunlu ekranlar ziyaret edildiğinde tamamlandı işaretlenmelidir.",
  dosyaBoyutu: [
    "Görseller web optimizasyonlu kullanılmalıdır.",
    "Ses dosyaları mümkünse MP3 ve düşük bitrate ile sıkıştırılmalıdır.",
    "Video kullanılacaksa kısa segmentler tercih edilmelidir."
  ],
  erisilebilirlik: [
    "Anlam taşıyan tüm görsellere alt metin eklenmelidir.",
    "Tab sırası mantıklı bir akış izleyecek şekilde düzenlenmelidir.",
    "Renk tek başına anlam taşıyıcı olmamalıdır.",
    "Yeterli kontrast korunmalıdır."
  ],
  ebaTest: [
    "SCORM paketi yüklenmeden önce açılış, ilerleme, tamamlama ve sonuç akışları test edilmelidir.",
    "Mobil ve masaüstü görünümde temel etkileşimler kontrol edilmelidir.",
    "Eksik medya, bozuk trigger ve kilitli navigasyon hataları kontrol edilmelidir."
  ]
};

/* ============================================================================
   YARDIMCI FONKSİYONLAR
============================================================================ */

function safeString(value) {
  return String(value ?? "").trim();
}

function detectBloomLevel(outcomeText = "") {
  const t = safeString(outcomeText).toLowerCase();
  for (const [level, verbs] of Object.entries(BLOOM_MAP)) {
    if (verbs.some((v) => t.includes(v))) return level;
  }
  return "anla";
}

function findBloomVerb(outcomeText = "") {
  const t = safeString(outcomeText).toLowerCase();
  for (const verbs of Object.values(BLOOM_MAP)) {
    const found = verbs.find((v) => t.includes(v));
    if (found) return found;
  }
  return "";
}

function pickContentMode(contentType = "") {
  const t = safeString(contentType).toLowerCase();
  if (t.includes("simülasyon") || t.includes("simulasyon")) return "simulation";
  if (t.includes("etkileşim") || t.includes("interaktif") || t.includes("oyun")) return "interactive";
  if (t.includes("video") || t.includes("belgesel") || t.includes("film")) return "video";
  if (t.includes("ses") || t.includes("podcast")) return "audio";
  return "general";
}

function analyzeOutcomeCode(outcomeText = "") {
  const text = safeString(outcomeText);
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

function getCognitiveProfile(grade = "") {
  const g = parseInt(grade, 10) || 0;
  if (g <= 2) {
    return {
      stage: "somut işlemsel öncesi / erken somut dönem",
      lang: "kısa, sade, somut ve görsel destekli dil",
      maxSlides: 5,
      sentenceRule: "3-6 kelimelik kısa cümleler tercih edilmeli",
    };
  }
  if (g <= 4) {
    return {
      stage: "somut işlemsel",
      lang: "basit ve örnek destekli anlatım",
      maxSlides: 6,
      sentenceRule: "kısa-orta uzunlukta cümleler kullanılmalı",
    };
  }
  if (g <= 8) {
    return {
      stage: "geçiş dönemi",
      lang: "orta karmaşıklıkta, ilişki kuran, kavramsal anlatım",
      maxSlides: 8,
      sentenceRule: "orta uzunlukta, açık ve yönlendirici cümleler kullanılmalı",
    };
  }
  return {
    stage: "soyut işlemsel",
    lang: "analitik, kavramsal ve gerekçeli anlatım",
    maxSlides: 10,
    sentenceRule: "orta-uzun ama sade ve akademik cümleler kullanılmalı",
  };
}

function getStorylineInteractions(bloomLevel, mode) {
  const pool = {
    hatırla: [
      "Flashcard etkileşimi",
      "Eşleştirme etkinliği",
      "Boşluk doldurma",
      "Tıklamalı kavram kartları",
    ],
    anla: [
      "Hotspot açıklama ekranı",
      "Accordion / sekmeli içerik",
      "Çoktan seçmeli yorum sorusu",
      "Tıklamalı infografik",
    ],
    uygula: [
      "Adım sıralama etkinliği",
      "Sürükle-bırak uygulama görevi",
      "Senaryo tabanlı karar noktası",
      "Süreç simülasyonu",
    ],
    analiz: [
      "Karşılaştırma matrisi",
      "Kategori sınıflama etkinliği",
      "Vaka çözümleme ekranı",
      "Neden-sonuç eşleştirmesi",
    ],
    değerlendir: [
      "Kanıt değerlendirme senaryosu",
      "Gerekçeli seçim sorusu",
      "Karar ağacı etkinliği",
      "Çok sonuçlu senaryo",
    ],
    yarat: [
      "Şablon doldurma görevi",
      "Parça birleştirme tasarımı",
      "Proje planı sıralama",
      "Ürün / çözüm tasarlama ekranı",
    ],
  };

  let selected = pool[bloomLevel] || pool.anla;

  if (mode === "video") {
    selected = [
      "Kısa video akışı + durdurup düşünme noktası",
      "Sahne bazlı anlatım + gömülü soru",
      "İzle-sonra-yanıtla ekranı",
    ];
  } else if (mode === "audio") {
    selected = [
      "Sesli anlatım + kavram kartları",
      "Dinle ve seç etkinliği",
      "Sesli vaka + kısa karar sorusu",
    ];
  } else if (mode === "simulation") {
    selected = [
      "Adım adım uygulama simülasyonu",
      "Koşullu karar senaryosu",
      "Hata bulma / düzeltme simülasyonu",
    ];
  }

  return selected.slice(0, 3);
}

function splitMeaningfulOptions(text = "") {
  return safeString(text)
    .split(/[\/•;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => s.length >= 4)
    .filter((s) => !/^(hazırlanır|yapılır|verilir|olur)\.?$/i.test(s));
}

function normalizeArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((v) => safeString(v)).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return fallback;
}

function limitText(text, maxLen = 600) {
  const t = safeString(text).replace(/\s+/g, " ");
  return t.length > maxLen ? `${t.slice(0, maxLen - 1)}…` : t;
}

function ensureArrayMinLength(arr, minCount, fillerFactory) {
  const out = Array.isArray(arr) ? [...arr] : [];
  while (out.length < minCount) {
    out.push(fillerFactory(out.length));
  }
  return out;
}

function guessSlideTypeFromModeAndIndex(mode, index, total, bloomLevel) {
  if (index === 0) return "Normal Slide";
  if (index === total - 1) return "Freeform Pick One";
  if (mode === "simulation") return index % 2 === 0 ? "Normal Slide" : "Freeform Drag-Drop";
  if (mode === "interactive") return index % 3 === 1 ? "Hotspot" : "Normal Slide";
  if (mode === "video") return index % 2 === 1 ? "Normal Slide" : "Freeform Pick One";
  if (bloomLevel === "hatırla") return index % 2 === 0 ? "Normal Slide" : "Freeform Drag-Drop";
  if (bloomLevel === "uygula" || bloomLevel === "analiz") return index % 2 === 0 ? "Normal Slide" : "Freeform Drag-Drop";
  return "Normal Slide";
}

function isWriterNeeded(slide) {
  const type = safeString(slide.slideType).toLowerCase();
  const objective = safeString(slide.objective).toLowerCase();
  const text = `${type} ${objective}`;

  if (text.includes("yalnız görsel") || text.includes("sadece görsel") || text.includes("only visual")) {
    return false;
  }

  if (type.includes("pick one") || type.includes("drag-drop") || type.includes("fill") || type.includes("hotspot")) {
    return true;
  }

  return true;
}

function defaultSlide(index, total, mode, bloomLevel) {
  const slideType = guessSlideTypeFromModeAndIndex(mode, index, total, bloomLevel);
  return {
    title: `Ekran ${index + 1}`,
    objective: index === 0
      ? "Kazanıma hazırlık ve dikkat odağı oluşturma"
      : index === total - 1
        ? "Öğrenmeyi yoklama ve pekiştirme"
        : "Kazanıma hizmet eden temel içerik işleme",
    slideType,
    writerNeeded: slideType !== "Normal Slide" || index !== 0,
    producer: {
      slideStructure: "Base Layer",
      layers: ["Base Layer"],
      triggers: ["İleri butonu ile bir sonraki ekrana geç"],
      variables: [],
      animation: "Hafif giriş animasyonları kullanılabilir",
      media: ["Görsel veya ikon kullanılabilir"],
    },
    writer: {
      mainText: "",
      questionStem: "",
      correctFeedback: "",
      incorrectFeedback: "",
    },
  };
}

function validateAndRepairScenario(data, context) {
  const repaired = { ...data };

  repaired.pedagojikAnaliz = repaired.pedagojikAnaliz || {};
  repaired.scenarioMeta = repaired.scenarioMeta || {};
  repaired.scormEbaChecklist = repaired.scormEbaChecklist || {};
  repaired.ekranlar = Array.isArray(repaired.ekranlar) ? repaired.ekranlar : [];

  repaired.pedagojikAnaliz.bloomSeviyesi =
    safeString(repaired.pedagojikAnaliz.bloomSeviyesi) || BLOOM_LABELS[context.bloomLevel];

  repaired.pedagojikAnaliz.bloomFiili =
    safeString(repaired.pedagojikAnaliz.bloomFiili) || context.bloomVerb || "";

  repaired.pedagojikAnaliz.onBilgiler = ensureArrayMinLength(
    normalizeArray(repaired.pedagojikAnaliz.onBilgiler),
    2,
    (i) => i === 0 ? "Konuya giriş düzeyinde temel ön bilgi" : "Kazanımı destekleyen yardımcı ön bilgi"
  ).slice(0, 4);

  repaired.pedagojikAnaliz.kavramYanilgilari = ensureArrayMinLength(
    normalizeArray(repaired.pedagojikAnaliz.kavramYanilgilari),
    2,
    (i) => i === 0 ? "Öğrenciler kavramları birbirine karıştırabilir." : "Öğrenciler örnek ile tanımı eşleştirmekte zorlanabilir."
  ).slice(0, 4);

  repaired.pedagojikAnaliz.tymmBeceri =
    safeString(repaired.pedagojikAnaliz.tymmBeceri) || "Eleştirel düşünme";

  repaired.pedagojikAnaliz.tymmDeger =
    safeString(repaired.pedagojikAnaliz.tymmDeger) || "Sorumluluk";

  repaired.pedagojikAnaliz.anlatiCercevesi =
    safeString(repaired.pedagojikAnaliz.anlatiCercevesi) || "Kazanımı gündelik yaşam örnekleriyle ilişkilendiren sade bir akış";

  repaired.pedagojikAnaliz.kirmiziCizgiler = ensureArrayMinLength(
    normalizeArray(repaired.pedagojikAnaliz.kirmiziCizgiler),
    2,
    (i) => i === 0 ? "Sınıf düzeyinin üstünde kalan ayrıntılı alt konulara girilmemelidir." : "Kazanım dışı teknik ayrıntılar eklenmemelidir."
  ).slice(0, 5);

  repaired.scenarioMeta.onerilenEkranSayisi =
    Math.min(
      context.maxSlides,
      Math.max(4, parseInt(repaired.scenarioMeta.onerilenEkranSayisi, 10) || context.suggestedSlides)
    );

  repaired.scenarioMeta.tahminiOgrenciSuresiDakika =
    Math.max(3, parseInt(repaired.scenarioMeta.tahminiOgrenciSuresiDakika, 10) || estimateStudentMinutes(context));

  repaired.scenarioMeta.tahminiGelistirmeSuresiSaat =
    Math.max(2, parseInt(repaired.scenarioMeta.tahminiGelistirmeSuresiSaat, 10) || estimateDevelopmentHours(context));

  repaired.scenarioMeta.tahminiVideoSuresiDakika =
    Math.max(0, parseInt(repaired.scenarioMeta.tahminiVideoSuresiDakika, 10) || estimateVideoMinutes(context));

  const targetCount = repaired.scenarioMeta.onerilenEkranSayisi;
  repaired.ekranlar = repaired.ekranlar.slice(0, targetCount);

  while (repaired.ekranlar.length < targetCount) {
    repaired.ekranlar.push(defaultSlide(repaired.ekranlar.length, targetCount, context.mode, context.bloomLevel));
  }

  repaired.ekranlar = repaired.ekranlar.map((slide, idx) => {
    const base = defaultSlide(idx, targetCount, context.mode, context.bloomLevel);
    const merged = {
      ...base,
      ...slide,
      producer: {
        ...base.producer,
        ...(slide?.producer || {}),
      },
      writer: {
        ...base.writer,
        ...(slide?.writer || {}),
      },
    };

    merged.title = safeString(merged.title) || `Ekran ${idx + 1}`;
    merged.objective = limitText(safeString(merged.objective) || base.objective, 220);
    merged.slideType = safeString(merged.slideType) || base.slideType;

    merged.producer.slideStructure = limitText(
      safeString(merged.producer.slideStructure) || "Base Layer",
      220
    );
    merged.producer.layers = normalizeArray(merged.producer.layers, ["Base Layer"]).slice(0, 6);
    merged.producer.triggers = normalizeArray(merged.producer.triggers, ["İleri butonu ile bir sonraki ekrana geç"]).slice(0, 6);
    merged.producer.variables = normalizeArray(merged.producer.variables, []).slice(0, 6);
    merged.producer.animation = limitText(
      safeString(merged.producer.animation) || "Gerekliyse sade giriş animasyonları kullanılabilir",
      220
    );
    merged.producer.media = normalizeArray(merged.producer.media, ["Görsel desteği kullanılabilir"]).slice(0, 5);

    merged.writerNeeded = typeof merged.writerNeeded === "boolean" ? merged.writerNeeded : isWriterNeeded(merged);

    if (!merged.writerNeeded) {
      merged.writer = null;
    } else {
      merged.writer = merged.writer || {};
      merged.writer.mainText = limitText(
        safeString(merged.writer.mainText) || "Bu ekranda kazanıma hizmet eden kısa ve yönlendirici bir metin yer almalıdır.",
        500
      );
      merged.writer.questionStem = limitText(safeString(merged.writer.questionStem), 320);
      merged.writer.correctFeedback = limitText(
        safeString(merged.writer.correctFeedback) || "Doğru seçim, ilgili kavramın doğru anlaşılmasına dayanmaktadır.",
        320
      );
      merged.writer.incorrectFeedback = limitText(
        safeString(merged.writer.incorrectFeedback) || "Bu yanıtta bir kavram karışıklığı olabilir; temel tanım ve örnek yeniden düşünülmelidir.",
        320
      );
    }

    return merged;
  });

  repaired.scormEbaChecklist.completionTrigger =
    safeString(repaired.scormEbaChecklist.completionTrigger) || DEFAULT_SCORM_RULES.completion;

  repaired.scormEbaChecklist.dosyaBoyutu = ensureArrayMinLength(
    normalizeArray(repaired.scormEbaChecklist.dosyaBoyutu),
    2,
    (i) => DEFAULT_SCORM_RULES.dosyaBoyutu[i] || "Medya dosyaları optimize edilmelidir."
  ).slice(0, 5);

  repaired.scormEbaChecklist.fontGomme =
    safeString(repaired.scormEbaChecklist.fontGomme) ||
    "Kullanılan fontların lisans uygunluğu kontrol edilmeli, gerekiyorsa Storyline yayın ayarlarında gömülü font desteği test edilmelidir.";

  repaired.scormEbaChecklist.erisilebilirlik = ensureArrayMinLength(
    normalizeArray(repaired.scormEbaChecklist.erisilebilirlik),
    3,
    (i) => DEFAULT_SCORM_RULES.erisilebilirlik[i] || "Erişilebilirlik temel ilkeleri uygulanmalıdır."
  ).slice(0, 6);

  repaired.scormEbaChecklist.ebaTest = ensureArrayMinLength(
    normalizeArray(repaired.scormEbaChecklist.ebaTest),
    3,
    (i) => DEFAULT_SCORM_RULES.ebaTest[i] || "EBA öncesi temel akış testleri tamamlanmalıdır."
  ).slice(0, 6);

  return repaired;
}

function estimateStudentMinutes(context) {
  const base = Math.max(4, context.suggestedSlides);
  if (context.mode === "video") return base + 2;
  if (context.mode === "simulation") return base + 3;
  if (context.bloomLevel === "analiz" || context.bloomLevel === "değerlendir" || context.bloomLevel === "yarat") {
    return base + 2;
  }
  return base + 1;
}

function estimateDevelopmentHours(context) {
  let hours = context.suggestedSlides * 1.2;
  if (context.mode === "simulation") hours += 3;
  if (context.mode === "video") hours += 2;
  if (["analiz", "değerlendir", "yarat"].includes(context.bloomLevel)) hours += 2;
  return Math.round(hours);
}

function estimateVideoMinutes(context) {
  if (context.mode !== "video") return 0;
  return Math.max(2, Math.min(6, Math.round(context.suggestedSlides * 0.6)));
}

function renderScenarioText(data, context) {
  const pa = data.pedagojikAnaliz || {};
  const meta = data.scenarioMeta || {};
  const checklist = data.scormEbaChecklist || {};

  const lines = [];

  lines.push(`# 1. Pedagojik Analiz`);
  lines.push(``);
  lines.push(`**Bloom seviyesi:** ${safeString(pa.bloomSeviyesi) || BLOOM_LABELS[context.bloomLevel]}`);
  if (safeString(pa.bloomFiili)) lines.push(`**Kazanımdaki eylem fiili:** ${safeString(pa.bloomFiili)}`);
  lines.push(`**TYMM becerisi:** ${safeString(pa.tymmBeceri)}`);
  lines.push(`**TYMM değeri:** ${safeString(pa.tymmDeger)}`);
  lines.push(`**Anlatı çerçevesi:** ${safeString(pa.anlatiCercevesi)}`);
  lines.push(``);
  lines.push(`**Ön bilgi gereksinimleri:**`);
  normalizeArray(pa.onBilgiler).forEach((x) => lines.push(`- ${x}`));
  lines.push(``);
  lines.push(`**Yaygın kavram yanılgıları:**`);
  normalizeArray(pa.kavramYanilgilari).forEach((x) => lines.push(`- ${x}`));
  lines.push(``);
  lines.push(`**Kırmızı çizgiler:**`);
  normalizeArray(pa.kirmiziCizgiler).forEach((x) => lines.push(`- ${x}`));
  lines.push(``);

  lines.push(`# 2. İçerik Tasarım Stratejisi`);
  lines.push(``);
  lines.push(`**Sınıf düzeyi:** ${context.grade}. sınıf`);
  lines.push(`**Ders:** ${context.course}`);
  lines.push(`**Ünite/Tema/Öğrenme Alanı:** ${context.unit || "—"}`);
  lines.push(`**İçerik modu:** ${context.mode}`);
  lines.push(`**Bilişsel profil:** ${context.cognitiveStage}`);
  lines.push(`**Dil önerisi:** ${context.cognitiveLang}`);
  lines.push(`**Önerilen ekran sayısı:** ${meta.onerilenEkranSayisi}`);
  lines.push(`**Önerilen Storyline etkileşimleri:**`);
  context.storylineInteractions.forEach((x) => lines.push(`- ${x}`));
  lines.push(``);

  lines.push(`# 3. Storyline Senaryosu`);
  lines.push(``);

  data.ekranlar.forEach((slide, idx) => {
    lines.push(`## EKRAN ${idx + 1}: ${safeString(slide.title)}`);
    lines.push(`*Ekran Türü: ${safeString(slide.slideType)}*`);
    lines.push(``);
    lines.push(`**Amaç:** ${safeString(slide.objective)}`);
    lines.push(``);
    lines.push(`📐 **YAPIMCI İÇİN — Storyline Teknik Yönergesi**`);
    lines.push(`- **Slide yapısı:** ${safeString(slide.producer?.slideStructure)}`);
    lines.push(`- **Layer'lar:** ${normalizeArray(slide.producer?.layers).join(", ") || "—"}`);
    lines.push(`- **Trigger'lar:**`);
    normalizeArray(slide.producer?.triggers).forEach((x) => lines.push(`  - ${x}`));
    lines.push(`- **Variable'lar:** ${normalizeArray(slide.producer?.variables).join(", ") || "Yok / gerekmiyor"}`);
    lines.push(`- **Animasyon:** ${safeString(slide.producer?.animation)}`);
    lines.push(`- **Medya:**`);
    normalizeArray(slide.producer?.media).forEach((x) => lines.push(`  - ${x}`));
    lines.push(``);

    if (slide.writerNeeded && slide.writer) {
      lines.push(`✍️ **YAZAR İÇİN — Metin İskeleti**`);
      lines.push(`- **Ana metin:** ${safeString(slide.writer.mainText) || "—"}`);
      if (safeString(slide.writer.questionStem)) {
        lines.push(`- **Soru kökü:** ${safeString(slide.writer.questionStem)}`);
      }
      if (safeString(slide.writer.correctFeedback)) {
        lines.push(`- **Doğru cevap dönütü:** ${safeString(slide.writer.correctFeedback)}`);
      }
      if (safeString(slide.writer.incorrectFeedback)) {
        lines.push(`- **Yanlış cevap dönütü:** ${safeString(slide.writer.incorrectFeedback)}`);
      }
    } else {
      lines.push(`✍️ **YAZAR İÇİN**`);
      lines.push(`- Bu ekran ağırlıklı olarak görsel/teknik yapıdadır; ayrı metin yazımı gerekmeyebilir.`);
    }

    lines.push(``);
  });

  lines.push(`# 4. Ölçme Değerlendirme`);
  lines.push(``);
  const lastSlide = data.ekranlar[data.ekranlar.length - 1];
  lines.push(`- Son ekran veya son iki ekran kazanımı yoklayan, açıklayıcı dönüt içeren yapıdadır.`);
  lines.push(`- Sadece doğru/yanlış bildiren kısa dönütler yerine neden-sonuç açıklaması kullanılmalıdır.`);
  lines.push(`- Kavram yanılgısı görülen seçeneklerde öğrenci doğru kavrama yönlendirilmelidir.`);
  if (lastSlide?.writer?.questionStem) {
    lines.push(`- Örnek değerlendirme odağı: ${safeString(lastSlide.writer.questionStem)}`);
  }
  lines.push(``);

  lines.push(`# 5. Teslim Kontrol Listesi`);
  lines.push(``);
  lines.push(`- Kazanım dışına taşan içerik bulunmamalı.`);
  lines.push(`- Her ekran tek ana öğrenme yükü taşımalı.`);
  lines.push(`- Trigger, layer ve variable adları anlamlı ve tutarlı olmalı.`);
  lines.push(`- Dönütler açıklayıcı ve kavram yanılgısı giderici olmalı.`);
  lines.push(`- Yalnız görsel ekranlarda gereksiz yazar metni bulunmamalı.`);
  lines.push(`- SCORM tamamlama koşulu test edilmeli.`);
  lines.push(``);

  lines.push(`# 6. Açıklamaya Uygunluk`);
  lines.push(``);
  lines.push(`- Açıklama/kısıt metnindeki sınırlar dikkate alınmıştır.`);
  if (context.desc) {
    lines.push(`- Esas alınan açıklama: ${context.desc}`);
  }
  lines.push(`- İçerik türü ile önerilen etkileşim yapısı uyumlu olacak biçimde kurgulanmıştır.`);
  lines.push(``);

  lines.push(`# 7. Üretim Tahminleri`);
  lines.push(``);
  lines.push(`- **Tahmini öğrenci etkileşim süresi:** ${meta.tahminiOgrenciSuresiDakika} dakika`);
  lines.push(`- **Tahmini geliştirme süresi:** ${meta.tahminiGelistirmeSuresiSaat} saat`);
  lines.push(`- **Tahmini video süresi:** ${meta.tahminiVideoSuresiDakika} dakika`);
  lines.push(``);

  lines.push(`# 8. SCORM & EBA Teknik Kontrol Listesi`);
  lines.push(``);
  lines.push(`1. **Completion Trigger:** ${safeString(checklist.completionTrigger)}`);
  lines.push(`2. **Dosya Boyutu:**`);
  normalizeArray(checklist.dosyaBoyutu).forEach((x) => lines.push(`- ${x}`));
  lines.push(`3. **Font Gömme:** ${safeString(checklist.fontGomme)}`);
  lines.push(`4. **Erişilebilirlik:**`);
  normalizeArray(checklist.erisilebilirlik).forEach((x) => lines.push(`- ${x}`));
  lines.push(`5. **EBA Test:**`);
  normalizeArray(checklist.ebaTest).forEach((x) => lines.push(`- ${x}`));
  lines.push(``);

  return lines.join("\n");
}

function buildPrompt(context) {
  return `
Sen MEB öğretim programı, TYMM, Storyline 360, SCORM 1.2 ve EBA uyumuna hâkim bir öğretim tasarımcısısın.

GÖREVİN:
Aşağıdaki girdilere göre SADECE GEÇERLİ JSON üretmek.
Markdown, açıklama, kod bloğu, giriş cümlesi yazma.
Sadece JSON döndür.

TEMEL KURALLAR:
- Üretim, verilen kazanım ve sınıf seviyesinin dışına taşmamalı.
- Dil, sınıf düzeyine uygun olmalı.
- Her ekran tek bir ana öğrenme yükü taşımalı.
- Ölçme değerlendirme ekranlarında açıklayıcı dönüt olmalı.
- Yalnızca görsel / teknik yapılı ekranlarda writerNeeded false olabilir.
- writerNeeded false ise writer alanı null olabilir.
- Storyline terminolojisi somut olmalı: trigger, layer, variable, medya.
- Çıktı kısa ama uygulanabilir olmalı; gereksiz edebi uzatma yapma.

GİRDİLER:
{
  "sinif": "${context.grade}",
  "ders": "${context.course}",
  "unite": "${context.unit}",
  "kazanim": "${context.outcome}",
  "aciklama": "${context.desc}",
  "icerikTuru": "${context.contentType}",
  "mod": "${context.mode}",
  "kazanimKodu": "${context.outcomeCode || ""}",
  "bloomTahmini": "${BLOOM_LABELS[context.bloomLevel]}",
  "bloomFiiliTahmini": "${context.bloomVerb || ""}",
  "bilisselProfil": "${context.cognitiveStage}",
  "dilRehberi": "${context.cognitiveLang}",
  "cumleKurali": "${context.sentenceRule}",
  "onerilenEtkilesimler": ${JSON.stringify(context.storylineInteractions)},
  "maksimumEkran": ${context.maxSlides},
  "onerilenEkranSayisi": ${context.suggestedSlides}
}

İSTENEN JSON ŞEMASI:
{
  "pedagojikAnaliz": {
    "bloomSeviyesi": "string",
    "bloomFiili": "string",
    "onBilgiler": ["string", "string"],
    "kavramYanilgilari": ["string", "string"],
    "tymmBeceri": "string",
    "tymmDeger": "string",
    "anlatiCercevesi": "string",
    "kirmiziCizgiler": ["string", "string"]
  },
  "scenarioMeta": {
    "onerilenEkranSayisi": 6,
    "tahminiOgrenciSuresiDakika": 7,
    "tahminiGelistirmeSuresiSaat": 8,
    "tahminiVideoSuresiDakika": 0
  },
  "ekranlar": [
    {
      "title": "string",
      "objective": "string",
      "slideType": "Normal Slide | Freeform Drag-Drop | Freeform Pick One | Hotspot | Fill in Blank",
      "writerNeeded": true,
      "producer": {
        "slideStructure": "string",
        "layers": ["string"],
        "triggers": ["string"],
        "variables": ["string"],
        "animation": "string",
        "media": ["string"]
      },
      "writer": {
        "mainText": "string",
        "questionStem": "string",
        "correctFeedback": "string",
        "incorrectFeedback": "string"
      }
    }
  ],
  "scormEbaChecklist": {
    "completionTrigger": "string",
    "dosyaBoyutu": ["string"],
    "fontGomme": "string",
    "erisilebilirlik": ["string"],
    "ebaTest": ["string"]
  }
}

EK KISITLAR:
- Ekran sayısı 4 ile ${context.maxSlides} arasında olsun.
- En az 1 ölçme/değerlendirme ekranı olsun.
- Son ekran değerlendirme veya pekiştirme işlevi görsün.
- Her ekranda producer alanı dolu olsun.
- writerNeeded true ise writer alanındaki mainText boş olmasın.
- Kırmızı çizgiler somut olsun.
- JSON dışına çıkma.
`.trim();
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    const cleaned = String(raw || "")
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    return JSON.parse(cleaned);
  }
}

/* ============================================================================
   ANA HANDLER
============================================================================ */

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        title: "Hata",
        error: "Method not allowed",
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        title: "AI Hatası",
        error: "OPENAI_API_KEY bulunamadı",
      });
    }

    const row = req.body || {};

    const grade = safeString(row["SINIF"]);
    const course = safeString(row["DERS ADI"]);
    const unit = safeString(row["ÜNİTE/TEMA/ ÖĞRENME ALANI"] || row["ÜNİTE/TEMA/ÖĞRENME ALANI"]);
    const outcome = safeString(row["KAZANIM/ÖĞRENME ÇIKTISI/BÖLÜM"]);
    const contentType = safeString(row["E-İÇERİK TÜRÜ"]);
    const ebaUrl = safeString(row["EBA_URL"]);

    let desc = safeString(row["AÇIKLAMA"]);
    if (row.forceChoiceText) {
      desc = safeString(row.forceChoiceText);
    }

    const contentOptions = splitMeaningfulOptions(desc);
    const mode = row.forceMode ? safeString(row.forceMode) : pickContentMode(contentType);

    const bloomLevel = detectBloomLevel(outcome);
    const bloomVerb = findBloomVerb(outcome);
    const codeInfo = analyzeOutcomeCode(outcome);
    const cogProfile = getCognitiveProfile(grade);
    const storylineInteractions = getStorylineInteractions(bloomLevel, mode);

    const suggestedSlides = Math.min(
      cogProfile.maxSlides,
      Math.max(
        4,
        mode === "simulation" ? 7 :
        mode === "video" ? 5 :
        ["analiz", "değerlendir", "yarat"].includes(bloomLevel) ? 7 : 5
      )
    );

    const context = {
      grade,
      course,
      unit,
      outcome,
      contentType,
      desc,
      ebaUrl,
      mode,
      bloomLevel,
      bloomVerb,
      outcomeCode: codeInfo?.raw || null,
      cognitiveStage: cogProfile.stage,
      cognitiveLang: cogProfile.lang,
      sentenceRule: cogProfile.sentenceRule,
      maxSlides: cogProfile.maxSlides,
      suggestedSlides,
      storylineInteractions,
      contentOptions,
    };

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = buildPrompt(context);

    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 2800,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Yalnızca geçerli JSON üret. JSON dışına çıkma.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const rawText = completion.choices?.[0]?.message?.content || "{}";
    const parsed = safeJsonParse(rawText);
    const repaired = validateAndRepairScenario(parsed, context);
    const text = renderScenarioText(repaired, context);

    return res.status(200).json({
      title: `${grade}. Sınıf ${course} — ${outcome.substring(0, 60)}${outcome.length > 60 ? "..." : ""}`,
      text,
      json: repaired,
      meta: {
        grade,
        course,
        unit,
        outcome,
        contentType,
        mode,
        bloomLevel: BLOOM_LABELS[bloomLevel],
        bloomLevelKey: bloomLevel,
        bloomVerb: bloomVerb || null,
        outcomeCode: codeInfo?.raw || null,
        cognitiveStage: cogProfile.stage,
        cognitiveLang: cogProfile.lang,
        suggestedSlides,
        storylineInteractions,
        contentOptions,
        ebaUrl: ebaUrl || null,
        model: MODEL,
        architecture: "single-call-structured-json-v2",
      },
    });
  } catch (error) {
    return res.status(500).json({
      title: "AI Hatası",
      error: error?.message || String(error),
    });
  }
};
