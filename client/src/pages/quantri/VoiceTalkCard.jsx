import { useCallback, useEffect, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { adminFetch } from '../../lib/adminApi'

const FALLBACK = {
  enabled: false,
  autoSpeak: true,
  preferFastChat: true,
  lang: 'vi-VN',
  rate: 1.05,
}

/**
 * Công tắc Voice chat — khi tắt, trang tra cứu chỉ còn chat chữ.
 */
export default function VoiceTalkCard({ showAdvanced = true }) {
  const [talk, setTalk] = useState(FALLBACK)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const res = await adminFetch('/api/quantri/voice-talk')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Không tải được Voice chat')
    setTalk({
      ...FALLBACK,
      ...(data.talk && typeof data.talk === 'object' ? data.talk : {}),
      enabled: (data.talk || data).enabled === true,
    })
    setLoaded(true)
  }, [])

  useEffect(() => {
    load().catch((e) => {
      setError(e.message)
      setTalk(FALLBACK)
      setLoaded(true)
    })
  }, [load])

  async function saveTalk(next) {
    setBusy(true)
    setError('')
    setOk('')
    try {
      const res = await adminFetch('/api/quantri/voice-talk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Không lưu được Voice chat')
      const raw = data.talk && typeof data.talk === 'object' ? data.talk : next
      const saved = { ...FALLBACK, ...raw, enabled: raw.enabled === true }
      setTalk(saved)
      setOk(
        saved.enabled
          ? 'Đã bật Voice chat trên trang tra cứu (mic + đọc thoại).'
          : 'Đã tắt Voice chat. Người dùng chỉ chat chữ.'
      )
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 flex items-center gap-2 text-base font-semibold">
            {talk.enabled ? (
              <Mic className="h-4 w-4 text-emerald-300" />
            ) : (
              <MicOff className="h-4 w-4 text-white/50" />
            )}
            Voice chat
          </h2>
          <p className="m-0 mt-1 text-xs text-white/55">
            Mặc định <strong>tắt</strong>: trang tra cứu chỉ nhập chữ và gửi. Bật thì hiện mic và đọc
            câu trả lời (Chrome/Edge, HTTPS hoặc localhost, cần cho phép micro).
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            role="switch"
            aria-checked={talk.enabled}
            aria-label={talk.enabled ? 'Tắt Voice chat' : 'Bật Voice chat'}
            disabled={busy || !loaded}
            onClick={() => saveTalk({ ...talk, enabled: !talk.enabled })}
            className={`relative h-7 w-12 rounded-full transition ${
              talk.enabled ? 'bg-emerald-500' : 'bg-white/20'
            }`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${
                talk.enabled ? 'left-5' : 'left-0.5'
              }`}
            />
          </button>
          <span
            className={`text-[11px] font-semibold ${
              talk.enabled ? 'text-emerald-200' : 'text-white/50'
            }`}
          >
            {talk.enabled ? 'Đang bật' : 'Đang tắt · chỉ chat chữ'}
          </span>
        </div>
      </div>

      {showAdvanced ? (
        <div className={`mt-4 grid gap-3 sm:grid-cols-2 ${talk.enabled ? '' : 'pointer-events-none opacity-40'}`}>
          <label className="flex items-center justify-between gap-2 text-sm text-white/75">
            Tự đọc câu trả lời
            <input
              type="checkbox"
              checked={talk.autoSpeak}
              disabled={!talk.enabled}
              onChange={(e) => setTalk((t) => ({ ...t, autoSpeak: e.target.checked }))}
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-sm text-white/75">
            Ưu tiên AI nhanh (Groq → Gemini → …)
            <input
              type="checkbox"
              checked={talk.preferFastChat}
              disabled={!talk.enabled}
              onChange={(e) => setTalk((t) => ({ ...t, preferFastChat: e.target.checked }))}
            />
          </label>
          <label className="text-xs text-white/60">
            Ngôn ngữ TTS / mic
            <input
              value={talk.lang}
              disabled={!talk.enabled}
              onChange={(e) => setTalk((t) => ({ ...t, lang: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-white/60">
            Tốc độ đọc ({talk.rate})
            <input
              type="range"
              min="0.7"
              max="1.4"
              step="0.05"
              value={talk.rate}
              disabled={!talk.enabled}
              onChange={(e) => setTalk((t) => ({ ...t, rate: Number(e.target.value) }))}
              className="mt-2 w-full"
            />
          </label>
          <button
            type="button"
            disabled={busy || !talk.enabled}
            onClick={() => saveTalk(talk)}
            className="rounded-xl bg-white/10 px-3 py-2 text-xs disabled:opacity-40 sm:col-span-2"
          >
            Lưu cài đặt giọng nói
          </button>
        </div>
      ) : null}

      {error ? <p className="m-0 mt-2 text-xs text-rose-300">{error}</p> : null}
      {ok ? <p className="m-0 mt-2 text-xs text-emerald-200">{ok}</p> : null}
    </section>
  )
}
