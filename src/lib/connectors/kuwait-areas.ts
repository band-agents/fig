// Kuwait areas as UPS Kuwait (GMTC) spells them: their destination "pincode" is the area name and must
// match their list exactly ("Hawally", not "Hawalli"; "Jabriyah"; "Mubarak Al Kabeer"). Spellings marked
// ✓ were accepted by GMTC's staging account on 25 Oct 2026; the rest are the common English names and
// get confirmed against GMTC's full list. Customers type freely (English, Arabic, typos): each name below
// lists what they write.

const AREAS: Record<string, string[]> = {
  'Kuwait City': ['kuwait city', 'kuwaitcity', 'capital', 'al asimah', 'asimah', 'city', 'مدينة الكويت', 'العاصمة', 'الكويت العاصمة'], // ✓
  Hawally: ['hawally', 'hawalli', 'hawali', 'hawaly', 'hawl', 'حولي'], // ✓
  Salmiya: ['salmiya', 'salmiyah', 'salmia', 'al salmiya', 'السالمية', 'سالمية'], // ✓
  Jabriyah: ['jabriya', 'jabriyah', 'jabria', 'الجابرية', 'جابرية'], // ✓
  Farwaniyah: ['farwaniya', 'farwaniyah', 'farwania', 'الفروانية', 'فروانية'], // ✓
  Ahmadi: ['ahmadi', 'al ahmadi', 'الأحمدي', 'الاحمدي'], // ✓
  Jahra: ['jahra', 'al jahra', 'jahrah', 'الجهراء', 'جهراء'], // ✓
  'Mubarak Al Kabeer': ['mubarak al kabeer', 'mubarak al-kabeer', 'mubarak alkabeer', 'mubarak al kabir', 'مبارك الكبير'], // ✓
  Mangaf: ['mangaf', 'al mangaf', 'المنقف', 'منقف'], // ✓
  Fintas: ['fintas', 'al fintas', 'الفنطاس', 'فنطاس'], // ✓
  Khaitan: ['khaitan', 'kheitan', 'خيطان'], // ✓
  Rumaithiya: ['rumaithiya', 'rumaithiyah', 'rumathiya', 'الرميثية', 'رميثية'], // ✓
  'Sabah Al Salem': ['sabah al salem', 'sabah al-salem', 'sabah alsalem', 'صباح السالم'], // ✓
  Mishref: ['mishref', 'mishrif', 'مشرف'], // ✓
  Bayan: ['bayan', 'بيان'], // ✓
  Salwa: ['salwa', 'سلوى'],
  Surra: ['surra', 'al surra', 'السرة'],
  Qurtuba: ['qurtuba', 'qortuba', 'قرطبة'],
  Yarmouk: ['yarmouk', 'al yarmouk', 'اليرموك'],
  Mansouriya: ['mansouriya', 'mansouria', 'المنصورية'],
  Shamiya: ['shamiya', 'shamiyah', 'الشامية'],
  Rawda: ['rawda', 'rawdah', 'al rawda', 'الروضة'],
  Adailiya: ['adailiya', 'adailiyah', 'العديلية'],
  Khaldiya: ['khaldiya', 'khaldiyah', 'الخالدية'],
  Kaifan: ['kaifan', 'كيفان'],
  Nuzha: ['nuzha', 'nuzhah', 'النزهة'],
  Faiha: ['faiha', 'faihaa', 'الفيحاء'],
  Shuwaikh: ['shuwaikh', 'shuwaikh industrial', 'الشويخ'], // ✗ refused as spelled: GMTC's own spelling still needed
  Sharq: ['sharq', 'شرق'],
  Mirqab: ['mirqab', 'المرقاب'],
  Dasman: ['dasman', 'دسمان'],
  'Bneid Al Gar': ['bneid al gar', 'bneid al-gar', 'بنيد القار'],
  Shaab: ['shaab', 'الشعب'],
  Dasma: ['dasma', 'الدسمة'],
  Daiya: ['daiya', 'daiyah', 'الدعية'],
  'Abdullah Al Salem': ['abdullah al salem', 'abdullah al-salem', 'ضاحية عبدالله السالم', 'عبدالله السالم'],
  Mubarakiya: ['mubarakiya', 'المباركية'],
  'Abu Halifa': ['abu halifa', 'abu hulaifa', 'ابو حليفة', 'أبو حليفة'],
  Mahboula: ['mahboula', 'mahboulah', 'المهبولة'],
  Fahaheel: ['fahaheel', 'fahahil', 'الفحيحيل'],
  Sabahiya: ['sabahiya', 'sabahiyah', 'الصباحية'],
  Riqqa: ['riqqa', 'riqqah', 'الرقة'],
  Hadiya: ['hadiya', 'hadiyah', 'هدية'],
  Egaila: ['egaila', 'eqaila', 'العقيلة'],
  'Abu Fatira': ['abu fatira', 'abu ftaira', 'ابو فطيرة', 'أبو فطيرة'],
  Qurain: ['qurain', 'al qurain', 'القرين'],
  Adan: ['adan', 'العدان'],
  Qusour: ['qusour', 'al qusour', 'القصور'],
  Messila: ['messila', 'المسيلة'],
  'Sabah Al Ahmad': ['sabah al ahmad', 'sabah al-ahmad', 'صباح الأحمد', 'صباح الاحمد'],
  Ardiya: ['ardiya', 'ardiyah', 'العارضية'],
  Andalous: ['andalous', 'andalus', 'الأندلس', 'الاندلس'],
  Rabiya: ['rabiya', 'rabiyah', 'الرابية'],
  Rehab: ['rehab', 'الرحاب'],
  Omariya: ['omariya', 'omariyah', 'العمرية'],
  Firdous: ['firdous', 'الفردوس'],
  'Jleeb Al Shuyoukh': ['jleeb al shuyoukh', 'jleeb', 'abbasiya', 'جليب الشيوخ', 'العباسية'],
  Dajeej: ['dajeej', 'الضجيج'],
  Sulaibikhat: ['sulaibikhat', 'الصليبخات'],
  Doha: ['doha', 'الدوحة'],
  Qairawan: ['qairawan', 'القيروان'],
  'Saad Al Abdullah': ['saad al abdullah', 'saad al-abdullah', 'سعد العبدالله'],
  Waha: ['waha', 'الواحة'],
  Naeem: ['naeem', 'النعيم'],
  Qasr: ['qasr', 'القصر'],
  Sulaibiya: ['sulaibiya', 'sulaibiyah', 'الصليبية'],
  'Shaab Al Bahri': ['shaab al bahri'],
  Bidaa: ['bidaa', 'البدع'],
  Shuhada: ['shuhada', 'الشهداء'],
  Siddiq: ['siddiq', 'الصديق'],
  Hittin: ['hittin', 'hateen', 'حطين'],
  Zahra: ['zahra', 'الزهراء'],
  Salam: ['salam', 'السلام'],
  'Jaber Al Ahmad': ['jaber al ahmad', 'jaber al-ahmad', 'جابر الأحمد', 'جابر الاحمد'],
  Wafra: ['wafra', 'الوفرة'],
  Khairan: ['khairan', 'الخيران'],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[ً-ْ]/g, '') // Arabic diacritics
    .replace(/^(al|el)[\s-]+/, '')
    .replace(/(block|blk|قطعة)\s*\d+.*$/, '')
    .replace(/[^a-z؀-ۿ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const INDEX = new Map<string, string>();
for (const [name, aliases] of Object.entries(AREAS)) for (const a of [name, ...aliases]) INDEX.set(norm(a), name);
// longest first, so "sabah al salem" wins over "salem" and "abdullah al salem" over both
const BY_LENGTH = [...INDEX.keys()].filter((k) => k.length >= 4).sort((x, y) => y.length - x.length);

/** GMTC's spelling for what the customer wrote, or null when it is not an area we know. */
export function gmtcArea(text: string | null | undefined, opts: { within?: boolean } = {}): string | null {
  if (!text?.trim()) return null;
  const n = norm(text);
  if (INDEX.has(n)) return INDEX.get(n)!;
  // "Salmiya, Block 10" / "حولي - قطعة ٣": try each part
  for (const part of text.split(/[,،\-–/|\n]+/)) {
    const p = norm(part);
    if (p && INDEX.has(p)) return INDEX.get(p)!;
  }
  // "Old Jahra, street 5": an area named as a whole word inside the text
  if (opts.within) {
    const padded = ` ${text.split(/[,،\-–/|\n]+/).map(norm).join(' ')} `;
    for (const k of BY_LENGTH) if (padded.includes(` ${k} `)) return INDEX.get(k)!;
  }
  return null;
}

/**
 * The area the parcel goes to. The area and city fields first, then the address lines (where customers
 * often write it: "Old Jahra, street 5"), and only then the governorate, which names a whole region
 * ("Al Ahmadi" is the governorate of Jahra's neighbours too) and would send the parcel to the wrong hub.
 */
export function areaFromAddress(a: { area?: string; city?: string; region?: string; line1?: string; line2?: string } | null | undefined): string | null {
  if (!a) return null;
  for (const f of [a.area, a.city]) {
    const hit = gmtcArea(f);
    if (hit) return hit;
  }
  for (const f of [a.area, a.city, a.line2, a.line1]) {
    const hit = gmtcArea(f, { within: true });
    if (hit) return hit;
  }
  return gmtcArea(a.region);
}
