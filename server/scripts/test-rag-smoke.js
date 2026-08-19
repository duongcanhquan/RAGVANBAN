/**
 * Smoke wrapper cho test:rag — bỏ qua an toàn khi không có server / API key.
 * CI: luôn exit 0 nếu môi trường chưa sẵn sàng; exit 1 nếu chạy được mà FAIL.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { hasProviderKey } = require('../src/services/llmFactory');
const { TEST_CASES, callChatApi, rulePrecheck } = require('./evaluate');

const API_URL = process.env.EVAL_API_URL || 'http://127.0.0.1:5000/api/chat';
const BASE = API_URL.replace(/\/api\/chat\/?$/, '');

async function canRun() {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { ok: false, reason: `health HTTP ${res.status}` };
    const json = await res.json();
    if (!json.ragReady) {
      return { ok: false, reason: 'ragReady=false (thiếu Pinecone/embeddings?)' };
    }
    return { ok: true, health: json };
  } catch (err) {
    return { ok: false, reason: err.message || 'không kết nối backend' };
  }
}

async function runQuickCase(testCase) {
  const chat = await callChatApi(testCase.question);
  const ruleViolations = rulePrecheck(testCase, chat.answer);
  return {
    id: testCase.id,
    status: ruleViolations.length ? 'FAIL' : 'PASS',
    reason: ruleViolations.join('; ') || 'rule-only PASS',
    latencyMs: chat.latencyMs,
  };
}

async function main() {
  const gate = await canRun();
  if (!gate.ok) {
    console.log(`⊘ test:rag smoke — bỏ qua (${gate.reason})`);
    console.log('  Gợi ý: cd server && npm run dev && cấu hình .env Pinecone/LLM');
    return;
  }

  const hasJudge =
    hasProviderKey('openai') || hasProviderKey('deepseek') || hasProviderKey('gemini');
  if (!hasJudge) {
    console.log('⊘ test:rag smoke — bỏ qua (không có LLM judge key)');
    return;
  }

  const sample = TEST_CASES.find((t) => t.id === 'TC04') || TEST_CASES[0];
  console.log(`→ Chạy smoke RAG: ${sample.id} (${sample.name})`);
  const result = await runQuickCase(sample);
  if (result.status === 'PASS') {
    console.log(`✓ RAG smoke PASS (${result.latencyMs}ms)`);
    return;
  }
  console.error(`✗ RAG smoke FAIL: ${result.reason}`);
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error('✗', err.message);
    process.exitCode = 1;
  });
}

module.exports = { canRun, runQuickCase };
