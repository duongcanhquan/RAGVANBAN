# Chat Page Override

> Overrides `design-system/MASTER.md` for the chat interface (Bước 4).

**Page:** Chat tra cứu văn bản
**Pattern:** Minimal single-column chat (ChatGPT-like), one primary input CTA

## Layout
- Full-height column: header (brand) → message list → composer
- Max content width: `42rem` (readable line length)
- No sidebar on mobile; optional thin source panel on desktop ≥1024px
- Empty state: 1 headline + 1 short helper + 3 example prompts (chips)

## Components
- **Composer:** textarea ≥44px touch, Send disabled while streaming, visible focus ring
- **Messages:** user right/accent-soft; assistant left/surface; streaming caret
- **Source chips:** pill links `[Tên VB]` → open `url_file_goc` new tab; SVG icon only (no emoji)
- **Loading:** skeleton lines in assistant bubble (≤300ms delay before show)

## Motion
- Message enter: fade + translateY 8px, 180ms ease-out
- Respect `prefers-reduced-motion: reduce` → instant

## Anti-patterns for this page
- No purple gradients, no glassmorphism clutter, no emoji icons
- No multi-column hero; chat is the product
