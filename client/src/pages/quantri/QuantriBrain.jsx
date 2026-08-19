import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Brain, ExternalLink, FlaskConical, Save } from 'lucide-react'
import { adminFetch } from '../../lib/adminApi'

function csv(list) {
  return (list || []).filter(Boolean).join(', ')
}

function parseCsv(s) {
  return String(s || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
}

export default function QuantriBrain() {
  const { me } = useOutletContext() || {}
  const [catalog, setCatalog] = useState([])
  const [config, setConfig] = useState(null)
  const [status, setStatus] = useState(null)
  const [ragReady, setRagReady] = useState(false)
  const [fromEnv, setFromEnv] = useState({})
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const [testOut, setTestOut] = useState({})
  const [openId, setOpenId] = useState('openrouter')
  const [draftKeys, setDraftKeys] = useState({})

  const load = useCallback(async () => {
    const res = await adminFetch('/api/quantri/brain')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Không tải được bộ não')
    setCatalog(data.catalog || [])
    setConfig(data.config)
    setStatus(data.status)
    setRagReady(Boolean(data.ragReady))
    setFromEnv(data.fromEnv || {})
    setDraftKeys({})
  }, [])

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [load])

  const chatIds = useMemo(() => catalog.filter((p) => p.supportsChat).map((p) => p.id), [catalog])
  const embedIds = useMemo(() => catalog.filter((p) => p.supportsEmbed).map((p) => p.id), [catalog])

  if (me?.role !== 'super_admin') {
    return (
      <p className="p-6 text-sm text-white/70">
        Chỉ super-admin được cấu hình API / bộ não.
      </p>
    )
  }

  function patchProvider(id, patch) {
    setConfig((cur) => ({
      ...cur,
      providers: {
        ...cur.providers,
        [id]: { ...cur.providers[id], ...patch },
      },
    }))
  }

  async function save() {
    if (!config) return
    setBusy(true)
    setError('')
    setOk('')
    try {
      const providers = {}
      for (const spec of catalog) {
        const st = config.providers[spec.id] || {}
        providers[spec.id] = {
          enabled: st.enabled !== false,
          baseUrl: st.baseUrl || '',
          chatModel: st.chatModel || '',
          embeddingModel: st.embeddingModel || '',
          siteUrl: st.siteUrl || '',
          siteName: st.siteName || '',
        }
        const typed = String(draftKeys[spec.id] || '').trim()
        if (typed) providers[spec.id].apiKey = typed
      }
      const pinecone = {
        indexName: config.pinecone?.indexName || 'van-ban-hanh-chinh',
        namespace: config.pinecone?.namespace || '',
        environment: config.pinecone?.environment || '',
      }
      const pKey = String(draftKeys.pinecone || '').trim()
      if (pKey) pinecone.apiKey = pKey

      const res = await adminFetch('/api/quantri/brain', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatPrimary: config.chatPrimary,
          extractPrimary: config.extractPrimary,
          embeddingPrimary: config.embeddingPrimary,
          chatFallback: parseCsv(csv(config.chatFallback)),
          extractFallback: parseCsv(csv(config.extractFallback)),
          embeddingFallback: parseCsv(csv(config.embeddingFallback)),
          pinecone,
          providers,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Không lưu được')
      setConfig(data.config)
      setStatus(data.status)
      setRagReady(Boolean(data.ragReady))
      setFromEnv(data.fromEnv || fromEnv)
      setDraftKeys({})
      setOk('Đã lưu bộ não. Chat và số hóa dùng cấu hình mới ngay (không cần restart).')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function testProvider(provider, purpose) {
    setTestOut((cur) => ({ ...cur, [`${provider}:${purpose}`]: 'Đang gọi…' }))
    const res = await adminFetch('/api/quantri/brain/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, purpose }),
    })
    const data = await res.json().catch(() => ({}))
    const msg = data.ok
      ? purpose === 'embedding'
        ? `OK · ${data.dims} chiều vector`
        : `OK · ${data.sample || 'phản hồi nhận được'}`
      : data.error || 'Thất bại'
    setTestOut((cur) => ({ ...cur, [`${provider}:${purpose}`]: msg }))
  }

  if (!config) {
    return <p className="p-6 text-sm text-white/60">{error || 'Đang tải bộ não…'}</p>
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 text-slate-100">
      <header className="mb-5">
        <h1 className="m-0 flex items-center gap-2 text-2xl font-semibold">
          <Brain className="h-6 w-6 text-[var(--hcc-gold-bright)]" />
          Bộ não (API / LLM)
        </h1>
        <p className="m-0 mt-1 text-sm text-white/65">
          Chọn nhà cung cấp cho trả lời, bóc metadata, và embedding. Key lưu trong{' '}
          <code className="text-[11px]">app_settings</code> (service role) — không lộ ra client.
        </p>
      </header>

      <div
        className={`mb-4 rounded-2xl border px-3 py-2 text-sm ${
          ragReady
            ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
            : 'border-amber-400/30 bg-amber-500/10 text-amber-100'
        }`}
      >
        {ragReady
          ? `Sẵn sàng · chat: ${(status?.chat || []).join(', ') || '—'} · embedding: ${(status?.embedding || []).join(', ') || '—'} · Pinecone: ${status?.pinecone ? 'OK' : 'thiếu'}`
          : 'Chưa đủ bộ não: cần ≥1 chat, ≥1 embedding, và Pinecone.'}
      </div>

      <section className="mb-5 rounded-3xl border border-white/10 bg-white/5 p-4 text-sm leading-relaxed text-white/75">
        <p className="m-0 font-medium text-white">Gói đăng ký chat (Plus / Advanced) ≠ API</p>
        <ul className="mt-2 mb-0 space-y-1 pl-4">
          <li>
            ChatGPT Plus, Gemini Advanced, DeepSeek trên web <strong>không</strong> dùng được làm API. Cần key
            trên trang developer (billing API).
          </li>
          <li>
            <strong>OpenRouter</strong> (openrouter.ai) — một key, nhiều model, có model <code>:free</code>. Nên
            bật thêm 1 provider trả phí làm fallback khi free hết quota.
          </li>
          <li>
            <strong>Google Antigravity</strong> dùng cùng key Gemini nhưng là agent sandbox (code/web). Hệ thống
            này chỉ dùng Gemini Flash/Pro để trả lời văn bản — không gọi Antigravity.
          </li>
          <li>
            Đổi <strong>embedding</strong> (model/vector) sẽ lệch kho cũ — phải số hóa lại tài liệu. Chat/extract
            đổi tự do.
          </li>
        </ul>
      </section>

      <section className="mb-5 rounded-3xl border border-white/10 bg-white/5 p-4">
        <h2 className="m-0 text-base font-semibold">1. Kho vector — Pinecone</h2>
        <p className="m-0 mt-1 mb-3 text-xs text-white/50">
          Bắt buộc cho tìm văn bản. {fromEnv.pinecone ? 'Đã có key trong .env — để trống ô dưới nếu giữ nguyên.' : ''}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-white/60">
            API key {config.pinecone?.hasKey ? `(${config.pinecone.apiKeyHint})` : ''}
            <input
              type="password"
              autoComplete="off"
              value={draftKeys.pinecone || ''}
              onChange={(e) => setDraftKeys((k) => ({ ...k, pinecone: e.target.value }))}
              placeholder={config.pinecone?.hasKey ? 'Để trống = giữ key cũ' : 'pcsk_…'}
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-white/60">
            Index
            <input
              value={config.pinecone?.indexName || ''}
              onChange={(e) =>
                setConfig((c) => ({ ...c, pinecone: { ...c.pinecone, indexName: e.target.value } }))
              }
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-white/60">
            Namespace (tuỳ chọn)
            <input
              value={config.pinecone?.namespace || ''}
              onChange={(e) =>
                setConfig((c) => ({ ...c, pinecone: { ...c.pinecone, namespace: e.target.value } }))
              }
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
            />
          </label>
        </div>
      </section>

      <section className="mb-5 rounded-3xl border border-white/10 bg-white/5 p-4">
        <h2 className="m-0 text-base font-semibold">2. Vai trò & thứ tự fallback</h2>
        <p className="m-0 mt-1 mb-3 text-xs text-white/50">
          Hết quota / 429 thì thử nhà cung cấp tiếp theo. Embedding nên ổn định một model.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-white/60">
            Chat (trả lời)
            <select
              value={config.chatPrimary}
              onChange={(e) => setConfig((c) => ({ ...c, chatPrimary: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-2 py-2 text-sm"
            >
              {chatIds.map((id) => (
                <option key={id} value={id}>
                  {catalog.find((p) => p.id === id)?.name}
                </option>
              ))}
            </select>
            <input
              value={csv(config.chatFallback)}
              onChange={(e) => setConfig((c) => ({ ...c, chatFallback: parseCsv(e.target.value) }))}
              placeholder="fallback: groq, openai…"
              className="mt-2 w-full rounded-xl border border-white/15 bg-black/20 px-2 py-1.5 text-[11px]"
            />
          </label>
          <label className="text-xs text-white/60">
            Extract (bóc metadata)
            <select
              value={config.extractPrimary}
              onChange={(e) => setConfig((c) => ({ ...c, extractPrimary: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-2 py-2 text-sm"
            >
              {chatIds.map((id) => (
                <option key={id} value={id}>
                  {catalog.find((p) => p.id === id)?.name}
                </option>
              ))}
            </select>
            <input
              value={csv(config.extractFallback)}
              onChange={(e) => setConfig((c) => ({ ...c, extractFallback: parseCsv(e.target.value) }))}
              className="mt-2 w-full rounded-xl border border-white/15 bg-black/20 px-2 py-1.5 text-[11px]"
            />
          </label>
          <label className="text-xs text-white/60">
            Embedding (vector)
            <select
              value={config.embeddingPrimary}
              onChange={(e) => setConfig((c) => ({ ...c, embeddingPrimary: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-2 py-2 text-sm"
            >
              {embedIds.map((id) => (
                <option key={id} value={id}>
                  {catalog.find((p) => p.id === id)?.name}
                </option>
              ))}
            </select>
            <input
              value={csv(config.embeddingFallback)}
              onChange={(e) => setConfig((c) => ({ ...c, embeddingFallback: parseCsv(e.target.value) }))}
              className="mt-2 w-full rounded-xl border border-white/15 bg-black/20 px-2 py-1.5 text-[11px]"
            />
          </label>
        </div>
      </section>

      <section className="mb-5">
        <h2 className="m-0 mb-3 text-base font-semibold">3. Nhà cung cấp</h2>
        <div className="space-y-2">
          {catalog.map((spec) => {
            const st = config.providers[spec.id] || {}
            const open = openId === spec.id
            return (
              <div key={spec.id} className="rounded-2xl border border-white/10 bg-white/5">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? '' : spec.id)}
                  className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left"
                >
                  <span
                    className={`h-2 w-2 rounded-full ${st.hasKey && st.enabled !== false ? 'bg-emerald-400' : 'bg-white/25'}`}
                  />
                  <span className="font-medium">{spec.name}</span>
                  <span className="text-[11px] text-white/40">
                    {spec.supportsChat ? 'chat' : ''}
                    {spec.supportsEmbed ? ' · embed' : ''}
                    {fromEnv[spec.id] ? ' · .env' : ''}
                    {st.hasKey ? ` · ${st.apiKeyHint}` : ' · chưa key'}
                  </span>
                </button>
                {open ? (
                  <div className="space-y-2 border-t border-white/10 px-3 py-3">
                    <p className="m-0 text-xs text-white/55">{spec.note}</p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {spec.signup ? (
                        <a
                          href={spec.signup}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[var(--hcc-gold-bright)] underline"
                        >
                          Lấy API key <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                      {spec.docs ? (
                        <a
                          href={spec.docs}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-white/50 underline"
                        >
                          Model docs
                        </a>
                      ) : null}
                    </div>
                    <label className="inline-flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={st.enabled !== false}
                        onChange={(e) => patchProvider(spec.id, { enabled: e.target.checked })}
                      />
                      Bật provider này
                    </label>
                    <label className="block text-xs text-white/60">
                      API key {st.hasKey ? `(đang dùng ${st.apiKeyHint})` : ''}
                      <input
                        type="password"
                        autoComplete="off"
                        value={draftKeys[spec.id] || ''}
                        onChange={(e) => setDraftKeys((k) => ({ ...k, [spec.id]: e.target.value }))}
                        placeholder={st.hasKey ? 'Để trống = giữ key cũ · gõ - để xóa' : 'Dán secret key'}
                        className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
                      />
                    </label>
                    {spec.id === 'custom' || spec.defaultBase || spec.id === 'openrouter' ? (
                      <label className="block text-xs text-white/60">
                        Base URL
                        <input
                          value={st.baseUrl || ''}
                          onChange={(e) => patchProvider(spec.id, { baseUrl: e.target.value })}
                          placeholder={spec.defaultBase || 'https://host/v1'}
                          className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
                        />
                      </label>
                    ) : null}
                    {spec.supportsChat ? (
                      <label className="block text-xs text-white/60">
                        Chat model
                        <input
                          value={st.chatModel || ''}
                          onChange={(e) => patchProvider(spec.id, { chatModel: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
                        />
                      </label>
                    ) : null}
                    {spec.id === 'openrouter' && spec.freeModels?.length ? (
                      <div>
                        <p className="m-0 mb-1 text-[11px] text-white/45">Model miễn phí OpenRouter (bấm để chọn):</p>
                        <div className="flex flex-wrap gap-1">
                          {spec.freeModels.map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => patchProvider(spec.id, { chatModel: m })}
                              className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                                st.chatModel === m ? 'bg-[var(--hcc-gold)] text-[#1a1214]' : 'bg-white/10 text-white/80'
                              }`}
                            >
                              {m.replace(':free', '')}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {spec.supportsEmbed ? (
                      <label className="block text-xs text-white/60">
                        Embedding model
                        <input
                          value={st.embeddingModel || ''}
                          onChange={(e) => patchProvider(spec.id, { embeddingModel: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
                        />
                      </label>
                    ) : null}
                    {spec.id === 'openrouter' ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="text-xs text-white/60">
                          HTTP-Referer (OpenRouter)
                          <input
                            value={st.siteUrl || ''}
                            onChange={(e) => patchProvider(spec.id, { siteUrl: e.target.value })}
                            placeholder="https://domain-cua-ban.vercel.app"
                            className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="text-xs text-white/60">
                          X-Title
                          <input
                            value={st.siteName || ''}
                            onChange={(e) => patchProvider(spec.id, { siteName: e.target.value })}
                            placeholder="RAGVANBAN"
                            className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {spec.supportsChat ? (
                        <button
                          type="button"
                          onClick={() => testProvider(spec.id, 'chat')}
                          className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs"
                        >
                          <FlaskConical className="h-3 w-3" />
                          Thử chat
                        </button>
                      ) : null}
                      {spec.supportsEmbed ? (
                        <button
                          type="button"
                          onClick={() => testProvider(spec.id, 'embedding')}
                          className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs"
                        >
                          <FlaskConical className="h-3 w-3" />
                          Thử embedding
                        </button>
                      ) : null}
                    </div>
                    {testOut[`${spec.id}:chat`] || testOut[`${spec.id}:embedding`] ? (
                      <p className="m-0 font-mono text-[11px] text-white/55">
                        {testOut[`${spec.id}:chat`] ? `chat: ${testOut[`${spec.id}:chat`]}` : ''}
                        {testOut[`${spec.id}:embedding`]
                          ? `${testOut[`${spec.id}:chat`] ? ' · ' : ''}embed: ${testOut[`${spec.id}:embedding`]}`
                          : ''}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      {ok ? <p className="text-sm text-emerald-200">{ok}</p> : null}

      <button
        type="button"
        disabled={busy}
        onClick={save}
        className="btn-gold inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold disabled:opacity-40"
      >
        <Save className="h-4 w-4" />
        {busy ? 'Đang lưu…' : 'Lưu bộ não'}
      </button>
    </div>
  )
}
