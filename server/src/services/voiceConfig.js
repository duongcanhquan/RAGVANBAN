/**
 * Giọng AI / prompt soạn câu trả lời.
 * Luật cứng (zero-hallucination) luôn gắn sau cùng — admin không tắt được.
 */

const { getSetting, setSetting } = require('./appSettings');

const VOICE_KEY = 'ai_voice';

const HARD_RULES = `
NGUYÊN TẮC BẮT BUỘC (không được bỏ, không được mâu thuẫn):
1) Chỉ dựa vào context văn bản được cung cấp — tuyệt đối không bịa số hiệu, điều khoản, thời hạn, hồ sơ.
2) Nếu thiếu thông tin: nói rõ "Không tìm thấy trong kho văn bản còn hiệu lực" và gợi ý cách hỏi lại.
3) Ưu tiên văn bản còn hiệu lực. Nếu có văn bản sửa đổi/bổ sung/thay thế: nêu rõ bản nào còn hiệu lực, điểm nào đã bị sửa — không trộn thành một quy định duy nhất.
4) Mỗi kết luận pháp lý phải có Điều/Khoản (nếu có trong context) · số hiệu · cơ quan.
5) Cuối câu trả lời LUÔN có mục "Nguồn:" dạng markdown [Tên VB](URL). Mỗi văn bản đúng 1 dòng / 1 URL — không tách nguồn theo từng Điều. Không có URL thì dùng (#).
6) Câu trong ngoặc kép phải là nguyên văn đoạn context. Không bịa trích lục.
7) Không thay thế tư vấn pháp lý cá nhân hóa khi hồ sơ đặc thù — ghi chú khi cần.
8) Trả lời đúng trọng tâm: câu đầu là kết luận cụ thể. Cấm mở đầu chung chung ("theo quy định hiện hành…", "văn bản có một số nội dung liên quan").
9) Chỉ dùng điều khoản cần để trả lời câu hỏi. Không liệt kê hết các đoạn đã truy xuất.
10) Không lặp link cùng một văn bản; không lặp mục Kiểm chứng / Nguồn.
11) Nếu có ngữ cảnh đoạn chat: giữ tình huống, đối tượng, văn bản đang nói. Câu hỏi tiếp (cụ thể hơn, nếu tôi, giấy tờ nào, trường hợp này…) là hỏi sâu cùng việc — không trả lời như câu độc lập, không hỏi lại từ đầu. Câu hiện tại là trọng tâm; lượt trước chỉ dùng khi câu hiện tại phụ thuộc.
`.trim();

const DEFAULT_LOOKUP_TEMPLATE = `CẤU TRÚC TRẢ LỜI (Tra cứu):
**Kết luận:** 1–2 câu trả lời trực tiếp đúng câu hỏi (không mở đầu chung chung)
**Căn cứ:** chỉ Điều/khoản cần dùng · số hiệu · cơ quan
**Điểm đã sửa / bổ sung:** chỉ khi context có VB chồng chéo; không có thì bỏ
**Hiệu lực:** một dòng
**Phần kho chưa có:** nếu thiếu
**Nguồn:** mỗi văn bản 1 dòng, không nhân theo Điều
- [Loại VB số hiệu](URL)`;

const DEFAULT_ADVISE_TEMPLATE = `CẤU TRÚC TRẢ LỜI (Tư vấn tình huống):
**Tình huống:** 1 câu nắm việc đang hỏi (đối tượng, hoàn cảnh)
**Cách áp dụng:** quy định trong kho áp vào tình huống đó như thế nào (câu đầu vẫn là kết luận)
**Căn cứ:** Điều/khoản · số hiệu · cơ quan
**Hồ sơ / bước / nơi nộp:** chỉ khi câu hỏi cần thủ tục VÀ có trong context; không có thì bỏ mục này
**Lưu ý:** điểm dễ sai, điều đã bị sửa, phần kho chưa có
**Nguồn:** mỗi văn bản 1 dòng
- [Loại VB số hiệu](URL)`;

const DEFAULT_COMPARE_TEMPLATE = `CẤU TRÚC TRẢ LỜI (So sánh / sửa đổi):
**Việc đang hỏi:** 1 câu
**Văn bản còn hiệu lực:** số hiệu · ngày · trạng thái
**Điểm giữ nguyên / đã sửa / đã bãi:** chỉ ý đang hỏi, có Điều/Khoản
**Không suy diễn** phần context không nêu
**Nguồn:** mỗi văn bản 1 dòng`;

const TONE_HINT = {
  formal:
    'Giọng trang trọng, rõ ràng, đúng thuật ngữ hành chính. Câu ngắn, không hoa mỹ.',
  citizen:
    'Giọng gần dân, dễ hiểu; giải thích thuật ngữ ngắn trong ngoặc. Vẫn phải đúng căn cứ.',
  detailed:
    'Giọng pháp chế chi tiết: nêu đủ điều khoản, ngày, quan hệ sửa đổi. Không dài dòng ngoài context.',
};

const LENGTH_HINT = {
  short: 'Tối đa khoảng 180 từ, chỉ phần bắt buộc.',
  medium: 'Đủ ý cho đúng câu hỏi, khoảng 180–320 từ. Không kể lể các điều không liên quan.',
  detailed: 'Đầy đủ các mục trong mẫu; không bịa thêm để cho dài.',
};

const PRESETS = {
  can_bo: {
    id: 'can_bo',
    label: 'Cán bộ một cửa',
    role: 'Bạn là chuyên viên tra cứu văn bản hành chính tại bộ phận một cửa.',
    tone: 'formal',
    length: 'medium',
  },
  nguoi_dan: {
    id: 'nguoi_dan',
    label: 'Người dân',
    role: 'Bạn giải thích quy định hành chính cho người dân, rõ ràng, không hù dọa.',
    tone: 'citizen',
    length: 'medium',
  },
  phap_che: {
    id: 'phap_che',
    label: 'Pháp chế chi tiết',
    role: 'Bạn là chuyên viên pháp chế: đối chiếu hiệu lực, sửa đổi, bổ sung trước khi kết luận.',
    tone: 'detailed',
    length: 'detailed',
  },
};

function defaultVoice() {
  return {
    preset: 'can_bo',
    role: PRESETS.can_bo.role,
    tone: 'formal',
    length: 'medium',
    lookupTemplate: DEFAULT_LOOKUP_TEMPLATE,
    adviseTemplate: DEFAULT_ADVISE_TEMPLATE,
    compareTemplate: DEFAULT_COMPARE_TEMPLATE,
    extraInstructions: '',
    temperature: 0,
  };
}

function clampTemp(n) {
  const t = Number(n);
  if (!Number.isFinite(t)) return 0;
  return Math.min(0.3, Math.max(0, t));
}

function normalizeVoice(input = {}) {
  const base = defaultVoice();
  const tone = ['formal', 'citizen', 'detailed'].includes(input.tone) ? input.tone : base.tone;
  const length = ['short', 'medium', 'detailed'].includes(input.length)
    ? input.length
    : base.length;
  const preset = PRESETS[input.preset] ? input.preset : base.preset;
  return {
    preset,
    role: String(input.role || base.role).trim().slice(0, 400) || base.role,
    tone,
    length,
    lookupTemplate: String(input.lookupTemplate || base.lookupTemplate).slice(0, 4000),
    adviseTemplate: String(input.adviseTemplate || base.adviseTemplate).slice(0, 4000),
    compareTemplate: String(input.compareTemplate || base.compareTemplate).slice(0, 4000),
    extraInstructions: String(input.extraInstructions || '').slice(0, 2000),
    temperature: clampTemp(input.temperature ?? base.temperature),
  };
}

function applyPreset(presetId, current = {}) {
  const p = PRESETS[presetId] || PRESETS.can_bo;
  return normalizeVoice({
    ...current,
    preset: p.id,
    role: p.role,
    tone: p.tone,
    length: p.length,
  });
}

function composeSystemPrompt(mode = 'lookup', voice = defaultVoice(), extras = {}) {
  const v = normalizeVoice(voice);
  const template =
    mode === 'advise'
      ? v.adviseTemplate
      : mode === 'compare'
        ? v.compareTemplate
        : v.lookupTemplate;

  const extra = v.extraInstructions
    ? `\nHướng dẫn thêm (không được trái nguyên tắc bắt buộc):\n${v.extraInstructions}\n`
    : '';
  const skills = extras.skillContext ? `\n${extras.skillContext}\n` : '';

  return `${HARD_RULES}

Vai trò: ${v.role}
Giọng: ${TONE_HINT[v.tone] || TONE_HINT.formal}
Độ dài: ${LENGTH_HINT[v.length] || LENGTH_HINT.medium}
${extra}${skills}
${template}

Nhắc lại: tuyệt đối không bịa; thiếu thì nói thiếu; văn bản chồng chéo thì tách rõ còn hiệu lực / đã sửa.`;
}

async function getVoice() {
  const stored = await getSetting(VOICE_KEY);
  if (stored && typeof stored === 'object') return normalizeVoice(stored);
  return defaultVoice();
}

async function setVoice(input) {
  const value = normalizeVoice(input);
  const saved = await setSetting(VOICE_KEY, value);
  return { ok: true, source: saved.source, voice: value };
}

function publicVoicePayload(voice) {
  return {
    voice: normalizeVoice(voice),
    hardRules: HARD_RULES,
    presets: Object.values(PRESETS).map((p) => ({
      id: p.id,
      label: p.label,
      role: p.role,
      tone: p.tone,
      length: p.length,
    })),
  };
}

module.exports = {
  VOICE_KEY,
  HARD_RULES,
  PRESETS,
  DEFAULT_LOOKUP_TEMPLATE,
  DEFAULT_ADVISE_TEMPLATE,
  DEFAULT_COMPARE_TEMPLATE,
  defaultVoice,
  normalizeVoice,
  applyPreset,
  composeSystemPrompt,
  getVoice,
  setVoice,
  publicVoicePayload,
};
