import { FileText, ExternalLink } from 'lucide-react'

/**
 * Citation Chip — đỏ–vàng HCC.
 */
export default function CitationChip({ href, children, className = '' }) {
  const label = typeof children === 'string' ? children : flattenText(children)

  if (!href || href === '#') {
    return <span className="text-[var(--hcc-muted)]">{label}</span>
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={href}
      className={`citation-chip inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-[var(--hcc-gold)]/50 bg-[linear-gradient(135deg,#fff9e6,#fff)] px-2.5 py-1 text-[13px] font-medium text-[var(--hcc-red-deep)] no-underline shadow-sm transition duration-200 hover:border-[var(--hcc-gold)] hover:shadow-[var(--shadow-gold)] align-middle ${className}`}
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--hcc-red)]" aria-hidden="true" strokeWidth={2} />
      <span className="truncate">{label || 'Tài liệu'}</span>
      <ExternalLink className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
    </a>
  )
}

function flattenText(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join('')
  if (node?.props?.children) return flattenText(node.props.children)
  return ''
}
