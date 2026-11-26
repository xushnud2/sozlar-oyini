// Faqat o‘zbekcha otlardan iborat baza yaratadi.
// Manbalar:
//   imlo.uz lug‘ati (matsalayev/uzbek-words ko‘chirmasi) — "Ot" deb belgilangan so‘zlar
//   MaksudSharipov/UzbekTagger word.xml (Apache-2.0) — boshqa turkumlarni chiqarish
//   xkas2001/uzbek-language-dataset (Apache-2.0) — eng tanish so‘zlarni oldinga olish
// Natija: kundalik hayotda ishlatiladigan 10 500 ot; adabiy/texnik so‘zlar oxiriga suriladi.
// Boshida tanish so‘zlar, oxirida kam uchraydiganlari turadi (server ularni 30 so‘zda 1-2 qilib qo‘shadi).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IMLO_URL = 'https://raw.githubusercontent.com/matsalayev/uzbek-words/main/uzbek_words.csv';
const XML_URL = 'https://raw.githubusercontent.com/MaksudSharipov/UzbekTagger/main/word.xml';
const FREQ_URL = 'https://huggingface.co/datasets/xkas2001/uzbek-language-dataset/resolve/main/merge/frequency_list.txt';
const TARGET = 10500;
const MIN_WORDS = 10000;

const normalize = (word) => String(word)
  .replace(/^\uFEFF/, '')
  .toLowerCase()
  .replace(/[ʻʼ'`´’]/g, '‘')
  .trim();
const keyOf = (word) => normalize(word).replace(/[‘’']/g, '');
const valid = (word) => word.length >= 2 && word.length <= 10
  && /^[\p{L}‘]+$/u.test(word);

// Fe’l va sifat shakllari otlar lug‘atida ham uchrab qoladi.
const BAD_END = /(moq|moqlik|magan|gan|ayotgan|ib|ishlari|ishi|ish|dilar|di|tirish|tir|lanish|lashish|olish|berish|kelish|qilish|bo‘lish|bolish|dek|day|simon|roq|gina|kina|cha|siz|li|iy|oviy|chan|parvar|lar)$/u;

const JUNK_KEYS = new Set([
  'http', 'https', 'www', 'com', 'org', 'net', 'title', 'php', 'index', 'html',
  'mpl', 'mln', 'sm', 'kg', 'km', 'mm', 'av', 'mil', 'uz', 'ru', 'en', 'de',
  'it', 'fr', 'es', 'the', 'and', 'for', 'from', 'with', 'by', 'at', 'of',
  'info', 'url', 'wiki', 'wikipedia', 'sputnik', 'telegram', 'facebook',
  'bilan', 'ham', 'uchun', 'bir', 'bo‘yicha', 'bo‘lib', 'bo‘lgan', 'bo‘ladi',
  'bo‘lsa', 'bo‘lishi', 'deb', 'edi', 'eng', 'esa', 'shu', 'bor', 'har', 'hamda',
  'qilinadi', 'qiladi', 'yoki', 'lekin', 'ammo', 'chunki', 'shuning', 'uning',
  'ular', 'biz', 'siz', 'men', 'sen', 'bu', 'u', 'va', 'dan', 'ning', 'ga', 'ni', 'da',
  'etdi', 'etish', 'ega', 'mavjud', 'turli', 'boshqalar', 'o‘zi', 'o‘zini', 'keyin',
  'kabi', 'sifatida', 'tashkil', 'holda', 'olib', 'kelib', 'yana', 'juda', 'barcha',
  'birinchi', 'alohida', 'maxsus', 'muhim', 'mustaqil', 'to‘liq', 'mumkin', 'lozim',
  'kerak', 'sodir', 'namoyon', 'rioya', 'navoiy', 'mia', 'santyago', 'andaza',
  'osiyo', 'vikipediya', 'ensiklopediya', 'taqdim', 'ishtirok', 'harakat', 'muvofiq',
  'hosil', 'iborat', 'paydo', 'qoldi', 'topgan', 'kelgan', 'bergan', 'turgan',
  'keldi', 'berdi', 'bo‘ldi', 'markaziy', 'shimoliy', 'janubiy', 'g‘arbiy',
  'sharqiy', 'elektron', 'avvalgi', 'keskin', 'buyuk', 'jan', 'ayni', 'muntazam',
  'qanchalik', 'chop', 'amalda', 'boshqa', 'albatta', 'asli', 'asosan', 'shahri',
  'o‘rniga', 'to‘pa', 'qidiruv', 'joriy', 'ekan', 'nima', 'kim', 'gacha', 'qancha',
  'maqsadida', 'yillik', 'yuridik', 'ma‘muriy', 'ma‘naviy', 'majburiy', 'mobaynida',
  'tomonlama', 'qayd', 'unda', 'in', 'of', 'org', 'title', 'na', 'jami', 'qad',
  'orasida', 'ostida', 'ustida', 'taqdirda', 'ostiga', 'ustiga', 'yilg‘a',
  'yiliga', 'oylik', 'kunlik', 'doirasida', 'davomida', 'asosida', 'yordamida',
  'hisobiga', 'natijasida', 'shuningdek', 'tashqari', 'hozirda', 'har qalay',
  'ravishda', 'tarzda', 'shaklda', 'holatda', 'jihatdan', 'ma‘noda', 'darajada',
  'evaziga', 'arafasida', 'ortidan', 'oldidan', 'atrof', 'andromeda'
].map(keyOf));

// To‘g‘ri yozilishi bor so‘zlarning xato shaklini tanlamaslik uchun.
const BAD_FORMS = new Set(['soz', 'koz', 'yol', 'talim', 'o‘ta', 'to‘la', 'to‘sh'].map(normalize));

// Har kuni ishlatiladigan, hamma tanish so‘zlar — ular birinchi navbatda tanlanadi.
const EVERYDAY_BASE = new Set([
  'uy', 'xona', 'oshxona', 'hammom', 'eshik', 'deraza', 'stol', 'stul', 'shkaf',
  'karavat', 'yostiq', 'ko‘rpa', 'soat', 'chiroq', 'lampa', 'telefon', 'kompyuter',
  'televizor', 'radio', 'muzlatgich', 'pech', 'choynak', 'qozon', 'qoshiq', 'vilka',
  'pichoq', 'tarelka', 'stakan', 'shisha', 'banka', 'quti', 'sumka', 'kalit', 'pul',
  'tanga', 'hamyon', 'kitob', 'qalam', 'qog‘oz', 'daftar', 'ruchka', 'oyina',
  'supurgi', 'taroq', 'non', 'sut', 'choy', 'qahva', 'shakar', 'tuz', 'go‘sht',
  'baliq', 'tuxum', 'sabzi', 'piyoz', 'kartoshka', 'pomidor', 'bodring', 'uzum',
  'olma', 'nok', 'anor', 'limon', 'apelsin', 'tarvuz', 'qovun', 'aroq', 'osh',
  'shashlik', 'manti', 'chuchvara', 'plov', 'lag‘mon', 'somsa', 'qurut', 'qatiq',
  'sariyog‘', 'bosh', 'ko‘z', 'quloq', 'burun', 'og‘iz', 'til', 'tish', 'soch',
  'qo‘l', 'oyoq', 'yurak', 'jigar', 'teri', 'it', 'mushuk', 'sigir', 'qo‘y', 'echki',
  'ot', 'to‘ng‘iz', 'jo‘ja', 'tovuq', 'qush', 'chumchuq', 'kaptar', 'burgut', 'ari',
  'chumoli', 'pashsha', 'chivin', 'qurt', 'ilon', 'toshbaqa', 'qurbaqa', 'osmon',
  'yer', 'suv', 'havo', 'yomg‘ir', 'qor', 'shamol', 'bulut', 'quyosh', 'oy',
  'yulduz', 'tog‘', 'daryo', 'ko‘l', 'dengiz', 'o‘rmon', 'daraxt', 'gul', 'o‘t',
  'qum', 'tosh', 'tuproq', 'mayoq', 'bino', 'ko‘cha', 'yo‘l', 'mashina', 'velosiped',
  'poezd', 'samolyot', 'dori', 'parvoz', 'chipta', 'doktor', 'o‘qituvchi', 'ishchi',
  'dehqon', 'cho‘pon', 'haydovchi', 'qassob', 'nonvoy', 'qish', 'yoz', 'bahor',
  'kuz', 'kun', 'tun', 'yil', 'hafta', 'daqiqa', 'sekund'
].map(normalize));

// Yana bir qator turmushda har kuni uchraydigan aniq otlar.
const EVERYDAY_MORE = new Set([
  // Oila va odamlar
  'ota', 'ona', 'farzand', 'bola', 'qiz', 'o‘g‘il', 'aka', 'uka', 'opa', 'singil',
  'bobo', 'momo', 'buvi', 'amaki', 'tog‘a', 'xola', 'amma', 'jiyan', 'qarindosh',
  'oila', 'er', 'xotin', 'kelin', 'qaynota', 'qaynona', 'qo‘shni', 'do‘st',
  'odam', 'kishi', 'yigit', 'ayol', 'erkak', 'chaqaloq', 'o‘smir', 'qariya',
  'bemor', 'hamshira', 'sartarosh', 'tikuvchi', 'poyabzalchi', 'temirchi',
  'duradgor', 'rassom', 'yozuvchi', 'shoir', 'qo‘shiqchi', 'raqqos', 'aktyor',
  'muhandis', 'buxgalter', 'savdogar', 'sotuvchi', 'ofitsiant', 'oshpaz',
  'farrosh', 'qorovul', 'politsiyachi', 'askar', 'sudya', 'advokat', 'imom',
  'talaba', 'o‘quvchi',
  // Tana
  'yuz', 'lab', 'qosh', 'kirpik', 'peshana', 'yonoq', 'iyak', 'bo‘yin', 'yelka',
  'barmoq', 'tirnoq', 'kaft', 'tirsak', 'bilak', 'ko‘krak', 'bel', 'orqa',
  'tizza', 'to‘piq', 'suyak', 'mushak', 'qon', 'o‘pka', 'buyrak', 'me’da',
  'ichak', 'miya', 'asab', 'nafas', 'ovoz', 'hid', 'ta’m', 'bo‘y', 'vazn',
  'uyqu', 'tush', 'orzu', 'xayol', 'fikr',
  // Ovqat
  'mandarin', 'anjir', 'xurmo', 'yong‘oq', 'bodom', 'kunjut', 'guruch',
  'makkajo‘xori', 'bug‘doy', 'arpa', 'no‘xat', 'loviya', 'mosh', 'yasmiq',
  'qo‘ziqorin', 'karam', 'salat', 'ismaloq', 'rayhon', 'sarimsoq', 'zanjabil',
  'qalampir', 'vanil', 'dolchin', 'vino', 'pivo', 'shampan', 'konyak', 'viski',
  'pishloq', 'yog‘', 'asal', 'murabbo', 'halvo', 'baklava', 'shirinlik',
  'keks', 'tort', 'pirojok', 'sho‘rva', 'meva', 'sabzavot', 'don', 'urug‘',
  'yemish', 'qand', 'novvot',
  // Uy va uy-ro‘zg‘or
  'hojatxona', 'koridor', 'zinapoya', 'devor', 'shift', 'pol', 'qavat',
  'yerto‘la', 'balkon', 'ayvon', 'hovli', 'bog‘', 'gulzor', 'lampochka',
  'plita', 'choyshab', 'adyol', 'gilam', 'parda', 'dasturxon', 'sochiq',
  'sovun', 'shampun', 'atir', 'pomada', 'ko‘zoynak', 'uzuk', 'marjon',
  'zirak', 'bilakuzuk', 'sharf', 'galstuk', 'kamar', 'tugma', 'cho‘ntak',
  'ryukzak',
  // Hayvonlar
  'o‘rdak', 'g‘oz', 'kurka', 'loychin', 'qarg‘a', 'asalari', 'sichqon',
  'kalamush', 'quyon', 'tulki', 'bo‘ri', 'ayiq', 'sher', 'yo‘lbars', 'fil',
  'maymun', 'jirafa', 'zebra', 'kenguru', 'delfin', 'kit', 'akula',
  'qisqichbaqa', 'meduza', 'kaltakesak', 'timsoh', 'begemot', 'karkidon',
  'bug‘u', 'kiyik', 'qobon', 'to‘ti', 'kaklik', 'bedana',
  // Tabiat va vaqt
  'loy', 'chang', 'tuman', 'shudring', 'muz', 'soy', 'ariq', 'bulloq',
  'quduq', 'issiqlik', 'sovuq', 'harorat', 'iqlim', 'fasl', 'okean',
  'ertalab', 'kecha', 'bugun', 'ertaga', 'dushanba', 'seshanba', 'chorshanba',
  'payshanba', 'juma', 'shanba', 'yakshanba', 'yanvar', 'fevral', 'mart',
  'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'dekabr',
  'vaqt', 'davr', 'asr',
  // Transport va shahar
  'avtomobil', 'mototsikl', 'avtobus', 'taks', 'marshrutka', 'tramvay',
  'metro', 'kema', 'paroxod', 'qayiq', 'sal', 'g‘ildirak', 'dvigatel',
  'rul', 'benzin', 'yoqilg‘i', 'svetofor', 'maydon', 'ko‘prik', 'tunel',
  'stansiya', 'aeroport', 'vokzal', 'do‘kon', 'bozor', 'supermarket',
  'restoran', 'kafe', 'mehmonxona', 'bank', 'pochta', 'shifoxona', 'dorixona',
  'masjid', 'cherkov', 'qabriston', 'stadion', 'park', 'zoopark', 'kinoteatr',
  'teatr', 'muzey', 'kutubxona', 'basseyn', 'garaj', 'ustaxona', 'zavod',
  'ofis', 'idora', 'sud', 'politsiya',
  // Kiyim
  'kiyim', 'ko‘ylak', 'shim', 'sviter', 'palto', 'kurtka', 'jaket', 'shapka',
  'qalpoq', 'doppi', 'poyabzal', 'botinka', 'sandal', 'paypoq',
  // Maktab va ish
  'dars', 'o‘quv', 'o‘chirgich', 'lineyka', 'rezin', 'kompas', 'chizg‘ich',
  'bo‘r', 'doska', 'parta', 'sinf', 'imtihon', 'baho', 'darslik', 'lug‘at',
  'maqola', 'xat', 'paket', 'konvert', 'marka', 'gazeta', 'jurnal',
  'klaviatura', 'monitor', 'ekran', 'so‘z', 'harf', 'raqam', 'son', 'gap',
  'jumla', 'sahifa', 'mavzu', 'reja', 'maqsad', 'ish', 'mehnat', 'xizmat',
  'lavozim', 'maosh', 'pensiya', 'maktab', 'universitet', 'institut',
  // His va sog‘liq
  'quvonch', 'baxt', 'sevgi', 'nafrat', 'g‘azab', 'qayg‘u', 'kulgi', 'yig‘i',
  'qo‘rqinch', 'ajablanish', 'uyat', 'g‘urur', 'ishonch', 'shubha', 'umid',
  'sabr', 'tinchlik', 'jimlik', 'shovqin', 'ehtiros', 'ochlik', 'chanqoq',
  'og‘riq', 'charchoq', 'his', 'tuyg‘u', 'kayfiyat', 'g‘oya', 'tabletka',
  'ukol', 'gripp', 'yo‘tal', 'isitma', 'yara', 'kuyik', 'allergiya', 'astma',
  'diabet', 'bosim', 'tomir', 'vitamin',
  // Sport
  'futbol', 'basketbol', 'voleybol', 'tennis', 'badminton', 'boks', 'kurash',
  'gimnastika', 'sakrash', 'suzish', 'raketka', 'g‘alaba', 'mag‘lubiyat',
  'jamoa', 'musobaqa', 'chempionat', 'medal', 'kubok', 'priz', 'rekord',
  'sport', 'tribuna', 'forma', 'futbolka'
].map(normalize));

const EVERYDAY = new Set([...EVERYDAY_BASE, ...EVERYDAY_MORE]);

// Instagram/TikTokda yurgan kulgili so‘zlar ham bazaga qo‘shiladi.
const TRENDY = new Set([
  'selfi', 'selfie', 'layk', 'like', 'repost', 'storis', 'story', 'reels', 'shorts',
  'mem', 'meme', 'filter', 'vayb', 'trend', 'post', 'bot', 'bloger', 'influenser',
  'podcast', 'tiktok', 'vlog', 'gif', 'aha', 'vau', 'qalay', 'ana', 'hoo', 'bravo',
  'top', 'klass', 'super', 'kripto', 'nft', 'koin', 'dizayn', 'logo', 'kod', 'app',
  'wifi', 'internet', 'smartfon', 'gadget'
].map(normalize));

function scoreOf(item) {
  const key = keyOf(item.word);
  // Avval kundalik so‘zlar, keyin trend so‘zlar, so‘ng chastota bo‘yicha.
  if (EVERYDAY.has(key)) return 2e12 + item.word.length;
  if (TRENDY.has(key)) return 1e12 + item.word.length;
  const count = item.count || 0;
  return Math.log10(count + 1) * 1000
    - Math.max(0, item.word.length - 7) * 140
    - (count < 50 ? 250 : 0)
    - (count < 10 ? 500 : 0);
}

async function source(file, url) {
  const target = path.join(ROOT, file);
  if (fs.existsSync(target)) return fs.readFileSync(target, 'utf8');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const text = await response.text();
  fs.writeFileSync(target, text);
  return text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseImloNouns(text) {
  const nouns = new Map();
  const other = new Set();

  for (const row of parseCsv(text).slice(1)) {
    const word = normalize(row[0]);
    if (!valid(word)) continue;
    const key = keyOf(word);
    const type = String(row[1] || '').trim();
    const pureNoun = type === 'Ot' || type.startsWith('Ot | ');
    const mixedOther = /Fe’l|Sifat|Ravish|Yordamchi|Olmosh|Son\b|Bog‘lovchi|Yuklama|Undov|Taqlid|Modal|Ko‘makchi/.test(type);

    if (pureNoun && !other.has(key)) {
      const current = nouns.get(key);
      if (!current || (!current.includes('‘') && word.includes('‘'))) nouns.set(key, word);
    } else if (mixedOther) {
      other.add(key);
      nouns.delete(key);
    }
  }

  return { nouns, other };
}

function parseXmlOther(xml) {
  const other = new Set();
  for (const match of xml.matchAll(/<word classId="([^"]+)"[^>]*>([^<]+)<\/word>/g)) {
    const word = normalize(match[2]);
    if (match[1] !== 'NOUN' && valid(word)) other.add(keyOf(word));
  }
  return other;
}

function parseFrequencies(text) {
  const exact = new Map();
  const byKey = new Map();
  const upper = new Map();

  for (const line of text.split(/\r?\n/)) {
    const match = /^(\S+):(\d+)\s*$/.exec(line);
    if (!match) continue;
    const raw = match[1];
    const word = normalize(raw);
    if (!valid(word)) continue;
    const count = Number(match[2]);
    const key = keyOf(word);

    if (raw[0] !== raw[0].toLowerCase()) {
      upper.set(key, Math.max(upper.get(key) || 0, count));
    } else {
      exact.set(word, Math.max(exact.get(word) || 0, count));
      byKey.set(key, Math.max(byKey.get(key) || 0, count));
    }
  }

  // Bosh harf bilan ko‘proq uchragan so‘zlar atoqli ot deb hisoblanadi.
  const proper = new Set([...upper.entries()]
    .filter(([key, count]) => count > (byKey.get(key) || 0))
    .map(([key]) => key));

  return { exact, byKey, proper };
}

async function main() {
  const [imloText, xml, freqText] = await Promise.all([
    source('imlo-words.csv', IMLO_URL),
    source('word.xml', XML_URL),
    source('freq-all.txt', FREQ_URL)
  ]);

  const { nouns, other } = parseImloNouns(imloText);
  const xmlOther = parseXmlOther(xml);
  const { exact, byKey, proper } = parseFrequencies(freqText);

  const ranked = [...nouns.entries()]
    .filter(([key, word]) => !other.has(key) && !xmlOther.has(key)
      && !JUNK_KEYS.has(key) && !proper.has(key) && !BAD_FORMS.has(word))
    .filter(([, word]) => !BAD_END.test(word))
    .map(([key, word]) => ({ word, count: byKey.get(key) || 0, exact: exact.get(word) || 0 }));

  // Tanish va trend so‘zlar lug‘atda yo‘q bo‘lsa ham bazaga kiritiladi.
  const curatedByKey = new Map();
  for (const group of [EVERYDAY, TRENDY]) {
    for (const word of group) curatedByKey.set(keyOf(word), word);
  }
  const present = new Set(ranked.map((item) => keyOf(item.word)));
  for (const [key, word] of curatedByKey) {
    if (present.has(key)) continue;
    ranked.push({ word, count: 0, exact: 0, curated: true });
    present.add(key);
  }

  // Uch qavat: kundalik so‘zlar, tanish so‘zlar, kam uchraydiganlar.
  const isDaily = (item) => EVERYDAY.has(keyOf(item.word)) || TRENDY.has(keyOf(item.word));
  const isFamiliar = (item) => !isDaily(item)
    && ((item.word.length <= 6 && item.count >= 200)
      || (item.word.length <= 5 && item.count >= 100));
  const byScore = (a, b) => scoreOf(b) - scoreOf(a)
    || b.count - a.count || b.exact - a.exact
    || a.word.length - b.word.length || a.word.localeCompare(b.word, 'uz');

  const dailyItems = ranked.filter(isDaily).sort(byScore);
  const familiarItems = ranked.filter(isFamiliar).sort(byScore);
  const rareItems = ranked.filter((item) => !isDaily(item) && !isFamiliar(item)).sort(byScore);
  const picked = [...dailyItems, ...familiarItems, ...rareItems].slice(0, TARGET).map((item) => item.word);
  const dailyCount = Math.min(picked.length, dailyItems.length);
  const familiarCount = Math.min(picked.length, dailyCount + familiarItems.length);
  if (picked.length <= MIN_WORDS) throw new Error(`Ot yetarli emas: ${picked.length}`);

  const lines = [];
  for (let index = 0; index < picked.length; index += 12) {
    lines.push('  ' + picked.slice(index, index + 12).map((word) => JSON.stringify(word)).join(', ') + ',');
  }
  const output = `// Kundalik ishlatiladigan o‘zbekcha otlar (${picked.length} ta).\n`
    + '// tools/build-words.js bilan yaratilgan: imlo.uz "Ot" lug‘ati + UzbekTagger (Apache-2.0) + chastota.\n'
    + `// Birinchi ${dailyCount} tasi kundalik, keyingi ${familiarCount - dailyCount} tasi tanish, qolgani kam uchraydigan.\n\n`
    + 'const WORDS = [\n' + lines.join('\n') + '\n];\n\n'
    + `const DAILY_COUNT = ${dailyCount};\nconst FAMILIAR_COUNT = ${familiarCount};\n\n`
    + 'module.exports = { WORDS, DAILY_COUNT, FAMILIAR_COUNT };\n';
  fs.writeFileSync(path.join(ROOT, 'words.js'), output);

  console.log(`Yaratildi: ${picked.length} ta ot (kundalik: ${dailyCount}, tanish: ${familiarCount - dailyCount}).`);
  console.log('Namuna:', picked.slice(0, 30).join(', '));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
