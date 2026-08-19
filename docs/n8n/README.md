# n8n → RAGVANBAN

Server đã có webhook. n8n chỉ việc gọi — **không cần** Google credential trên n8n nếu chỉ đồng bộ thư mục đã khai trong `/quantri`.

## Chạy ngay (khuyến nghị)

File import: [`ragvanban-sync.workflow.json`](./ragvanban-sync.workflow.json)

1. App **bật** (`npm run dev` hoặc production).
2. Vào **`/quantri` → Cài đặt → Google Drive & n8n**
   - Dán Google service account JSON (nếu chưa)
   - Thêm link thư mục Drive
   - Bật webhook n8n → **Tạo secret** → copy
3. n8n → **Workflows → Import from File** → chọn file JSON trên.
4. Mở node **Gọi RAG webhook**
   - URL: `http://127.0.0.1:5000/api/webhooks/n8n`  
     n8n Docker trên Mac: `http://host.docker.internal:5000/api/webhooks/n8n`  
     Vercel: `https://YOUR-DOMAIN/api/webhooks/n8n`
   - Header `X-N8N-Secret` = secret vừa copy (thay `PASTE_N8N_SECRET`)
5. Bấm **Execute Workflow** trên node **Chạy tay**.

Thành công: JSON `ok: true`, `action: sync_folder`, danh sách file đã số hóa.

Bật workflow (Active) để **Mỗi 15 phút** tự chạy. Node **File mới trên Drive** là tùy chọn — cần gắn Google OAuth trên n8n và dán Folder ID.

## Payload server nhận

| Body | Việc làm |
|------|----------|
| `{ "action": "sync_folder", "limit": 20 }` | Đồng bộ thư mục đã khai trong Cài đặt |
| `{ "fileId": "1abc..." }` | Số hóa 1 file Drive |
| `{ "fileUrl": "https://...", "fileName": "vb.pdf" }` | Tải URL công khai rồi số hóa |

Header bắt buộc: `X-N8N-Secret`.

## Kiểm tra server

```bash
curl http://127.0.0.1:5000/api/webhooks/n8n/health
```

`enabled: true` và `secretConfigured: true` rồi hãy Execute n8n.
