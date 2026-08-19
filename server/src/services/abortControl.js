/**
 * AbortSignal xuyên embed / Pinecone / LLM — hủy khi client đóng hoặc hết hạn.
 */

function abortError(kind = 'client') {
  const timeout = kind === 'timeout';
  const err = new Error(timeout ? 'Request timeout' : 'Aborted');
  err.name = 'AbortError';
  err.code = timeout ? 'TIMEOUT_ERR' : 'ABORT_ERR';
  err.abortKind = timeout ? 'timeout' : 'client';
  return err;
}

function isAbortError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (err.code === 'ABORT_ERR' || err.code === 'TIMEOUT_ERR') return true;
  return err.abortKind === 'client' || err.abortKind === 'timeout';
}

function combineSignals(...signals) {
  const list = signals.filter(Boolean);
  if (!list.length) return undefined;
  if (list.length === 1) return list[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(list);
  const ac = new AbortController();
  const onAbort = () => {
    if (ac.signal.aborted) return;
    const reason = list.find((s) => s.aborted)?.reason;
    ac.abort(isAbortError(reason) ? reason : abortError(reason?.abortKind === 'timeout' ? 'timeout' : 'client'));
  };
  for (const s of list) {
    if (s.aborted) {
      onAbort();
      return ac.signal;
    }
    s.addEventListener('abort', onAbort, { once: true });
  }
  return ac.signal;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (isAbortError(reason)) throw reason;
  throw abortError(reason?.abortKind === 'timeout' ? 'timeout' : 'client');
}

function raceAbort(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) {
    const reason = signal.reason;
    return Promise.reject(isAbortError(reason) ? reason : abortError());
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      const reason = signal.reason;
      reject(isAbortError(reason) ? reason : abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

async function* abortableAsyncIter(iterable, signal) {
  if (!iterable) return;
  const it =
    typeof iterable[Symbol.asyncIterator] === 'function'
      ? iterable[Symbol.asyncIterator]()
      : iterable;
  try {
    while (true) {
      throwIfAborted(signal);
      const next = await raceAbort(Promise.resolve(it.next()), signal);
      if (next.done) break;
      yield next.value;
    }
  } finally {
    if (typeof it.return === 'function') {
      const closing = Promise.resolve(it.return()).catch(() => {});
      if (!signal?.aborted) await closing;
    }
  }
}

function defaultChatTimeoutMs(env = process.env) {
  const n = Number(env.CHAT_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(n) && n > 0) return n;
  return 120000;
}

module.exports = {
  abortError,
  isAbortError,
  throwIfAborted,
  raceAbort,
  abortableAsyncIter,
  combineSignals,
  defaultChatTimeoutMs,
};
