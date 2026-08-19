export function explainLoginError(raw) {
  const msg = String(raw || '').trim()
  const lower = msg.toLowerCase()
  if (!msg) return 'Đăng nhập thất bại'
  if (/invalid login credentials|invalid_credentials/.test(lower)) {
    return 'Sai email hoặc mật khẩu. Lần đầu: dùng đúng SUPER_ADMIN_PASSWORD trên Vercel (không dùng 123456).'
  }
  if (/email not confirmed|confirm/.test(lower) && /email/.test(lower)) {
    return 'Email chưa xác nhận. Supabase → Authentication → Providers → Email: tắt Confirm email, hoặc bấm resend.'
  }
  if (/vite_supabase|thiếu vite/.test(lower)) {
    return msg
  }
  if (/failed to fetch|networkerror|load failed/.test(lower)) {
    return 'Không gọi được API. Kiểm tra Vercel đang chạy / máy đã npm run dev:server.'
  }
  if (/unexpected token|not valid json|<!doctype/.test(lower)) {
    return 'API /quantri không tới Express (nhận HTML). Đợi Vercel deploy xong rồi thử lại.'
  }
  return msg
}
