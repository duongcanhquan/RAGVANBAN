/**
 * Thông báo lỗi trả về client — không lộ key / header.
 */

function publicErrorMessage(err, fallback = 'Lỗi máy chủ') {
  const msg = String(err?.message || fallback || 'Lỗi máy chủ');
  if (/api[_-]?key|bearer\s|sk-|authorization|password|secret|credential/i.test(msg)) {
    return 'Lỗi máy chủ';
  }
  return msg.slice(0, 220) || fallback;
}

module.exports = { publicErrorMessage };
