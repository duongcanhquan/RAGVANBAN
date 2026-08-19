# 🏛️ Hệ thống RAG Tra cứu Văn bản Hành chính

> **Zero-hallucination RAG** giúp người dân tra cứu chính sách / văn bản hành chính — chỉ trả lời từ context còn hiệu lực, luôn kèm **trích dẫn + link file gốc**.

---

## 📐 Kiến trúc tổng quan

```text
┌─────────────┐     SSE/HTTP      ┌──────────────────┐
│  React/Vite │ ◄──────────────► │  Node.js/Express │
│  (client)   │   :5173 → :5000  │     (server)     │
└─────────────┘                  └────────┬─────────┘
                                          │
            ┌─────────────────────────────┼─────────────────────────────┐
            ▼                             ▼                             ▼
   ┌────────────────┐          ┌────────────────┐            ┌────────────────┐
   │    Supabase    │          │    Pinecone    │            │  Multi-LLM     │
   │ DB + Storage   │          │ Vector Index   │            │ OpenAI/DeepSeek│
   │ chat_logs,     │          │ Embeddings     │            │ / Gemini       │
   │ documents, PDF │          │                │            │                │
   └───────▲────────┘          └────────────────┘            └────────────────┘
           │ optional
   ┌───────┴────────┐     ┌─────────────┐
   │ Google Drive   │◄────│    n8n      │  (cá nhân / nhiều nơi, webhook secret)
   │ Service Account│     │ automation  │
   └────────────────┘     └─────────────┘
```

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| **Frontend** | React + Vite + Tailwind | Chat công dân + Admin glassmorphism |
| **Backend** | Node.js + Express | API `/api/chat`, `/api/upload`, SSE stream |
| **Database** | Supabase (PostgreSQL) | `chat_logs`, `documents` |
| **Storage** | Supabase Storage | Bucket `documents` — PDF gốc |
| **Google Drive** *(tùy chọn)* | Service Account | PDF cá nhân / team — sync Admin hoặc n8n |
| **Automation** *(tùy chọn)* | n8n webhook | `POST /api/webhooks/n8n` + `X-N8N-Secret` |
| **Vector DB** | Pinecone | Embeddings + metadata filter |
| **LLM** | OpenAI / DeepSeek / Gemini | Chat, extract metadata, embeddings |

---

## ✅ Yêu cầu trước khi bắt đầu

- [ ] Node.js **18+** (khuyến nghị 20+)
- [ ] Tài khoản [Supabase](https://supabase.com)
- [ ] Tài khoản [Pinecone](https://www.pinecone.io)
- [ ] *(Tùy chọn)* Google Cloud Service Account + thư mục Drive
- [ ] *(Tùy chọn)* n8n (self-host hoặc cloud) để tự động ingest

---

## 🔑 Hướng dẫn lấy API Keys (từng bước)

### 1) Supabase (Database + Storage)

1. Vào [https://supabase.com/dashboard](https://supabase.com/dashboard) → **New project**
2. Vào **Project Settings → API**
3. Copy:
   - **Project URL** → `SUPABASE_URL` / `VITE_SUPABASE_URL`
   - **anon public** → `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY`
   - **service_role** → `SUPABASE_SERVICE_ROLE_KEY` ⚠️ **bí mật**, chỉ dùng trên server

> 💡 `service_role` bypass RLS — **không bao giờ** đưa vào frontend / commit git.

### 2) Pinecone (Vector)

1. Vào [https://app.pinecone.io](https://app.pinecone.io)
2. **API Keys** → tạo / copy key → `PINECONE_API_KEY`
3. **Create Index**:
   - Name: `van-ban-hanh-chinh` (hoặc tên bạn đặt vào `PINECONE_INDEX_NAME`)
   - Dimension: **1536** nếu dùng `text-embedding-3-small` (OpenAI)
   - Metric: `cosine`

### 3) OpenAI

1. [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create secret key → `OPENAI_API_KEY`
3. Dùng cho chat và/hoặc embeddings

### 4) DeepSeek (chat rẻ, OpenAI-compatible)

1. [https://platform.deepseek.com](https://platform.deepseek.com) → API Keys
2. Copy → `DEEPSEEK_API_KEY`
3. Base URL mặc định: `https://api.deepseek.com`

### 5) Google Gemini

1. [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Create API key → `GEMINI_API_KEY`
3. Có thể dùng cho chat / extract / embeddings (`text-embedding-004`)

### 6) Google Drive *(tùy chọn — cá nhân / nhiều nơi)*

1. [Google Cloud Console](https://console.cloud.google.com/) → tạo project → bật **Google Drive API**
2. **IAM → Service Accounts** → Create → Key JSON → lưu **ngoài** repo
3. Share thư mục PDF trên Drive cho **email service account** (Viewer)
4. Folder ID từ URL `.../folders/<GOOGLE_DRIVE_FOLDER_ID>`
5. Trong `.env`:
   - `GOOGLE_SERVICE_ACCOUNT_JSON` = đường dẫn tuyệt đối tới file JSON
   - `GOOGLE_DRIVE_FOLDER_ID` = ID thư mục

### 7) n8n webhook *(tùy chọn — tự động hóa an toàn)*

1. Đặt `N8N_WEBHOOK_SECRET` = chuỗi dài ngẫu nhiên (cùng giá trị trên n8n)
2. n8n gọi `POST https://<host>/api/webhooks/n8n` với header `X-N8N-Secret`
3. Body ví dụ: `{ "fileId": "<google-drive-file-id>" }` hoặc `{ "action": "sync_folder", "limit": 10 }`
4. Import workflow mẫu: `docs/n8n/drive-to-rag.workflow.json` — hướng dẫn đầy đủ: [`docs/n8n/README.md`](docs/n8n/README.md)

---

## ⚙️ Mẫu file `.env` chuẩn

Tạo file `.env` ở **thư mục gốc** dự án (cùng cấp `client/` và `server/`):

```env
# -------- Server --------
PORT=5000
CLIENT_ORIGIN=http://localhost:5173

# -------- Pinecone --------
PINECONE_API_KEY=pcsk_xxx
PINECONE_INDEX_NAME=van-ban-hanh-chinh
PINECONE_NAMESPACE=
PINECONE_ENVIRONMENT=us-east-1

# -------- Multi-LLM --------
OPENAI_API_KEY=sk-xxx
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_BASE_URL=https://api.deepseek.com
GEMINI_API_KEY=AIzaXXX

DEFAULT_EMBEDDING_PROVIDER=openai
DEFAULT_CHAT_PROVIDER=deepseek
DEFAULT_EXTRACT_PROVIDER=gemini

CHAT_FALLBACK_PROVIDERS=deepseek,openai,gemini
EXTRACT_FALLBACK_PROVIDERS=gemini,deepseek,openai
EMBEDDING_FALLBACK_PROVIDERS=openai,gemini

OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
DEEPSEEK_CHAT_MODEL=deepseek-chat
GEMINI_CHAT_MODEL=gemini-2.0-flash
GEMINI_EMBEDDING_MODEL=text-embedding-004

# -------- Ingestion --------
DATA_DIR=./data
CHUNK_SIZE=900
CHUNK_OVERLAP=150
UPSERT_BATCH_SIZE=64
PUBLIC_DOCS_BASE_URL=
RAG_TOP_K=6
UPLOAD_MAX_BYTES=26214400

# -------- Supabase --------
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
SUPABASE_STORAGE_BUCKET=documents

# Vite (client) — chỉ ANON
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...

# -------- Google Drive (tùy chọn) --------
GOOGLE_SERVICE_ACCOUNT_JSON=C:/secrets/rag-drive-sa.json
GOOGLE_DRIVE_FOLDER_ID=1abcYourFolderId

# -------- n8n (tùy chọn) --------
N8N_WEBHOOK_SECRET=change-me-to-a-long-random-string
```

> 📋 Có thể copy từ `.env.example` rồi điền giá trị thật.

---

## 🗄️ Setup Supabase SQL (copy / paste)

1. Mở project → **SQL Editor** → **New query**
2. Dán toàn bộ đoạn dưới (hoặc file `supabase/migrations/001_chat_logs.sql`) → **Run**

```sql
-- chat_logs
create table if not exists public.chat_logs (
  id uuid primary key default gen_random_uuid(),
  user_session text not null default 'anonymous',
  question text not null,
  citations_used jsonb not null default '[]'::jsonb,
  answer text default '',
  created_at timestamptz not null default now()
);

create index if not exists chat_logs_created_at_idx on public.chat_logs (created_at desc);

-- documents
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  so_hieu text,
  loai_van_ban text,
  trang_thai text,
  chunk_count integer not null default 0,
  storage_path text,
  storage_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.documents add column if not exists storage_path text;
alter table public.documents add column if not exists storage_url text;
alter table public.documents add column if not exists drive_file_id text;
alter table public.documents add column if not exists drive_web_view_link text;
alter table public.documents add column if not exists source text default 'upload';

-- RLS (anon đọc stats; ghi qua service_role)
alter table public.chat_logs enable row level security;
alter table public.documents enable row level security;

drop policy if exists "anon_read_chat_logs" on public.chat_logs;
create policy "anon_read_chat_logs"
  on public.chat_logs for select to anon, authenticated using (true);

drop policy if exists "anon_read_documents" on public.documents;
create policy "anon_read_documents"
  on public.documents for select to anon, authenticated using (true);

-- Storage bucket documents (public URL)
insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "public_read_documents_bucket" on storage.objects;
create policy "public_read_documents_bucket"
  on storage.objects for select
  to public
  using (bucket_id = 'documents');
```

### Kiểm tra nhanh trên Dashboard

| Mục | Nơi kiểm tra |
|---|---|
| Bảng `chat_logs`, `documents` | **Table Editor** |
| Bucket `documents` | **Storage** |
| Bucket **Public** = ON | Storage → documents → Configuration |

---

## ☁️ Deploy Vercel (GitHub)

Một project: frontend Vite + API Express cùng domain (`/api/...`).

Checklist đầy đủ (env, Supabase, Pinecone, giới hạn Hobby): [`docs/vercel-deploy.md`](docs/vercel-deploy.md)

---

## 🚀 Hướng dẫn khởi chạy

### Bước 1 — Cài dependencies

```bash
# Từ thư mục gốc dự án
cd server
npm install

cd ../client
npm install
```

### Bước 2 — Điền `.env` ở root

```bash
cp .env.example .env
# Mở .env và dán các API key
```

### Bước 3 — Chạy SQL trên Supabase (mục trên)

### Bước 4 — Chạy Backend + Frontend (2 terminal)

**Terminal 1 — Backend**

```bash
cd server
npm run start
# hoặc: npm run dev
```

→ `http://localhost:5000`  
→ Health: `GET http://localhost:5000/api/health`

**Terminal 2 — Frontend**

```bash
cd client
npm run dev
```

→ `http://localhost:5173`  
→ Quản trị (ẩn menu): `http://localhost:5173/quantri`

### Hoặc từ root (nếu đã cài deps)

```bash
npm run dev:server
npm run dev:client
```

---

## 📤 Luồng Admin Upload (tóm tắt)

1. Đăng nhập `/quantri` → kéo thả PDF
2. `POST /api/upload` (multipart + SSE progress)
3. PDF → **Supabase Storage** (`documents/`)
4. LLM extract metadata → chunk → **Pinecone**
5. Ghi dòng vào bảng `documents`
6. Chat dùng `link_goc` = URL Storage công khai để trích dẫn

### Google Drive / n8n (song song, không bắt buộc)

| Cách | Endpoint |
|---|---|
| Admin liệt kê / sync folder | `GET /api/drive/list`, `POST /api/drive/sync` |
| Số hóa 1 file Drive | `POST /api/drive/ingest` `{ "fileId" }` |
| n8n tự động | `POST /api/webhooks/n8n` + `X-N8N-Secret` |

PDF từ Drive có thể mirror lên Supabase Storage; citation ưu tiên URL Storage (hoặc link Drive nếu chưa có Supabase).

---

## 💬 Luồng Chat

1. User hỏi trên `/`
2. Intent Router → Hybrid Search (lọc `Còn hiệu lực` / `Bị thay thế một phần`)
3. QA stream SSE → Citation chips
4. Backend insert `chat_logs` (câu hỏi + citations + answer)

---

## 🧪 Lệnh hữu ích

| Lệnh | Mô tả |
|---|---|
| `cd server && npm run ingest -- --dry-run` | Thử pipeline PDF không gọi API |
| `cd server && npm run ingest` | Ingest PDF trong `server/data` / `/data` |
| `cd server && npm test` | Unit tests |
| `cd server && npm run test:rag` | Đánh giá RAG (cần backend đang chạy) |
| `cd client && npm run build` | Build production frontend |

---

## 📁 Cấu trúc thư mục (rút gọn)

```text
/
├── client/                 # React + Vite + Tailwind
│   └── src/pages/          # ChatPage, AdminPage
├── server/
│   ├── src/routes/         # chat, upload, admin, drive, webhooks
│   ├── src/services/       # supabase, googleDrive, llmFactory, ingestFile
│   └── scripts/            # ingest, evaluate
├── docs/n8n/               # workflow mẫu + hướng dẫn webhook
├── supabase/migrations/    # SQL schema + storage + Drive columns
├── data/                   # PDF nguồn (CLI ingest)
├── .env.example
└── README.md
```

---

## ❓ Troubleshooting nhanh

| Hiện tượng | Cách xử lý |
|---|---|
| `supabase: false` trên `/api/health` | Kiểm tra `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` |
| `googleDrive: false` | JSON service account + `GOOGLE_DRIVE_FOLDER_ID`; đã share folder cho SA chưa |
| n8n `401 Unauthorized` | Sai / thiếu header `X-N8N-Secret` so với `N8N_WEBHOOK_SECRET` |
| Upload lỗi Storage | Chạy SQL tạo bucket `documents`; bucket phải **public** để lấy URL |
| Chat demo / không retrieve | Thiếu Pinecone/LLM key hoặc chưa ingest PDF |
| CORS / API fail từ Vite | Backend phải chạy **port 5000**; Vite proxy dùng `127.0.0.1:5000` (không dùng `localhost` trên Windows) |
| Server start xong rồi mất / không vào được | Port bị chiếm: `cd server && npm run kill:5000` rồi `npm run start`. Giữ cửa sổ terminal mở. Mở thử `http://127.0.0.1:5000/api/health` |
| Embedding dimension mismatch | Index Pinecone phải khớp model (1536 cho `text-embedding-3-small`) |

---

## 📜 License & ghi chú

Dự án phục vụ mục đích **demo / nội bộ**. Khi triển khai production: hạn chế CORS, bảo vệ `/quantri` (đã có đăng nhập), xoay vòng API keys, và cân nhắc không public bucket nếu tài liệu mật — dùng signed URL thay thế.
