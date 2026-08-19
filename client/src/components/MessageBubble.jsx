import { lazy, Suspense } from 'react'
import { CheckCircle2, Copy, ShieldAlert, ShieldCheck, ThumbsDown, ThumbsUp } from 'lucide-react'
import { User } from 'lucide-react'
import CitationChip from './CitationChip'
import { ChatWait } from './WaitMotion'
import logoVietmy from '../assets/logo-vietmy.png'
import { extraSourceChips } from '../lib/sources'
import { isExpired } from '../lib/docStatus'

const MarkdownBody = lazy(() => import('./MarkdownBody'))

/**
 * MessageBubble — hiển thị độ tin cậy + copy nhanh.
 */
export default function MessageBubble({
  role,
  content,
  streaming,
  sources = [],
  confidence,
  qaMode,
  statusText = '',
  logId,
  feedback,
  onFeedback,
}) {
  const isUser = role === 'user'
  const markdownBody = content?.length ? content : streaming ? ' ' : ''
  const conf = confidence || {
    level: sources?.length >= 2 ? 'high' : sources?.length === 1 ? 'medium' : 'low',
    label:
      sources?.length >= 2
        ? 'Độ tin cậy cao'
        : sources?.length === 1
          ? 'Có căn cứ pháp lý'
          : streaming
            ? 'Đang kiểm chứng…'
            : 'Chưa có căn cứ trong kho',
    sources: sources?.length || 0,
  }
  const extraChips = !isUser && !streaming ? extraSourceChips(content, sources) : []

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(content || '')
    } catch {
      // ignore
    }
  }

  return (
    <div
      className={`msg-enter flex w-full gap-2 sm:gap-3 ${
        isUser ? 'flex-row-reverse' : 'flex-row'
      }`}
    >
      {isUser ? (
        <div
          className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--hcc-red)] text-white shadow-sm sm:h-8 sm:w-8`}
          aria-hidden="true"
        >
          <User className="h-4 w-4" />
        </div>
      ) : (
        <img
          src={logoVietmy}
          alt=""
          width={32}
          height={32}
          className="mt-1 h-7 w-7 shrink-0 rounded-md bg-[#0a1628] object-contain p-0.5 sm:h-8 sm:w-8"
          aria-hidden="true"
        />
      )}

      <div
        className={`max-w-[min(100%,42rem)] rounded-2xl px-3 py-2.5 text-left text-[15px] leading-relaxed sm:px-4 sm:py-3 xl:max-w-[min(100%,48rem)] 2xl:max-w-[min(100%,52rem)] ${
          isUser
            ? 'rounded-tr-md bg-[var(--hcc-red)] text-white shadow-[var(--shadow-md)]'
            : 'glass-panel rounded-tl-md text-slate-100'
        }`}
      >
        {isUser ? (
          <p className="m-0 whitespace-pre-wrap">{content}</p>
        ) : (
          <>
            {!streaming && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    conf.level === 'high'
                      ? 'bg-emerald-500/20 text-emerald-200'
                      : conf.level === 'medium'
                        ? 'bg-amber-500/20 text-amber-200'
                        : 'bg-[var(--hcc-red-soft)] text-rose-200'
                  }`}
                >
                  {conf.level === 'low' ? (
                    <ShieldAlert className="h-3 w-3" />
                  ) : (
                    <ShieldCheck className="h-3 w-3" />
                  )}
                  {conf.label}
                  {conf.sources > 0 ? ` · ${conf.sources} nguồn` : ''}
                </span>
                {qaMode && (
                  <span className="rounded-full bg-[var(--hcc-canvas)] px-2 py-0.5 text-[11px] text-[var(--hcc-muted)]">
                    {qaMode === 'advise' ? 'Tư vấn' : qaMode === 'compare' ? 'So sánh' : 'Tra cứu'}
                  </span>
                )}
              </div>
            )}

            {streaming && !String(content || '').trim() ? (
              <ChatWait statusText={statusText} compact />
            ) : null}

            {streaming && !String(content || '').trim() ? null : (
            <Suspense
              fallback={
                <div className="prose-chat whitespace-pre-wrap text-slate-100">{markdownBody}</div>
              }
            >
              <MarkdownBody streaming={streaming}>{markdownBody}</MarkdownBody>
            </Suspense>
            )}

            {!streaming && extraChips.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {extraChips.map((c) => (
                  <CitationChip
                    key={`${c.title}::${c.url}`}
                    href={c.url}
                    status={c.trang_thai}
                  >
                    {[c.title, c.dieu ? `Đ.${c.dieu}` : '', isExpired(c.trang_thai) ? c.trang_thai : ''].filter(Boolean).join(' · ')}
                  </CitationChip>
                ))}
              </div>
            )}

            {!streaming && content && (
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--hcc-line)]/70 pt-2">
                <button
                  type="button"
                  onClick={copyAnswer}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-[var(--hcc-muted)] hover:bg-white/10 hover:text-[var(--hcc-gold-bright)]"
                >
                  <Copy className="h-3 w-3" />
                  Sao chép
                </button>
                {logId && onFeedback ? (
                  <>
                    <button
                      type="button"
                      aria-label="Hữu ích"
                      aria-pressed={feedback === 'up'}
                      onClick={() => onFeedback(logId, 'up')}
                      className={`inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition ${
                        feedback === 'up'
                          ? 'bg-emerald-500/20 text-emerald-200'
                          : 'text-[var(--hcc-muted)] hover:bg-white/10 hover:text-emerald-200'
                      }`}
                    >
                      <ThumbsUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label="Chưa đúng"
                      aria-pressed={feedback === 'down'}
                      onClick={() => onFeedback(logId, 'down')}
                      className={`inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition ${
                        feedback === 'down'
                          ? 'bg-rose-500/20 text-rose-200'
                          : 'text-[var(--hcc-muted)] hover:bg-white/10 hover:text-rose-200'
                      }`}
                    >
                      <ThumbsDown className="h-3 w-3" />
                    </button>
                  </>
                ) : null}
                {conf.level !== 'low' && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" />
                    Có trích dẫn
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
