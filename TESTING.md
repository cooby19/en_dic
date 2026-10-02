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
