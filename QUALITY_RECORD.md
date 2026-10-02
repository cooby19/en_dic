# 解析品質評分紀錄

2026-10-02：已建立 40 個非敏感、人工撰寫案例；真實 Gemini 尚未執行，**待驗收**。替身測試只驗證工具，不計入 36 / 40 門檻。

每案四項人工判斷：翻譯正確、上下文／歧義處理正確、解析有用、繁體中文自然。四項全部通過、schema 有效、類型符合預期且無模型錯誤，才計一案通過。人工評分必須綁定該次 reportChecksum，禁止沿用上次結果。至少 36 / 40 才通過；失敗案例修正後重跑全組並重新評分。

實際回應、等待時間、評分者代號與備註保存於專案外私人檔案。此表只保留無敏感內容的驗收狀態。工具指令見 [TESTING.md](TESTING.md)。

| 案例 | 類別 | 原文 | 人工評分 |
| --- | --- | --- | --- |
| Q01 | word | resilient | 待驗收 |
| Q02 | word | subtle | 待驗收 |
| Q03 | word | commute | 待驗收 |
| Q04 | word | reluctant | 待驗收 |
| Q05 | word | linger | 待驗收 |
| Q06 | word | meticulous | 待驗收 |
| Q07 | word | nevertheless | 待驗收 |
| Q08 | word | awkward | 待驗收 |
| Q09 | phrase | break the ice | 待驗收 |
| Q10 | phrase | on the fence | 待驗收 |
| Q11 | phrase | a piece of cake | 待驗收 |
| Q12 | phrase | come up with | 待驗收 |
| Q13 | phrase | call it a day | 待驗收 |
| Q14 | phrase | under the weather | 待驗收 |
| Q15 | phrase | take for granted | 待驗收 |
| Q16 | phrase | in the long run | 待驗收 |
| Q17 | polysemy | bank | 待驗收 |
| Q18 | polysemy | bank | 待驗收 |
| Q19 | polysemy | charge | 待驗收 |
| Q20 | polysemy | charge | 待驗收 |
| Q21 | polysemy | light | 待驗收 |
| Q22 | polysemy | light | 待驗收 |
| Q23 | polysemy | run | 待驗收 |
| Q24 | polysemy | fine | 待驗收 |
| Q25 | ellipsis | Coming? | 待驗收 |
| Q26 | ellipsis | Not yet. | 待驗收 |
| Q27 | ellipsis | Sounds good. | 待驗收 |
| Q28 | ellipsis | If only I had known. | 待驗收 |
| Q29 | ellipsis | The sooner, the better. | 待驗收 |
| Q30 | ellipsis | No wonder. | 待驗收 |
| Q31 | ellipsis | Been there, done that. | 待驗收 |
| Q32 | ellipsis | Need a hand? | 待驗收 |
| Q33 | paragraph | The train was late, so we walked to the library. By the time we arrived, the rain had stopped. | 待驗收 |
| Q34 | paragraph | Although the recipe looked simple, the bread did not rise. We decided to try again with fresh yeast. | 待驗收 |
| Q35 | paragraph | I used to read before bed. These days, I listen to short stories instead. | 待驗收 |
| Q36 | paragraph | The book that you recommended was fascinating. I could hardly put it down. | 待驗收 |
| Q37 | paragraph | If the weather clears up, we will have a picnic. Otherwise, we can cook at home. | 待驗收 |
| Q38 | paragraph | The more we practiced, the more confident we became. Progress was slow but steady. | 待驗收 |
| Q39 | paragraph | A small garden can attract birds and insects. Planting native flowers helps them find food. | 待驗收 |
| Q40 | paragraph | She said she would send the notes after lunch. I had already checked my inbox twice when they finally arrived. | 待驗收 |
