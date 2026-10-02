# 本機驗證

`npm run check` 執行文件、API／Pi adapter、真正多連線 PostgreSQL、Chromium 行為測試、型別與建置檢查。需 Node 22.19+、npm 依賴、Chromium，以及 PostgreSQL 17+ 的 `initdb`／`pg_ctl`。PostgreSQL 必須以一般使用者執行，不可使用 root。

```sh
# 請指向自己已安裝 PostgreSQL 的 bin 目錄；若已在 PATH 可省略。
EN_DIC_TEST_PG_BIN=/usr/lib/postgresql/17/bin npm run check
# 只跑配額、權限與交易競爭：
EN_DIC_TEST_PG_BIN=/usr/lib/postgresql/17/bin npm run test:postgres
```

測試會在系統暫存目錄建立自己的 PostgreSQL 叢集，只開啟該私人目錄的 Unix socket，使用合成帳號及測試資料。runtime 以真正的 NOSUPERUSER／NOBYPASSRLS LOGIN 角色連線；每個案例使用獨立資料庫，載入全部版本控制內的遷移。測試結束會停止該叢集；暫存資料與日誌留供診斷，不遞迴刪除。沒有 PostgreSQL 時檢查明確失敗，不會跳過競爭驗收。Windows 請在 WSL 執行。

Pi 測試使用真實的 Pi 0.99.2 與 Google SDK，僅替換最外層 `fetch` 回應，檢查 HTTP 請求、SSE、錯誤分類與呼叫次數，不呼叫真實 Gemini 或使用真實 Key。配額時間邊界測試只在獨立測試資料庫替換 `reserve_query` 的時鐘；一般並行、RLS 與收藏／清理測試使用原始函式及真實時間。Vault extension 仍使用 SQL stub，Cron 未啟用。

這些檢查不代表真實 Google 登入、Gemini 品質、Supabase Vault／Cron、Render 或手機實機驗收；雲端項目仍見 [PROGRESS.md](PROGRESS.md)。

## L06／L07 瀏覽器與安全驗證

`npm run test:web` 先建置公開介面，再啟動 Vite 與 Chromium。375／390／1440px 測試完整原文、收藏、歷史、搜尋、備註、刪除、複習、JSON 下載、模型解除後收藏及發音降級。畫面擷取保存於系統暫存目錄 `en-dic-visual/`，只使用合成資料。一般流程攔截 API；快取案例另啟動只在 localhost 使用的 HTTP fixture，載入真正建置產物及 service worker，以瀏覽器 CacheStorage 和實際離線重載驗證 shell／assets，確認 API、OAuth、匯出皆未快取。

私人狀態涵蓋伺服器登出失敗、重試、重新載入、跨分頁 BroadcastChannel／storage fallback、晚到 `/me` 與查詢成功／錯誤、離線與恢復連線。bfcache 以 persisted pageshow 事件驗證清除及重查，不代表手機或所有瀏覽器真實 bfcache 驗收。鍵盤、安全區與 iOS／Android 安裝仍待 C05。

## L09 遷移工具

```sh
npm run migrate -- --help
npm run migrate -- --list        # 不連資料庫
# EN_DIC_MIGRATION_CONFIG 為專案外絕對 JSON 路徑；只傳路徑，不傳 URL／密碼。
EN_DIC_MIGRATION_CONFIG=/private/en-dic/migration.json npm run migrate
EN_DIC_MIGRATION_CONFIG=/private/en-dic/migration.json npm run migrate -- --apply
```

外部 JSON 欄位是 `databaseUrl`（獨立管理者、direct 或 session pooler，不能 transaction pooler）；`--apply` 額外要求 `backupPath` 指向專案外非空 `.age` 加密備份。檔案存在與副檔名檢查不代表備份可還原；加密與還原驗證由 L13／C06 負責。工具不自動建立雲端、取得憑證或製作備份，本輪沒有執行雲端遷移。

預設使用只讀交易列出 pending。套用前拒絕 runtime 登入，要求 `supabase_vault`／`pg_cron` 已啟用，避免初始遷移遺漏到期排程。整批 SQL 與 history 以一個交易提交，advisory lock 序列化並行；已套用版本重跑會略過，checksum、順序或缺少歷史時拒絕寫入。所有版本控制內遷移都經本機 PostgreSQL 測試；Vault 仍為 stub，Cron 待 C02。

本工具管理自己的 `en_dic_migrations.history`，**不與 Supabase CLI `db push` 混用**。已有 private.entries 卻沒有工具歷史的資料庫，包含先前 CLI 套用的資料庫，預設拒絕自動採納；須由管理者比對實際 schema 與遷移檔案，再決定對帳方案，不偽造已套用紀錄。測試驗證只讀計畫、整批套用、重跑、並行、checksum 拒絕、DDL／history 回滾及既有 schema 拒絕。

## L10 品質工具與人工評分

```sh
npm run test:quality -- --list   # 40 案例，不呼叫模型
npm run test:quality -- --help
# 只在個人外部 Gemini 設定就緒、要進行真實驗收時執行 --run：
EN_DIC_QUALITY_CONFIG=/private/en-dic/quality.json npm run test:quality -- --run --output /private/en-dic/report.json
npm run test:quality -- --template /private/en-dic/report.json --output /private/en-dic/scores.json
npm run test:quality -- --score /private/en-dic/report.json --scores /private/en-dic/scores.json
```

外部 JSON 只有 `apiKey` 與選填 `model`，預設 `gemini-3.8-flash`；不回退到環境／主機憑證。只有 `--run` 呼叫真實 Gemini，依序跑 40 案例，紀錄每案耗時、分析或安全錯誤代碼；沿用實際 Pi adapter 的重試與 timeout，每案最多 60 秒。run 是產出待人工評分的報告，並非品質通過。輸出與評分檔必須在專案外，拒絕覆寫既有檔案，不記錄 Key 或供應商錯誤原文。

案例涵蓋單字、片語、多義字、省略句及短段落，各 8 案；人工依 `criteria` 檢視翻譯、上下文／歧義、解析與繁體中文四項，各填 true／false，評分者填非敏感代號。模板的 `reportChecksum` 綁定當次完整報告。全部 40 案評分完成後，無錯誤、schema／類型正確且四項皆通過才計分；至少 36 / 40 才達門檻，未達門檻或缺評分回非零 exit code。失敗後修正並重跑完整案例，重新人工評分，不沿用舊分數。summary 提供 median／p95 耗時與失敗 ID。

[QUALITY_RECORD.md](QUALITY_RECORD.md) 保留 40 案待驗收紀錄。`npm test` 使用 fixture 驗證工具、36／35 邊界、評分完整性與不洩露原始錯誤；fixture source 永遠不能判為真實模型驗收通過。沒有外部 Key 時，一般 check 不呼叫模型，也不自動提供人工分數。真實 Gemini 36 / 40 仍由 C03 追蹤。
