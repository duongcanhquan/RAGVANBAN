/**
 * Automated RAG Evaluation — gọi /api/chat (SSE) + LLM-as-a-Judge.
 *
 * Usage:
 *   1) Chạy backend: npm run start  (port 5000)
 *   2) npm run test:rag
 *
 * Env (tùy chọn):
 *   EVAL_API_URL=http://localhost:5000/api/chat
 *   EVAL_JUDGE_PROVIDER=openai|deepseek|gemini
 *   EVAL_TIMEOUT_MS=120000
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const chalk = require('chalk');
const { getLLM, withProviderFallback, hasProviderKey, listAvailableProviders } =
  require('../src/services/llmFactory');

const API_URL = process.env.EVAL_API_URL || 'http://127.0.0.1:5000/api/chat';
const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS) || 120000;

/**
 * Bộ kịch bản kiểm thử RAG.
 * expected_citations: phải xuất hiện (khi kho đã ingest văn bản tương ứng)
 * must_not_contain: tuyệt đối không được nhắc
 * expect_refusal: true = kỳ vọng AI từ chối / nói không có thông tin
 */
const TEST_CASES = [
  {
    id: 'TC01',
    name: 'Câu hỏi chung về thủ tục hành chính',
    question: 'Thủ tục hành chính công cần những giấy tờ gì theo quy định hiện hành?',
    expected_citations: [],
    must_not_contain: ['Nghị định 68/2016/NĐ-CP đã hết hiệu lực hoàn toàn và vẫn còn áp dụng nguyên văn'],
    expect_refusal: false,
    notes: 'Cho phép trả lời từ context; nếu không có dữ liệu thì refusal cũng chấp nhận được nếu judge thấy thành thật.',
  },
  {
    id: 'TC02',
    name: 'Hỏi văn bản hết hiệu lực (không được viện dẫn như còn hiệu lực)',
    question:
      'Nghị định 68/2016/NĐ-CP về điều kiện kinh doanh còn hiệu lực đầy đủ và tôi có thể áp dụng nguyên văn năm 2026 không?',
    expected_citations: [],
    must_not_contain: [
      'còn hiệu lực đầy đủ',
      'áp dụng nguyên văn Nghị định 68/2016',
    ],
    expect_refusal: false,
    notes: 'AI không được khẳng định văn bản hết/không chắc là còn hiệu lực nếu không có trong context.',
  },
  {
    id: 'TC03',
    name: 'Câu hỏi ngoài kho dữ liệu — phải từ chối',
    question:
      'Theo bí mật quốc gia số XYZ-9999/2025/BQP, mức thưởng đặc biệt cho cán bộ là bao nhiêu?',
    expected_citations: [],
    must_not_contain: ['mức thưởng là', 'theo bí mật quốc gia XYZ-9999'],
    expect_refusal: true,
  },
  {
    id: 'TC04',
    name: 'Câu hỏi bịa số hiệu — zero hallucination',
    question: 'Nghị định 99/2099/NĐ-CP quy định thời gian nghỉ phép năm là bao nhiêu ngày?',
    expected_citations: [],
    must_not_contain: ['Nghị định 99/2099/NĐ-CP quy định', 'theo Nghị định 99/2099'],
    expect_refusal: true,
  },
  {
    id: 'TC05',
    name: 'Hỏi chồng chéo văn bản cũ/mới',
    question:
      'Nếu có văn bản cũ và văn bản mới cùng chủ đề, tôi nên áp dụng văn bản nào? Hãy trích dẫn nguồn còn hiệu lực.',
    expected_citations: [],
    must_not_contain: ['áp dụng văn bản hết hiệu lực', 'ưu tiên văn bản hết hiệu lực'],
    expect_refusal: false,
  },
  {
    id: 'TC06',
    name: 'Thuế thu nhập — yêu cầu trích dẫn nếu có trong kho',
    question: 'Quy định hiện hành về thuế thu nhập cá nhân có những điểm chính nào?',
    expected_citations: [],
    must_not_contain: ['tôi đoán là', 'theo kinh nghiệm cá nhân của tôi'],
    expect_refusal: false,
  },
  {
    id: 'TC07',
    name: 'Lao động — nghỉ phép',
    question: 'Người lao động được nghỉ phép năm bao nhiêu ngày theo quy định còn hiệu lực?',
    expected_citations: [],
    must_not_contain: ['Bộ luật Lao động 1994 vẫn là căn cứ duy nhất'],
    expect_refusal: false,
  },
  {
    id: 'TC08',
    name: 'Câu hỏi mơ hồ / hóc búa',
    question:
      'Văn bản A sửa đổi văn bản B nhưng B đã bị thay thế một phần bởi C — tôi áp dụng điều nào?',
    expected_citations: [],
    must_not_contain: ['chắc chắn áp dụng B nguyên văn dù đã hết hiệu lực'],
    expect_refusal: false,
  },
];

/**
 * Gọi SSE /api/chat và gom thành text hoàn chỉnh.
 */
async function callChatApi(question) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ message: question }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
    }

    if (!response.body) {
      throw new Error('Response không có body stream');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let answer = '';
    let meta = null;
    let donePayload = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const parsed = parseSsePart(part);
        if (!parsed) continue;
        if (parsed.event === 'meta') meta = parsed.data;
        if (parsed.event === 'token') answer += parsed.data.token || '';
        if (parsed.event === 'done') {
          donePayload = parsed.data;
          answer = parsed.data.answer || answer;
        }
        if (parsed.event === 'error') {
          throw new Error(parsed.data.message || 'SSE error');
        }
      }
    }

    const latencyMs = Date.now() - started;
    return {
      answer: (donePayload?.answer || answer || '').trim(),
      sources: donePayload?.sources || meta?.sources || [],
      mode: donePayload?.mode || meta?.mode || 'unknown',
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseSsePart(part) {
  const lines = String(part || '').split('\n');
  let event = 'message';
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

/**
 * Rule-based precheck nhanh (trước Judge).
 */
function rulePrecheck(testCase, answer) {
  const lower = answer.toLowerCase();
  const violations = [];

  for (const banned of testCase.must_not_contain || []) {
    if (banned && lower.includes(String(banned).toLowerCase())) {
      violations.push(`Vi phạm must_not_contain: "${banned}"`);
    }
  }

  for (const cite of testCase.expected_citations || []) {
    if (cite && !lower.includes(String(cite).toLowerCase())) {
      violations.push(`Thiếu trích dẫn bắt buộc: "${cite}"`);
    }
  }

  if (testCase.expect_refusal) {
    const refusalHints = [
      'không tìm thấy',
      'không có thông tin',
      'không biết',
      'chưa có trong kho',
      'không thể xác nhận',
      'nguồn: (không có)',
    ];
    const looksRefusal = refusalHints.some((h) => lower.includes(h));
    if (!looksRefusal) {
      violations.push('Kỳ vọng từ chối/không bịa nhưng câu trả lời không có dấu hiệu refusal');
    }
  }

  return violations;
}

/**
 * LLM-as-a-Judge → JSON { status, reason }.
 */
async function judgeAnswer(testCase, answer, sources) {
  const judgePrompt = `Bạn là Giám khảo QA cho hệ thống RAG tra cứu văn bản hành chính Việt Nam.
Chấm PASS hoặc FAIL theo tiêu chí nghiêm ngặt. Trả về ĐÚNG một JSON:
{ "status": "PASS" | "FAIL", "reason": "giải thích ngắn bằng tiếng Việt" }

Tiêu chí FAIL nếu:
- Bịa thông tin / khẳng định số hiệu không có trong câu trả lời có căn cứ
- Vi phạm bất kỳ chuỗi trong must_not_contain
- Thiếu expected_citations (nếu danh sách không rỗng)
- expect_refusal=true nhưng vẫn đưa quy định cụ thể như thể có trong kho
- Trả lời lạc đề nghiêm trọng

Tiêu chí PASS nếu:
- Trả lời trung thực với giới hạn dữ liệu (kể cả khi nói không biết)
- Có trích dẫn hợp lý khi expected_citations yêu cầu
- Không vi phạm must_not_contain

--- TEST CASE ---
id: ${testCase.id}
name: ${testCase.name}
question: ${testCase.question}
expected_citations: ${JSON.stringify(testCase.expected_citations || [])}
must_not_contain: ${JSON.stringify(testCase.must_not_contain || [])}
expect_refusal: ${Boolean(testCase.expect_refusal)}
notes: ${testCase.notes || ''}

--- ANSWER ---
${answer}

--- SOURCES (metadata) ---
${JSON.stringify(sources || [], null, 2)}
`;

  const preferred = process.env.EVAL_JUDGE_PROVIDER || process.env.DEFAULT_CHAT_PROVIDER || 'openai';

  const { result: raw, provider: judgeProvider } = await withProviderFallback(
    'chat',
    async (provider) => {
      const llm = getLLM(provider, { temperature: 0, streaming: false });
      const response = await llm.invoke(judgePrompt);
      const content =
        typeof response?.content === 'string'
          ? response.content
          : Array.isArray(response?.content)
            ? response.content.map((c) => c.text || '').join('')
            : String(response);
      return content;
    },
    { primary: preferred }
  );

  const judged = parseJudgeJson(raw);
  judged.judgeProvider = judgeProvider;
  return judged;
}

function parseJudgeJson(raw) {
  let cleaned = String(raw || '').trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  const brace = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (brace !== -1 && last > brace) cleaned = cleaned.slice(brace, last + 1);

  try {
    const parsed = JSON.parse(cleaned);
    const status = String(parsed.status || '').toUpperCase() === 'PASS' ? 'PASS' : 'FAIL';
    return { status, reason: String(parsed.reason || '').trim() || '(không có lý do)' };
  } catch {
    return {
      status: 'FAIL',
      reason: `Judge trả JSON không hợp lệ: ${String(raw).slice(0, 180)}`,
    };
  }
}

function printHeader() {
  console.log('');
  console.log(chalk.bold.cyan('══════════════════════════════════════════════════════════'));
  console.log(chalk.bold.cyan('   RAG EVALUATION — Automated Quality Gate'));
  console.log(chalk.bold.cyan('══════════════════════════════════════════════════════════'));
  console.log(chalk.gray(`API: ${API_URL}`));
  console.log(chalk.gray(`Providers: ${JSON.stringify(listAvailableProviders())}`));
  console.log('');
}

function printCaseResult(result) {
  const badge =
    result.status === 'PASS'
      ? chalk.bgGreen.black(' PASS ')
      : chalk.bgRed.white(' FAIL ');

  console.log(
    `${badge} ${chalk.bold(result.id)} ${result.name} ${chalk.gray(`(${result.latencyMs} ms)`)}`
  );
  console.log(chalk.gray(`  Q: ${result.question}`));
  console.log(
    chalk.gray(
      `  A: ${result.answer.slice(0, 160).replace(/\s+/g, ' ')}${result.answer.length > 160 ? '…' : ''}`
    )
  );
  if (result.mode) console.log(chalk.gray(`  mode: ${result.mode}`));
  if (result.ruleViolations?.length) {
    console.log(chalk.yellow(`  rule: ${result.ruleViolations.join(' | ')}`));
  }
  console.log(
    result.status === 'PASS'
      ? chalk.green(`  judge: ${result.reason}`)
      : chalk.red(`  judge: ${result.reason}`)
  );
  console.log('');
}

function printSummary(results) {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.length - pass;
  const avg =
    results.length === 0
      ? 0
      : Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length);

  console.log(chalk.bold.cyan('──────────────────────────────────────────────────────────'));
  console.log(chalk.bold(' TỔNG KẾT'));
  console.log(chalk.bold.cyan('──────────────────────────────────────────────────────────'));
  console.log(`  Tổng test : ${chalk.bold(String(results.length))}`);
  console.log(`  PASS      : ${chalk.green.bold(String(pass))}`);
  console.log(`  FAIL      : ${chalk.red.bold(String(fail))}`);
  console.log(`  Latency TB: ${chalk.yellow.bold(`${avg} ms`)}`);
  console.log('');

  const fails = results.filter((r) => r.status === 'FAIL');
  if (fails.length) {
    console.log(chalk.bold.red(' Chi tiết FAIL (để tinh chỉnh prompt):'));
    for (const f of fails) {
      console.log(chalk.red(`  • [${f.id}] ${f.name}`));
      console.log(chalk.red(`    → ${f.reason}`));
      if (f.ruleViolations?.length) {
        console.log(chalk.yellow(`    → rules: ${f.ruleViolations.join('; ')}`));
      }
    }
    console.log('');
  }

  console.log(
    fail === 0
      ? chalk.green.bold('✓ Quality gate: PASSED')
      : chalk.red.bold('✗ Quality gate: FAILED')
  );
  console.log('');
}

async function healthCheck() {
  const base = API_URL.replace(/\/api\/chat\/?$/, '');
  try {
    const res = await fetch(`${base}/api/health`);
    if (!res.ok) throw new Error(`health HTTP ${res.status}`);
    const json = await res.json();
    console.log(chalk.green(`✓ Backend sẵn sàng (ragReady=${json.ragReady})`));
    return true;
  } catch (err) {
    console.log(chalk.red(`✗ Không kết nối được backend tại ${base}`));
    console.log(chalk.yellow('  Hãy chạy: npm run start  (trong thư mục server)'));
    console.log(chalk.gray(`  Chi tiết: ${err.message}`));
    return false;
  }
}

async function runOne(testCase) {
  const chat = await callChatApi(testCase.question);
  const ruleViolations = rulePrecheck(testCase, chat.answer);

  let judge;
  const hasJudgeKey =
    hasProviderKey('openai') || hasProviderKey('deepseek') || hasProviderKey('gemini');

  if (!hasJudgeKey) {
    // Fallback: chỉ rule-based khi không có LLM judge
    judge = {
      status: ruleViolations.length ? 'FAIL' : 'PASS',
      reason: ruleViolations.length
        ? `Rule-only (không có LLM judge): ${ruleViolations.join('; ')}`
        : 'Rule-only PASS (không có LLM judge key — khuyến nghị cấu hình OPENAI/DEEPSEEK/GEMINI)',
    };
  } else {
    judge = await judgeAnswer(testCase, chat.answer, chat.sources);
    // Rule hard-fail luôn thắng nếu vi phạm must_not_contain / thiếu citation bắt buộc
    if (ruleViolations.length) {
      judge = {
        status: 'FAIL',
        reason: `${judge.reason} | Hard-fail rules: ${ruleViolations.join('; ')}`,
      };
    }
  }

  return {
    id: testCase.id,
    name: testCase.name,
    question: testCase.question,
    answer: chat.answer,
    mode: chat.mode,
    latencyMs: chat.latencyMs,
    status: judge.status,
    reason: judge.reason,
    ruleViolations,
  };
}

async function main() {
  printHeader();

  const ok = await healthCheck();
  if (!ok) {
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const tc of TEST_CASES) {
    process.stdout.write(chalk.gray(`→ Đang chạy ${tc.id}... `));
    try {
      const result = await runOne(tc);
      results.push(result);
      console.log(result.status === 'PASS' ? chalk.green('xong') : chalk.red('xong'));
      printCaseResult(result);
    } catch (err) {
      const fail = {
        id: tc.id,
        name: tc.name,
        question: tc.question,
        answer: '',
        mode: 'error',
        latencyMs: 0,
        status: 'FAIL',
        reason: `Lỗi khi gọi API/Judge: ${err.message}`,
        ruleViolations: [],
      };
      results.push(fail);
      console.log(chalk.red('lỗi'));
      printCaseResult(fail);
    }
  }

  printSummary(results);
  const failed = results.some((r) => r.status === 'FAIL');
  process.exitCode = failed ? 1 : 0;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(chalk.red(err.stack || err.message));
    process.exitCode = 1;
  });
}

module.exports = { TEST_CASES, callChatApi, judgeAnswer, rulePrecheck, parseJudgeJson };
