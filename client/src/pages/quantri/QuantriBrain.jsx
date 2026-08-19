import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Brain, ExternalLink, FlaskConical, Save } from 'lucide-react'
import { adminFetch } from '../../lib/adminApi'

const TABS = [
  { id: 'setup', label: 'Cách cài' },
  { id: 'chat', label: 'Chat' },
  { id: 'embed', label: 'Embedding' },
  { id: 'keys', label: 'API key' },
]

const EMBED_RECIPES = [
  {
    dim: 1536,
    use: 'ChatGPT / OpenAI',
    model: 'text-embedding-3-small',
    pinecone: 'Pinecone → Custom settings → Dimensions 1536 → cosine',
    provider: 'openai',
  },
  {
    dim: 768,
    use: 'Gemini',
    model: 'gemini-embedding-001',
    pinecone: 'Pinecone → chip 768 → cosine',
    provider: 'gemini',
  },
  {
    dim: 1024,
    use: 'Mistral',
    model: 'mistral-embed',
    pinecone: 'Pinecone → chip 1024 → cosine',
    provider: 'mistral',
  },
]

function JobChip({ kind }) {
  if (kind === 'chat') {
    return (
      <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-100">
        Chat
      </span>
    )
  }
  if (kind === 'embed') {
    return (
      <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-100">
        Embedding
      </span>
    )
  }
  return (
    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
      Chỉ chat — không embed
    </span>
  )
}

function NeedCard({ ok, title, job, who, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-3 py-2.5 text-left text-xs ${
        ok
          ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-50'
          : 'border-amber-400/35 bg-amber-500/10 text-amber-50'
      }`}
    >
      <p className="m-0 text-[10px] font-semibold uppercase tracking-wide opacity-80">
        {ok ? 'Đủ' : 'Thiếu'} · {title}
      </p>
      <p className="m-0 mt-1 font-medium text-white">{job}</p>
      <p className="m-0 mt-1 text-[11px] text-white/55">{who}</p>
    </button>
  )
}

function csv(list) {
  return (list || []).filter(Boolean).join(', ')
}

function parseCsv(s) {
  return String(s || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
}

function SaveBrainButton({ busy, onSave }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onSave}
      className="btn-gold inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40"
    >
      <Save className="h-4 w-4" />
      {busy ? 'Đang lưu…' : 'Lưu bộ não'}
    </button>
  )
}

function SectionHead({ title, hint, busy, onSave }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="m-0 text-base font-semibold">{title}</h2>
        {hint ? <p className="m-0 mt-1 text-xs text-white/50">{hint}</p> : null}
      </div>
      <SaveBrainButton busy={busy} onSave={onSave} />
    </div>
  )
}

function ProviderFields({
  spec,
  st,
  fromEnv,
  draftKeys,
  setDraftKeys,
  patchProvider,
  testProvider,
  testOut,
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {spec.supportsEmbed ? (
          <>
            {spec.supportsChat ? <JobChip kind="chat" /> : null}
            <JobChip kind="embed" />
          </>
        ) : (
          <JobChip kind="chat-only" />
        )}
      </div>
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
        {fromEnv[spec.id] ? (
          <span className="text-[11px] text-white/40">Đã có key trong .env — để trống ô nếu giữ nguyên.</span>
        ) : null}
      </div>
      <label className="inline-flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={st.enabled !== false}
          onChange={(e) => patchProvider(spec.id, { enabled: e.target.checked })}
        />
        Bật nhà cung cấp này
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
        <div className="rounded-2xl border border-sky-400/25 bg-sky-500/10 p-3">
          <p className="m-0 mb-2 flex items-center gap-2 text-xs font-semibold text-sky-100">
            <JobChip kind="chat" />
            Trả lời câu hỏi & bóc metadata khi số hóa
          </p>
          <label className="block text-xs text-white/70">
            Model chat
            <input
              value={st.chatModel || ''}
              onChange={(e) => patchProvider(spec.id, { chatModel: e.target.value })}
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
            />
          </label>
          {spec.id === 'openrouter' && spec.freeModels?.length ? (
            <div className="mt-2">
              <p className="m-0 mb-1 text-[11px] text-white/45">Model chat miễn phí (bấm để chọn):</p>
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
          <button
            type="button"
            onClick={() => testProvider(spec.id, 'chat')}
            className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs"
          >
            <FlaskConical className="h-3 w-3" />
            Thử chat
          </button>
          {testOut[`${spec.id}:chat`] ? (
            <p className="m-0 mt-2 font-mono text-[11px] text-white/55">chat: {testOut[`${spec.id}:chat`]}</p>
          ) : null}
        </div>
      ) : null}
      {spec.supportsEmbed ? (
        <div className="rounded-2xl border border-violet-400/25 bg-violet-500/10 p-3">
          <p className="m-0 mb-2 flex items-center gap-2 text-xs font-semibold text-violet-100">
            <JobChip kind="embed" />
            Số hóa tài liệu + tìm trong kho — không phải chat
          </p>
          <label className="block text-xs text-white/70">
            Model embedding (vector)
            <input
              value={st.embeddingModel || ''}
              onChange={(e) => patchProvider(spec.id, { embeddingModel: e.target.value })}
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
            />
            <span className="mt-1 block text-[11px] text-white/45">
              ChatGPT / OpenAI text-embedding-3-small = 1536. Gemini gemini-embedding-001 = 768. Mistral
              mistral-embed = 1024. Số chiều phải trùng index Pinecone.
            </span>
          </label>
          <button
            type="button"
            onClick={() => testProvider(spec.id, 'embedding')}
            className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs"
          >
            <FlaskConical className="h-3 w-3" />
            Thử embedding
          </button>
          {testOut[`${spec.id}:embedding`] ? (
            <p className="m-0 mt-2 font-mono text-[11px] text-white/55">
              embed: {testOut[`${spec.id}:embedding`]}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-50">
          <JobChip kind="chat-only" />
          <p className="m-0 mt-1.5">
            <strong>{spec.name}</strong> không tạo vector. Có thể dùng để trả lời, nhưng hệ thống vẫn cần
            thêm OpenAI (1536), Gemini (768) hoặc Mistral (1024) cho embedding + Pinecone.
          </p>
        </div>
      )}
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
    </div>
  )
}

export default function QuantriBrain() {
  const { me } = useOutletContext() || {}
  const [catalog, setCatalog] = useState([])
  const [config, setConfig] = useState(null)
  const [status, setStatus] = useState(null)
  const [ragReady, setRagReady] = useState(false)
  const [fromEnv, setFromEnv] = useState({})
  const [missing, setMissing] = useState([])
  const [embeddingDim, setEmbeddingDim] = useState(null)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const [testOut, setTestOut] = useState({})
  const [openId, setOpenId] = useState('')
  const [draftKeys, setDraftKeys] = useState({})
  const [tab, setTab] = useState('setup')
  const [seen, setSeen] = useState(() => new Set(['setup']))

  const load = useCallback(async () => {
    const res = await adminFetch('/api/quantri/brain')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Không tải được bộ não')
    setCatalog(data.catalog || [])
    setConfig(data.config)
    setStatus(data.status)
    setRagReady(Boolean(data.ragReady))
    setFromEnv(data.fromEnv || {})
    setMissing(Array.isArray(data.missing) ? data.missing : [])
    setEmbeddingDim(data.embeddingDim || null)
    setDraftKeys({})
    adminFetch('/api/quantri/brain/embedding-dim')
      .then(async (dimRes) => {
        const dimData = await dimRes.json().catch(() => ({}))
        if (dimRes.ok && dimData.embeddingDim) setEmbeddingDim(dimData.embeddingDim)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [load])

  const chatIds = useMemo(() => catalog.filter((p) => p.supportsChat).map((p) => p.id), [catalog])
  const embedIds = useMemo(() => catalog.filter((p) => p.supportsEmbed).map((p) => p.id), [catalog])

  function go(id) {
    setTab(id)
    setSeen((cur) => {
      if (cur.has(id)) return cur
      const next = new Set(cur)
      next.add(id)
      return next
    })
  }

  function tabReady(id) {
    if (id === 'setup') return ragReady && embeddingDim?.ok !== false
    if (id === 'chat') return Boolean((status?.chat || []).length)
    if (id === 'embed') {
      return Boolean((status?.embedding || []).length && config?.pinecone?.hasKey && embeddingDim?.ok !== false)
    }
    if (id === 'keys') {
      return catalog.some((p) => {
        const st = config?.providers?.[p.id]
        return st?.hasKey && st.enabled !== false
      })
    }
    return false
  }

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

  function applyRecommendedEmbedding() {
    const rec = embeddingDim?.recommend
    const action = embeddingDim?.action
    const provider = action?.embeddingPrimary || rec?.provider
    if (!provider || !config) return
    const model = action?.embeddingModel || rec?.defaultModel || ''
    setConfig((c) => ({
      ...c,
      embeddingPrimary: provider,
      embeddingFallback: [],
      providers: {
        ...c.providers,
        [provider]: {
          ...(c.providers[provider] || {}),
          embeddingModel: model || c.providers[provider]?.embeddingModel,
          enabled: true,
        },
      },
    }))
    go('embed')
    setOpenId(provider)
    setError('')
    setOk(
      `Đã chọn embedding ${catalog.find((p) => p.id === provider)?.name || provider}` +
        (model ? ` · ${model}` : '') +
        `. Dán API key nhà đó nếu chưa có, rồi Lưu. Không dùng OpenAI/Gemini khác chiều làm dự phòng.`
    )
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
      setMissing(Array.isArray(data.missing) ? data.missing : [])
      setEmbeddingDim(data.embeddingDim || null)
      setDraftKeys({})
      if (data.embeddingDim && data.embeddingDim.ok === false) {
        setOk('')
        setError(
          data.embeddingDim.fixHint ||
            `Đã lưu key nhưng lệch chiều: embedding ${data.embeddingDim.expectedDim} ≠ index Pinecone ${data.embeddingDim.indexDim}. Chọn embedding khớp index rồi Lưu lại.`
        )
      } else {
        setOk('Đã lưu toàn bộ bộ não (mọi tab). Chat và số hóa dùng ngay, không cần restart.')
      }
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
        ? data.mismatch
          ? data.fixHint ||
            `Vector ${data.dims} chiều ≠ index Pinecone ${data.indexDim} — phải giống nhau`
          : `OK · ${data.dims} chiều${data.expectedDim ? ` (model ${data.expectedDim})` : ''}${data.indexDim ? ` · index ${data.indexDim}` : ''}`
        : `OK · ${data.sample || 'phản hồi nhận được'}`
      : data.error || 'Thất bại'
    setTestOut((cur) => ({ ...cur, [`${provider}:${purpose}`]: msg }))
  }

  if (!config) {
    return <p className="p-6 text-sm text-white/60">{error || 'Đang tải bộ não…'}</p>
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 text-slate-100">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 flex items-center gap-2 text-2xl font-semibold">
            <Brain className="h-6 w-6 text-[var(--hcc-gold-bright)]" />
            Bộ não (API / LLM)
          </h1>
          <p className="m-0 mt-1 text-sm text-white/65">
            Hai việc tách nhau: <strong className="text-white">Chat</strong> trả lời câu hỏi,{' '}
            <strong className="text-white">Embedding</strong> tạo vector. Số chiều embedding phải trùng
            Pinecone. Bạn đang dùng ChatGPT → index <strong className="text-white">1536</strong>.
          </p>
        </div>
        <SaveBrainButton busy={busy} onSave={save} />
      </header>

      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <NeedCard
          ok={(status?.chat || []).length > 0}
          title="Chat"
          job="Trả lời câu hỏi, bóc metadata"
          who={
            (status?.chat || []).length
              ? `Đang có: ${(status.chat || []).join(', ')}`
              : 'Cần Gemini / OpenAI / OpenRouter / DeepSeek / Groq…'
          }
          onClick={() => go('chat')}
        />
        <NeedCard
          ok={(status?.embedding || []).length > 0 && embeddingDim?.ok !== false}
          title="Embedding"
          job="Biến văn bản thành vector để tìm"
          who={
            embeddingDim?.ok === false
              ? `Lệch chiều: ${embeddingDim.expectedDim || '?'} ≠ index ${embeddingDim.indexDim} — ${
                  (embeddingDim.recommend?.models || ['đổi embedding cho khớp']).join(' / ')
                }`
              : (status?.embedding || []).length
                ? `Đang có: ${(status.embedding || []).join(', ')}${
                    embeddingDim?.indexDim ? ` · khớp index ${embeddingDim.indexDim}` : ''
                  }`
                : embeddingDim?.indexDim === 1024
                  ? 'Index 1024 → cần Mistral mistral-embed (không dùng OpenAI 1536)'
                  : embeddingDim?.indexDim === 768
                    ? 'Index 768 → cần Gemini gemini-embedding-001'
                    : embeddingDim?.indexDim === 1536
                      ? 'Index 1536 → cần OpenAI text-embedding-3-small'
                      : 'Bắt buộc Gemini (768), Mistral (1024) hoặc OpenAI (1536) — DeepSeek/Groq không được'
          }
          onClick={() => go('embed')}
        />
        <NeedCard
          ok={Boolean(status?.pinecone)}
          title="Pinecone"
          job="Kho chứa vector embedding"
          who={status?.pinecone ? 'Đã có API key' : 'Chưa key / tên index — không phải LLM chat'}
          onClick={() => go('embed')}
        />
      </div>
      <p className="mb-4 text-xs text-white/60">
        {ragReady && embeddingDim?.ok !== false
          ? 'Đủ Chat + Embedding + Pinecone. Tab Cách cài ghi rõ số chiều và model.'
          : `Chưa đủ: ${(missing.length ? missing : ['chat', 'embedding', 'pinecone']).join(', ')}${
              embeddingDim?.ok === false ? ' · lệch chiều embedding/Pinecone' : ''
            }. Bấm thẻ màu vàng phía trên để điền.`}
      </p>

      {embeddingDim?.indexDim ? (
        <div
          className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${
            embeddingDim.ok === false
              ? 'border-rose-400/40 bg-rose-500/15 text-rose-50'
              : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-50'
          }`}
        >
          <p className="m-0 font-medium">
            Index Pinecone đang {embeddingDim.indexDim} chiều
            {embeddingDim.ok === false
              ? ` — embedding hiện tại (${embeddingDim.model || config.embeddingPrimary || '?'}) ra ${
                  embeddingDim.expectedDim || '?'
                } chiều, không ghép được.`
              : ` · đã khớp ${embeddingDim.model || 'model embedding'}.`}
          </p>
          <p className="m-0 mt-1 text-[13px] leading-relaxed text-white/80">
            {embeddingDim.ok === false
              ? embeddingDim.fixHint
              : `Giữ index này thì embedding phải là ${(embeddingDim.recommend?.models || []).join(' / ') || `${embeddingDim.indexDim} chiều`}.`}
          </p>
          {embeddingDim.ok === false && embeddingDim.action?.embeddingPrimary ? (
            <button
              type="button"
              onClick={applyRecommendedEmbedding}
              className="mt-3 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-900"
            >
              Chọn{' '}
              {catalog.find((p) => p.id === embeddingDim.action.embeddingPrimary)?.name ||
                embeddingDim.action.embeddingPrimary}{' '}
              cho khớp {embeddingDim.indexDim} chiều
            </button>
          ) : null}
        </div>
      ) : null}

      <nav className="mb-5 flex flex-wrap gap-1">
        {TABS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => go(s.id)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
              tab === s.id ? 'bg-white text-[var(--hcc-red)]' : 'bg-white/10 text-white/80'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${tabReady(s.id) ? 'bg-emerald-400' : 'bg-white/30'}`}
              aria-hidden
            />
            {s.label}
          </button>
        ))}
      </nav>

      {error ? <p className="mb-3 text-sm text-rose-300">{error}</p> : null}
      {ok ? <p className="mb-3 text-sm text-emerald-200">{ok}</p> : null}

      {seen.has('setup') ? (
        <div hidden={tab !== 'setup'} inert={tab !== 'setup' ? true : undefined}>
          <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <SectionHead
              title="Cách cài — ChatGPT + Pinecone 1536"
              hint="Chỉ cần khớp số chiều. Chat và embedding là hai ô khác nhau; cùng một key OpenAI dùng được cả hai."
              busy={busy}
              onSave={save}
            />
            <ol className="m-0 space-y-3 pl-5 text-sm leading-relaxed text-white/80">
              <li>
                <strong className="text-white">Pinecone:</strong> tạo index{' '}
                <span className="font-mono text-white">1536</span> chiều, metric cosine. Console không có
                chip 1536 → <strong className="text-white">Custom settings</strong>, gõ 1536. Dán key + tên
                index ở tab Embedding.
              </li>
              <li>
                <strong className="text-white">Embedding:</strong> dùng{' '}
                <strong className="text-white">OpenAI text-embedding-3-small</strong> (đúng 1536). Tab Chat →
                Embedding chính = OpenAI. Dán key OpenAI (sk-…) ở tab API key. Không dùng Gemini 768 hay
                Mistral 1024 với index này.
              </li>
              <li>
                <strong className="text-white">Chat:</strong> chọn nhà trả lời (OpenAI cùng key, hoặc Gemini /
                DeepSeek / Groq…). Chat không cần trùng số chiều. Gói ChatGPT Plus trên chatgpt.com không
                phải API — phải lấy key tại platform.openai.com.
              </li>
            </ol>
            <div className="mt-4 overflow-x-auto rounded-xl border border-white/10 text-[11px]">
              <table className="w-full border-collapse text-left text-white/75">
                <thead className="bg-white/5 text-white/50">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Số chiều</th>
                    <th className="px-2 py-1.5 font-medium">Dùng cái gì</th>
                    <th className="px-2 py-1.5 font-medium">Model embedding</th>
                  </tr>
                </thead>
                <tbody>
                  {EMBED_RECIPES.map((row) => {
                    const yours = row.dim === embeddingDim?.indexDim
                    return (
                      <tr
                        key={row.dim}
                        className={`border-t border-white/10 ${yours ? 'bg-amber-400/10 text-white' : ''}`}
                      >
                        <td className="px-2 py-2 font-mono text-white">
                          {row.dim}
                          {yours ? (
                            <span className="ml-1.5 rounded-full bg-amber-400/25 px-1.5 py-0.5 text-[10px] text-amber-50">
                              index của bạn
                            </span>
                          ) : row.dim === 1536 ? (
                            <span className="ml-1.5 rounded-full bg-sky-400/20 px-1.5 py-0.5 text-[10px] text-sky-100">
                              ChatGPT
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-2">{row.use}</td>
                        <td className="px-2 py-2">
                          <span className="font-mono text-[11px] text-white">{row.model}</span>
                          <div className="mt-0.5 text-white/45">{row.pinecone}</div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="m-0 mt-3 text-xs text-white/50">
              Đổi số chiều hoặc model embedding so với kho cũ thì phải số hóa lại tài liệu. Đổi Chat thì
              không cần.
            </p>
          </section>
        </div>
      ) : null}

      {seen.has('chat') ? (
        <div hidden={tab !== 'chat'} inert={tab !== 'chat' ? true : undefined}>
          <section className="rounded-3xl border border-sky-400/25 bg-sky-500/10 p-4">
            <SectionHead
              title="Chat — trả lời câu hỏi"
              hint="Không tạo vector. Có thể OpenAI, Gemini, DeepSeek, Groq… Dán key ở tab API key."
              busy={busy}
              onSave={save}
            />
            <label className="text-xs text-white/70">
              Chat chính
              <select
                value={config.chatPrimary}
                onChange={(e) => setConfig((c) => ({ ...c, chatPrimary: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-2 py-2 text-sm"
              >
                {chatIds.map((id) => (
                  <option key={id} value={id}>
                    {catalog.find((p) => p.id === id)?.name}
                    {catalog.find((p) => p.id === id)?.supportsEmbed ? '' : ' · chỉ chat'}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-2 block text-xs text-white/70">
              Chat dự phòng (hết quota thì thử tiếp)
              <input
                value={csv(config.chatFallback)}
                onChange={(e) => setConfig((c) => ({ ...c, chatFallback: parseCsv(e.target.value) }))}
                placeholder="groq, openai…"
                className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-2 py-1.5 text-[11px]"
              />
            </label>
            <label className="mt-3 block text-xs text-white/70">
              Extract (bóc số hiệu, cơ quan…) — cũng là chat, không phải embedding
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
            </label>
            <input
              value={csv(config.extractFallback)}
              onChange={(e) => setConfig((c) => ({ ...c, extractFallback: parseCsv(e.target.value) }))}
              placeholder="fallback extract"
              className="mt-2 w-full rounded-xl border border-white/15 bg-black/20 px-2 py-1.5 text-[11px]"
            />
          </section>
        </div>
      ) : null}

      {seen.has('embed') ? (
        <div hidden={tab !== 'embed'} inert={tab !== 'embed' ? true : undefined}>
          <section className="rounded-3xl border border-violet-400/25 bg-violet-500/10 p-4">
            <SectionHead
              title="Embedding + Pinecone"
              hint="Số trên Pinecone = model embedding. Index 1536 → OpenAI text-embedding-3-small."
              busy={busy}
              onSave={save}
            />
            <div className="mb-4 grid gap-2 sm:grid-cols-3">
              {EMBED_RECIPES.map((row) => {
                const yours = row.dim === embeddingDim?.indexDim
                return (
                  <button
                    key={row.dim}
                    type="button"
                    onClick={() => {
                      setConfig((c) => ({
                        ...c,
                        embeddingPrimary: row.provider,
                        embeddingFallback: [],
                        providers: {
                          ...c.providers,
                          [row.provider]: {
                            ...(c.providers[row.provider] || {}),
                            embeddingModel: row.model,
                            enabled: true,
                          },
                        },
                      }))
                      setOpenId(row.provider)
                      go('keys')
                      setOk(`Đã chọn embedding ${row.use} · ${row.model} (${row.dim} chiều). Dán API key rồi Lưu.`)
                    }}
                    className={`rounded-2xl border px-3 py-2.5 text-left text-xs ${
                      yours
                        ? 'border-amber-300/50 bg-amber-400/15 text-white'
                        : 'border-white/15 bg-black/20 text-white/75'
                    }`}
                  >
                    <p className="m-0 font-mono text-lg font-semibold text-white">{row.dim}</p>
                    <p className="m-0 mt-1 font-medium text-white">{row.use}</p>
                    <p className="m-0 mt-0.5 font-mono text-[11px] text-violet-100">{row.model}</p>
                    <p className="m-0 mt-1 text-[11px] text-white/45">{row.pinecone}</p>
                  </button>
                )
              })}
            </div>
            {embeddingDim?.ok === false ? (
              <div className="mb-3 rounded-xl bg-rose-500/20 px-3 py-2 text-xs text-rose-50">
                <p className="m-0">{embeddingDim.fixHint}</p>
                {embeddingDim.action?.embeddingPrimary ? (
                  <button
                    type="button"
                    onClick={applyRecommendedEmbedding}
                    className="mt-2 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-900"
                  >
                    Chọn nhà khớp index {embeddingDim.indexDim}
                  </button>
                ) : null}
              </div>
            ) : null}
            <label className="text-xs text-white/70">
              Embedding chính
              {embeddingDim?.indexDim ? ` · index đang ${embeddingDim.indexDim} chiều` : ''}
              <select
                value={config.embeddingPrimary}
                onChange={(e) => setConfig((c) => ({ ...c, embeddingPrimary: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-2 py-2 text-sm"
              >
                {embedIds.map((id) => (
                  <option key={id} value={id}>
                    {catalog.find((p) => p.id === id)?.name}
                    {embeddingDim?.recommend?.provider === id
                      ? ` · khớp index ${embeddingDim.indexDim}`
                      : ''}
                  </option>
                ))}
              </select>
            </label>
            <p className="m-0 mt-2 text-[11px] text-white/50">
              DeepSeek / Groq không embed. Embedding dự phòng chỉ dùng khi cùng số chiều — để trống nếu
              chỉ OpenAI 1536.
            </p>
            <label className="mt-2 block text-xs text-white/70">
              Embedding dự phòng (cùng số chiều, thường để trống)
              <input
                value={csv(config.embeddingFallback)}
                onChange={(e) => setConfig((c) => ({ ...c, embeddingFallback: parseCsv(e.target.value) }))}
                placeholder="để trống"
                className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-2 py-1.5 text-[11px]"
              />
            </label>
            {fromEnv.pinecone ? (
              <p className="mt-3 mb-0 text-[11px] text-white/45">
                Đã có key Pinecone trong .env — để trống ô key nếu giữ nguyên.
              </p>
            ) : null}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-white/60">
                API key Pinecone {config.pinecone?.hasKey ? `(${config.pinecone.apiKeyHint})` : ''}
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
                Tên index
                {embeddingDim?.indexDim ? ` (${embeddingDim.indexDim} chiều)` : ''}
                <input
                  value={config.pinecone?.indexName || ''}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, pinecone: { ...c.pinecone, indexName: e.target.value } }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="text-xs text-white/60 sm:col-span-2">
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
        </div>
      ) : null}

      {seen.has('keys') ? (
        <div hidden={tab !== 'keys'} inert={tab !== 'keys' ? true : undefined}>
          <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <SectionHead
              title="API key"
              hint="Dán key developer. Gói ChatGPT Plus / Gemini Advanced trên web không dùng được. Một key OpenAI dùng được cả Chat lẫn Embedding."
              busy={busy}
              onSave={save}
            />
            <p className="m-0 mb-3 text-xs text-white/50">
              Lấy key:{' '}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-[var(--hcc-gold-bright)] underline">
                OpenAI
              </a>
              {' · '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-[var(--hcc-gold-bright)] underline">
                Gemini
              </a>
              {' · '}
              <a href="https://console.mistral.ai/api-keys" target="_blank" rel="noreferrer" className="text-[var(--hcc-gold-bright)] underline">
                Mistral
              </a>
              {' · '}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-[var(--hcc-gold-bright)] underline">
                OpenRouter
              </a>
            </p>
            <div className="space-y-2">
              {catalog.map((spec) => {
                const st = config.providers[spec.id] || {}
                const open = openId === spec.id
                return (
                  <div key={spec.id} className="rounded-2xl border border-white/10 bg-black/20">
                    <button
                      type="button"
                      onClick={() => setOpenId(open ? '' : spec.id)}
                      className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left"
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${st.hasKey && st.enabled !== false ? 'bg-emerald-400' : 'bg-white/25'}`}
                      />
                      <span className="font-medium">{spec.name}</span>
                      <span className="flex flex-wrap items-center gap-1">
                        {spec.supportsEmbed ? (
                          <>
                            {spec.supportsChat ? <JobChip kind="chat" /> : null}
                            <JobChip kind="embed" />
                          </>
                        ) : (
                          <JobChip kind="chat-only" />
                        )}
                      </span>
                      <span className="text-[11px] text-white/40">
                        {fromEnv[spec.id] ? '.env · ' : ''}
                        {st.hasKey ? st.apiKeyHint : 'chưa key'}
                      </span>
                    </button>
                    {open ? (
                      <div className="border-t border-white/10 px-3 py-3">
                        <ProviderFields
                          spec={spec}
                          st={st}
                          fromEnv={fromEnv}
                          draftKeys={draftKeys}
                          setDraftKeys={setDraftKeys}
                          patchProvider={patchProvider}
                          testProvider={testProvider}
                          testOut={testOut}
                        />
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
