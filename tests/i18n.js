/* ===== tests/i18n.js — 多語系字典完整性檢查（零依賴）=====
 * 1. zh-Hant 與 en 的 key 集合完全相同
 * 2. 同一個 key 的 {param} 兩邊一致
 * 3. 原始碼（index.html 的 data-i18n*、public/js/*.js）用到的 key 都存在字典
 * 4. 伺服器端（lib／server.js）不得再送中文顯示文字（註解與暱稱預設值除外）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const dicts = {};
global.window = global;
global.I18N = { register(lang, d) { dicts[lang] = d; } };
require('../public/js/locales.js');
const zh = dicts['zh-Hant'], en = dicts['en'];
let bad = 0, checks = 0;
const fail = m => { bad++; console.log('  ✗ ' + m); };
const ok = m => { checks++; console.log('  ✓ ' + m); };
if (!zh || !en) { console.log('  ✗ 找不到 zh-Hant 或 en 字典'); process.exit(1); }

const zk = Object.keys(zh), ek = Object.keys(en);
const miss1 = zk.filter(k => !(k in en)), miss2 = ek.filter(k => !(k in zh));
if (miss1.length) fail('en 缺少：' + miss1.join(', ')); if (miss2.length) fail('zh-Hant 缺少：' + miss2.join(', '));
if (!miss1.length && !miss2.length) ok('兩種語言 key 完全一致（' + zk.length + ' 個）');

const params = s => (String(s).match(/\{(\w+)\}/g) || []).sort().join(',');
const pbad = zk.filter(k => k in en && params(zh[k]) !== params(en[k]));
if (pbad.length) fail('{參數} 不一致：' + pbad.map(k => k + ' [' + params(zh[k]) + ' / ' + params(en[k]) + ']').join('; ')); else ok('每個 key 的 {參數} 兩邊一致');
const empty = zk.filter(k => k !== 'home.title2' && (!String(zh[k]).trim() || !String(en[k]).trim()));
if (empty.length) fail('空字串：' + empty.join(', ')); else ok('沒有空字典值（home.title2 為刻意留空）');

/* 原始碼用到的 key */
const used = new Map();
const add = (k, f) => { if (!used.has(k)) used.set(k, f); };
const jsFiles = fs.readdirSync(path.join(ROOT, 'public/js')).filter(f => f.endsWith('.js') && !['locales.js', 'i18n.js'].includes(f)).map(f => 'public/js/' + f);
const prefixes = new Set(zk.map(k => k.split('.')[0]));
const keyRe = /['"`]([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)['"`](?!\s*\+)/g;
for (const f of jsFiles) {
  const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  let m; while ((m = keyRe.exec(src))) if (prefixes.has(m[1].split('.')[0])) add(m[1], f);
  /* 動態 key：前綴 + 變數，逐一展開 */
  const dyn = [[/T\('lv\.' \+ [\w.]+ \+ '\.(name|desc)'\)/g, null]];
  if (/'lv\.' \+/.test(src)) for (const id of ['toddler', 'easy', 'normal', 'hard', 'myth']) { add('lv.' + id + '.name', f); add('lv.' + id + '.desc', f); }
  if (/'chat\.p' \+/.test(src)) for (let i = 1; i <= 5; i++) add('chat.p' + i, f);
  if (/'srv\.err\.' \+/.test(src)) ['room_missing', 'invite_invalid', 'invite_revoked', 'invite_expired', 'private', 'spec_full', 'busy_sit', 'busy_settings', 'full', 'not_player', 'illegal_turn', 'illegal', 'server'].forEach(c => add('srv.err.' + c, f));
  if (/'srv\.' \+ (m\.|res\.)?code/.test(src)) ['joinedPlay', 'joinedSpec', 'sat', 'leftRoom', 'kicked', 'start', 'newInvite', 'timeout', 'leftGame', 'resigned', 'dcLoss'].forEach(c => add('srv.' + c, f));
}
const html = read('public/index.html');
for (const m of html.matchAll(/data-i18n(?:-html|-title|-content)?="([^"]+)"/g)) add(m[1], 'index.html');
for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(';').forEach(p => { const k = p.split('=')[1]; if (k) add(k.trim(), 'index.html'); });
const undef = [...used].filter(([k]) => !(k in zh));
if (undef.length) fail('原始碼用到但字典沒有：' + undef.map(([k, f]) => k + '（' + f + '）').join(', ')); else ok('原始碼用到的 ' + used.size + ' 個 key 都存在字典');

/* 伺服器端不送中文顯示文字（去掉註解後檢查字串字面值） */
const hz = /[一-鿿]/;
const srvBad = [];
const stripBlockComments = source => source.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ''));
const stripLineComment = line => line.replace(/\/\/[^\r\n]*/, '');
if (hz.test(stripLineComment('const label = "test"; // 繁體中文\r'))) fail('CRLF 行註解未從掃描內容移除');
else ok('CRLF 行註解會從掃描內容移除');
for (const f of ['lib/rooms.js', 'lib/ws.js', 'server.js']) {
  stripBlockComments(read(f)).split('\n').forEach((line, i) => {
    const code = stripLineComment(line);
    if (/console\.(log|error)/.test(code)) return;     // 主控台日誌給開發者看
    if (/'玩家' \+/.test(code)) return;                // 暱稱預設值屬於玩家資料
    if (hz.test(code)) srvBad.push(f + ':' + (i + 1));
  });
}
if (srvBad.length) fail('伺服器端仍有中文字面值：' + srvBad.join(', ')); else ok('伺服器端沒有中文顯示文字（只送代碼與參數）');

/* 前端 JS 不得殘留中文字面值（字典與註解除外；隨機暱稱與中英切換鈕字樣屬資料） */
const feBad = [];
for (const f of jsFiles) {
  stripBlockComments(read(f)).split('\n').forEach((line, i) => {
    const code = stripLineComment(line);
    if (/const (ADJ|ANI) =/.test(code)) return;
    if (f === 'public/js/config.js') return;           // 只給開發者看的設定診斷訊息，不會顯示在畫面上
    if (hz.test(code)) feBad.push(f + ':' + (i + 1));
  });
}
if (feBad.length) fail('前端 JS 仍有中文字面值：' + feBad.join(', ')); else ok('前端 JS 沒有殘留中文字面值');

/* HTML 預設文字應與 zh-Hant 字典一致（靜態內容與字典不脫節） */
const htmlBad = [];
for (const m of html.matchAll(/<([a-z0-9]+)[^>]*\sdata-i18n="([^"]+)"[^>]*>([^<]*)</g)) if (m[2] in zh && m[3].trim() && m[3].trim() !== zh[m[2]]) htmlBad.push(m[2]);
if (htmlBad.length) fail('index.html 預設文字與 zh-Hant 字典不同：' + htmlBad.join(', ')); else ok('index.html 預設文字與 zh-Hant 字典一致');

console.log('\n字典檢查：' + (bad ? bad + ' 項失敗' : checks + ' 項通過'));
process.exit(bad ? 1 : 0);
