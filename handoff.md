# 英文收集辭典 MVP 交接紀錄

更新日期：2026-10-01（Asia/Taipei）。專案：`/Users/sihanchen/Desktop/en_dic`。

本文件保留 2026-10-01 的歷史交接快照。後續 L01～L10 變更、目前命令與驗收結果以 [PROGRESS.md](PROGRESS.md)、[TESTING.md](TESTING.md) 及兩份產品文件為準；下方「目前沒有」與待辦敘述是當時狀態。

## 1. 使用者要求與目前停留位置

原始要求是閱讀 `/Users/sihanchen/Downloads/PLAN (1).md` 後完成實作。計畫涵蓋「貼上英文 → 翻譯解析 → 自主收藏 → 搜尋與複習」的手機優先 PWA。

使用者已明確選擇：**先完成本機實作與測試，雲端設定稍後提供**。不要再次要求提供 Key、密碼，也不要自行建立或部署雲端服務。

最新要求是：**先把目前工作進度寫成 `handoff.md`，方便下一個 AI 接手**。因此這次停在可交接的程式快照；完整 MVP 尚未交付。下面的「已寫入」不等於真實服務驗收通過。

## 2. 必須遵守的專案規範

先讀根目錄 `AGENTS.md`，並保留對話中的額外限制：

- 禁止批量刪除檔案或目錄；禁止 `rm -rf` 等遞迴刪除命令。必要時只刪除一個明確路徑的檔案。需要批量清理時請使用者手動處理。
- 每個完成的改動必須新增或更新相關測試；交付前測試及必要驗證通過，並建立 Git commit。
- API Key、Token、密碼、`.env`、個人資訊、備份不得放入專案、Git 或日誌。使用專案外設定與雲端 Vault。
- 只修改必要內容，不做無關重構或格式化。
- 不自行啟動子代理；目前沒有使用者授權的平行代理工作。

本輪已使用 Supabase 技能：`/Users/sihanchen/.codex/plugins/cache/openai-curated-remote/supabase/1.0.0/skills/supabase/SKILL.md`。已讀 changelog、Vault、Google 登入、PKCE 及 Pi 文件；下一個 AI 若繼續 Supabase 工作，應依技能確認現行文件。CLI 曾因自身設定目錄的 sandbox 權限失敗；經工具核准後成功建立遷移，並未對雲端資料庫進行任何寫入。

## 3. 已確認的產品與架構決策

以附加計畫為準。原有兩份產品文件仍有過時決策，**不要把它們當成最新需求**。

- npm workspaces；React + TypeScript + Vite + Tailwind；Node + TypeScript + Fastify。
- Fastify 同一服務提供前端產物及 API；目標 Render Free、Supabase Free，HTTPS、同源。
- Google 邀請制登入；每次獨立 PKCE、一次性流程識別、10 分鐘 HttpOnly cookie；產品 session 使用雜湊保存，有效 7 天。
- 每次 API 與 RLS 重新檢查邀請；私有 schema；專用 runtime role 禁止 superuser / BYPASSRLS。
- 每人自己的 Gemini Key，Vault 保存。鎖定 `@earendil-works/pi-ai@0.99.2`，預設 `google / gemini-3.8-flash`。第一版延後 ChatGPT OAuth。
- 原文最多 3,000 字元；上下文最多 1,000 字元；完整原文保存。
- 未收藏紀錄保留 UTC 14 × 24 小時；取消收藏從當下重算；讀寫排除已到期紀錄。
- 重複比對採 NFC、去除首尾空白、合併連續空白，保留大小寫及標點，包含上下文。
- 每次新的成功查詢保存新紀錄並提供原收藏入口；請求 ID 重送不得建立重複紀錄。
- 收藏／歷史分開查詢，英文不分大小寫、中文文字包含搜尋；游標分頁。
- 複習順序：還不熟 → 未複習 → 記得；先顯示英文，再揭示答案。
- JSON 匯出；PWA 只快取公開介面；Web Speech API 發音。
- 每人每分鐘 10 次、每日 100 次；每人同時 1 個、服务同時 5 個模型請求；4,096 tokens，60 秒；5xx 最多重試一次，其他錯誤手動重試。
- 每週及遷移前加密備份，專案外私人位置保留 4 週；排除 session 與模型憑證；還原後重新登入、接 Key。

## 4. 已寫入的程式與檔案

| 路徑 | 目前內容 |
| --- | --- |
| `package.json`、`package-lock.json`、`tsconfig.base.json` | workspace、固定版本依賴、建置／型別檢查／測試命令 |
| `packages/shared/src/index.ts` | TypeBox 解析與請求 schema、共用 Entry／Connection 型別、NFC 正規化、預設模型 |
| `apps/server/src/config.ts` | 只讀取 `EN_DIC_CONFIG` 指定的專案外絕對 JSON 路徑；HTTPS 與必填設定檢查 |
| `apps/server/src/db.ts` | pg 交易、session 限權查驗、交易內使用者與 session 範圍、runtime role 啟動檢查 |
| `apps/server/src/auth.ts` | Supabase Auth REST PKCE、交換授權碼、向 Auth server 再驗證 Google 身分；不信任 user_metadata |
| `apps/server/src/app.ts` | 邀請制登入／登出、Origin 檢查、no-store、安全錯誤訊息、模型設定／查詢、紀錄管理、複習與匯出 API |
| `apps/server/src/model.ts` | Pi Google provider、禁止環境及主機憑證回退、唯讀 Vault CredentialStore、嚴格 return_analysis 工具、回應驗證、有限重試 |
| `apps/server/src/entries.ts` | 讀取序列化、列表／搜尋／游標分頁 |
| `apps/server/src/index.ts` | 生產服務啟動、提供 web/dist、訊號關閉；尚未用真實設定啟動 |
| `apps/web/src/main.tsx`、`style.css`、`api.ts` | 「拾字」手機介面：登入、查詢、收藏、歷史、詳情／來源／備註、複習、設定、JSON 下載、發音、登出畫面清除 |
| `apps/web/public/` | manifest、service worker、SVG 與 192／512 PNG 圖示；只快取 shell 與 assets，排除 API／OAuth |
| `supabase/migrations/20261001070225_dictionary_mvp.sql` | 由 CLI 建立的初始遷移；private tables、RLS、session／Vault 限權函式、配額與 lease、成功請求 tombstone、到期清理 |
| `supabase/config.toml` | 本機 Data API 關閉、Auth 及 localhost callback 設定；雲端仍須另行設定 |
| `tests/database.ts` | 記憶體 PGlite 測試資料庫，真實 PostgreSQL role／RLS／交易／SQL，僅 Vault extension 由測試 stub 替代 |
| `tests/api.test.ts` | 9 項 API／資料庫整合測試，包含許多子情境 |
| `.gitignore` | 排除 node_modules、dist、憑證、dump／backup／age、日誌與測試輸出 |

`apps/server/src/errors.ts`、各 workspace 的 package.json / tsconfig、Vite 設定、web index.html 也已建立。

目前沒有 README、CI workflow、Render 設定、備份／還原工具或品質案例資料。`scripts/`、`tests/fixtures/`、`.github/workflows/` 只有空目錄。

## 5. 本輪驗證與修正

交接時的本機驗證：

- `npm test`：**9 / 9 通過**，2026-10-01 最新一次約 6.6 秒。
- `npm run typecheck`：通過。
- `npm run build`：通過；交接前已完成完整 `npm run check`（文件測試、API／資料庫測試、型別檢查、建置全部通過）。
- `npm run test:docs`：原有 **4 / 4 通過**。這四個測試驗證舊文件，尚不能證明已同步最新決策。此次另加 2 項交接文件測試，文件測試合計 **6 / 6 通過**。
- `git diff --check`：通過。
- 安裝時 npm audit 回報 0 vulnerabilities；尚未做獨立完整安全審查。

API 測試已涵蓋：完整原文、請求 ID 重送／衝突、正規化與原收藏入口、取消收藏重算、不重複延長取消後期限、跨帳號讀写／匯出／複習隔離、撤邀、到期不可見與清理、英中搜尋與 literal `%`／`_`、33 筆游標分頁、複習排序、完整 JSON 與單筆刪除、輸入長度／偽造欄位／Origin、拒絕／格式錯誤／429／逾時／保存失敗不建立成功歷史、並行重送不釋放原查詢 lease、解除連線取消查詢、首次連線與解除競爭、OAuth cookie／單次流程／逾時／未受邀／session 雜湊。

已修正的問題：

1. 同一 request ID 的並行重送若被拒絕，不能清除原請求的 lease。釋放操作移入 `runModel` 的 reservation owner；保存也在該生命週期內完成。
2. 解除尚未建立的連線仍增加 version tombstone，避免正在測試的新 Key 重新接回。
3. Vault SQL 的 `secret` 變數與 vault table 欄位名稱衝突，改為 `v_secret`；測試 stub view 也保留 `secret` 欄位，使測試更貼近真實形狀。
4. PGlite 不接受 prepared statement 內多個 DDL，保存失敗測試改為分開建立函式與 trigger。
5. Pi 0.99.2 Google adapter 的 thinking level 必須用 `LOW`。該 adapter 不呼叫 `onResponse`；目前由記憶體中的 errorMessage 擷取數值狀態分類，原始內容不回傳或記錄。
6. `tsx --test` 的 IPC 在 sandbox 失敗，測試命令改為 `node --import tsx --test`。

**驗證限制：** API 模型為測試替身，Vault 为 stub；沒有真實 Google 登入、Gemini 解析、Supabase Vault／Cron、Render、瀏覽器 E2E 或手機實機驗收。不要將 9 個測試描述成所有計畫驗收已通過。

## 6. 接手後優先檢查與待辦

### A. 先完成本機品質與必要修補

1. 讀本文件、附加計畫與 Git 狀態，執行 `npm run check` 建立基線。
2. **查詢頁新的相同查詢與重送要區分。** `Query` 的 request ref 目前成功後仍保留 ID；再次按相同內容會回傳舊紀錄。應在已收到成功結果後結束該 ID，下一次使用者主動查詢產生新 ID；網路失敗／未知是否已保存時仍重用原 ID。新增測試。
3. **檢查 success lookup 與 reserve_query 的競爭。** 第二個同 ID 請求如果在前次 lookup 後、reserve 前遇到第一個保存完成，可能再次呼叫模型並撞 unique constraint，回 500。應在原子預約或預約後再查成功 tombstone，補競爭測試。
4. 完成實際 Pi adapter 的傳輸／錯誤測試，驗證 5xx 僅一次重試、429 不重試、無效 Key／模型、不回退、截斷／拒絕與严格 schema 相容；目前 API failure 測試沒有實際走 Pi SDK。
5. 配額測試尚缺：每分鐘／每日邊界、UTC 切日、每人 1 個及服務 5 個跨帳號上限、解除或撤邀後 lease 到期、安全 SQL 直接存取。
6. 收藏與 cleanup 的真正並行交易競爭尚未驗證。PGlite fixture 用單一連線序列化交易，不能代替多連線 PostgreSQL 的競爭測試。
7. 檢查 config 的 `realpath`／symlink 處理（目前只檢查字串路徑），游標 UUID 驗證、含外部資料的錯誤不洩露，以及前端登出失敗／跨分頁／bfcache／晚到回應清除私人狀態。
8. 加瀏覽器流程測試與視覺檢查，確認 375／390px 手機、桌面、長原文、安全區、鍵盤、發音無英文語音、離線、登出、PWA 快取及匯出。不需要真實 Key 的情境可以測試替身跑本機。
9. `packages/shared/package.json` 同時有 `@sinclair/typebox` 與 `typebox`，實作只用 `typebox`；下一次必要依賴整理可移除無用宣告並同步 lockfile。遵守禁止批量刪除。
10. `runModel` 的呼叫處保留一些只有註解的 `finally`，可在修補相關流程時整理；避免為風格做額外重構。

### B. 補足本機交付內容

1. 同步 `PRODUCT_OUTLINE.md`、`PRODUCT_TECHNOLOGY.md` 與 `tests/test_product_technology.py`。舊測試仍要求訂閱 OAuth／待確認規則，必須改為此次 MVP 決策。
2. 實作 `scripts/migrate.ts` 與 `scripts/quality.ts`。**package.json 已有命令，但檔案不存在，這兩個命令目前不能使用。**
3. 加 40 個非敏感品質案例（單字、片語、多義字、省略句、短段落）；真實模型與人工評分獨立執行，要求至少 36 / 40；修正失敗案例後重測。沒有外部 Key 時只能建立工具與案例，不能宣稱品質通過。
4. 加 README，說明本機設定、命令、架構、安全角色、邀請管理、部署與仍未驗收項目。
5. 加 CI：文件測試、單元／API／資料庫整合、型別檢查、建置；真實模型不進一般 CI。
6. 加 Render Free 的部署設定與手冊，維持同一服務、HTTPS、外部 secret file；不要自行發布。
7. 加專案外加密備份及還原工具、版本驗證與還原測試；每週及遷移前、4 週保留；排除 sessions、login_flows、connections 及 Vault。過期備份需要批量清理時只列出清单供使用者手動刪除。

### C. 雲端設定提供後才做的驗收

1. 用管理者角色套用遷移；服務另用專用 LOGIN 角色（NOBYPASSRLS、NOSUPERUSER），授予 `en_dic_runtime` 權限，不能把 postgres/service_role 憑證用作 runtime。
2. 啟用 Vault、pg_cron，關閉雲端 Data API；private 不作 exposed schema；配置 Google OAuth、站台 URL、含 flow query 的 callback allowlist、邀請名單。
3. 遷移只在 `cron` schema 已存在時排程，若套用時未啟用 cron，之後需手動建立 `en-dic-expiry` 排程，或改善部署工具確保不遺漏。
4. 真實跨帳號 API／DB、撤邀、Vault 函式權限、無法直接讀 decrypted view、連線競爭、模型失效仍可查看收藏。
5. Render 閒置喚醒、Supabase 暫停、真實模型 40 案例、跨裝置、iOS Safari／Android Chrome 加主畫面及發音、備份還原。
6. Supabase advisors 與權限審查；真實 Vault／Cron 不能由本機 stub 驗證取代。

## 7. 執行方式與環境注意事項

```sh
cd /Users/sihanchen/Desktop/en_dic
npm ci
npm run check
npm run dev:web
```

依賴已安裝，`npm ci` 不是每次必須。開發前端預設 Vite localhost:5173，`/api`、`/auth` 代理到 localhost:3000；尚未設定後端時 UI 無法真實登入。

後端必須設定 **專案外** JSON，再用其絕對路徑作 `EN_DIC_CONFIG`。欄位：`origin`、`databaseUrl`、`supabaseUrl`、`supabasePublishableKey`、選填 `port`。production origin 要 HTTPS；localhost 可 HTTP。Key／密碼不要出現在命令列參數、聊天、repo 或 console。這輪沒有建立任何真實設定檔。

`npm run build` 後可 `npm start`；Node 最低 22.19.0。共用 package export 指向 TypeScript source，runtime 依賴 Node 的 type stripping（目前環境 Node 26.8.1）；接手者需確認目標部署 Node 版本，或改為明確匯出的已編譯 JS 並同步測試／建置流程。

本機沒有 psql，Docker CLI 有，但 Docker daemon 未啟動。整合測試使用記憶體 PGlite，不需要 Docker。未安裝或驗證 Playwright 瀏覽器，未啟動 UI preview。

Vite 設 `emptyOutDir: false` 以避免建置時批量刪除；重建可能留下舊 hash 資產。不要用遞迴刪除清理 dist，必要時由使用者手動清理。

## 8. Git 與交接提交

開始時工作樹乾淨，原 HEAD：`fbf8d23`（`docs: support Pi subscription OAuth model connections`）。

此次會把目前 MVP 程式快照、測試與交接文件納入一個對應 commit，訊息為 `feat: checkpoint local MVP implementation and handoff`。其定位是 **可追蹤的未完成實作快照**，不代表整份計畫完成；實際 hash 請由 `git log -1 --oneline` 取得，避免在同一 commit 文件內寫入自身 hash。

接手時先確認 `git status --short`、`git log -3 --oneline`；保留使用者後續變更，不要 reset／覆蓋。下一個完成的修補仍須更新測試、驗證、另建 commit。
