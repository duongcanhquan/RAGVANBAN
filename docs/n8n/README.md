# n8n + Google Drive → RAG

Tự động số hóa PDF khi có file mới trên Drive — phù hợp dùng **cá nhân** hoặc **nhiều nơi** mà không mở Admin upload công khai.

## Bảo mật

1. Đặt `N8N_WEBHOOK_SECRET` dài, ngẫu nhiên trên server (`.env`).
2. n8n gọi `POST /api/webhooks/n8n` với header `X-N8N-Secret`.
3. Chỉ expose webhook qua HTTPS (tunnel / reverse proxy). Không public Admin nếu không cần.

## Biến môi trường (server)

```env
GOOGLE_SERVICE_ACCOUNT_JSON=C:/secrets/rag-drive-sa.json
GOOGLE_DRIVE_FOLDER_ID=1abc...
N8N_WEBHOOK_SECRET=doi-thanh-chuoi-dai-ngau-nhien
```

## Google Service Account (cá nhân an toàn)

1. [Google Cloud Console](https://console.cloud.google.com/) → tạo project → bật **Google Drive API**.
2. **IAM → Service Accounts** → Create → tạo key **JSON** → lưu ngoài repo.
3. Share thư mục Drive chứa PDF cho **email service account** (quyền Viewer).
4. Copy **Folder ID** từ URL: `https://drive.google.com/drive/folders/<FOLDER_ID>`.

## Payload webhook

| Body | Ý nghĩa |
|------|---------|
| `{ "fileId": "..." }` | Tải 1 PDF từ Drive → ingest |
| `{ "action": "sync_folder", "limit": 10 }` | Đồng bộ tối đa N file trong folder |
| `{ "fileUrl": "https://...", "fileName": "a.pdf" }` | Tải PDF từ URL công khai |

## Import workflow mẫu

File: `drive-to-rag.workflow.json`

1. n8n → **Workflows → Import**
2. Gắn credential Google Drive (Trigger)
3. Env trên n8n:
   - `RAG_WEBHOOK_URL` = `https://your-public-host/api/webhooks/n8n`
   - `N8N_WEBHOOK_SECRET` = cùng giá trị server
   - `GOOGLE_DRIVE_FOLDER_ID` = folder theo dõi

## Kiểm tra nhanh

```bash
curl http://127.0.0.1:5000/api/webhooks/n8n/health
curl http://127.0.0.1:5000/api/drive/status
```
