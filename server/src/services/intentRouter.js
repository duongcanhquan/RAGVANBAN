/**
 * Intent Router — phân loại lĩnh vực + mục đích (tra cứu / tư vấn).
 */

const { raceAbort, throwIfAborted } = require('./abortControl');

const DEFAULT_LINH_VUC = 'Chung';

function parseIntentResponse(raw) {
  let cleaned = String(raw || '').trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = {
      linh_vuc: DEFAULT_LINH_VUC,
      keywords: [],
      needs_retrieval: true,
      muc_dich: 'tra_cuu',
    };
  }

  const muc =
    parsed.muc_dich === 'tu_van' || parsed.muc_dich === 'advise'
      ? 'tu_van'
      : parsed.muc_dich === 'so_sanh'
        ? 'so_sanh'
        : 'tra_cuu';

  return {
    linh_vuc: String(parsed.linh_vuc || DEFAULT_LINH_VUC).trim() || DEFAULT_LINH_VUC,
    keywords: Array.isArray(parsed.keywords)
      ? parsed.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 8)
      : [],
    needs_retrieval: parsed.needs_retrieval !== false,
    muc_dich: muc,
  };
}

function heuristicIntent(question, preferredMode) {
  const q = String(question || '').toLowerCase();
  let linh_vuc = DEFAULT_LINH_VUC;

  if (/thuế|thuế thu nhập|vat|gtgt/.test(q)) linh_vuc = 'Thuế';
  else if (/bảo hiểm|bhxh|bhyt/.test(q)) linh_vuc = 'Bảo hiểm xã hội';
  else if (/đất đai|nhà ở|bất động sản|xây dựng/.test(q)) linh_vuc = 'Đất đai';
  else if (/lao động|hợp đồng lao động|lương|nghỉ phép/.test(q)) linh_vuc = 'Lao động';
  else if (/doanh nghiệp|đăng ký kinh doanh|giấy phép/.test(q)) linh_vuc = 'Doanh nghiệp';
  else if (/cccd|căn cước|hộ chiếu|cư trú/.test(q)) linh_vuc = 'Cư trú · Căn cước';
  else if (/hành chính công|bộ phận một cửa|một cửa/.test(q)) linh_vuc = 'Hành chính công';

  let muc_dich = preferredMode === 'advise' ? 'tu_van' : 'tra_cuu';
  if (/so sánh|khác gì|thay thế|sửa đổi/.test(q)) muc_dich = 'so_sanh';
  else if (
    /làm sao|cần gì|hồ sơ|nộp ở đâu|thủ tục|hướng dẫn|tôi muốn|xin cấp|xin cấp lại/.test(q)
  ) {
    muc_dich = 'tu_van';
  }

  return {
    linh_vuc,
    keywords: q
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5),
    needs_retrieval: true,
    muc_dich,
  };
}

/**
 * @param {string} question
 * @param {{ llm?: { invoke: Function }, useLlm?: boolean, mode?: string, signal?: AbortSignal }} options
 */
async function routeIntent(question, options = {}) {
  const { llm = null, useLlm = true, mode = 'lookup', signal } = options;
  throwIfAborted(signal);

  if (!question || !String(question).trim()) {
    return {
      linh_vuc: DEFAULT_LINH_VUC,
      keywords: [],
      needs_retrieval: false,
      muc_dich: mode === 'advise' ? 'tu_van' : 'tra_cuu',
    };
  }

  if (!useLlm || !llm) {
    return heuristicIntent(question, mode);
  }

  const prompt = `Bạn là Intent Router cho Hệ thống văn bản thông minh HCC (Việt Nam).
Phân tích câu hỏi và trả về ĐÚNG một JSON (không giải thích):
{
  "linh_vuc": string,
  "keywords": string[],
  "needs_retrieval": boolean,
  "muc_dich": "tra_cuu" | "tu_van" | "so_sanh"
}

linh_vuc gợi ý: Thuế, Lao động, Đất đai, Hành chính công, Doanh nghiệp, Bảo hiểm xã hội, Cư trú · Căn cước, Chung.
muc_dich: tra_cuu = hỏi quy định/số hiệu; tu_van = hỏi cách làm thủ tục; so_sanh = so sánh/thay thế văn bản.
Chế độ UI người dùng đang chọn: ${mode === 'advise' ? 'tu_van' : 'tra_cuu'} (ưu tiên nếu câu hỏi mơ hồ).

Câu hỏi: """${String(question).trim()}"""`;

  const response = await raceAbort(
    Promise.resolve(signal ? llm.invoke(prompt, { signal }) : llm.invoke(prompt)),
    signal
  );
  const content =
    typeof response?.content === 'string'
      ? response.content
      : Array.isArray(response?.content)
        ? response.content.map((c) => c.text || '').join('')
        : String(response);

  const parsed = parseIntentResponse(content);
  // Nếu UI chọn advise và LLM trả tra_cuu nhưng câu hỏi mang tính thủ tục → giữ tu_van
  if (mode === 'advise' && parsed.muc_dich === 'tra_cuu') {
    const h = heuristicIntent(question, mode);
    if (h.muc_dich === 'tu_van') parsed.muc_dich = 'tu_van';
  }
  return parsed;
}

function shouldSkipIntentLlm(question, mode = 'lookup') {
  const q = String(question || '').trim();
  if (!q) return true;
  const { parseQuestionAnchors } = require('../ingestion/legalChunker');
  const a = parseQuestionAnchors(q);
  if (a.soHieu.length || a.dieu) return true;
  if (a.wantsCompare) return true;
  const h = heuristicIntent(q, mode);
  if (h.linh_vuc !== DEFAULT_LINH_VUC) return true;
  if (q.length < 48 && /^(khoản|điều|vậy|thế|còn)\b/i.test(q)) return true;
  return false;
}

function resolveQaMode(uiMode, intent) {
  if (uiMode === 'advise') return 'advise';
  if (intent?.muc_dich === 'so_sanh') return 'compare';
  return 'lookup';
}

module.exports = {
  routeIntent,
  parseIntentResponse,
  heuristicIntent,
  shouldSkipIntentLlm,
  resolveQaMode,
  DEFAULT_LINH_VUC,
};
