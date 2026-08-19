import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import CitationChip from './CitationChip'

export default function MarkdownBody({ children, streaming = false }) {
  return (
    <div className="prose-chat [&_table]:w-full [&_table]:text-sm [&_th]:border [&_th]:border-[var(--hcc-line)] [&_th]:bg-[var(--hcc-red-soft)] [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-[var(--hcc-line)] [&_td]:px-2 [&_td]:py-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => <CitationChip href={href}>{children}</CitationChip>,
          p: ({ children }) => (
            <p className="mb-2 last:mb-0 leading-relaxed [&_.citation-chip]:my-1">{children}</p>
          ),
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
          strong: ({ children }) => (
            <strong className="font-semibold text-[var(--hcc-gold-bright)]">{children}</strong>
          ),
          code: ({ children, className }) => {
            const isBlock = Boolean(className)
            if (isBlock) {
              return (
                <code className="mb-2 block overflow-x-auto rounded-lg bg-[var(--hcc-canvas)] p-3 text-[0.85em]">
                  {children}
                </code>
              )
            }
            return (
              <code className="rounded bg-[var(--hcc-red-soft)] px-1 py-0.5 text-[0.9em] text-rose-200">
                {children}
              </code>
            )
          },
        }}
      >
        {children}
      </ReactMarkdown>
      {streaming && String(children || '').trim() ? (
        <span
          className="ml-0.5 inline-block h-4 w-1.5 animate-pulse align-middle bg-[var(--hcc-gold)]"
          aria-label="Đang trả lời"
        />
      ) : null}
    </div>
  )
}
