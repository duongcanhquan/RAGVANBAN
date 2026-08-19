# Deploy RAGVANBAN lên Vercel (GitHub)

Một project Vercel: **giao diện** (`client/dist`) + **API Express** (`/api/*`) cùng domain.

Chat gọi `/api/chat` (không cần `VITE_API_BASE`). File `.env` local **không** lên GitHub — phải dán key vào Vercel.

---

## 0) Trước khi bấm Deploy

Cần sẵn:

- [ ] Repo GitHub đã nối với Vercel
- [ ] Project [Supabase](https://supabase.com/dashboard) + đã chạy SQL (mục 3)
- [ ] Index [Pinecone](https://app.pinecone.io): dense, **cosine**. Dễ: dimension **768** + Gemini `text-embedding-004`. OpenAI: **Custom settings**, gõ **1536** (console thường không hiện chip 1536).
- [ ] Ít nhất một LLM key: OpenAI / DeepSeek / Gemini
- [ ] OpenAI hoặc Gemini cho **embedding** (DeepSeek không có embedding)

---

## 1) Đẩy code có `vercel.json` lên GitHub

Trên máy, từ thư mục dự án:

```bash
git add vercel.json api/index.js package.json server/src/index.js .gitignore .env.example README.md docs/vercel-deploy.md
git commit -m "Add Vercel config for Vite frontend + Express API."
git push origin main
```

Vercel sẽ tự build khi `main` được push.

**Cài đặt project trên Vercel (Settings → General):**

| Mục | Giá trị |
|---|---|
| Framework Preset | Other |
| Root Directory | *(để trống — gốc repo)* |
| Build Command | *(để mặc định từ `vercel.json`)* |
| Output Directory | `client/dist` |
| Node.js | **20.x** |

---

## 2) Dán Environment Variables

Vercel → project → **Settings → Environment Variables**.

Chọn **Production**, **Preview**, **Development** cho mọi biến (trừ khi bạn cố ý tách).

`VITE_*` được **nhúng lúc build**. Thêm/sửa `VITE_*` xong phải **Redeploy**.

### Bắt buộc

| Tên | Lấy ở đâu |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | API → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | API → `service_role` — **bí mật**, chỉ server |
| `SUPABASE_STORAGE_BUCKET` | `documents` |
| `VITE_SUPABASE_URL` | Cùng giá trị `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | Cùng giá trị `SUPABASE_ANON_KEY` |
| `PINECONE_API_KEY` | [app.pinecone.io](https://app.pinecone.io) → API Keys |
| `PINECONE_INDEX_NAME` | `van-ban-hanh-chinh` |
| `PINECONE_ENVIRONMENT` | Region index, ví dụ `us-east-1` |
| `CLIENT_ORIGIN` | URL production, ví dụ `https://your-app.vercel.app` (điền sau lần deploy đầu nếu chưa biết URL) |
| `SUPER_ADMIN_EMAIL` | `quan.duong@caodangvietmy.edu.vn` |
| `SUPER_ADMIN_PASSWORD` | Mật khẩu tạm super-admin (chỉ lúc bootstrap; đổi ngay trong `/quantri`) |

### LLM — ít nhất 1 chat + 1 embedding

| Tên | Ghi chú |
|---|---|
| `OPENAI_API_KEY` | Chat và/hoặc embedding |
| `DEEPSEEK_API_KEY` | Chat rẻ; **không** dùng cho embedding |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` |
| `GEMINI_API_KEY` | Chat / extract / embedding |

Nên copy thêm các biến provider từ `.env` local:

```
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
CHUNK_SIZE=900
CHUNK_OVERLAP=150
UPSERT_BATCH_SIZE=64
RAG_TOP_K=6
UPLOAD_MAX_BYTES=41943040
```

`UPLOAD_MAX_BYTES` mặc định 40 MB (cấu hình 1–512 MB tại `/quantri/rag`). Vercel vẫn giới hạn **HTTP body ~4.5 MB** khi upload tay — file lớn hơn dán **link Google Drive** (server tải từ Drive theo giới hạn đã đặt).

### Cloudflare R2 — bắt buộc nếu upload file tay

File tải lên `/quantri` lưu R2. File Drive **không** copy sang R2.

1. Cloudflare Dashboard → **R2** → Create bucket (ví dụ `van-ban-goc`)
2. **Manage R2 API Tokens** → Create API token (Object Read & Write) → copy Access Key + Secret
3. Bucket → **Settings** → **Public development URL** → Enable → copy `https://pub-….r2.dev`  
   (hoặc gắn custom domain)
4. Dán biến:

| Tên | Ghi chú |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare → Overview → Account ID |
| `R2_ACCESS_KEY_ID` | R2 API token |
| `R2_SECRET_ACCESS_KEY` | R2 API token |
| `R2_BUCKET` | Tên bucket, ví dụ `van-ban-goc` |
| `R2_PUBLIC_BASE_URL` | `https://pub-….r2.dev` hoặc `https://files.yourdomain.com` (không slash cuối) |

`/api/health` có `"r2": true` khi 4 biến account/key/bucket đã đúng.

### Tùy chọn

| Tên | Ghi chú |
|---|---|
| `N8N_WEBHOOK_SECRET` | Chuỗi dài; n8n gửi header `X-N8N-Secret` |
| `GOOGLE_DRIVE_FOLDER_ID` | ID thư mục Drive (chỉ cần nếu sync folder, không bắt buộc khi chỉ dán link) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **Dán nguyên JSON** (1 dòng), không dùng đường dẫn file Windows |
| `DRIVE_MIRROR_TO_SUPABASE` | Để `false` — không copy Drive sang kho khác |

Sau khi lưu biến: **Deployments → … trên bản mới nhất → Redeploy**.

---

## 3) Supabase SQL + Storage

Dashboard Supabase → **SQL Editor** → chạy lần lượt (hoặc dán từng file):

1. `supabase/migrations/001_chat_logs.sql`
2. `supabase/migrations/002_drive_columns.sql`
3. `supabase/migrations/003_knowledge.sql`
4. `supabase/migrations/004_doc_categories.sql`
5. `supabase/migrations/005_admin_rbac.sql` — bảng `/quantri`

Kiểm tra:

- Table Editor: `chat_logs`, `documents`, `scenarios`, `doc_categories`, `admin_profiles`, `admin_category_grants`
- File gốc: **R2** (upload) hoặc **Drive** (link). Bucket Supabase `documents` không còn là kho chính.

---

## 4) Pinecone index

Create Index (dense, **không** gắn model sẵn của Pinecone):

- Name: `van-ban-hanh-chinh`
- Metric: **cosine**
- Dimensions: **768** nếu embedding Gemini `text-embedding-004` (chip có sẵn trên console)
- Hoặc **1536** nếu OpenAI `text-embedding-3-small` — console không có chip 1536: **Custom settings**, gõ `1536`

Chip 384 / 512 / 1024 / 2048 là preset model của Pinecone, không dùng với bộ não RAGVANBAN trừ khi model embedding ra đúng số chiều đó.

---

## 5) Kiểm tra sau khi deploy

1. Mở URL Vercel (ví dụ `https://xxx.vercel.app`)
2. Health: `https://xxx.vercel.app/api/health`

Kỳ vọng:

```json
{
  "status": "ok",
  "ragReady": true,
  "supabase": true,
  "r2": true,
  "googleDrive": true
}
```

- `r2: false` → thiếu `R2_*` (upload tay sẽ không có file tải về)
- `ragReady: false` → thiếu LLM hoặc Pinecone
- `supabase: false` → sai `SUPABASE_URL` / `SERVICE_ROLE`
- Trang trắng / 404 `/quantri` → chưa có rewrite SPA (cần `vercel.json` trên `main`)

3. Mở `https://<app>.vercel.app/quantri` (không có trên menu công khai). Đăng nhập super-admin → đổi mật khẩu → upload PDF **< 4.5 MB**
4. Về `/` → hỏi một câu thuộc văn bản vừa nạp

`/admin` cũ redirect sang `/quantri`.

Cập nhật `CLIENT_ORIGIN` = URL production rồi Redeploy (không bắt buộc nếu cùng domain `.vercel.app`).

---

## 6) Giới hạn Vercel cần biết

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Upload PDF lớn fail | Body max ~4.5 MB | File nhỏ hơn, hoặc Drive / ingest máy local |
| Chat/upload/n8n cắt giữa chừng | Timeout (Hobby 10–60s) | Gói Pro (`maxDuration` 300s); Drive trigger 1 file; tắt OCR nặng |
| Thư viện/tình huống mất sau deploy | Serverless không ghi đĩa bền | Bắt buộc Supabase (mục 3) |
| Drive không list | JSON path Windows trên Vercel | Dán raw JSON vào env |
| `VITE_` không có trên client | Thêm env sau lần build | Redeploy |

OCR (`tesseract.js`) trên serverless dễ chậm/OOM — ưu tiên PDF có text.

---

## 7) Custom domain (tùy chọn)

Vercel → **Settings → Domains** → thêm domain → cập nhật `CLIENT_ORIGIN` → Redeploy.

Webhook n8n (production): copy URL + secret từ `/quantri` trên domain Vercel, import `docs/n8n/ragvanban-sync.workflow.json`. Không dùng localhost. Chi tiết: [`docs/n8n/README.md`](./n8n/README.md).
