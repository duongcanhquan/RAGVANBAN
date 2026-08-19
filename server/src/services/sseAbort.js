/**
 * Hủy SSE khi client đóng kết nối — không nhầm request body đã đọc xong.
 */

function listenSseAbort(res) {
  let aborted = false;
  if (res && typeof res.on === 'function') {
    res.on('close', () => {
      if (!res.writableEnded) aborted = true;
    });
  }
  return () => aborted;
}

module.exports = { listenSseAbort };
