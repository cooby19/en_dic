import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BookOpen, Search, Bookmark, Clock3, Layers, Settings, ArrowUpRight, Volume2, ArrowLeft, Check, Plus, LogOut, Download, Trash2 } from 'lucide-react';
import { DEFAULT_MODEL, type Entry, type Connection, type Analysis } from '@en-dic/shared';
import { api, body, ApiError } from './api';
import './style.css';
type Page = 'query' | 'favorites' | 'history' | 'review' | 'settings';
const pages = [{ id: 'query', label: '查詢', icon: Search }, { id: 'favorites', label: '收藏', icon: Bookmark }, { id: 'history', label: '歷史', icon: Clock3 }, { id: 'review', label: '複習', icon: Layers }, { id: 'settings', label: '設定', icon: Settings }] as const;
const date = (value: string) => new Intl.DateTimeFormat('zh-TW', { month: 'short', day: 'numeric' }).format(new Date(value));
function AnalysisView({ analysis }: { analysis: Analysis }) {
  return <div className="analysis"><span className="tag">{{ word: '單字', phrase: '片語', sentence: '句子' }[analysis.kind]}</span><h2>{analysis.translation}</h2>
    {analysis.kind === 'word' && <><p className="muted">{analysis.partOfSpeech}</p><p>{analysis.usage}</p><ul>{analysis.meanings.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
    {analysis.kind === 'phrase' && <><p>{analysis.usage}</p><blockquote>{analysis.example}</blockquote></>}
    {analysis.kind === 'sentence' && <><h3>句子結構</h3><p>{analysis.structure}</p>{analysis.vocabulary.length > 0 && <><h3>重點詞彙</h3><dl>{analysis.vocabulary.map((x, i) => <div key={i}><dt>{x.english}</dt><dd>{x.meaning}</dd></div>)}</dl></>}</>}
    {analysis.ambiguity && <p className="hint">{analysis.ambiguity}</p>}</div>;
}
function Speak({ text }: { text: string }) {
  const [message, setMessage] = useState('');
  return <><button className="icon-button" aria-label="播放英文發音" onClick={() => {
    if (!('speechSynthesis' in window)) return setMessage('此裝置不支援英文發音。');
    const voices = speechSynthesis.getVoices(), voice = voices.find(x => x.lang.toLowerCase().startsWith('en'));
    if (!voice) return setMessage('沒有可用英文語音，請在裝置設定新增英文語音。');
    setMessage(''); speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = voice.lang; utterance.voice = voice; speechSynthesis.speak(utterance);
  }}><Volume2 size={19}/></button>{message && <span className="muted" role="status">{message}</span>}</>;
}
function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null), [page, setPage] = useState<Page>('query');
  const [selected, setSelected] = useState<Entry | null>(null), [message, setMessage] = useState('');
  const [epoch, setEpoch] = useState(0), [offline, setOffline] = useState(!navigator.onLine);
  const generation = useRef(0), channel = useRef<BroadcastChannel | null>(null);
  const clear = useCallback(() => { generation.current++; setSignedIn(false); setSelected(null); setMessage(''); setPage('query'); setEpoch(x => x + 1); if ('speechSynthesis' in window) speechSynthesis.cancel(); }, []);
  const report = useCallback((error: unknown) => { if (error instanceof ApiError && error.status === 401) { clear(); setMessage(error.message); } else setMessage(error instanceof Error ? error.message : '操作失敗，請重試。'); }, [clear]);
  useEffect(() => {
    let mounted = true;
    const check = async () => { try { await api('/me'); if (mounted) setSignedIn(true); } catch (e) { if (mounted) { if (e instanceof ApiError && e.status === 401) clear(); else { setSignedIn(false); report(e); } } } };
    void check();
    const reconnect = () => { setOffline(!navigator.onLine); if (navigator.onLine) void check(); };
    const show = (event: PageTransitionEvent) => { if (event.persisted) { clear(); void check(); } };
    const visible = () => { if (!document.hidden) { setSelected(null); setEpoch(x => x + 1); void check(); } };
    window.addEventListener('online', reconnect); window.addEventListener('offline', reconnect); window.addEventListener('pageshow', show); document.addEventListener('visibilitychange', visible);
    channel.current = 'BroadcastChannel' in window ? new BroadcastChannel('en-dic-session') : null;
    if (channel.current) channel.current.onmessage = () => clear();
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
    const login = new URL(location.href).searchParams.get('login');
    if (login) { setMessage(login === 'invite' ? '這個帳號尚未受邀，請聯絡管理者。' : '登入取消或逾時，請再試一次。'); history.replaceState(null, '', '/'); }
    return () => { mounted = false; window.removeEventListener('online', reconnect); window.removeEventListener('offline', reconnect); window.removeEventListener('pageshow', show); document.removeEventListener('visibilitychange', visible); channel.current?.close(); };
  }, [clear, report]);
  const logout = async () => { try { await api('/logout', { method: 'POST' }); channel.current?.postMessage('logout'); clear(); } catch (error) { clear(); report(error); } };
  const open = async (id: string) => { const version = generation.current; try { const result = await api<Entry>(`/entries/${id}`); if (version === generation.current) setSelected(result); } catch (error) { report(error); } };
  const navigate = (next: Page) => { setPage(next); setSelected(null); setMessage(''); setEpoch(x => x + 1); };
  return <div className="app"><aside className="sidebar"><a className="brand" href="/"><BookOpen size={28}/><span>拾字<small>ENGLISH COLLECTION</small></span></a><p className="sidebar-note">把遇見的英文，<br/>變成自己的語言。</p>{signedIn && <nav>{pages.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => navigate(id)} className={page === id ? 'active' : ''}><Icon size={20}/>{label}</button>)}</nav>}<div className="sidebar-bottom"><span>一字一句，慢慢累積。</span>{signedIn && <button className="text-button" onClick={logout}><LogOut size={16}/>登出</button>}</div></aside>
    <div className="workspace"><header className="topbar"><span className="mobile-brand"><BookOpen size={22}/>拾字</span><span className="breadcrumb">你的英文收集辭典 <span>/ {pages.find(x => x.id === page)?.label}</span></span><span className="status-dot">{offline ? '目前離線' : '連線使用'}</span></header>
      <main>{offline && <div className="notice">目前離線。私人內容不會離線快取，恢復連線後即可查詢及同步。</div>}{message && <div className="notice error" role="alert">{message}<button aria-label="關閉提示" onClick={() => setMessage('')}>×</button></div>}
        {signedIn === null ? <div className="empty">服務啟動中，首次連線可能需要稍候…</div> : !signedIn ? <div className="welcome"><span className="eyebrow">A LITTLE WORD, A NEW WORLD</span><h1>留住每一次<br/>理解的瞬間。</h1><p>貼上英文，讀懂意思。<br/>收藏值得記住的單字、片語與句子，<br/>在自己的節奏裡慢慢複習。</p><a className="primary" href="/auth/google">使用 Google 登入 <ArrowUpRight size={19}/></a><small>僅限受邀帳號 · 收藏在各裝置同步</small><div className="welcome-note"><BookOpen size={40}/><span>今天遇見的字，<br/>明天也記得。</span></div></div> : selected ? <EntryDetail key={selected.id} entry={selected} onBack={() => { setSelected(null); setEpoch(x => x + 1); }} report={report} onChange={setSelected}/> : <React.Fragment key={`${page}-${epoch}`}>
          {page === 'query' && <Query report={report} open={open} onSettings={() => navigate('settings')}/>}
          {(page === 'favorites' || page === 'history') && <EntryList kind={page} report={report} open={open}/>}
          {page === 'review' && <Review report={report}/>}
          {page === 'settings' && <SettingsView report={report} logout={logout}/>}
        </React.Fragment>}
      </main><footer>拾字 <span>·</span> 讓理解留下來</footer></div>
    {signedIn && <nav className="bottom-nav">{pages.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={21}/><span>{label}</span></button>)}</nav>}
  </div>;
}
function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div className="page-title"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>; }
type Report = (error: unknown) => void;
function Query({ report, open, onSettings }: { report: Report; open: (id: string) => void; onSettings: () => void }) {
  const [original, setOriginal] = useState(''), [context, setContext] = useState(''), [result, setResult] = useState<Entry | null>(null), [existing, setExisting] = useState<string[]>([]), [busy, setBusy] = useState(false), [connection, setConnection] = useState<Connection | null>(null);
  const request = useRef<{ input: string; id: string } | null>(null), alive = useRef(true);
  useEffect(() => { void api<Connection>('/connection').then(x => { if (alive.current) setConnection(x); }).catch(report); return () => { alive.current = false; }; }, [report]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (busy || !original.trim()) return;
    const input = body({ original, context }); if (request.current?.input !== input) request.current = { input, id: crypto.randomUUID() };
    setBusy(true); setResult(null); setExisting([]);
    try { const data = await api<{ entry: Entry; existingFavorites: string[] }>('/query', { method: 'POST', body: body({ original, context, requestId: request.current.id }) }); request.current = null; if (alive.current) { setResult(data.entry); setExisting(data.existingFavorites); } }
    catch (error) { if (alive.current) report(error); } finally { if (alive.current) setBusy(false); }
  };
  const favorite = async () => { if (!result || busy) return; setBusy(true); try { const saved = await api<Entry>(`/entries/${result.id}`, { method: 'PATCH', body: body({ favorite: !result.favorite }) }); if (alive.current) setResult(saved); } catch (e) { report(e); } finally { if (alive.current) setBusy(false); } };
  return <><PageTitle eyebrow="COLLECT A LITTLE UNDERSTANDING" title="今天，遇見什麼英文？" description="一個字、一句話，或一段讓你好奇的內容。"/>
    {connection && !connection.connected && <div className="notice">開始前，先連接自己的 Gemini Key。<button className="text-button" onClick={onSettings}>前往設定 <ArrowUpRight size={16}/></button></div>}
    <form className="input-card" onSubmit={submit}><label htmlFor="original">貼上英文 <span>WORD / PHRASE / SENTENCE</span></label><textarea id="original" maxLength={3000} rows={5} value={original} onChange={e => setOriginal(e.target.value)} placeholder="What caught your attention today?" required/><div className="input-counter">{original.length.toLocaleString()} / 3,000</div><details><summary><Plus size={16}/>補充上下文 <span>選填</span></summary><label className="sr-only" htmlFor="context">上下文</label><textarea id="context" value={context} onChange={e => setContext(e.target.value)} maxLength={1000} rows={3} placeholder="原句或前後文，讓翻譯更貼近你的情境。"/><div className="input-counter">{context.length} / 1,000</div></details><div className="input-actions"><span>理解後，再決定要不要收藏。</span><button className="primary" disabled={busy || !original.trim() || !connection?.connected}>{busy ? '解析與保存中…' : '翻譯與解析'}<ArrowUpRight size={18}/></button></div></form>
    {busy && <p className="hint" role="status">正在等待完整解析並保存。首次喚醒可能較久，最多等待 60 秒。</p>}
    {result ? <article className="result-card"><div className="entry-head"><span className="eyebrow">YOUR NEW DISCOVERY</span><Speak text={result.original}/></div><h2 className="original">{result.original}</h2><AnalysisView analysis={result.analysis}/>{existing.length > 0 && <div className="notice">你已收藏相同內容。<button className="text-button" onClick={() => open(existing[0])}>查看原收藏</button></div>}<div className="card-actions"><button className={result.favorite ? 'primary' : 'secondary'} onClick={favorite} disabled={busy}><Bookmark size={17}/>{result.favorite ? '已收藏 · 取消收藏' : '收藏這次理解'}</button><button className="text-button" onClick={() => open(result.id)}>來源與備註 <ArrowUpRight size={16}/></button></div><small className="muted">{result.favorite ? '收藏持續保留。' : `歷史保留至 ${date(result.expiresAt!)}。`} · {result.model}</small></article> : <div className="gentle-note"><BookOpen size={24}/><div><h3>不只是翻譯，也是理解。</h3><p>依內容提供詞性、用法或句子結構。成功查詢保留 14 天，收藏後持續保存。</p></div></div>}
  </>;
}
function EntryList({ kind, report, open }: { kind: 'favorites' | 'history'; report: Report; open: (id: string) => void }) {
  const [search, setSearch] = useState(''), [items, setItems] = useState<Entry[]>([]), [cursor, setCursor] = useState<string | null>(null), [busy, setBusy] = useState(true), [loaded, setLoaded] = useState(false);
  const sequence = useRef(0);
  const load = async (next?: string, currentSearch = search) => {
    const number = ++sequence.current; setBusy(true);
    try { const data = await api<{ entries: Entry[]; nextCursor: string | null }>(`/entries?${new URLSearchParams({ kind, search: currentSearch, ...(next ? { cursor: next } : {}) })}`); if (sequence.current === number) { setItems(previous => next ? [...previous, ...data.entries] : data.entries); setCursor(data.nextCursor); setLoaded(true); } }
    catch (e) { if (sequence.current === number) report(e); } finally { if (sequence.current === number) setBusy(false); }
  };
  useEffect(() => { setItems([]); setLoaded(false); const timer = setTimeout(() => { void load(undefined, search); }, 250); return () => { clearTimeout(timer); sequence.current++; }; }, [search]);
  return <><PageTitle eyebrow={kind === 'favorites' ? 'WORDS WORTH KEEPING' : 'RECENT DISCOVERIES'} title={kind === 'favorites' ? '我的收藏' : '查詢歷史'} description={kind === 'favorites' ? '每一次收藏，都是一點新的理解。' : '成功查詢保留 14 天，值得記住的可以隨時收藏。'}/><div className="search-field"><Search size={19}/><input aria-label="搜尋英文或中文" value={search} maxLength={300} onChange={e => setSearch(e.target.value)} placeholder="搜尋英文原文或中文翻譯"/></div><div className="list-label"><span>{search ? '搜尋結果' : kind === 'favorites' ? '最近收藏' : '最近查詢'}</span><span>{items.length} 筆{cursor ? '+' : ''}</span></div>
    {busy && <p className="muted" role="status">載入中…</p>}{!busy && loaded && !items.length && <div className="empty"><Bookmark size={30}/><h3>{search ? '還沒有符合的內容' : '這裡，等著你的第一筆理解。'}</h3><p>{search ? '試試別的英文或中文關鍵字。' : '從查詢頁貼上英文，開始累積。'}</p></div>}
    <div className="entries">{items.map(item => <button className="entry-row" key={item.id} onClick={() => open(item.id)}><div><span className="tag">{{ word: '單字', phrase: '片語', sentence: '句子' }[item.analysis.kind]}</span><h2>{item.original}</h2><p>{item.analysis.translation}</p><small>{date(kind === 'favorites' ? item.favoritedAt! : item.createdAt)}{item.expiresAt && ` · ${date(item.expiresAt)} 到期`}</small></div><ArrowUpRight size={19}/></button>)}</div>{cursor && <button className="secondary load-more" onClick={() => load(cursor)} disabled={busy}>載入更多</button>}
  </>;
}
function EntryDetail({ entry, onBack, onChange, report }: { entry: Entry; onBack: () => void; onChange: (entry: Entry) => void; report: Report }) {
  const [source, setSource] = useState(entry.source), [notes, setNotes] = useState(entry.notes), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [deleting, setDeleting] = useState(false);
  const alive = useRef(true); useEffect(() => () => { alive.current = false; }, []);
  const update = async (patch: unknown) => { setBusy(true); setSaved(false); try { const result = await api<Entry>(`/entries/${entry.id}`, { method: 'PATCH', body: body(patch) }); if (alive.current) { onChange(result); setSaved(true); } } catch (e) { report(e); } finally { if (alive.current) setBusy(false); } };
  return <><button className="text-button back" onClick={onBack}><ArrowLeft size={17}/>返回列表</button><article className="result-card"><div className="entry-head"><span className="eyebrow">A WORD TO REMEMBER</span><Speak text={entry.original}/></div><h1 className="original">{entry.original}</h1>{entry.context && <p className="context">上下文：{entry.context}</p>}<AnalysisView analysis={entry.analysis}/><button className={entry.favorite ? 'primary' : 'secondary'} disabled={busy} onClick={() => update({ favorite: !entry.favorite })}><Bookmark size={17}/>{entry.favorite ? '已收藏 · 取消收藏' : '加入收藏'}</button><p className="muted"><small>{date(entry.createdAt)} 查詢 · {entry.model} · {entry.expiresAt ? `${date(entry.expiresAt)} 到期` : '持續保留'}{entry.review && ` · ${entry.review === 'learning' ? '還不熟' : '記得'}`}</small></p></article>
    <form className="settings-card" onSubmit={e => { e.preventDefault(); void update({ source, notes }); }}><h2>留下一點情境</h2><label htmlFor="source">來源</label><input id="source" value={source} maxLength={1000} placeholder="文章、影片或遇見它的地方" onChange={e => setSource(e.target.value)}/><label htmlFor="notes">我的備註</label><textarea id="notes" value={notes} maxLength={4000} rows={4} placeholder="用自己的話，記住這次理解。" onChange={e => setNotes(e.target.value)}/><div className="card-actions"><button className="secondary" disabled={busy}>儲存備註 <Check size={16}/></button>{saved && <small role="status">已同步</small>}</div></form>
    {deleting ? <div className="notice error">確定永久刪除這一筆紀錄？<button className="text-button" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/entries/${entry.id}`, { method: 'DELETE' }); if (alive.current) onBack(); } catch (e) { report(e); } finally { if (alive.current) setBusy(false); } }}>確認刪除</button><button className="text-button" onClick={() => setDeleting(false)}>取消</button></div> : <button className="text-button danger" onClick={() => setDeleting(true)}><Trash2 size={16}/>刪除這筆紀錄</button>}
  </>;
}
function Review({ report }: { report: Report }) {
  const [items, setItems] = useState<Entry[] | null>(null), [index, setIndex] = useState(0), [reveal, setReveal] = useState(false), [busy, setBusy] = useState(false);
  const alive = useRef(true); useEffect(() => { void api<{ entries: Entry[] }>('/review').then(x => { if (alive.current) setItems(x.entries); }).catch(report); return () => { alive.current = false; }; }, [report]);
  const current = items?.[index];
  const mark = async (review: 'remembered' | 'learning') => { if (!current || busy) return; setBusy(true); try { await api(`/entries/${current.id}/review`, { method: 'POST', body: body({ review }) }); if (alive.current) { setIndex(x => x + 1); setReveal(false); } } catch (e) { report(e); } finally { if (alive.current) setBusy(false); } };
  return <><PageTitle eyebrow="A LITTLE PRACTICE, EVERY DAY" title="回頭看，就更熟悉一點。" description="優先複習還不熟的內容，其次是未複習，再來是記得的。"/>{items === null ? <p role="status">載入中…</p> : current ? <article className="review-card"><div className="entry-head"><span className="muted">{index + 1} / {items.length}</span><Speak text={current.original}/></div><h2 className="original">{current.original}</h2>{current.context && <p className="muted">{current.context}</p>}{!reveal ? <button className="primary" onClick={() => setReveal(true)}>想好了，揭示答案</button> : <><AnalysisView analysis={current.analysis}/><div className="review-actions"><button className="secondary" disabled={busy} onClick={() => mark('learning')}>還不熟</button><button className="primary" disabled={busy} onClick={() => mark('remembered')}><Check size={18}/>記得</button></div></>}</article> : <div className="empty"><Check size={32}/><h2>{items.length ? '這一輪，完成了。' : '收藏一點內容，再開始複習。'}</h2><p>{items.length ? '今天的理解，又多留住了一點。' : '複習只使用你的收藏，每次最多 30 筆。'}</p></div>}</>;
}
function SettingsView({ report, logout }: { report: Report; logout: () => void }) {
  const [connection, setConnection] = useState<Connection | null>(null), [models, setModels] = useState<string[]>([DEFAULT_MODEL]), [model, setModel] = useState(DEFAULT_MODEL), [key, setKey] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const alive = useRef(true); useEffect(() => { void Promise.all([api<Connection>('/connection'), api<{ models: string[] }>('/models')]).then(([c, m]) => { if (alive.current) { setConnection(c); setModel(c.model); setModels(m.models); } }).catch(report); return () => { alive.current = false; }; }, [report]);
  const change = async (method: string, path = '/connection') => {
    if (!connection || busy) return; setBusy(true); setNotice('');
    try { const result = await api<Connection>(path, { method, ...(method === 'PUT' ? { body: body({ ...(key ? { key } : {}), model, version: connection.version }) } : {}) }); if (alive.current) { setConnection(result); setModel(result.model); setNotice(result.connected ? '連線測試成功，設定已保存。' : '已解除連線，收藏仍可查看。'); } }
    catch (e) { report(e); const current = await api<Connection>('/connection').catch(() => null); if (alive.current && current) setConnection(current); }
    finally { if (alive.current) { setKey(''); setBusy(false); } }
  };
  const download = async () => { setBusy(true); try { const data = await api('/export'); if (!alive.current) return; const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'english-collection.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (e) { report(e); } finally { if (alive.current) setBusy(false); } };
  return <><PageTitle eyebrow="MAKE IT YOURS" title="設定與資料" description="自己的模型連線，自己的學習收藏。"/><form className="settings-card" onSubmit={e => { e.preventDefault(); void change('PUT'); }}><div className="entry-head"><h2>Gemini 連線</h2><span className="tag">{connection ? connection.status === 'error' ? '需要檢查' : connection.connected ? '已連線' : '未連線' : '載入中'}</span></div><p className="muted">每位使用者使用自己的 API Key；Key 會加密保存，儲存前會送出一次解析測試。</p><label htmlFor="key">{connection?.connected ? '更換 Key（留空可保留）' : 'Gemini API Key'}</label><input id="key" type="password" autoComplete="off" value={key} maxLength={300} onChange={e => setKey(e.target.value)} placeholder="輸入你的 API Key" required={!connection?.connected}/><label htmlFor="model">解析模型</label><select id="model" value={model} onChange={e => setModel(e.target.value)}>{models.map(x => <option key={x}>{x}</option>)}</select><div className="card-actions"><button className="primary" disabled={busy || !connection}>{busy ? '處理中…' : '儲存並測試'}<ArrowUpRight size={17}/></button>{connection?.connected && <><button type="button" className="text-button" disabled={busy} onClick={() => change('POST', '/connection/test')}>測試連線</button><button type="button" className="text-button danger" disabled={busy} onClick={() => change('DELETE')}>解除連接</button></>}</div>{notice && <p role="status">{notice}</p>}<p className="fine-print">實際額度、計費與資料使用由你的 Gemini 專案及方案決定。免費方案不保證固定次數；輸入內容將交由 Google 處理。<a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noreferrer">查看價格與資料政策 ↗</a><a href="https://ai.google.dev/gemini-api/docs/rate-limits" target="_blank" rel="noreferrer">查看額度 ↗</a></p></form>
    <section className="settings-card"><h2>你的資料，由你保留</h2><p className="muted">收藏持續保存。未收藏的成功查詢保留 14 天；取消收藏後，從當下重新計算 14 天。</p><button className="secondary" onClick={download} disabled={busy}><Download size={17}/>匯出完整收藏 JSON</button><p className="fine-print">匯出包含原文、解析、上下文、來源、備註與複習狀態。下載檔案請存放在專案外的私人位置。介面可安裝為 PWA，私人內容需要連線查看。</p><p className="fine-print">每分鐘最多 10 次、每日最多 100 次，每人同時進行一個模型請求。首次開啟服務可能需等待喚醒。</p></section><button className="text-button danger" onClick={logout}><LogOut size={17}/>登出並清除畫面</button></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
