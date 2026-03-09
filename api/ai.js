const OpenAI = require("openai").default;
const { verifyToken } = require("./login");

// ── Token doğrulama yardımcısı ────────────────────────────────────────────
function authCheck(req, res) {
  const auth  = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "Oturum açmanız gerekiyor" });
    return null;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Oturum süresi dolmuş, lütfen tekrar giriş yapın" });
    return null;
  }
  return payload;
}

// ── Ders yetkisi kontrolü ─────────────────────────────────────────────────
function dersCheck(payload, course, grade, res) {
  // dersler boşsa tüm derslere erişim (admin)
  if (!payload.dersler || payload.dersler.length === 0) return true;
  const yetkili = payload.dersler.some(d => d.toLowerCase() === (course || "").toLowerCase());
  if (!yetkili) {
    res.status(403).json({ error: `"${course}" dersi için yetkiniz yok` });
    return false;
  }
  return true;
}


// ─── Bloom Taksonomisi ────────────────────────────────────────────────────────
const BLOOM_MAP = {
  hatırla:     ["tanımla","listele","say","belirt","adlandır","eşleştir","bul","göster"],
  anla:        ["açıkla","özetle","yorumla","sınıflandır","karşılaştır","örneklendir","ayırt et","fark et"],
  uygula:      ["hesapla","çöz","kullan","uygula","gerçekleştir","doldur","yaz","seç"],
  analiz:      ["incele","sorgula","çözümle","ilişkilendir","test et","kategorize et","gruplayınız"],
  değerlendir: ["savun","eleştir","gerekçelendir","yargıla","tartış","değerlendir","karar ver"],
  yarat:       ["tasarla","geliştir","oluştur","planla","üret","öner","kur","inşa et"],
};

function detectBloomLevel(outcomeText = "") {
  const t = outcomeText.toLowerCase();
  for (const [level, verbs] of Object.entries(BLOOM_MAP)) {
    if (verbs.some((v) => t.includes(v))) return level;
  }
  return "anla";
}

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
  return { raw: m[0], prefix: m[1], gradeFromCode: m[2], strandOrUnit: m[3], outcomeIndex: m[4] };
}

function getCognitiveProfile(grade = "") {
  const g = parseInt(grade) || 0;
  if (g <= 2) return { stage: "somut işlemsel öncesi", lang: "3-4 kelimelik cümleler, somut nesneler, bol görsel ve ses", maxSlides: 5, ageNote: "6-7 yaş: Okuma gelişiyor, metni minimize et, sesi zorunlu yap, 'Sen', 'Siz' yerine karakter adı kullan" };
  if (g <= 4) return { stage: "somut işlemsel", lang: "basit cümleler, hikâye çerçevesi, görsel ağırlıklı", maxSlides: 6, ageNote: "8-9 yaş: Kısa paragraflar, somut örnekler, günlük hayattan seçilmiş, eğlenceli ve merak uyandıran dil" };
  if (g <= 8) return { stage: "geçiş dönemi", lang: "orta karmaşıklık, kavramsal bağlantılar, açıklayıcı dil", maxSlides: 8, ageNote: "10-13 yaş: Neden-sonuç ilişkileri kurulabilir, 'sen' hitabı uygundur, akademik jargondan kaçın" };
  return { stage: "soyut işlemsel", lang: "analitik dil, soyut kavramlar, kaynak ve kanıt gösterme", maxSlides: 10, ageNote: "14+ yaş: Eleştirel düşünme beklenir, öğrenci görüşünü savunmaya yönlendir" };
}

// ─── ŞABLON KÜTÜPHANESİ ──────────────────────────────────────────────────────
// Her şablon gerçek Storyline projelere dayalı, yapımcının uygulayabileceği teknik rehber içerir

const TEMPLATE_LIBRARY = {

  "siniflandirma_oyunu": {
    name: "Sınıflandırma Oyunu (Doğru/Yanlış - Balon Patlat / Kategori Seç)",
    bloomLevels: ["hatırla", "anla"],
    description: "Öğrenci ekrana gelen ifadeyi okur, iki kategoriden birine atar. Otomatik ilerleyen, tekrar eden yapı.",
    storylineNotes: `
STORYLINE 360 TEKNİK REHBERİ — SINIFLANDIRMA OYUNU

SLIDE YAPISI:
  Slide 1 → Giriş/Kural açıklaması
  Slide 2 → İçerik/Bilgi tanıtımı (gerekirse)
  Slide 3-10 → Soru slide'ları (her biri aynı layout, Master Slide kullan)
  Slide Son → Sonuç ve puan ekranı

HER SORU SLIDE'I — LAYOUT:
  - Üst bant: İlerleme çubuğu (X/8) — Number Variable ile
  - Merkez: Büyük metin kutusu (cümle/ifade) — her slide'da sadece metin değişir
  - Sol buton (YEŞİL, 150x80px): [Kategori A etiketi — örn: "DOĞRU", "EVET", "KARŞILAŞTıRMA CÜMLESİ"]
  - Sağ buton (KIRMIZI, 150x80px): [Kategori B etiketi — örn: "YANLIŞ", "HAYIR", "KARŞILAŞTIRMA DEĞİL"]
  - Alt köşe: Ses ikonu (seslendirme varsa)

LAYER YAPISI (Her slide):
  - Base Layer: Soru + 2 buton
  - Layer "Dogru_Donut" (1.5 saniye): Animasyon + AÇIKLAYICI dönüt metni
  - Layer "Yanlis_Donut" (1.5 saniye): Animasyon + yönlendirici dönüt metni + doğru cevap gösterimi
  - Layer "Gecis" (0.5 saniye): "Sonraki soruya geçiyoruz..." veya sayaç animasyonu

VARİABLE'LAR:
  dogruSayisi → Number, başlangıç: 0
  soruNo → Number, başlangıç: 1 (ilerleme göstergesi için)

TRIGGER'LAR (Her soru slide'ı base layer):
  [YEŞİL BUTON] Tıklandığında:
    IF bu soru için DOĞRU CEVAP = YEŞİL:
      → adjustVar dogruSayisi += 1
      → Show Layer "Dogru_Donut"
    ELSE:
      → Show Layer "Yanlis_Donut"
  [KIRMIZI BUTON] Tıklandığında: (yukarıdakinin tersi)
  [Layer "Dogru_Donut"] Timeline Complete:
    → Hide Layer "Dogru_Donut"
    → Show Layer "Gecis"
    → adjustVar soruNo += 1
  [Layer "Gecis"] Timeline Complete:
    → Jump to Next Slide

SONUÇ SLIDE'I TRIGGER:
  Timeline Start:
    → Set Variable "Result.ScorePercent" = dogruSayisi / 8 * 100
    → IF dogruSayisi >= 6: Show Layer "Basarili"
      ELSE: Show Layer "TekrarDene"

SCORM AYARLARI:
  Tracking: "Complete when user has viewed a slide" → SON SLIDE
  Reporting: Score from variable → dogruSayisi
  Pass/Fail: %75 (6/8)`,
  },

  "tiklanabilir_infografik": {
    name: "Tıklanabilir İnfografik / Hotspot Keşif",
    bloomLevels: ["anla", "uygula"],
    description: "Ana ekranda interaktif bir görsel/şema var, hotspot'lara tıklayınca bilgi layer'ları açılır.",
    storylineNotes: `
STORYLINE 360 TEKNİK REHBERİ — HotSPOT KEŞİF

SLIDE YAPISI:
  Slide 1 → Giriş + görev yönergesi
  Slide 2 → Ana infografik (tıklanabilir noktalar)
  Slide 3 → Pekiştirme sorusu (opsiyonel)

LAYOUT:
  - Tam ekran arka plan illüstrasyonu (YAZAR: görsel dosyasını temin eder)
  - 4-6 adet Hotspot nesnesi (görünmez dikdörtgen — üstüne "+" ikonu yerleştir)
  - Her "+" ikonu: Normal State (soluk) + Visited State (parlak/tik işaretli)
  - Sağ üst: Sayaç "Keşfedilen: X / 5" — Number Variable ile
  - Alt: "Devam Et" butonu → başlangıçta Hidden, tümü keşfedilince Visible

LAYER YAPISI:
  Base Layer: Harita/şema + hotspot'lar
  Layer "Nokta1": Kavram başlığı + açıklama (3-4 cümle) + görsel/ikon
  Layer "Nokta2": (aynı yapı)
  ... (hotspot sayısı kadar)
  Layer "Tamamlandi": Özet + tüm kavramları listeleyen tablo

VARİABLE'LAR:
  ziyaret → Number, 0
  toplamNokta → Number, [hotspot sayısı — sabit]

TRIGGER'LAR:
  Hotspot1 Tıklandı:
    → Show Layer "Nokta1"
    → Set State of Hotspot1 = Visited
    → adjustVar ziyaret += 1 (SADECE State == Normal ise — tekrar sayma)
  Her layer'da "Kapat X" butonu:
    → Hide Layer [ilgili layer]
  Trigger on variable: ziyaret == toplamNokta:
    → Show Object "DevamEt"

SCORM: Son slide görüntülenince Complete.`,
  },

  "surukle_birak_siralama": {
    name: "Sürükle-Bırak (Sıralama / Eşleştirme / Kategorize)",
    bloomLevels: ["uygula", "analiz"],
    description: "Öğrenci kavramları, adımları veya tanımları doğru hedefe sürükler. Freeform Drag-and-Drop.",
    storylineNotes: `
STORYLINE 360 TEKNİK REHBERİ — DRAG AND DROP

SLIDE TÜRÜ: Freeform → Drag and Drop

LAYOUT:
  - Sol alan (veya üst): Sürüklenecek KARTI'lar (her kart: renkli arka plan + metin)
  - Sağ alan (veya alt): Drop Zone'lar — kategori başlıklı çerçeveler
  - Üst köşe: Soru/görev metni
  - Alt: "Kontrol Et" butonu (Submit) + "Sıfırla" butonu (Reset)
  - Sağ köşe: "İpucu" butonu (opsiyonel)

FORM VIEW AYARLARI:
  Correct Pairs: (YAPIMCI her kartı doğru hedefle eşleştir)
  Shuffle drag items: AÇIK
  Allow return to origin if dropped incorrectly: AÇIK
  Attempts: 2 (ilk denemede dönüt göster, ikincide cevabı ver)

LAYER YAPISI:
  Base Layer: Sürükle-bırak alanı
  Layer "Dogru_Donut": Tüm doğru → tebrik + NEDENİNİ açıklayan 2-3 cümle
  Layer "Yanlis_Hint": Yanlış → hangi kartın hangi kutuya gittiğini vurgula + ipucu
  Layer "Cevap_Goster": 2. denemede doğru düzeni göster
  Layer "Ipucu": (opsiyonel) İpucu metni + "Kapat" butonu

TRIGGER'LAR:
  Submit Tıklandı:
    → IF tüm doğru: adjustVar dogruSayisi += 1, Show Layer "Dogru_Donut"
    → ELSE IF deneme == 1: Show Layer "Yanlis_Hint", adjustVar deneme += 1
    → ELSE IF deneme >= 2: Show Layer "Cevap_Goster"

SCORM: Doğru yerleştirme sonrası Complete.`,
  },

  "senaryo_dallari": {
    name: "Dal-Budak Senaryo / Karar Noktaları",
    bloomLevels: ["analiz", "değerlendir", "yarat"],
    description: "Gerçekçi bir durum, öğrenci karar verir, her karar farklı sonuca götürür.",
    storylineNotes: `
STORYLINE 360 TEKNİK REHBERİ — DAL-BUDAK SENARYO

SLIDE AKIŞI:
  Slide 1 → Senaryo girişi (bağlam + karakter tanıtımı)
  Slide 2 → 1. Karar Noktası (2 seçenek)
    → Slide 3a: A yolu sonucu + 2. Karar
    → Slide 3b: B yolu sonucu + 2. Karar
  Slide 4a/4b/4c/4d: Nihai sonuçlar
  Slide 5 → Özet: Tüm yolların karşılaştırması

KARAR NOKTASI SLIDE'I LAYOUT:
  - Üst: Senaryo metni (durum açıklaması — karakter ağzından veya 3. şahıs)
  - Orta: İsteğe bağlı — görsel (karakter/ortam)
  - Alt sol: A Seçeneği butonu (yeşil-mavi tonları)
  - Alt sağ: B Seçeneği butonu (turuncu-kırmızı tonları)
  - (Eğer süre kısıtı varsa: Geri sayım timer — countdown variable ile)

LAYER YAPISI (Sonuç slide'larında):
  Base Layer: Sonuç açıklaması + "Devam Et" butonu
  Layer "Uzman": Bu kararı uzman/yetişkin nasıl değerlendirirdi
  Layer "Alternatif": "Diğer seçeneği seçseydin..." (opsiyonel)

VARİABLE'LAR:
  secim1 → Text, "" → "A" veya "B" olarak set edilir
  secim2 → Text, ""
  dogruYol → Boolean, false

TRIGGER'LAR:
  A Butonu Tıklandı:
    → adjustVar secim1 = "A"
    → Jump to Slide 3a
  B Butonu Tıklandı:
    → adjustVar secim1 = "B"
    → Jump to Slide 3b
  Son slide timeline start:
    → IF secim1 == "A" AND secim2 == "B": dogruYol = true
    → Set Score = dogruYol ? 100 : 50

SCORM: Son slide (özet) görüntülenince Complete.`,
  },

  "ogrenme_karti": {
    name: "Öğrenme Kartı (Flashcard)",
    bloomLevels: ["hatırla", "anla"],
    description: "Ön yüz: kavram, arka yüz: tanım. Kart çevirme animasyonuyla.",
    storylineNotes: `
STORYLINE 360 TEKNİK REHBERİ — FLASHCARD

SLIDE YAPISI:
  Her kavram için 1 slide.
  Toplam: [kavram sayısı] slide + 1 Giriş + 1 Sonuç

HER SLIDE LAYOUT:
  - Merkez: 600x380px kart çerçevesi
  - Base Layer (Ön Yüz): Kavram adı (büyük font) + temsili ikon/görsel
  - Layer "Arka" (Arka Yüz): Tanım (2-3 cümle) + örnek + kaynak
  - Kart dışı: Sol ok (önceki), sağ ok (sonraki), sayaç "Kart X/Y"
  - Alt: "Anladım ✓" butonu — tıklanınca State = Visited

ANİMASYON (3D Çevirme):
  Base Layer nesnesine: "Spin" animasyonu — Y ekseni, 180° (Exit)
  Layer "Arka" nesnesine: "Spin" animasyonu — Y ekseni, 180° (Entrance)
  Her ikisi aynı süre (0.4 saniye)

VARİABLE'LAR:
  anlasilanKart → Number, 0
  toplamKart → Number, [kart sayısı]

TRIGGER'LAR:
  Kart alanı tıklandı → Show Layer "Arka" (flip animasyonuyla)
  "Anladım" tıklandı:
    → adjustVar anlasilanKart += 1
    → Set State of "Anladım" butonu = Visited (Disabled)
  anlasilanKart == toplamKart:
    → Show "Tüm kartları gördün!" mesajı

SCORM: anlasilanKart == toplamKart olduğunda Complete.`,
  },

  "bosluk_doldurma": {
    name: "Boşluk Doldurma (Seçmeli veya Yazmalı)",
    bloomLevels: ["hatırla", "anla", "uygula"],
    description: "Cümlede boşluklar var, öğrenci doğru kelime/kavramı seçer veya yazar.",
    storylineNotes: `
STORYLINE 360 TEKNİK REHBERİ — BOŞLUK DOLDURMA

ÖNERİLEN YÖNTEM: Pick One (yazım hatası riski yok, mobil uyumlu)

SLIDE YAPISI:
  Her boşluk grubu ayrı slide VEYA tek slide çok boşluk (max 3-4 boşluk/slide)

LAYOUT:
  - Üst: Bağlam metni veya cümle (boşluk = görsel ayraç veya alt çizgi)
  - Boşluk için: 3-4 seçenekli buton grubu (her seçenek küçük dikdörtgen buton)
  - Sağ: Bağlam görseli (varsa)
  - Alt: "Kontrol Et" butonu

LAYER YAPISI:
  Base Layer: Metin + seçenekler
  Layer "Dogru_[N]": Doğru seçilince → neden doğru (2 cümle)
  Layer "Yanlis_[N]": Yanlış seçilince → ne neden yanlış + doğru cevap vurgusu
  Layer "Tamam": Tüm boşluklar doğruysa → genel değerlendirme

TRIGGER'LAR:
  Seçenek A tıklandı → Set State = Selected
  "Kontrol Et" tıklandı:
    → IF seçilen == doğru cevap: Show Layer "Dogru_1"
    → ELSE: Show Layer "Yanlis_1"

SCORM: Son boşluk doğru tamamlandığında Complete.`,
  },

  "video_izle_cevapla": {
    name: "Video İzle + Sor (Etkileşimli Video — Video ELİNİZDE HAZIR)",
    bloomLevels: ["anla", "uygula", "değerlendir"],
    description: "Hazır video var, belirli anlarda durur, soru sorulur.",
    storylineNotes: `
STORYLINE 360 TEKNİK REHBERİ — ETKİLEŞİMLİ VİDEO (Video dosyası hazır)

SLIDE YAPISI:
  Slide 1 → Video slide (tüm video, cue point'lerle)
  Slide 2-N → Soru layer'ları (video durunca açılır)

VİDEO AYARLARI:
  - Dosya: MP4, H.264, 720p max, 100MB max
  - Seek bar: KAPALI (öğrenci atlayamasın)
  - Cue points: Her kilit bilgiden ~5 saniye sonra

SORU LAYER'LARI:
  Cue point'e gelince → Pause + Show Layer "Soru_[N]"
  Layer "Dogru_[N]": Açıklayıcı 2 cümle dönüt + Resume trigger
  Layer "Yanlis_[N]": Yönlendirici 2 cümle dönüt + Tekrar İzle seçeneği

TRIGGER'LAR:
  Cue point N ulaşıldı → Pause Timeline → Show Layer "Soru_N"
  Doğru seçenek tıklandı → Show Layer "Dogru_N"
  Layer "Dogru_N" timeline complete → Hide tüm layer → Resume Timeline

SCORM: Video + tüm sorular tamamlandıysa Complete.
EBA: Altyazı (SRT) ZORUNLU. Video max 100MB.`,
  },

  "video_uretim_senaryosu": {
    name: "Video/Animasyon/Belgesel/Sanal Tur ÜRETİM SENARYOSU (Video henüz yok — üretilmesi gerekiyor)",
    bloomLevels: ["hatırla", "anla", "uygula", "analiz", "değerlendir"],
    description: "Açıklamada video/animasyon/belgesel/sanal tur üretilmesi planlanmış. Önce prodüksiyon senaryosu, sonra Storyline etkileşim planı.",
    storylineNotes: `
!! BU İÇERİK İÇİN ÖNCE VİDEO / ANİMASYON / SANAL TUR ÜRETİLMESİ GEREKİYOR.
Senaryo iki belgeden oluşur:
  BELGE 1 → Prodüksiyon Senaryosu   (yönetmene / animatöre / sanal tur üreticisine)
  BELGE 2 → Storyline Etkileşim Planı   (video hazırlandıktan sonra Storyline'da uygulanır)

════════════════════════════════════════════════
BELGE 1 FORMATI — Her sahne şu yapıda yazılır:
════════════════════════════════════════════════

┌─ SAHNE [N] ─────────────────────────────────────────────────────────────┐
│ Süre: ~[X] saniye  |  Tür: [2D Animasyon / 3D / Gerçek Çekim / Sanal Tur]
│
│ GÖRÜNTÜ:
│   [Ekranda ne var — karakter, arka plan, kamera açısı, hareket yönü]
│   [Geçiş efekti / zoom / vurgu animasyonu]
│
│ MÜZİK / SES EFEKTİ:
│   [Arka plan tonu: merak / heyecan / sakin / dramatik]
│   [Varsa ses efekti: tıklama, ding, doğa sesi vb.]
│
│ SESLENDİRME (sanatçıya verilecek tam metin — noktalama dahil):
│   "[Virgül ve nokta tempoyu belirler. *Yıldız* = vurgulu okuma.]"
│
│ ALTYAZI (SRT dosyasına — seslendirmeyle birebir aynı):
│   "[EBA erişilebilirlik zorunluluğu]"
│
│ GÖRSEL NOTLAR (animatöre / sanat yönetmenine):
│   [Renk paleti, karakter özellikleri, prop'lar, mekan detayı]
└─────────────────────────────────────────────────────────────────────────┘

════════════════════════════════════════════════
BELGE 2 FORMATI — Storyline Etkileşim Planı
════════════════════════════════════════════════
(Video hazırlandıktan sonra Storyline'a aktarımda kullanılır)

  CUE POINT [N] — [Dakika:Saniye]
  Soru: [Tam soru metni]
  A) [Seçenek]   B) [Seçenek]   C) [Seçenek — gerekirse]
  Doğru Cevap: [Harf]
  Doğru Dönüt: "[2 cümle — neden doğru + kazanıma bağlantı]"
  Yanlış Dönüt: "[2 cümle — yanılgıyı düzelt + doğruya yönlendir]"

SCORM: Video + tüm sorular tamamlandıysa Complete.
EBA: SRT altyazı ZORUNLU. MP4 H.264 720p max 100MB.`,
  },
};

function selectBestTemplate(bloomLevel, mode, desc = "") {
  const d = desc.toLowerCase();

  // Video modu: elinde HAZIR MI yoksa ÜRETİLECEK Mİ?
  if (mode === "video") {
    // "hazırlanır/üretilecek/yapılacak/oluşturulacak" → önce prodüksiyon senaryosu gerekli
    const needsProduction = /hazırlan|üretil|yapılacak|oluşturul|animasyon.*hazır|belgesel.*hazır|sanal.*tur.*hazır/.test(d);
    return needsProduction ? "video_uretim_senaryosu" : "video_izle_cevapla";
  }
  // Video modu olmasa bile açıklamada üretim sinyali varsa
  if (/animasyon|belgesel|sanal (müze|tur)/.test(d)) return "video_uretim_senaryosu";
  if (d.includes("sırala") || d.includes("adım") || d.includes("süreç") || d.includes("eşleştir")) return "surukle_birak_siralama";
  if (d.includes("boşluk") || d.includes("tamamla") || d.includes("doldur")) return "bosluk_doldurma";
  if (d.includes("karar") || d.includes("senaryo") || d.includes("durum") || d.includes("vaka")) return "senaryo_dallari";
  if (d.includes("kart") || d.includes("kavram") || d.includes("tanım") || d.includes("flashcard")) return "ogrenme_karti";
  if (d.includes("tıkla") || d.includes("keşif") || d.includes("infograf") || d.includes("harita")) return "tiklanabilir_infografik";
  const bloomDefaults = {
    hatırla: "siniflandirma_oyunu",
    anla: "tiklanabilir_infografik",
    uygula: "surukle_birak_siralama",
    analiz: "senaryo_dallari",
    değerlendir: "senaryo_dallari",
    yarat: "senaryo_dallari",
  };
  return bloomDefaults[bloomLevel] || "siniflandirma_oyunu";
}

// ─── Harici Prompt Üretici ───────────────────────────────────────────────────
async function buildExternalPrompt({ openai, grade, course, unit, outcome, contentType, desc, userRequest }) {
  const bloomLevel = detectBloomLevel(outcome);
  const cogProfile = getCognitiveProfile(grade);

  // İçerik türü ipucu
  const contentHint = (() => {
    const d = (desc + " " + contentType).toLowerCase();
    if (/video|animasyon|belgesel|sanal.*tur/.test(d)) return "video veya animasyon";
    if (/simülasyon|simulasyon/.test(d)) return "simülasyon";
    if (/etkileşim|interaktif|oyun/.test(d)) return "etkileşimli içerik veya oyun";
    if (/sürükle|eşleştir|sırala/.test(d)) return "sürükle-bırak etkileşimi";
    return "eğitim içeriği";
  })();

  const systemMsg = `Sen MEB müfredatına ve Articulate Storyline 360 ile video animasyon üretim süreçlerine hâkim bir öğretim tasarımcısısın.
Görevin: Bir alan yazarının herhangi bir yapay zekâya (ChatGPT, Claude, Gemini vb.) girerek e-içerik senaryosu üretebileceği, kopyala-yapıştır hazır, model-agnostik, Türkçe bir prompt yazmak.

PROMPT YAZIM KURALLARI:
- Prompt Türkçe olacak
- Prompt bağımsız çalışmalı — karşı tarafa bağlam tamamen verilecek
- Prompt şu bölümleri içerecek: [BAĞLAM], [GÖREV], [KISITLAR], [ÇIKTI FORMATI]
- Kısıtlar bölümünde Storyline 360 teknik sınırlılıkları ve müfredat sınırları yer alacak
- Çıktı formatı bölümünde ekran ekran senaryo, seslendirme metni ve yapımcı notları istenecek
- Prompt, "Sen bir öğretim tasarımcısısın..." diye başlayacak
- Sonuna "Bu promptu ChatGPT, Claude, Gemini veya istediğiniz yapay zekâya yapıştırabilirsiniz." notu EKLEME — bunu sistem zaten söylüyor`;

  const userMsg = `Şu bilgilerle prompt yaz:
- Sınıf: ${grade}. Sınıf | Ders: ${course} | Ünite: ${unit}
- Kazanım: ${outcome}
- İçerik Türü: ${contentType} | Açıklama: ${desc || "(belirtilmemiş)"}
- Bloom Seviyesi: ${bloomLevel} | Bilişsel Profil: ${cogProfile.stage}
- Yaş Notu: ${cogProfile.ageNote}
- İçerik Yönelimi: ${contentHint}
${userRequest ? `
- Yazarın Özel İsteği: "${userRequest}"` : ""}

Prompt içinde şu KISITLARI mutlaka belirt:
1. Articulate Storyline 360 ile üretilecek (teknik kısıtlar: max ${cogProfile.maxSlides} ekran, SCORM 1.2, EBA uyumlu)
2. Video/animasyon varsa: MP4 H.264 720p max, SRT altyazı zorunlu, 100MB limit
3. ${grade}. sınıf dil seviyesi: ${cogProfile.lang}
4. TTKB kırmızı çizgiler: müfredat sınırları aşılmayacak
5. Dönütler "Tebrikler/Yanlış" değil, açıklayıcı 2 cümle olacak`;

  try {
    const r = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.2,
      max_tokens: 1200,
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: userMsg }
      ]
    });
    return r.choices?.[0]?.message?.content || "Prompt üretilemedi.";
  } catch(e) {
    return "Prompt üretilirken hata: " + String(e.message || e);
  }
}

// ─── Ana handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ title: "Hata", error: "Method not allowed" });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ title: "AI Hatası", error: "OPENAI_API_KEY bulunamadı" });

    // ── Kimlik doğrulama ─────────────────────────────────────────────────
    const user = authCheck(req, res);
    if (!user) return;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const row = req.body || {};

    const grade       = String(row["SINIF"] ?? "").trim();
    const course      = String(row["DERS ADI"] ?? "").trim();
    const unit        = String(row["ÜNİTE/TEMA/ ÖĞRENME ALANI"] ?? "").trim();
    const outcome     = String(row["KAZANIM/ÖĞRENME ÇIKTISI/BÖLÜM"] ?? "").trim();
    const contentType = String(row["E-İÇERİK TÜRÜ"] ?? "").trim();
    let   desc        = String(row["AÇIKLAMA"] ?? "").trim();
    if (row.forceChoiceText) desc = String(row.forceChoiceText).trim();
    const ebaUrl      = String(row["EBA_URL"] ?? "").trim();

    // ── Ders yetkisi kontrolü ─────────────────────────────────────────────
    if (!dersCheck(user, course, grade, res)) return;

    // ── PROMPT MODU: Yazara kopyalanabilir prompt üret ───────────────────────
    if (row.promptMode === true) {
      const userRequest = String(row.userRequest || "").trim();
      const generatedPrompt = await buildExternalPrompt({
        openai, grade, course, unit, outcome, contentType, desc, userRequest
      });
      return res.status(200).json({ prompt: generatedPrompt });
    }

    const mode       = row.forceMode ? String(row.forceMode) : pickContentMode(contentType);
    const bloomLevel = detectBloomLevel(outcome);
    const cogProfile = getCognitiveProfile(grade);
    const codeInfo   = analyzeOutcomeCode(outcome);
    // AI'ın videoStatus tespitini templateKey seçimine yansıt (Aşama 1'den önce)
    const templateKey = row.forceTemplate || selectBestTemplate(bloomLevel, mode, desc);
    const template    = TEMPLATE_LIBRARY[templateKey] || TEMPLATE_LIBRARY["siniflandirma_oyunu"];

    // ── AŞAMA 1: Pedagojik Analiz ────────────────────────────────────────────
    const analysisPrompt = `
Sen MEB TYMM müfredatına hâkim bir öğretim tasarımcısısın.
Şu kazanımı analiz et ve YALNIZCA JSON döndür:

Kazanım: "${outcome}"
Ders: ${course}, Sınıf: ${grade}, Ünite: ${unit}
İçerik Açıklaması: ${desc}

{
  "bloomLevel": "tespit ettiğin Bloom seviyesi (Türkçe)",
  "bloomVerb": "kazanımdaki eylem fiili",
  "coreConceptsToTeach": ["kavram1", "kavram2", "kavram3"],
  "prerequisiteKnowledge": "ön bilgiler virgülle",
  "commonMisconceptions": ["Yanlış inanç 1 — örnek cümle olarak", "Yanlış inanç 2"],
  "tymm_skill": "TYMM 21.yy becerisi",
  "tymm_value": "TYMM değeri",
  "suggestedNarrative": "Yaratıcı içerik çerçevesi — kim, nerede, ne yapıyor",
  "redLines": ["X kavramından bahsetme çünkü [somut neden]"],
  "videoStatus": "needs_production VEYA exists_ready — İçerik açıklamasında video/animasyon/belgesel/sanal tur ÜRETILMESINDEN söz ediliyorsa needs_production yaz, hazır bir videodan söz ediliyorsa exists_ready yaz",
  "videoScenes": [
    {"sahneNo": 1, "sure": "~30 saniye", "goruntu": "Ekranda ne görünüyor — karakter, arka plan, kamera açısı", "seslendirme": "Seslendirme metni tam cümle — noktalama dahil", "gorselNot": "Animatöre renk/karakter/efekt notu"},
    {"sahneNo": 2, "sure": "~30 saniye", "goruntu": "...", "seslendirme": "...", "gorselNot": "..."},
    {"sahneNo": 3, "sure": "~30 saniye", "goruntu": "...", "seslendirme": "...", "gorselNot": "..."},
    {"sahneNo": 4, "sure": "~30 saniye", "goruntu": "...", "seslendirme": "...", "gorselNot": "..."}
  ],
  "sampleItems": [
    {"content": "İfade/soru/durum metni tam olarak", "category": "Doğru kategori adı", "isCorrectCategory": true, "feedback": "Neden bu kategoride — 1 somut cümle"},
    {"content": "İfade 2", "category": "Yanlış kategori", "isCorrectCategory": false, "feedback": "Açıklama"},
    {"content": "İfade 3", "category": "Doğru", "isCorrectCategory": true, "feedback": "Açıklama"},
    {"content": "İfade 4", "category": "Yanlış", "isCorrectCategory": false, "feedback": "Açıklama"},
    {"content": "İfade 5", "category": "Doğru", "isCorrectCategory": true, "feedback": "Açıklama"},
    {"content": "İfade 6", "category": "Yanlış", "isCorrectCategory": false, "feedback": "Açıklama"},
    {"content": "İfade 7", "category": "Doğru", "isCorrectCategory": true, "feedback": "Açıklama"},
    {"content": "İfade 8", "category": "Yanlış", "isCorrectCategory": false, "feedback": "Açıklama"}
  ],
  "languageRegister": "Dil tonu önerisi bu yaş için"
}`;

    let ped = {};
    try {
      const r1 = await openai.chat.completions.create({
        model: "gpt-4o", temperature: 0.1, max_tokens: 2200,
        messages: [{ role: "user", content: analysisPrompt }],
      });
      const raw1 = (r1.choices?.[0]?.message?.content || "{}").replace(/```json|```/g, "").trim();
      ped = JSON.parse(raw1);
    } catch (_) {
      ped = { bloomLevel, commonMisconceptions: [], sampleItems: [], coreConceptsToTeach: [], redLines: [] };
    }

    // AI'ın videoStatus tespitini şablon seçimine uygula (açıklama yetersiz kaldıysa)
    const finalTemplateKey = row.forceTemplate || (
      ped.videoStatus === "needs_production" ? "video_uretim_senaryosu" :
      ped.videoStatus === "exists_ready"     ? "video_izle_cevapla"     :
      templateKey
    );
    const finalTemplate = TEMPLATE_LIBRARY[finalTemplateKey] || template;

    // Üretim senaryosu varsa videoScenes metnini hazırla
    const videoScenesText = Array.isArray(ped.videoScenes) && ped.videoScenes.length > 0
      ? ped.videoScenes.map(s =>
          `  SAHNE ${s.sahneNo} (~${s.sure}):\n` +
          `    Görüntü: ${s.goruntu}\n` +
          `    Seslendirme: "${s.seslendirme}"\n` +
          `    Görsel not: ${s.gorselNot}`
        ).join("\n\n")
      : "";

    const sampleItemsText = Array.isArray(ped.sampleItems)
      ? ped.sampleItems.map((q, i) =>
          `  ${i+1}. "${q.content}" → Kategori: ${q.category} | Dönüt: "${q.feedback}"`
        ).join("\n")
      : "";

    const misconceptionsText = Array.isArray(ped.commonMisconceptions)
      ? ped.commonMisconceptions.map(m => `  • ${m}`).join("\n")
      : String(ped.commonMisconceptions || "—");

    const redLinesText = Array.isArray(ped.redLines)
      ? ped.redLines.map(r => `  • ${r}`).join("\n")
      : String(ped.redLines || "—");

    // ── AŞAMA 2: Tam Senaryo ─────────────────────────────────────────────────
    const systemInstruction = `
Sen MEB TTKB e-içerik standartlarını ve TYMM felsefesini içselleştirmiş, Articulate Storyline 360 uzmanı Baş Öğretim Tasarımcısısın.

GÖREV: Yazarın elinden tutarak, yapımcının Storyline'ı açıp birebir uygulayabileceği senaryo üret.

ALTTIN KURALLAR — BUNLARIN DIŞINA ÇIKMA:
1. TÜM METİNLERİ DOLDUR. "[Buraya yaz]", "[YAZAR DOLDURACAK]", "[örnek]" yazma. Gerçek metin üret.
2. SORULARI/İÇERİKLERİ TEK TEK YAZ. "8 soru olacak" değil, 8 soruyu birebir yaz.
3. HER DÖNÜT 2 CÜMLE VE AÇIKLAYICI OLMALI. Sadece "Tebrikler!" veya "Yanlış!" TTKB'den döner.
4. DİL: ${cogProfile.ageNote}
5. YAPIMCIYA STORYLINE'A ÖZGÜ TALİMAT VER. "Trigger ekle" değil, tam olarak hangi nesneye hangi trigger.
`;

    const userPrompt = `
## PROJE BİLGİLERİ
- Sınıf: ${grade} | Ders: ${course} | Ünite: ${unit}
- Kazanım: ${outcome}${codeInfo ? ` (${codeInfo.raw})` : ""}
- İçerik Türü: ${contentType} | Açıklama: ${desc || "(belirtilmemiş)"}

## PEDAGOJİK ANALİZ SONUÇLARI
- Bloom: ${ped.bloomLevel || bloomLevel} | Fiil: "${ped.bloomVerb || "—"}"
- Öğretilecek kavramlar: ${(ped.coreConceptsToTeach || []).join(", ") || "—"}
- Ön bilgi: ${ped.prerequisiteKnowledge || "—"}
- TYMM: ${ped.tymm_skill || "—"} / ${ped.tymm_value || "—"}
- İçerik çerçevesi: "${ped.suggestedNarrative || "—"}"
- Dil: ${ped.languageRegister || cogProfile.lang}

## KIRMIZI ÇİZGİLER
${redLinesText}

## YAYGIN KAVRAM YANILGILARI (Dönütlerde ele alınacak)
${misconceptionsText}

## AI'NIN ÜRETTİĞİ HAZIR İÇERİKLER (Revize edilebilir, değiştirilebilir)
${sampleItemsText}

${videoScenesText ? `## AI'NIN ÜRETTİĞİ VİDEO/ANİMASYON SAHNE TASLAKLARI\n(Yönetmene / animatöre iletilecek — revize edilebilir)\n${videoScenesText}\n` : ""}
## SEÇİLEN ŞABLON: ${finalTemplate.name}
${finalTemplate.storylineNotes}

---

## LÜTFEN ŞU 4 BÖLÜMÜ TAM VE EKSİKSİZ ÜRETİN:

---
### 📋 BÖLÜM 1 — YAZARA: İÇERİK REHBERİ

**İşlenecek Kavramlar ve Örnek Cümleler:**
(Her kavram için somut örnek — yazar bunları revize eder)

**Girilmeyecek Konular:**
(Müfredat sınırı — somut gerekçeyle)

**Dil ve Ton:**
(Bu yaş için cümle uzunluğu, kelime tercihi, hitap biçimi — somut örnekle)

**TYMM ${ped.tymm_skill || "Becerisi"} Entegrasyonu:**
(Bu içeriğe nasıl yedirilir — 2 somut öneri)

---
### 🎬 BÖLÜM 2 — TAM SENARYO (Ekran ekran, metin dahil)

Her ekran için şu yapıyı kullan:

---
**EKRAN [N]: [Başlık]**
*Slide Türü: [Storyline slide type]*

📐 YAPIMCI:
[Bu ekrana özgü teknik not — layer adı, trigger adı, variable adı tam olarak]

📢 ÖĞRENCIYE GÖSTERILEN METİN (tam metin — yazar sadece revize eder):
"[Gerçek metin burada olacak]"

🃏 İÇERİK ELEMANLARI (Sorular, kartlar, seçenekler — tam liste):
[Her birini tek tek yaz — "Soru 1:", "Soru 2:" diye]

✅ DOĞRU CEVAP DÖNÜTLERİ:
[Her doğru için: açıklayıcı 2 cümle — kavram yanılgısına veya TYMM'ye bağla]

❌ YANLIŞ CEVAP DÖNÜTLERİ:
[Her yanlış için: yanılgıyı düzelt + doğruya yönlendir — 2 cümle]
---

(Giriş → İçerik/Oyun ekranları → Sonuç ekranı — TÜM ekranları yaz)

---
### ⚙️ BÖLÜM 3 — YAPIMCI KONTROL LİSTESİ

1. Completion Trigger (tam Storyline yolu):
2. Dosya Boyutu (EBA standartları):
3. Erişilebilirlik (Tab order, Alt text, Kontrast):
4. SCORM Cloud Test Senaryoları (3 kritik test):
5. Bu içeriğe özgü uyarılar:

---
### 🔍 BÖLÜM 4 — YAZAR ONAY FORMU

[ ] Tüm metinler kazanım sınırları içinde mi?
[ ] Dönütler açıklayıcı 2 cümle mi? (Tebrikler/Yanlış yazmadım)
[ ] Görseller listesi: ___, ___, ___ (yapımcıya iletildi)
[ ] Seslendirme metni ayrı belge olarak hazırlandı mı?
[ ] TYMM değeri içeriğe yedirildi mi?
[ ] Kavram yanılgıları dönütlerde ele alındı mı?
[ ] ${grade}. sınıf dil seviyesine uygun mu?
[ ] Doğru/yanlış denge: yaklaşık %50 doğru, %50 yanlış ifade var mı?
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.35,
      max_tokens: 5000,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: userPrompt },
      ],
    });

    const text = completion.choices?.[0]?.message?.content || "Boş yanıt";

    return res.status(200).json({
      title: `${grade}. Sınıf ${course} — ${outcome.substring(0, 55)}...`,
      text,
      meta: {
        grade, course, unit, outcome, contentType, mode,
        bloomLevel: ped.bloomLevel || bloomLevel,
        tymm_skill: ped.tymm_skill || null,
        suggestedNarrative: ped.suggestedNarrative || null,
        outcomeCode: codeInfo?.raw || null,
        cognitiveStage: getCognitiveProfile(grade).stage,
        templateUsed: finalTemplateKey,
        templateName: finalTemplate.name,
        videoStatus: ped.videoStatus || null,
        sampleItems: ped.sampleItems || [],
        ebaUrl: ebaUrl || null,
      },
    });
  } catch (error) {
    return res.status(500).json({ title: "AI Hatası", error: error?.message || String(error) });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ─── BUILD HANDLER: HTML5 İçerik Üretici ───────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Video türleri — bu türler için Hayata Geçir pasif
const VIDEO_MODES = new Set(["video", "video_izle_cevapla", "video_uretim_senaryosu"]);

function isVideoContent(contentType = "", templateKey = "") {
  const t = contentType.toLowerCase();
  if (VIDEO_MODES.has(templateKey)) return true;
  if (/video|belgesel|film|animasyon|sanal.*tur/.test(t)) return true;
  return false;
}

// ── HTML5 Üretim Sistemi ─────────────────────────────────────────────────
// Her şablon tipi için ayrı builder fonksiyonu.
// AI kazanım + sampleItems'ı alır, tam HTML5 üretir.

async function buildHTML5Content({ openai, templateKey, grade, course, unit, outcome, contentType, desc, sampleItems, cogProfile }) {

  const itemsJson = JSON.stringify(sampleItems || [], null, 2);
  const gradeNum = parseInt(grade) || 5;

  // Her şablon tipi için özelleştirilmiş system prompt
  const builderPrompts = {

    siniflandirma_oyunu: `
Sen MEB EBA için HTML5 eğitim içeriği üreten bir frontend geliştiricisisin.
GÖREV: Tam çalışan, tek dosya HTML5 sınıflandırma/doğru-yanlış oyunu üret.

TEKNİK KURALLAR:
- Tek .html dosyası — harici CDN yok, tüm CSS+JS inline
- Mobil uyumlu, touch destekli
- Türkçe arayüz
- Oyun mekaniği: Her ifade ekrana gelir → Doğru / Yanlış butonu → Anında görsel+metin dönüt
- Skor sayacı, ilerleme çubuğu
- Tüm içerik sağlanan JSON'dan alınır — placeholder YASAK
- EBA renk paleti: koyu lacivert (#0a1628) arka plan, açık kart (#1a2d4a), vurgu mavi (#2d7dd2)
- Animasyonlar: CSS transitions, konfeti efekti doğru cevapta
- Tüm sorular teker teker gösterilir, son ekranda puan ve özet

JSON FORMAT ŞART: Yanıt YALNIZCA geçerli HTML kodu olacak — başında \`\`\`html olmayacak, açıklama olmayacak.`,

    tiklanabilir_infografik: `
Sen MEB EBA için HTML5 eğitim içeriği üreten bir frontend geliştiricisisin.
GÖREV: Tam çalışan, tek dosya HTML5 tıklanabilir infografik üret.

TEKNİK KURALLAR:
- Tek .html dosyası — harici CDN yok, tüm CSS+JS inline
- Mobil uyumlu
- Türkçe arayüz
- Mekanizma: Merkezi görsel/diyagram üzerinde hotspot noktalar → tıklayınca kart açılır (kavram + açıklama)
- Tüm kavramlar keşfedilince "Tamamladınız!" ekranı
- Sağlanan JSON'daki kavramlar için hotspot konumları otomatik hesaplanır (grid veya daire dizilim)
- EBA renk paleti: koyu lacivert (#0a1628), kart (#1a2d4a), vurgu (#2d7dd2)
- Tıklanan hotspot pulse animasyonu
- JSON FORMAT ŞART: Yanıt YALNIZCA geçerli HTML — başında \`\`\`html olmayacak.`,

    surukle_birak_siralama: `
Sen MEB EBA için HTML5 eğitim içeriği üreten bir frontend geliştiricisisin.
GÖREV: Tam çalışan, tek dosya HTML5 sürükle-bırak sıralama/eşleştirme oyunu üret.

TEKNİK KURALLAR:
- Tek .html dosyası — harici CDN yok, tüm CSS+JS inline
- Mobil uyumlu: touch events (touchstart/touchmove/touchend) VE mouse events
- Türkçe arayüz
- Mekanizma: Kartları doğru sıraya veya doğru hedef kutularına sürükle
- "Kontrol Et" butonu → yanlış olanlar kırmızı, doğrular yeşil
- Sağlanan JSON'dan kartlar ve doğru sıra/eşleştirme alınır
- EBA renk paleti: #0a1628, #1a2d4a, #2d7dd2
- Sürükleme sırasında ghost efekti, bırakma animasyonu
- JSON FORMAT ŞART: Yanıt YALNIZCA geçerli HTML — başında \`\`\`html olmayacak.`,

    ogrenme_karti: `
Sen MEB EBA için HTML5 eğitim içeriği üreten bir frontend geliştiricisisin.
GÖREV: Tam çalışan, tek dosya HTML5 flashcard (öğrenme kartı) sistemi üret.

TEKNİK KURALLAR:
- Tek .html dosyası — harici CDN yok, tüm CSS+JS inline
- Mobil uyumlu, swipe destekli
- Türkçe arayüz
- Mekanizma: Kartın ön yüzü (kavram/soru) → tıkla/çevir → arka yüz (açıklama/cevap) → İleri/Geri navigasyon
- 3D kart çevirme animasyonu (CSS perspective/rotateY)
- "Öğrendim" / "Tekrar İzleyeceğim" butonu — öğrenilenleri takip et
- Final ekranı: kaç kart öğrenildi
- Sağlanan JSON'dan kartlar alınır
- EBA renk paleti: #0a1628, #1a2d4a, #2d7dd2
- JSON FORMAT ŞART: Yanıt YALNIZCA geçerli HTML — başında \`\`\`html olmayacak.`,

    bosluk_doldurma: `
Sen MEB EBA için HTML5 eğitim içeriği üreten bir frontend geliştiricisisin.
GÖREV: Tam çalışan, tek dosya HTML5 boşluk doldurma egzersizi üret.

TEKNİK KURALLAR:
- Tek .html dosyası — harici CDN yok, tüm CSS+JS inline
- Mobil uyumlu
- Türkçe arayüz
- Mekanizma: Cümlede boşluk var → kelime havuzundan sürükle-bırak VEYA tıkla-seç
- Her boşluk dolunca anında görsel dönüt (doğru: yeşil, yanlış: kırmızı + sallama animasyonu)
- "Kontrol Et" ve "Temizle" butonları
- Sağlanan JSON'dan cümleler ve doğru kelimeler alınır
- EBA renk paleti: #0a1628, #1a2d4a, #2d7dd2
- JSON FORMAT ŞART: Yanıt YALNIZCA geçerli HTML — başında \`\`\`html olmayacak.`,

    senaryo_dallari: `
Sen MEB EBA için HTML5 eğitim içeriği üreten bir frontend geliştiricisisin.
GÖREV: Tam çalışan, tek dosya HTML5 dal-budak karar senaryosu üret.

TEKNİK KURALLAR:
- Tek .html dosyası — harici CDN yok, tüm CSS+JS inline
- Mobil uyumlu
- Türkçe arayüz
- Mekanizma: Senaryo metni → 2-3 seçenek → seçime göre farklı devam → sonuç ekranı
- İlerleme çubuğu, geri dönüş butonu
- Duygusal/görsel arka plan değişimi seçime göre (doğru yol: yeşilimsi, yanlış: kırmızımsı)
- Sağlanan JSON'dan senaryo düğümleri alınır
- EBA renk paleti: #0a1628, #1a2d4a, #2d7dd2
- JSON FORMAT ŞART: Yanıt YALNIZCA geçerli HTML — başında \`\`\`html olmayacak.`,
  };

  // Şablona göre uygun prompt seç, yoksa genel
  const systemPrompt = builderPrompts[templateKey] || builderPrompts["siniflandirma_oyunu"];

  const userPrompt = `
İçerik Bilgileri:
- Sınıf: ${grade}. Sınıf | Ders: ${course} | Ünite: ${unit}
- Kazanım: ${outcome}
- İçerik Türü: ${contentType}
- Açıklama: ${desc}
- Yaş Notu: ${cogProfile.ageNote}

Kullanılacak İçerik Verileri (JSON):
${itemsJson}

Bu verileri kullanarak tam çalışan HTML5 içeriği üret.
Başlık: "${outcome.substring(0, 60)}" olsun.
Öğrenci hitabı: "${gradeNum <= 4 ? "sen" : "sen"}" (${gradeNum}. sınıf seviyesine uygun dil).

ÖNEMLİ: Sağlanan JSON'daki gerçek içerikleri kullan. Örnek/dummy veri KULLANMA.
Çıktı: Yalnızca HTML kodu. \`\`\`html işareti koyma, sadece <!DOCTYPE html> ile başla.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.2,
    max_tokens: 4000,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  });

  let html = response.choices?.[0]?.message?.content || "";
  // Markdown fence varsa temizle
  html = html.replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  // Temel doğrulama
  if (!html.includes("<!DOCTYPE") && !html.includes("<html")) {
    throw new Error("Geçersiz HTML üretildi");
  }

  return html;
}

// ── Build Handler ────────────────────────────────────────────────────────────
module.exports.buildHandler = async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY bulunamadı" });

    // ── Kimlik doğrulama ─────────────────────────────────────────────────
    const user = authCheck(req, res);
    if (!user) return;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const row = req.body || {};

    const grade       = String(row["SINIF"] ?? "").trim();
    const course      = String(row["DERS ADI"] ?? "").trim();
    const unit        = String(row["ÜNİTE/TEMA/ ÖĞRENME ALANI"] ?? "").trim();
    const outcome     = String(row["KAZANIM/ÖĞRENME ÇIKTISI/BÖLÜM"] ?? "").trim();
    const contentType = String(row["E-İÇERİK TÜRÜ"] ?? "").trim();
    const desc        = String(row["AÇIKLAMA"] ?? "").trim();

    const mode        = pickContentMode(contentType);
    const bloomLevel  = detectBloomLevel(outcome);
    const cogProfile  = getCognitiveProfile(grade);
    const templateKey = row.forceTemplate || selectBestTemplate(bloomLevel, mode, desc);

    // Ders yetkisi kontrolü
    if (!dersCheck(user, course, grade, res)) return;

    // Video içerik kontrolü
    if (isVideoContent(contentType, templateKey)) {
      return res.status(400).json({ error: "video_mode", message: "Video içerikler için HTML5 üretimi desteklenmiyor." });
    }

    // sampleItems yoksa önce pedagojik analiz yap
    let sampleItems = Array.isArray(row.sampleItems) && row.sampleItems.length > 0
      ? row.sampleItems
      : null;

    if (!sampleItems) {
      // Hızlı analiz — sadece sampleItems için
      try {
        const quickAnalysis = await openai.chat.completions.create({
          model: "gpt-4o",
          temperature: 0.15,
          max_tokens: 1200,
          messages: [{
            role: "user",
            content: `Kazanım: "${outcome}"
Ders: ${course}, Sınıf: ${grade}, Şablon: ${templateKey}
Açıklama: ${desc}

Bu kazanım için ${templateKey} şablonuna uygun 8 adet içerik öğesi üret.
YALNIZCA JSON döndür:
{
  "sampleItems": [
    {"content": "tam ifade/soru metni", "category": "kategori adı", "isCorrectCategory": true, "feedback": "açıklama cümlesi"},
    ...8 öğe toplam, yaklaşık yarısı doğru yarısı yanlış kategoride
  ]
}`
          }]
        });
        const raw = (quickAnalysis.choices?.[0]?.message?.content || "{}").replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(raw);
        sampleItems = parsed.sampleItems || [];
      } catch(_) {
        sampleItems = [];
      }
    }

    const htmlContent = await buildHTML5Content({
      openai, templateKey, grade, course, unit, outcome, contentType, desc, sampleItems, cogProfile
    });

    // Dosya adı oluştur
    const safeName = `${grade}Sinif_${course}_${outcome.substring(0, 30)}`
      .replace(/[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ_]/g, "_")
      .replace(/_+/g, "_");

    return res.status(200).json({
      html: htmlContent,
      filename: `${safeName}.html`,
      templateKey,
      templateName: (TEMPLATE_LIBRARY[templateKey] || {}).name || templateKey,
    });

  } catch (error) {
    return res.status(500).json({ error: error?.message || String(error) });
  }
};
