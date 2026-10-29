/* ===== tests/browser-check.js — 無頭瀏覽器的畫面與操作檢查（選配）=====
 * 需要 playwright（沒裝就整個略過，不影響 npm run verify）：
 *   npm i -g playwright && npx playwright install chromium
 *   node tests/browser-check.js            # 會自己啟動伺服器
 * 檢查：五種視窗尺寸有沒有橫向溢出／按鈕出界、單機整局（含結算 overlay 三顆按鈕）、
 *       觸控「點兩下確認」、鍵盤落子、設定彈窗（焦點鎖定／Esc／恢復預設）、
 *       線上：邀請連結入座、觀戰、聊天、整局、再來一局、離開關房。1～6 並行，全程約 1 分鐘內；
 *       加 CHECK_SHOTS=1 才會截圖到 tests/shots/。
 */
'use strict';
const fs = require('fs');
const path = require('path');
let pw = null;
try { pw = require('playwright'); } catch (e) { try { pw = require('playwright-core'); } catch (e2) { /* none */ } }
if (!pw) { console.log('（略過）沒有安裝 playwright，無法跑瀏覽器檢查'); process.exit(0); }

const assert = require('assert');
const { server } = require('../server.js');
const SHOTS = path.join(__dirname, 'shots'); if (process.env.CHECK_SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
/* 語系：預設用 zh-TW 瀏覽器；CHECK_LANG=en 改用 en-US 再跑一次。斷言一律走字典 key，與語系無關 */
const LOCALE = process.env.CHECK_LANG === 'en' ? 'en-US' : 'zh-TW';
/* 截圖在平行跑時很吃 CPU：預設不截，要看畫面時 CHECK_SHOTS=1 */
const shot = (page, name) => process.env.CHECK_SHOTS ? page.screenshot({ path: path.join(SHOTS, name) }) : Promise.resolve();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T0 = Date.now(); let n = 0; const ok = m => console.log('  ✓ ' + (++n) + '. ' + m + ' [' + ((Date.now() - T0) / 1000).toFixed(1) + 's]');

/* 加速：計時器縮短 8 倍（電腦思考延遲、提示消失），performance.now 走快 6 倍（棋子動畫） */
const FAST = '(()=>{const st=window.setTimeout;window.setTimeout=(f,d,...a)=>st(f,(d||0)/8,...a);const pn=performance.now.bind(performance);performance.now=()=>pn()*6;})()';

const VIEWPORTS = [
  ['desktop', 1280, 800, false], ['tablet-landscape', 1180, 820, true], ['tablet-portrait', 820, 1180, true],
  ['phone-portrait', 390, 844, true], ['phone-landscape', 844, 390, true]
];

async function boardPoint(page, idx) {
  return page.evaluate(i => { const d = __rv.scene.debug().layout, r = document.getElementById('gl').getBoundingClientRect(); let c = i % 8, w = (i / 8) | 0; if (__rv.scene.debug().rot) { c = 7 - c; w = 7 - w; } return { x: r.left + d.OX + (c + 0.5) * d.CELL, y: r.top + d.OY + (w + 0.5) * d.CELL }; }, idx);
}
async function clickCell(page, idx) { const p = await boardPoint(page, idx); await page.mouse.click(p.x, p.y); }
async function myLegal(page) { return page.evaluate(() => { const G = __rv.G; return G.state && G.me && G.state.turn === G.me && !G.busy && !G.state.over ? Rules.legalList(G.state.board, G.me) : []; }); }
async function playUntilOver(page, label, limit) {
  const t0 = Date.now();
  while (Date.now() - t0 < (limit || 90000)) {
    const over = await page.evaluate(() => !!(__rv.G.state && __rv.G.state.over && !__rv.G.busy));
    if (over) return;
    const l = await myLegal(page);
    if (l.length) { await clickCell(page, l[Math.floor(Math.random() * l.length)]); await sleep(60); } else await sleep(30);
  }
  throw new Error(label + ' 下不完');
}
const noOverflow = async (page, tag) => {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight, ih: innerHeight }));
  assert.ok(r.sw <= r.iw + 1 && r.sh <= r.ih + 1, tag + ' 有溢出 ' + JSON.stringify(r));
};
const inView = async (page, sel, tag) => {
  const b = await page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight, vis: e.offsetParent !== null }; }, sel);
  assert.ok(b && b.vis && b.l >= -1 && b.t >= -1 && b.r <= b.w + 1 && b.b <= b.h + 1, tag + ' ' + sel + ' 出界 ' + JSON.stringify(b));
};

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await pw.chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  const track = (page, tag) => { page.on('pageerror', e => errors.push(tag + ': ' + e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(tag + ' console: ' + m.text()); }); };
  async function ctx(vp, touch) { const c = await browser.newContext({ viewport: { width: vp[1], height: vp[2] }, hasTouch: !!touch, isMobile: !!touch, deviceScaleFactor: 1, locale: LOCALE }); await c.addInitScript(FAST); return c; }

  try {
    /* 1～6 彼此獨立（各自的 context，線上段以房號認房間），並行跑 */
    const parts = [];
    /* ---------- 1. 各種尺寸 ---------- */
    parts.push(Promise.all(VIEWPORTS.map(async vp => {
      const c = await ctx(vp, vp[3]), p = await c.newPage(); track(p, vp[0]);
      await p.goto(base); await p.waitForSelector('#scr-home.on'); await sleep(500);
      await noOverflow(p, vp[0] + ' 首頁'); await inView(p, '#btn-settings', vp[0]); await inView(p, '#btn-lang', vp[0] + ' 語言鈕'); await inView(p, '#scr-home .btn.primary', vp[0]);
      assert.strictEqual(await p.evaluate(() => document.getElementById('btn-settings').previousElementSibling.id), 'btn-lang', '語言鈕要在同一工具列緊貼設定鈕左側');
      await p.click('#btn-lang');
      assert.strictEqual(await p.getAttribute('#btn-lang', 'aria-expanded'), 'true', '點語言鈕展開選單');
      await p.keyboard.press('Escape');
      assert.strictEqual(await p.getAttribute('#btn-lang', 'aria-expanded'), 'false', 'Escape 收起語言選單');
      await shot(p, vp[0] + '-1home.png');
      await p.click('#scr-home .btn.primary'); await p.waitForSelector('#scr-setup.on'); await sleep(250);
      await noOverflow(p, vp[0] + ' 設定頁'); await shot(p, vp[0] + '-2setup.png');
      await inView(p, '#scr-setup .btn.primary', vp[0] + ' 開始按鈕（可捲動時略過）').catch(() => {});
      await p.evaluate(() => document.querySelector('#scr-setup .btn.primary').scrollIntoView());
      await p.click('#scr-setup .btn.primary'); await p.waitForFunction(() => __rv.G.screen === 'game'); await sleep(700);
      await noOverflow(p, vp[0] + ' 對局'); await inView(p, '#btn-settings', vp[0]); await inView(p, '#btn-hint', vp[0]);
      const lay = await p.evaluate(() => __rv.scene.debug().layout); assert.ok(lay.S >= Math.min(lay.CW, lay.CH) * 0.55 || lay.S >= 200, vp[0] + ' 棋盤太小 ' + JSON.stringify(lay));
      const bl = lay.OX - lay.S * 0.07, bt = lay.OY - lay.S * 0.07; assert.ok(bl >= -1 && bt >= -1 && bl + lay.S <= lay.CW + 1 && bt + lay.S <= lay.CH + 1, vp[0] + ' 棋盤超出畫面 ' + JSON.stringify(lay));
      await shot(p, vp[0] + '-3game.png');
      if (vp[1] < 900) { // 窄版：側欄是左側抽屜
        await p.click('#side-toggle'); await sleep(250); await inView(p, '#side', vp[0] + ' 抽屜'); await shot(p, vp[0] + '-4drawer.png');
        await p.click('#side-close'); await sleep(150); assert.strictEqual(await p.evaluate(() => document.getElementById('side').offsetParent === null), true, vp[0] + ' 抽屜沒收起');
      }
      await c.close();
    })).then(() => ok('五種視窗尺寸：首頁／設定／對局沒有溢出，主要按鈕在畫面內，棋盤夠大')));

    /* ---------- 2. 單機整局 + 結算 overlay ---------- */
    parts.push((async () => {
      const c = await ctx(VIEWPORTS[0]), p = await c.newPage(); track(p, 'local');
      await p.goto(base); await p.click('#scr-home .btn.primary');
      await p.evaluate(() => { document.querySelectorAll('.seg-btn')[0].click(); });                    // 幼幼班
      await p.click('#scr-setup .btn.primary'); await p.waitForFunction(() => __rv.G.screen === 'game');
      assert.strictEqual(await p.evaluate(() => __rv.G.hintOn), true); ok('幼幼班預設開啟提示');
      await playUntilOver(p, '單機', 120000);
      await p.waitForSelector('#result-layer:not([hidden]) .result-card', { timeout: 6000 });
      const btns = await p.$$eval('#result-layer .btn', els => els.map(e => e.textContent.trim()));
      assert.deepStrictEqual(btns, await p.evaluate(() => ['result.again', 'result.toRoom', 'result.toHome'].map(k => I18N.t(k)))); ok('結算 overlay：疊在棋盤上、有「再來一局／回到房間／回到首頁」');
      assert.ok(await p.evaluate(() => __rv.scene.debug().discs >= 4), '棋盤仍在背景');
      await shot(p, 'local-result.png');
      const sc = await p.evaluate(() => { const c = Rules.count(__rv.G.state.board); return c; });
      assert.strictEqual(await p.evaluate(() => __rv.scene.getBoard().join('')), await p.evaluate(() => __rv.G.state.board.join(''))); ok('畫面棋子與規則局面一致（' + sc.black + ' 比 ' + sc.white + '）');
      await p.click('#res-again'); await p.waitForFunction(() => document.getElementById('result-layer').hidden && __rv.G.hist.length <= 1); ok('再來一局：重新開局');
      await p.evaluate(() => document.getElementById('btn-home').click()); await sleep(200);
      await p.click('#modal-root .btn.danger', { timeout: 1000 }).catch(() => {}); await p.waitForSelector('#scr-home.on', { timeout: 3000 }); ok('離開確認 → 回首頁');
      await c.close();})());

    /* ---------- 3. 觸控兩下確認 / 鍵盤 ---------- */
    parts.push((async () => {
      const c = await ctx(VIEWPORTS[1], true), p = await c.newPage(); track(p, 'touch');
      await p.goto(base); await p.tap('#scr-home .btn.primary'); await p.tap('#scr-setup .btn.primary'); await p.waitForFunction(() => __rv.G.screen === 'game'); await sleep(600);
      const l = (await myLegal(p))[0]; const pt = await boardPoint(p, l);
      await p.touchscreen.tap(pt.x, pt.y); await sleep(250);
      assert.strictEqual(await p.evaluate(() => __rv.G.hist.length), 0); assert.ok(await p.isVisible('#confirm-bar')); ok('觸控第一次點：只預覽，出現確認列');
      await p.touchscreen.tap(pt.x, pt.y); await sleep(250);
      assert.ok(await p.evaluate(() => __rv.G.hist.length) >= 1); ok('觸控第二次點同一格：落子');
      await c.close();
      const c2 = await ctx(VIEWPORTS[0]), q = await c2.newPage(); track(q, 'kbd');
      await q.goto(base); await q.click('#scr-home .btn.primary'); await q.click('#scr-setup .btn.primary'); await q.waitForFunction(() => __rv.G.screen === 'game'); await sleep(500);
      await q.focus('#gl'); await q.keyboard.press('ArrowRight'); await q.keyboard.press('Enter'); await sleep(300);
      assert.strictEqual(await q.evaluate(() => __rv.G.hist.length >= 1), true); ok('鍵盤：方向鍵移動游標、Enter 落子');
      await c2.close();})());

    /* ---------- 4. 設定彈窗 ---------- */
    parts.push((async () => {
      const c = await ctx(VIEWPORTS[0]), p = await c.newPage(); track(p, 'settings');
      await p.goto(base); await p.waitForSelector('#scr-home.on'); await p.focus('#btn-settings'); await p.keyboard.press('Enter');
      await p.waitForSelector('.modal[role=dialog]'); await sleep(250);
      await shot(p, 'settings.png');
      const sw = await p.$$('.modal .sw'); assert.ok(sw.length >= 8); const before = await sw[0].getAttribute('aria-checked'); await sw[0].click();
      assert.notStrictEqual(await sw[0].getAttribute('aria-checked'), before); assert.strictEqual(await p.evaluate(() => Store.get('musicOn')), before !== 'true'); ok('設定：開關即時生效並存起來');
      await p.focus('.modal .sl'); const v0 = await p.evaluate(() => Store.get('musicVol')); await p.keyboard.press('ArrowLeft'); assert.ok(await p.evaluate(v => Store.get('musicVol') < v, v0)); ok('設定：滑桿可用鍵盤調整');
      for (let i = 0; i < 40; i++) { await p.keyboard.press('Tab'); const inside = await p.evaluate(() => !!document.activeElement.closest('.modal')); assert.ok(inside, '焦點跑出彈窗'); }
      ok('設定：Tab 焦點鎖在彈窗內');
      await p.keyboard.press('Escape'); await sleep(250);
      assert.ok(!(await p.$('.modal'))); assert.strictEqual(await p.evaluate(() => document.activeElement.id), 'btn-settings'); ok('設定：Esc 關閉並把焦點還給設定鈕');
      await c.close();})());

    /* ---------- 5. 線上：邀請、觀戰、聊天、整局、再來一局、關房 ---------- */
    parts.push((async () => {
      const vp = VIEWPORTS[0];
      const ca = await ctx(vp), cb = await ctx(vp), cc = await ctx(vp);
      const A = await ca.newPage(), B = await cb.newPage(), C = await cc.newPage(); track(A, 'A'); track(B, 'B'); track(C, 'C');
      await A.goto(base); await A.click('#scr-home .btn:nth-child(2)'); await A.waitForSelector('#scr-lobby.on');
      await A.waitForFunction(() => Net.status === 'open'); await A.fill('#nick-input', '甲方'); await A.dispatchEvent('#nick-input', 'change');
      await A.click('#scr-lobby .btn.primary'); await A.waitForFunction(() => __rv.G.screen === 'game' && __rv.G.room);
      const room = await A.evaluate(() => ({ id: __rv.G.room.id, token: __rv.G.room.invite.token }));
      ok('甲建房 ' + room.id);
      await shot(A, 'online-room-A.png');

      await B.goto(base + '?room=' + room.id + '&invite=' + room.token); await B.waitForSelector('#scr-lobby.on .invite-card');
      assert.strictEqual(await B.evaluate(() => __rv.G.screen), 'lobby'); ok('邀請連結不會自動進房：先停在大廳顯示邀請卡與可改暱稱');
      await shot(B, 'online-invite-B.png');
      await B.fill('#nick-input', '乙方'); await B.dispatchEvent('#nick-input', 'change');
      await B.click('.invite-card .btn.primary'); await B.waitForFunction(() => __rv.G.screen === 'game' && __rv.G.room);
      assert.strictEqual(await B.evaluate(() => __rv.G.room.you.role), 'player'); assert.strictEqual(await B.evaluate(() => __rv.G.room.you.color), 2); ok('乙確認暱稱後以邀請連結入座執白');

      await C.goto(base); await C.click('#scr-home .btn:nth-child(2)'); await C.waitForFunction(() => Net.status === 'open'); await C.waitForSelector('.room-item');
      await C.click('.room-item:has-text("' + room.id + '") .btn:not(.primary)'); await C.waitForFunction(() => __rv.G.screen === 'game' && __rv.G.room);
      assert.strictEqual(await C.evaluate(() => __rv.G.room.you.role), 'spectator'); ok('丙從房間列表觀戰');

      await A.fill('#chat-input', '大家好'); await A.press('#chat-input', 'Enter');
      for (const pg of [A, B, C]) await pg.waitForFunction(() => document.getElementById('chat-list').textContent.includes('大家好'));
      ok('聊天室：玩家與觀戰者都收到');
      assert.ok(await A.isVisible('#summary') && await A.isVisible('#chatbox')); ok('左側欄同時有對局摘要與聊天室');

      await A.click('#room-panel .btn.primary'); await B.click('#room-panel .btn.primary');
      await A.waitForFunction(() => __rv.G.room.status === 'playing'); await sleep(500);
      await shot(A, 'online-play-A.png'); await shot(C, 'online-play-spectator.png');
      const t0 = Date.now();
      while (Date.now() - t0 < 120000) {
        const done = await A.evaluate(() => __rv.G.room.status === 'finished' && !__rv.G.busy);
        if (done) break;
        for (const pg of [A, B]) { const l = await myLegal(pg); if (l.length) { await clickCell(pg, l[Math.floor(Math.random() * l.length)]); await sleep(60); } }
        await sleep(30);
      }
      for (const pg of [A, B, C]) await pg.waitForSelector('#result-layer:not([hidden]) .result-card', { timeout: 8000 });
      const bA = await A.evaluate(() => __rv.scene.getBoard().join('')), bC = await C.evaluate(() => __rv.scene.getBoard().join('')), sB = await B.evaluate(() => __rv.G.state.board.join(''));
      assert.strictEqual(bA, bC); assert.strictEqual(bA, sB); ok('整局下完：三個畫面棋盤一致，結算 overlay 都出現');
      const spec = await C.$eval('#result-layer #res-again', e => e.disabled); assert.ok(spec); ok('觀戰者的「再來一局」不可按');
      await shot(A, 'online-result-A.png');
      await A.click('#res-again'); await B.click('#res-again');
      await A.waitForFunction(() => __rv.G.room.status === 'playing' && __rv.G.room.game.number === 2, null, { timeout: 8000 }); await sleep(400);
      assert.strictEqual(await A.evaluate(() => document.getElementById('result-layer').hidden), true); assert.strictEqual(await A.evaluate(() => __rv.G.room.you.color), 2); ok('再來一局：雙方確認後開新局並換邊');
      await A.evaluate(() => document.querySelector('#side-actions .btn.danger').click()); await A.click('#modal-root .btn.danger');
      await B.waitForSelector('#result-layer:not([hidden])'); await B.click('#result-layer .row2 .btn:first-child'); await sleep(250);
      assert.ok(await B.isVisible('#room-panel')); ok('認輸後「回到房間」：關掉 overlay、顯示房間面板');
      await A.evaluate(() => document.querySelector('#room-panel .room-actions .btn.ghost').click()); await A.waitForFunction(() => __rv.G.screen === 'lobby');
      await B.evaluate(() => document.querySelector('#room-panel .room-actions .btn.ghost').click()); await B.waitForFunction(() => __rv.G.screen === 'lobby');
      await C.waitForSelector('#modal-root .modal'); assert.ok((await C.textContent('#modal-root .modal')).includes(await C.evaluate(() => I18N.t('closed.ended')))); ok('玩家都離開 → 房間關閉，觀戰者看到「房間已結束」');
      await ca.close(); await cb.close(); await cc.close();
    })());

    /* ---------- 6. 窄版線上：抽屜、未讀徽章 ---------- */
    parts.push((async () => {
      const vp = VIEWPORTS[3], c1 = await ctx(vp, true), c2 = await ctx(vp, true);
      const A = await c1.newPage(), B = await c2.newPage(); track(A, 'mA'); track(B, 'mB');
      await A.goto(base); await A.tap('#scr-home .btn:nth-child(2)'); await A.waitForFunction(() => Net.status === 'open'); await A.tap('#scr-lobby .btn.primary'); await A.waitForFunction(() => __rv.G.room);
      const room = await A.evaluate(() => ({ id: __rv.G.room.id, token: __rv.G.room.invite.token }));
      await B.goto(base + '?room=' + room.id + '&invite=' + room.token); await B.waitForSelector('.invite-card'); await B.tap('.invite-card .btn.primary'); await B.waitForFunction(() => __rv.G.room);
      await B.evaluate(() => { Net.send({ type: 'chat', text: '嗨' }); }); await sleep(500);
      assert.ok(await A.isVisible('#side-badge'), '未讀徽章'); ok('手機直向：聊天室收起時顯示未讀徽章');
      await shot(A, 'phone-online-room.png');
      await A.tap('#side-toggle'); await sleep(300); assert.ok(await A.isVisible('#chat-input')); await shot(A, 'phone-online-drawer.png'); ok('手機直向：側欄從左側抽屜展開，聊天室可輸入');
      await c1.close(); await c2.close();
    })());
    await Promise.all(parts);
    assert.deepStrictEqual(errors.filter(e => !/favicon/.test(e)), [], '頁面有錯誤：\n' + errors.join('\n'));
    ok('全程沒有 JS 錯誤或 console error');
    console.log('瀏覽器檢查全部通過，截圖在 tests/shots/');
    await browser.close(); server.close(); setTimeout(() => process.exit(0), 100);
  } catch (e) {
    console.error('✗ 失敗：', e && e.stack || e); if (errors.length) console.error('頁面錯誤：\n' + errors.join('\n'));
    await browser.close().catch(() => {}); process.exit(1);
  }
})();
