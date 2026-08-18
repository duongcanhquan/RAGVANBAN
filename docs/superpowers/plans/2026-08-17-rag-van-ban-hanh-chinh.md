# RAG Tra cứu Văn bản Hành chính — Implementation Plan

> **For agentic workers:** Execute task-by-task. Test → fix → pass before next task. Steps use checkbox syntax.

**Goal:** Xây hệ thống RAG zero-hallucination giúp người dân tra cứu chính sách/văn bản hành chính, có citation + link file gốc.

**Architecture:** Client React/Vite stream SSE từ Express. Ingest PDF → LLM metadata → chunk → OpenAI embeddings → Pinecone. Query: Intent Router → Hybrid Search (metadata filter `trang_thai=Còn hiệu lực`) → QA prompt nghiêm ngặt → stream + nguồn.

**Tech Stack:** Node.js/Express, LangChain 0.3, OpenAI, Pinecone, pdf-parse, React/Vite/Tailwind, SSE.

## Global Constraints

- Zero hallucination: chỉ trả lời từ context retrieve được.
- Metadata filter bắt buộc: ưu tiên văn bản mới / `Còn hiệu lực`, loại `Hết hiệu lực`.
- Mọi câu trả lời phải có citation dạng `[Tên văn bản](URL)`.
- Code modular, có comment, Node backend + React/Vite frontend.
- UI: Accessible & Ethical (design-system/MASTER.md) — đơn giản, nhanh, contrast cao, không purple AI gradient.
- Font override: **Be Vietnam Pro** (hỗ trợ tiếng Việt tốt hơn Inter).
- Quy trình: làm → test → sửa → mới bước tiếp theo.
- Không commit trừ khi user yêu cầu.

---

## File Map

| Path | Responsibility |
|------|----------------|
| `design-system/MASTER.md` | Design tokens & UX rules |
| `design-system/pages/chat.md` | Override cho màn chat (Bước 4) |
| `server/src/index.js` | Express entry |
| `server/src/ingestion/*.js` | Modular ingest helpers |
| `server/scripts/ingest.js` | CLI orchestration |
| `server/scripts/test-ingest-unit.js` | Unit tests (không cần API key) |
| `server/src/routes/chat.js` | SSE `/api/chat` (Bước 3) |
| `server/src/services/*` | Intent, search, QA (Bước 3) |
| `client/src/*` | Chat UI (Bước 4) |
| `data/` | PDF nguồn |

---

### Task 1: Khóa Bước 1 (scaffold + verify)

**Files:**
- Modify: `client/src/index.css` (design tokens)
- Modify: `design-system/MASTER.md` (font Be Vietnam Pro)
- Create: `package.json` (root scripts)
- Test: health + client build

- [ ] Apply design tokens vào CSS
- [ ] Verify `GET /api/health` → status ok
- [ ] Verify `npm run build` trong `client`
- [ ] Verify deps server resolve được

**Done when:** health 200 + client build exit 0.

---

### Task 2: Data Ingestion (Bước 2)

**Files:**
- Create: `server/src/ingestion/listPdfs.js`
- Create: `server/src/ingestion/extractPdfText.js`
- Create: `server/src/ingestion/extractMetadata.js`
- Create: `server/src/ingestion/chunkDocuments.js`
- Create: `server/src/ingestion/upsertToPinecone.js`
- Create: `server/scripts/ingest.js`
- Create: `server/scripts/test-ingest-unit.js`
- Create: `data/fixtures/sample-van-ban.pdf` (fixture test)

**Interfaces:**
- `listPdfFiles(dataDir) → string[]`
- `extractPdfText(filePath) → Promise<{ text, pageCount }>`
- `extractMetadataFromPrefix(textPrefix, { fileName, urlFileGoc, llm? }) → Promise<DocumentMetadata>`
- `chunkTextWithMetadata(text, metadata, { chunkSize, chunkOverlap }) → Document[]`
- `upsertChunksToPinecone(chunks, { pinecone, indexName, embeddings }) → Promise<{ upserted }>`
- `runIngest({ dryRun })` orchestration

**Metadata schema:**
```js
{
  loai_van_ban: string,
  so_hieu: string,
  ngay_ban_hanh: string, // YYYY-MM-DD
  trang_thai: 'Còn hiệu lực' | 'Hết hiệu lực',
  url_file_goc: string,
  ten_file: string,
  linh_vuc?: string
}
```

- [ ] Viết unit test (chunk + parse JSON metadata + listPdfs)
- [ ] Implement modules tối thiểu để test pass
- [ ] `ingest.js` hỗ trợ `--dry-run` (không gọi OpenAI/Pinecone)
- [ ] Chạy unit test → pass
- [ ] Chạy dry-run trên `data/` (empty OK / fixture OK)

**Done when:** `node scripts/test-ingest-unit.js` exit 0; dry-run không crash.

---

### Task 3: API & Agentic RAG (Bước 3) — DONE

**Files:** `server/src/routes/chat.js`, `server/src/services/intentRouter.js`, `hybridSearch.js`, `qaChain.js`, `clients.js`

- [x] Intent Router LLM (+ heuristic fallback)
- [x] Pinecone query + filter `trang_thai = Còn hiệu lực`
- [x] QA prompt nghiêm ngặt tiếng Việt + nguồn markdown links
- [x] SSE stream `/api/chat` (+ demo mode khi thiếu key)
- [x] Unit tests `test:chat` — 9 passed
- [x] Smoke SSE — meta/token/done

---

### Task 4: Chat UI (Bước 4) — DONE

**Files:** `client/src/App.jsx`, `components/*`, `lib/streamChat.js`, `lib/sources.js`

- [x] Layout Minimal Single Column / ChatGPT-like
- [x] Stream text mượt
- [x] Markdown render (react-markdown + remark-gfm)
- [x] Source chips mở tab mới
- [x] Tokens từ MASTER.md; page override `design-system/pages/chat.md`
- [x] Client build exit 0

---

## Test Strategy

| Layer | Command | Needs keys? |
|-------|---------|-------------|
| Unit ingest | `node server/scripts/test-ingest-unit.js` | No |
| Dry-run ingest | `npm run ingest -- --dry-run` | No |
| Live ingest | `npm run ingest` | OpenAI + Pinecone |
| Health | `GET /api/health` | No |
| Client build | `cd client && npm run build` | No |

---

## Checkpoint Rule

Sau mỗi Task: báo cáo kết quả test (exit code + output chính). **Không** sang Task tiếp theo nếu test fail. Task 3–4 chờ user `Tiếp tục` theo roadmap gốc; Task 1–2 chạy liền trong phiên này theo yêu cầu user.
