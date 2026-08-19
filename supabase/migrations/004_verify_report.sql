-- Lưu kết quả kiểm chứng trích dẫn sau mỗi câu trả lời RAG
alter table public.chat_logs add column if not exists verify_report jsonb;

comment on column public.chat_logs.verify_report is 'Báo cáo citationVerify: ok, số mục chưa khớp';
