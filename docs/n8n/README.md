# n8n → RAGVANBAN trên Vercel (tùy chọn)

**Không cần n8n để tự số hóa file Drive mới.** App quét thư mục đã khai mỗi 15 phút (`/api/cron/drive-sync`) và bỏ qua file đã có `drive_file_id`. Bấm **Đồng bộ Drive ngay** trên `/quantri` để chạy ngay.

n8n chỉ dùng nếu muốn webhook từ tool ngoài. n8n **không** gọi `localhost`. App trên Vercel thì webhook phải là:

`https://<app-của-bạn>.vercel.app/api/webhooks/n8n`

## Việc n8n làm (nếu bật Active)

| Khi nào | Node | Body gửi Vercel |
|---------|------|-----------------|
| **Tải file lên thư mục Drive** | Google Drive Trigger | `{ "fileId": "…" }` hoặc `{ "id", "name", "mimeType" }` |
| Mỗi **4 giờ** (quét sót, giống cron) | Schedule | `{ "action": "sync_folder", "limit": 8 }` |
| Bấm thử 1 lần | Manual | `sync_folder` |

File import: [`ragvanban-sync.workflow.json`](./ragvanban-sync.workflow.json)

---

## A. Chuẩn bị trên Vercel (một lần)

1. Mở app production, vào **`/quantri` → Cài đặt → Google Drive & n8n** (super-admin).
2. **Google Drive**
   - Dán JSON service account (nếu chưa).
   - Share thư mục Drive cho **email service account** (Viewer).
   - **Thêm link thư mục** đó vào danh sách nguồn.
   - Công tắc Drive **bật**.
3. **n8n**
   - Công tắc webhook **bật**.
   - **Tạo secret** → Copy.
   - Copy **URL** trên màn hình (phải bắt đầu `https://…`, không `127.0.0.1`).
4. Kiểm tra health (trình duyệt hoặc Terminal):

```bash
curl -sS https://YOUR-APP.vercel.app/api/webhooks/n8n/health
```

Cần `"enabled": true` và `"secretConfigured": true`.  
`enabled: false` → chưa bật công tắc. `secretConfigured: false` → chưa Tạo secret.

`/api/health` nên có `"n8nWebhook": true` và `"googleDrive": true`.

Vercel Hobby cắt request ~10–60 giây. Số hóa PDF (nhất là OCR) nên dùng **Vercel Pro** (đã để `maxDuration` 300s). Mỗi lần Drive trigger chỉ gửi **1 file**.

---

## B. Cài n8n

Dùng **n8n Cloud** (n8n.io) hoặc n8n self-host **có internet ra Vercel**. Không dùng n8n chỉ gọi được máy local.

1. **Workflows → ⋮ → Import from File** → `docs/n8n/ragvanban-sync.workflow.json`
2. Mở node **Gọi RAG webhook (Vercel)**
   - **URL** = URL vừa copy ở `/quantri` (thay `https://YOUR-APP.vercel.app/api/webhooks/n8n`)
   - Header Name = `X-N8N-Secret`, Value = secret (thay `PASTE_N8N_SECRET`)
   - Body → JSON: biểu thức `{{ $json }}` — **không** dùng `JSON.stringify($json)` (sẽ làm app không đọc được fileId)
3. Thử **Chạy tay (thử 1 lần)** → Execute Workflow  
   Trong **Executions** mở output HTTP, xem:
   - `ingested: true` + `processed` > 0 → đã vào kho
   - `ingested: false`, `processed: 0`, `skipped` lớn → file đã có / thư mục trống / chưa Share SA
   - `duplicate: true` → file trùng, không số hóa lại
   - `401` = sai secret · `403` = tắt công tắc · `503` = chưa secret · timeout = Pro / 1 file

---

## C. “Tải lên Drive là tự chạy” (bắt buộc nếu muốn bấm upload là xong)

1. Trong n8n: **Credentials → Google Drive OAuth2** (tài khoản Google của bạn, không phải service account).
2. Node **File mới trên Drive**
   - Gắn credential vừa tạo.
   - **Folder ID**: đoạn `XXXX` trong  
     `https://drive.google.com/drive/folders/XXXX`
   - Event: **File Created** (đã set sẵn).
3. Cùng thư mục đó phải đã **Share Viewer cho service account** (bước A) — Vercel mới tải được file.
4. Bật workflow **Active**.
5. Thử: kéo 1 PDF vào thư mục → trong n8n Executions phải có run → Vercel trả `ok: true`, `action: ingest_file`.

n8n Cloud poll Drive khoảng 1 phút/lần, nên file mới có thể trễ ~1 phút, không phải tức thì 0 giây.

---

## D. Lịch quét sót

App (không cần n8n): Vercel cron `/api/cron/drive-sync` mỗi **15 phút**, chỉ lấy file chưa có `drive_file_id`.

Node n8n **Mỗi 4 giờ** (nếu workflow Active) cũng gọi `sync_folder` — cùng logic, tối đa 8 file mới/lần.

---

## Payload Vercel nhận

Header bắt buộc: `X-N8N-Secret` (cũng nhận `X-Webhook-Secret`).

| Body | Việc |
|------|------|
| `{ "fileId": "1abc..." }` | Số hóa 1 file Drive (đường tải lên) |
| `{ "action": "sync_folder", "limit": 8 }` | Đồng bộ thư mục đã khai |
| `{ "fileUrl": "https://...", "fileName": "vb.pdf" }` | Tải URL rồi số hóa |

---

## Lỗi thường gặp

| Hiện tượng | Nguyên nhân |
|------------|-------------|
| **Kết nối OK (`ok: true`) nhưng app không có tài liệu mới** | Xem field `ingested` / `processed` / `message` trong Executions. Thường: (1) Body n8n dùng `JSON.stringify` → sửa thành `{{ $json }}`; (2) `processed: 0` = không có file mới hoặc đã trùng; (3) chưa **Share Viewer** folder cho email service account; (4) chưa thêm **Nguồn Drive** trên `/quantri`; (5) file không phải PDF/Word/Excel. Cách chắc: `/quantri` → **Đồng bộ Drive ngay** |
| **`Header name must be a valid HTTP token ["header x-n8n-secret"]`** | Ô **Name** của header bị dán nhầm (có chữ `header` + khoảng trắng). Sửa: Name = `X-N8N-Secret` (không dấu cách, không chữ “header”); Value = secret copy từ `/quantri` |
| n8n báo connection refused / ECONNREFUSED | Còn URL `127.0.0.1` hoặc `localhost` — đổi sang Vercel |
| 401 | Secret n8n ≠ secret trên `/quantri` (tạo lại rồi dán lại) |
| File mới không chạy | Workflow chưa Active, hoặc chưa gắn Google OAuth, hoặc sai Folder ID |
| `Định dạng Drive chưa hỗ trợ` / không tải được | Chưa Share folder cho **email service account** |
| Timeout | PDF quá nặng / OCR; để Drive trigger 1 file; nâng Pro |

### Sửa nhanh node «Gọi RAG webhook (Vercel)»

1. Mở node → **Send Headers** = bật  
2. Dòng header **chỉ** như sau (2 ô riêng):

| Name (tên) | Value (giá trị) |
|------------|-----------------|
| `X-N8N-Secret` | *(dán secret, không có khoảng trắng thừa)* |
| `Content-Type` | `application/json` |

3. **Không** ghi `Header X-N8N-Secret`, `header x-n8n-secret`, hay `X-N8N-Secret: xxx` vào ô Name.  
4. URL = `https://<app>.vercel.app/api/webhooks/n8n` (không localhost).  
5. Chạy lại **Chạy tay (thử 1 lần)**.
