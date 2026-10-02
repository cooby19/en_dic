# 英文收集辭典｜產品技術方向

更新日期：2026-10-02（Asia/Taipei）

本文件與 [產品大綱](PRODUCT_OUTLINE.md) 已同步最新 MVP 決策；歷史背景見 [handoff.md](handoff.md)，實作與未完成驗收見 [PROGRESS.md](PROGRESS.md)。本機驗證通過不代表真實雲端、模型品質或手機實機驗收通過。

## 1. 已確認的產品決策

- 個人與受邀朋友的小規模使用；Google 邀請制產品登入，每次 API 與 RLS 重新檢查邀請。
- 雲端保存、同帳號跨裝置同步；手機優先網頁與 PWA，不考慮 App 商店上架。
- 每人自己的 Gemini API Key，由 Supabase Vault 保存；Google 產品登入不代表已取得 Gemini 授權。
- 模型接入鎖定 `@earendil-works/pi-ai@0.99.2`，僅 `google` provider，預設 `gemini-3.8-flash`；可用清單限定支援嚴格取樣的 Gemini 3.x。
- 第一版延後 ChatGPT OAuth 與其他模型訂閱，不提供管理者共用 Key。不靜默改用其他帳號或付費 API。
- 取消收藏後，從取消當下重新計算 UTC 14 × 24 小時；未收藏查詢自成功保存起保留相同期限。

## 2. 技術組合

| 部分 | 已選技術 | 用途 |
| --- | --- | --- |
| 工作區 | npm workspaces，Node 22.19+ | 固定版本依賴與 lockfile |
| 前端 | React + TypeScript + Vite + Tailwind CSS | 查詢、收藏、歷史、詳情、複習與設定 |
| 後端 | Node.js + TypeScript + Fastify | 同一服務提供 web/dist 與 API，同源 HTTPS |
| 部署目標 | Render Free | 不自行發布；閒置喚醒另待驗收 |
| 資料與登入 | Supabase Free、PostgreSQL、Auth | Google 邀請制與資料同步 |
| 隔離 | private schema、RLS、專用 runtime role | NOSUPERUSER、NOBYPASSRLS，非 postgres/service_role |
| 模型憑證 | Supabase Vault、唯讀 CredentialStore | 依使用者隔離，禁止環境及主機憑證回退 |
| 到期清理 | pg_cron → private.cleanup() | 讀寫先排除到期資料，排程後清理 |
| 發音 | Web Speech API | 有英文語音才播放，缺少或不支援時提示 |

## 3. 手機與 PWA 體驗

PWA 只快取公開 shell、圖示與 hash assets；API、OAuth、匯出及私人資料不進入 CacheStorage。私人內容只在連線且登入驗證成功後呈現，離線、登出、跨分頁登出及 bfcache 復原會清除畫面。晚到回應不得重新顯示資料。伺服器登出失敗時顯示重試入口，畫面仍保持清除。

375／390px、桌面與長原文以 Chromium 測試替身驗證；iOS Safari／Android Chrome 的主畫面安裝、鍵盤、安全區及發音仍需實機驗收。加入主畫面不等於能離線查詢或複習。

## 4. Gemini 接入與安全

### 4.1 登入與連線

產品帳號登入與模型供應商授權為兩個獨立流程。Google 產品登入使用獨立 PKCE 與一次性 flow，10 分鐘 HttpOnly cookie；產品 session 以雜湊保存，有效 7 天，不持久保存 Google access token。

設定頁接入每人的 Gemini Key；先送一次解析測試，再保存至 Vault。更換、測試、解除連接皆檢查連線版本，解除連接取消進行中請求。既有收藏、複習與匯出可在模型無效或解除連接時使用。Google AI Studio API 使用 API Key，不能假設 Google AI Pro/Ultra 訂閱可替代它。

憑證、私人設定、備份、真實品質回應與人工評分必須保存於專案外私人位置，不進入 Git、日誌或前端產物。EN_DIC_CONFIG 必須使用專案外絕對路徑，並檢查 realpath／symlink。後端只回傳安全錯誤，不轉送供應商或資料庫原始錯誤。

### 4.2 解析與保存

原文最多 3,000 字元、上下文最多 1,000 字元；完整原文保存。word 提供詞性、用法與常見意思；phrase 提供整體意思、用法、例句；sentence（含短段落）提供自然繁體中文翻譯、句子結構及重點詞彙。缺乏上下文的多義字提示常見解讀及補充原句。輸入是待解析資料，不得改寫系統規則。

Pi 嚴格傳輸物件包含全部必填欄位，再驗證 domain schema；未使用欄位必須為空。只有完整有效結果才保存。拒絕、截斷、格式錯誤、逾時、保存失敗均不產生成功歷史。

### 4.3 配額與錯誤

每人每分鐘 10 次、每日 100 次，UTC 分鐘／日桶；每人同時 1 個、服務同時 5 個模型請求，包含連線測試。最多 4,096 tokens、60 秒 lease／等待上限。5xx 最多重試一次；429、無效 Key／模型、拒絕、格式錯誤與網路錯誤提示手動重試，不自動切換模型或付費方案。

這些是產品上限，不是 Google 保證額度；實際計費、可用性與限制以個人的 Google 專案為準。免費方案的內容可能用於改善 Google 產品，輸入將送交 Google，介面應說明資料使用政策。

- [Gemini API 價格與資料政策](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API 額度](https://ai.google.dev/gemini-api/docs/rate-limits)

## 5. 雲端資料與功能規則

- 成功的新查詢各保存新紀錄，包含原文、上下文、解析、模型與時間；相同 request ID 重送只回原紀錄，內容不同回 REQUEST_CONFLICT。
- 重複比對採 NFC、去首尾空白、合併連續空白，保留大小寫與標點，包含上下文；已收藏相同內容提供原收藏入口。
- 收藏／歷史分開，英文不分大小寫、中文文字包含搜尋；不把 `%`／`_` 當 SQL wildcard，游標分頁每頁 30 筆。
- 未收藏保存 UTC 14 × 24 小時；收藏持續保留，取消收藏從當下重算。重複取消不得再延長期限。到期資料在讀寫時立即排除，清理與收藏交易須保護收藏。
- 複習只用收藏，每次最多 30 筆；還不熟 → 未複習 → 記得，先英文再揭示答案，保存熟悉程度與時間。
- JSON 匯出全部收藏，包含原文、解析、上下文、來源、備註、時間與複習狀態；不含 session、Key 或 Vault 資料。
- 每週及遷移前加密備份，專案外私人位置保留 4 週；排除 sessions、login_flows、connections 與 Vault，還原後重新登入與接 Key。L13 工具與真實還原尚待驗收；到期刪除不代表即時從所有備份消失。

## 6. 遷移與維護

`scripts/migrate.ts` 預設只讀計畫；`--list` 離線列出遷移，`--apply` 需專案外管理者設定、遷移前非空 `.age` 備份，以及 Vault／pg_cron 已啟用。runtime 與管理者分開。工具有自己的 `en_dic_migrations.history`，以 checksum、單一交易及 advisory lock 防止變更歷史、部分套用與並行重複執行，不與 Supabase CLI db push 混用。既有 schema 缺乏本工具歷史時拒絕自動採納，須先人工對帳。

Fastify 同源服務使用外部設定、HTTPS 與 no-store；private 不作 exposed schema，關閉 Supabase Data API。Render 部署檔案、README／CI、備份還原工具仍由 L11～L13 追蹤，尚未自行部署。

## 7. 功能驗收與測試

| 情境 | 預期結果／驗證方式 |
| --- | --- |
| Google 邀請制、PKCE、未受邀、撤邀 | 每次 API 與 RLS 查邀請；真實登入與 callback 另待驗收 |
| 不同帳號讀寫、匯出與複習 | 無法取得或修改他人資料，runtime 不可直接讀 Vault |
| 單字、片語、多義字、省略句、短段落 | 40 個非敏感案例逐案人工評分，至少 36 / 40；真實模型待驗收 |
| 空白、過長、拒絕、截斷、格式錯誤 | 清楚提示，不產生成功歷史 |
| 5xx、429、Key／模型失效、逾時、解除連接 | 有限重試與安全錯誤，已保存收藏仍可使用 |
| 未收藏滿 14 天、取消收藏、並行清理 | 到期不可讀寫，重算期限正確，不刪除收藏 |
| 相同內容的新查詢與 request ID 重送 | 前者新增，後者重播；不重複呼叫模型 |
| 游標、symlink、外部錯誤 | 非法輸入安全拒絕，不洩露私人設定 |
| 登出失敗、跨分頁、bfcache、晚到回應 | 清除私人畫面，失敗可重試，不被舊回應重新打開 |
| 手機／桌面、長原文、離線與 PWA 快取 | Chromium 驗證；鍵盤、安全區與手機安裝另做實機驗收 |
| 發音缺少英文語音、匯出、備註、複習 | 有降級提示；匯出保留完整收藏內容 |
| 遷移重跑、失敗、checksum 與並行 | PostgreSQL 驗證交易與歷史；真實 Vault／Cron 另待驗收 |

命令與限制見 [TESTING.md](TESTING.md)，40 案例評分狀態見 [QUALITY_RECORD.md](QUALITY_RECORD.md)。HTTP、模型、前端替身或 Vault stub 不能替代真實服務驗收。

## 8. 尚待驗收

已選定的供應商、Google 邀請制、Gemini Key、保存規則與配額不再列為待確認。外部設定提供後驗收 Render／Supabase、真實 Vault／Cron、40 案例 Gemini 品質、跨裝置與手機 PWA、發音及加密備份還原；第一版模型訂閱 OAuth 保持延後。

## 9. 技術參考

- [Pi 與鎖定版本](https://github.com/earendil-works/pi)
- [Pi CredentialStore](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md#credential-store)
- [Supabase 資料庫遷移](https://supabase.com/docs/guides/local-development/database-migrations)
- [PWA 安裝方式](https://web.dev/learn/pwa/installation)
