import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Brain, ExternalLink, FlaskConical, Save } from 'lucide-react'
import { adminFetch } from '../../lib/adminApi'

const FEATURED_PROVIDER_IDS = ['gemini', 'openai', 'openrouter', 'deepseek']

const TABS = [
  { id: 'pinecone', label: 'Pinecone · kho embed' },
  { id: 'roles', label: 'Chọn Chat / Embedding' },
  { id: 'gemini', label: 'Gemini · chat+embed' },
  { id: 'openai', label: 'OpenAI · chat+embed' },
  { id: 'openrouter', label: 'OpenRouter · chat+embed' },
  { id: 'deepseek', label: 'DeepSeek · chỉ chat' },
  { id: 'others', label: 'Chat khác' },
  { id: 'goichat', label: 'Gói web ≠ API' },
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
              Gemini text-embedding-004 = 768 (chip Pinecone 768). OpenAI text-embedding-3-small = 1536.
              Phải trùng chiều index.
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
            thêm Gemini / OpenAI / OpenRouter cho embedding (tab tương ứng + Pinecone).
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
  const [tab, setTab] = useState('pinecone')
  const [seen, setSeen] = useState(() => new Set(['pinecone']))

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
  const otherSpecs = useMemo(
    () => catalog.filter((p) => !FEATURED_PROVIDER_IDS.includes(p.id)),
    [catalog]
  )

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
    if (id === 'pinecone') return Boolean(config?.pinecone?.hasKey)
    if (id === 'roles') return ragReady
    if (id === 'others') {
      return otherSpecs.some((p) => {
        const st = config?.providers?.[p.id]
        return st?.hasKey && st.enabled !== false
      })
    }
    if (id === 'goichat') return false
    const st = config?.providers?.[id]
    return Boolean(st?.hasKey && st.enabled !== false)
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
      setOk('Đã lưu toàn bộ bộ não (mọi tab). Chat và số hóa dùng ngay, không cần restart.')
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
          ? `Vector ${data.dims} chiều ≠ index Pinecone ${data.indexDim} — phải giống nhau`
          : `OK · ${data.dims} chiều${data.expectedDim ? ` (model ${data.expectedDim})` : ''}${data.indexDim ? ` · index ${data.indexDim}` : ''}`
        : `OK · ${data.sample || 'phản hồi nhận được'}`
      : data.error || 'Thất bại'
    setTestOut((cur) => ({ ...cur, [`${provider}:${purpose}`]: msg }))
  }

  function renderProviderTab(id) {
    const spec = catalog.find((p) => p.id === id)
    if (!spec || !config) return null
    const st = config.providers[id] || {}
    return (
      <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
        <SectionHead
          title={spec.name}
          hint={
            spec.supportsEmbed
              ? 'Một key dùng được cả Chat (khung xanh) và Embedding (khung tím). Hai việc khác nhau — đừng nhầm model chat với model vector.'
              : 'Chỉ Chat. Không dùng nhà này cho số hóa / tìm trong kho — cần thêm Gemini hoặc OpenAI embedding.'
          }
          busy={busy}
          onSave={save}
        />
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
      </section>
    )
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
            Cần đủ <strong className="text-white">3 phần khác nhau</strong>: Chat (trả lời) ≠ Embedding
            (tạo vector) ≠ Pinecone (kho vector). Chat không thay được embedding.
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
          onClick={() => {
            const id = (status?.chat || [])[0]
            if (FEATURED_PROVIDER_IDS.includes(id)) go(id)
            else if (id) go('others')
            else go('deepseek')
          }}
        />
        <NeedCard
          ok={(status?.embedding || []).length > 0}
          title="Embedding"
          job="Biến văn bản thành vector để tìm"
          who={
            (status?.embedding || []).length
              ? `Đang có: ${(status.embedding || []).join(', ')}`
              : 'Bắt buộc Gemini, OpenAI hoặc OpenRouter — DeepSeek/Groq không được'
          }
          onClick={() => {
            const id = (status?.embedding || [])[0]
            if (FEATURED_PROVIDER_IDS.includes(id)) go(id)
            else if (id) go('others')
            else go('gemini')
          }}
        />
        <NeedCard
          ok={Boolean(status?.pinecone)}
          title="Pinecone"
          job="Kho chứa vector embedding"
          who={status?.pinecone ? 'Đã có API key' : 'Chưa key / tên index — không phải LLM chat'}
          onClick={() => go('pinecone')}
        />
      </div>
      <p className="mb-4 text-xs text-white/60">
        {ragReady
          ? 'Đủ 3 phần. Tab «Chọn Chat / Embedding» quyết định nhà nào trả lời và nhà nào tạo vector.'
          : `Chưa đủ: ${(missing.length ? missing : ['chat', 'embedding', 'pinecone']).join(', ')}. Bấm thẻ màu vàng phía trên để điền.`}
      </p>

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
            {s.id !== 'goichat' && s.id !== 'roles' ? (
              <span
                className={`h-1.5 w-1.5 rounded-full ${tabReady(s.id) ? 'bg-emerald-400' : 'bg-white/30'}`}
                aria-hidden
              />
            ) : null}
            {s.label}
          </button>
        ))}
      </nav>

      {error ? <p className="mb-3 text-sm text-rose-300">{error}</p> : null}
      {ok ? <p className="mb-3 text-sm text-emerald-200">{ok}</p> : null}

      {seen.has('pinecone') ? (
        <div hidden={tab !== 'pinecone'} inert={tab !== 'pinecone' ? true : undefined}>
          <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <SectionHead
              title="Kho embedding — Pinecone"
              hint="Đây không phải Chat. Pinecone chỉ lưu vector do model embedding tạo ra. Chiều index phải trùng model embedding."
              busy={busy}
              onSave={save}
            />
            <div className="mb-3 overflow-x-auto rounded-xl border border-white/10 text-[11px]">
              <table className="w-full border-collapse text-left text-white/75">
                <thead className="bg-white/5 text-white/50">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Index Pinecone</th>
                    <th className="px-2 py-1.5 font-medium">Embedding trên /quantri</th>
                  </tr>
                </thead>
                <tbody>
                  {(embeddingDim?.pairings || [
                    {
                      dim: 768,
                      recommended: true,
                      pineconeUi: 'Chip 768 có sẵn',
                      models: ['Gemini text-embedding-004'],
                    },
                    {
                      dim: 1536,
                      recommended: false,
                      pineconeUi: 'Custom settings, gõ 1536',
                      models: ['OpenAI text-embedding-3-small'],
                    },
                  ]).map((row) => (
                    <tr key={row.dim} className="border-t border-white/10">
                      <td className="px-2 py-1.5 align-top">
                        <span className="font-mono text-white">{row.dim}</span>
                        {row.recommended ? (
                          <span className="ml-1.5 rounded-full bg-emerald-400/20 px-1.5 py-0.5 text-[10px] text-emerald-100">
                            nên dùng
                          </span>
                        ) : null}
                        <div className="mt-0.5 text-white/45">{row.pineconeUi}</div>
                      </td>
                      <td className="px-2 py-1.5">{(row.models || []).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {embeddingDim?.indexDim && embeddingDim.recommend ? (
              <p className="mb-3 rounded-xl bg-amber-500/15 px-3 py-2 text-xs text-amber-50">
                Index đang là {embeddingDim.indexDim} chiều → embedding phải là{' '}
                {(embeddingDim.recommend.models || []).join(' / ')}. Tab «Vai trò» chọn đúng nhà cung
                cấp đó rồi Lưu.
              </p>
            ) : null}
            {embeddingDim && embeddingDim.ok === false ? (
              <p className="mb-3 rounded-xl bg-rose-500/20 px-3 py-2 text-xs text-rose-100">
                Lệch chiều: model {embeddingDim.model || 'embedding'} = {embeddingDim.expectedDim}{' '}
                chiều, index Pinecone = {embeddingDim.indexDim} chiều. Đổi embedding cho khớp, hoặc
                tạo index mới rồi số hóa lại toàn bộ.
              </p>
            ) : null}
            {fromEnv.pinecone ? (
              <p className="mb-3 text-[11px] text-white/45">
                Đã có key Pinecone trong .env — để trống ô key nếu giữ nguyên.
              </p>
            ) : null}
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
                {embeddingDim?.indexDim ? ` (${embeddingDim.indexDim} chiều)` : ''}
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
        </div>
      ) : null}

      {seen.has('roles') ? (
        <div hidden={tab !== 'roles'} inert={tab !== 'roles' ? true : undefined}>
          <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <SectionHead
              title="Chọn ai Chat / ai Embedding"
              hint="Hai ô này độc lập. Chat = trả lời. Embedding = tạo vector (danh sách dưới chỉ nhà có embed — không có DeepSeek/Groq)."
              busy={busy}
              onSave={save}
            />
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-sky-400/25 bg-sky-500/10 p-4">
                <p className="m-0 mb-1 flex items-center gap-2 text-sm font-semibold text-white">
                  <JobChip kind="chat" />
                  Trả lời & bóc metadata
                </p>
                <p className="m-0 mb-3 text-[11px] text-white/50">
                  Câu hỏi người dùng + extract khi số hóa. Có thể DeepSeek/Groq. Không dùng ô này để tạo
                  vector.
                </p>
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
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, extractFallback: parseCsv(e.target.value) }))
                  }
                  placeholder="fallback extract"
                  className="mt-2 w-full rounded-xl border border-white/15 bg-black/20 px-2 py-1.5 text-[11px]"
                />
              </div>
              <div className="rounded-2xl border border-violet-400/25 bg-violet-500/10 p-4">
                <p className="m-0 mb-1 flex items-center gap-2 text-sm font-semibold text-white">
                  <JobChip kind="embed" />
                  Tạo vector (số hóa + tìm)
                </p>
                <p className="m-0 mb-3 text-[11px] text-white/50">
                  Bắt buộc. Khớp chiều Pinecone. Nên một model cố định — đổi model phải số hóa lại.
                </p>
                <label className="text-xs text-white/70">
                  Embedding chính
                  {embeddingDim?.expectedDim ? ` · ${embeddingDim.expectedDim} chiều` : ''}
                  <select
                    value={config.embeddingPrimary}
                    onChange={(e) => setConfig((c) => ({ ...c, embeddingPrimary: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-2 py-2 text-sm"
                  >
                    {embedIds.map((id) => (
                      <option key={id} value={id}>
                        {catalog.find((p) => p.id === id)?.name} · có embedding
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-2 block text-xs text-white/70">
                  Embedding dự phòng (cùng số chiều)
                  <input
                    value={csv(config.embeddingFallback)}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, embeddingFallback: parseCsv(e.target.value) }))
                    }
                    placeholder="openai, gemini…"
                    className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-2 py-1.5 text-[11px]"
                  />
                </label>
                <p className="m-0 mt-3 rounded-xl bg-black/20 px-2 py-2 text-[11px] text-violet-50/90">
                  Không có DeepSeek / Groq / xAI / Fireworks trong danh sách này vì chúng không embed.
                  {embeddingDim?.indexDim
                    ? ` Index Pinecone hiện ${embeddingDim.indexDim} chiều.`
                    : ''}
                </p>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {FEATURED_PROVIDER_IDS.filter((id) => seen.has(id)).map((id) => (
        <div key={id} hidden={tab !== id} inert={tab !== id ? true : undefined}>
          {renderProviderTab(id)}
        </div>
      ))}

      {seen.has('others') ? (
        <div hidden={tab !== 'others'} inert={tab !== 'others' ? true : undefined}>
          <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <SectionHead
              title="Chat khác"
              hint="Hầu hết chỉ Chat. Mistral/Together/custom mới có embedding — xem nhãn trên từng dòng."
              busy={busy}
              onSave={save}
            />
            <div className="space-y-2">
              {otherSpecs.map((spec) => {
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

      {seen.has('goichat') ? (
        <div hidden={tab !== 'goichat'} inert={tab !== 'goichat' ? true : undefined}>
          <section className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm leading-relaxed text-white/75">
            <h2 className="m-0 text-base font-semibold text-white">Không đăng nhập gói ChatGPT / Gemini web</h2>
            <p className="mt-2 mb-3">
              <strong className="text-white">Không làm được</strong> nút «Kết nối tài khoản đã mua Plus /
              Advanced / Pro». Những gói đó là chat trên trình duyệt, OpenAI / Google / Anthropic{' '}
              <strong className="text-white">không cấp API</strong> từ mật khẩu web. Lách cookie hoặc giả
              trình duyệt là trái điều khoản và dễ gãy.
            </p>
            <p className="mb-3">
              Cách đúng: tạo <strong className="text-white">API key</strong> trên trang developer. Một key
              Gemini/OpenAI dùng được <strong className="text-white">cả Chat lẫn Embedding</strong> (hai
              model khác nhau trên cùng key). DeepSeek chỉ Chat.
            </p>
            <ul className="mb-0 space-y-2 pl-4">
              <li>
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--hcc-gold-bright)] underline"
                >
                  Gemini — Google AI Studio
                </a>
                {' · '}
                embedding 768 chiều, khớp chip Pinecone 768. Gemini Advanced trên gemini.google.com không
                dùng được.
              </li>
              <li>
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--hcc-gold-bright)] underline"
                >
                  OpenAI — platform.openai.com
                </a>
                {' · '}
                ChatGPT Plus trên chatgpt.com không phải API.
              </li>
              <li>
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--hcc-gold-bright)] underline"
                >
                  OpenRouter
                </a>
                {' · '}
                một key, nhiều model, có tầng <code className="text-[11px]">:free</code>.
              </li>
              <li>
                Google Antigravity dùng cùng key Gemini nhưng là agent code/web — app này chỉ gọi Gemini
                Flash (`gemini-3.6-flash`) để trả lời văn bản.
              </li>
              <li>
                Đổi <strong className="text-white">embedding</strong> (model/vector) lệch kho cũ — phải số
                hóa lại tài liệu. Chat/extract đổi tự do.
              </li>
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  )
}
