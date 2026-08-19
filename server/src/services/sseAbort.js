/**
 * Hủy SSE khi client đóng kết nối — không nhầm request body đã đọc xong.
 * bindSseAbort: AbortController + timeout, để hủy Pinecone/LLM đang chạy.
 */

const { abortError } = require('./abortControl');

function listenSseAbort(res, opts = {}) {
  const controller = opts.controller || null;
  let aborted = false;
  if (res && typeof res.on === 'function') {
    res.on('close', () => {
      if (!res.writableEnded) {
        aborted = true;
        if (controller && !controller.signal.aborted) {
          controller.abort(abortError('client'));
        }
      }
    });
  }
  return () => aborted || Boolean(controller?.signal.aborted);
}

function bindSseAbort(res, { timeoutMs = 0 } = {}) {
  const controller = new AbortController();
  let timer = null;
  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const closed = listenSseAbort(res, { controller });

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      if (!controller.signal.aborted) controller.abort(abortError('timeout'));
    }, timeoutMs);
  }

  controller.signal.addEventListener('abort', clearTimer, { once: true });

  return {
    controller,
    signal: controller.signal,
    aborted: () => closed() || controller.signal.aborted,
    dispose: clearTimer,
  };
}

module.exports = { listenSseAbort, bindSseAbort };
