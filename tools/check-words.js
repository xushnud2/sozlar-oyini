const { WORDS } = require('../words');

const normalize = (word) => String(word).toLowerCase().replace(/[‘’']/g, '');
const NOT_NOUNS = new Set([
  'yugurmoq', 'olmoq', 'kelmoq', 'qilmoq', 'yozmoq', 'bo‘ldi', 'qildi',
  'oladi', 'keladi', 'olib', 'kelib', 'qilib', 'yaxshi', 'aqlli', 'chiroyli',
  'tez', 'bilan', 'va', 'uchun', 'tashkil', 'mavjud', 'alohida', 'muhim',
  'maxsus', 'to‘liq', 'mustaqil', 'ravishda', 'evaziga', 'arafasida',
  'ortidan', 'oldidan', 'tarzda', 'shaklda', 'holatda'
].map(normalize));

const badChar = WORDS.filter((word) => !/^[\p{L}\p{M}‘’-]+$/u.test(word));
const cyrillic = WORDS.filter((word) => /[а-яіїєґқғҳў]/i.test(word));
const keys = WORDS.map(normalize);
const duplicates = WORDS.length - new Set(keys).size;
const tooShort = WORDS.filter((word) => word.length < 2);
const notNouns = WORDS.filter((word) => NOT_NOUNS.has(normalize(word)));

console.log({
  count: WORDS.length,
  badChar: badChar.length,
  cyrillic: cyrillic.length,
  duplicates,
  tooShort: tooShort.length,
  notNouns: notNouns.length
});
console.log('Namuna:', WORDS.slice(0, 20).join(', '));
console.log('O‘rtada:', WORDS.slice(3000, 3020).join(', '));
console.log('Oxiri:', WORDS.slice(-20).join(', '));

if (WORDS.length <= 10000 || badChar.length || cyrillic.length
  || duplicates || tooShort.length || notNouns.length) process.exitCode = 1;
