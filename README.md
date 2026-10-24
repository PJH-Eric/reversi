# 黑白棋（Reversi）

木質棋盤＋大理石棋子的 2D 畫面，翻面時有偽 3D 的硬幣翻轉動畫。零依賴（只需要 Node.js）。

## 模式
- **單機**：五段電腦 —— 幼幼班（亂下）／簡單（貪心）／普通（2 層搜尋）／困難（4 層＋殘局精算）／神話（8 層＋殘局精算）。
- **線上 1 對 1**：房間列表、邀請連結（有期限、可撤銷）、觀戰（上限 20 人）、聊天室、斷線 30 秒內可重連、可選每手時限（30／60 秒）、再來一局自動換邊。伺服器為權威，最後一位實體玩家離開房間即關閉。

## 啟動
Windows 直接點 `啟動遊戲.bat`，或：

```
npm start        # http://localhost:3180
```

## 測試
```
npm test                 # 規則、AI、房間邏輯與語系檢查
npm run test:online      # 真實線上整合（需支援 WebSocket 的 Node 版本）
node tests/browser-check.js   # 需要 Playwright；沒裝會自動略過。截圖在 tests/shots/
SLOW=1 npm test          # 加跑 AI 對戰強度比較
```

## 架構
- `public/js/rules.js` 規則核心（瀏覽器、伺服器、測試共用）；`ai.js` 五段 AI；`scene2d.js` Canvas 2D 繪製；`app.js` 介面流程。
- `server.js` + `lib/rooms.js` + `lib/ws.js`（自寫 WebSocket）。
- `public/js/config.js` 是唯一的伺服器網址設定入口。

## 部署（預設拓撲）
1. **後端 → Render**：用 `render.yaml` 建立 Web Service（新加坡區），在服務設定填 `ALLOW_ORIGIN`。健康檢查 `/health`。免費層會休眠、重啟後房間會消失（房間只存在記憶體）。
2. **前端 → GitHub Pages**：repo 的 Variables 設 `GAME_SERVER_URL`（Render 後端 HTTPS 網址），推到 `main` 後由 `.github/workflows/pages.yml` 自動測試並部署。

## 維護與驗證產物

介面支援繁體中文、簡體中文與英文；從右上角語言選單切換，新增說明文字時須同步維護三種語系。遊戲人數、操作與勝負條件以本文件的玩法說明及規則核心為準。

以 `package.json` 的 scripts 為可執行指令來源；`npm test` 執行基本驗證，`npm run verify` 執行該專案列出的整合驗證。需要 Playwright、瀏覽器或網路的檢查，依各測試章節的前置條件執行。

截圖、測試報告、記錄檔及快取為可重新產生的驗證產物，不屬於正式遊戲資產，也不提交版本控制。測試完成後可清除 `screenshots/`、`shots/`、`.shots/`、`test-results/`、`playwright-report/`、`coverage/`、`.cache/`、`tmp/`、`temp/` 與 `*.log`。保留正式圖片、圖示、音訊、字型、原始碼、測試案例、鎖定檔及 `.env.example`；`node_modules/` 是相依套件目錄，不能當成圖片或暫存檔一起刪除。
