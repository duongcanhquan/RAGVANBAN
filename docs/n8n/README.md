# n8n → RAGVANBAN trên Vercel (production)

n8n **không** gọi `localhost`. App đang chạy trên Vercel thì webhook phải là:

`https://<app-của-bạn>.vercel.app/api/webhooks/n8n`

(hoặc custom domain). n8n Cloud / n8n VPS chỉ gọi được URL public.

## Việc n8n làm

| Khi nào | Node | Body gửi Vercel |
|---------|------|-----------------|
| **Tải file lên thư mục Drive** | Google Drive Trigger | `{ "fileId": "…" }` |
| Mỗi **4 giờ** (quét file sót) | Schedule | `{ "action": "sync_folder", "limit": 8 }` |
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
   - Header `X-N8N-Secret` = secret vừa copy (thay `PASTE_N8N_SECRET`)
3. Thử **Chạy tay (thử 1 lần)** → Execute Workflow  
   Thành công: JSON `ok: true`, `action: sync_folder`.
   - `401` = sai secret  
   - `403` = công tắc n8n/Drive tắt  
   - `503` = chưa tạo secret  
   - `504` / timeout = Vercel cắt giờ; giảm `limit` hoặc gói Pro

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

## D. Lịch 4 giờ

Node **Mỗi 4 giờ** gọi `sync_folder` (tối đa 8 file/lần cho vừa timeout Vercel). Không cần Google credential trên n8n cho nhánh này — Vercel dùng service account + thư mục đã khai trong Cài đặt.

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
| n8n báo connection refused / ECONNREFUSED | Còn URL `127.0.0.1` hoặc `localhost` — đổi sang Vercel |
| 401 | Secret n8n ≠ secret trên `/quantri` (tạo lại rồi dán lại) |
| File mới không chạy | Workflow chưa Active, hoặc chưa gắn Google OAuth, hoặc sai Folder ID |
| `Định dạng Drive chưa hỗ trợ` / không tải được | Chưa Share folder cho **email service account** |
| Timeout | PDF quá nặng / OCR; để Drive trigger 1 file; nâng Pro |
