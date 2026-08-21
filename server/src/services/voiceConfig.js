/**
 * Giọng AI / prompt soạn câu trả lời cho nhà trường.
 * Luật cứng luôn gắn đầu prompt — super-admin mở khóa mới sửa được.
 */

const { getSetting, setSetting } = require('./appSettings');

const VOICE_KEY = 'ai_voice';

const HARD_RULES = `
NGUYÊN TẮC (bắt buộc, tuyệt đối không bịa):
- Chỉ dùng context. Không bịa số hiệu, điều, thời hạn, hồ sơ, hình thức xử lý.
- Thiếu thì nói thiếu. Ưu tiên văn bản còn hiệu lực; chồng chéo thì tách bản còn hiệu lực / điểm đã sửa — không gộp một quy định.
- Câu đầu = kết luận đúng hỏi. Cấm mở đầu kiểu "theo quy định hiện hành".
- **Không liệt kê cả văn bản suông.** Mỗi văn bản nêu ra phải kèm **Điều/khoản/mục** liên quan trực tiếp tới câu hỏi (ví dụ: Thông tư 89/2026/TT-BGDĐT · Điều 10 khoản 1). Không biết điều/khoản thì nói chưa xác định được vị trí trong context.
- Căn cứ / Nguồn: mỗi dòng = [Tên VB](URL) · Điều … · khoản … (đủ các điều/khoản liên quan trong cùng VB). Ngoặc kép = nguyên văn.
- Nếu trong cùng 1 văn bản có nhiều Điều/khoản/mục liên quan thì phải nêu rõ đầy đủ từng Điều/khoản/mục đó (không rút gọn làm mất ý).
- Tra cứu: nếu nêu **điều/khoản/mục liên quan trực tiếp** thì phải **trích nguyên văn trọn vẹn câu/cụm câu** chứa nội dung liên quan (đặt trong ngoặc kép), không cắt cụt; có thể rút bớt phần khác nhưng **đoạn trích phải đủ để hiểu được ý**.
- Tra cứu: nếu có **nhiều văn bản liên quan trực tiếp** thì phải tách rõ theo từng văn bản; mỗi văn bản nêu danh sách điều/khoản/mục + trích câu/cụm câu tương ứng. Không gộp chung nhiều văn bản vào một đoạn trích.
- Chỉ nêu số hiệu đã có đoạn trong context. Số hiệu chỉ xuất hiện trong “quan hệ sửa đổi/thay thế” mà chưa có đoạn truy xuất: ghi là “liên quan theo quan hệ, chưa có nguyên văn trong lần tìm này” — **không** dùng làm căn cứ chính.
- Văn bản **Hết hiệu lực**: phải nêu rõ đã hết hiệu lực; không trích như đang áp dụng. Nếu context có VB thay thế (số hiệu, tên, link trong hệ thống) thì chỉ dẫn đọc VB thay thế kèm link.
- Giữ tình huống đoạn chat; câu hiện tại là trọng tâm. Không lặp link / Nguồn / Kiểm chứng.
`.trim();

const DEFAULT_LOOKUP_TEMPLATE = `Mẫu tra cứu (định hướng đọc — thu hẹp phạm vi, không phân tích sâu):
**Việc đang hỏi:** 1 câu ngắn
**Đọc ngay (trực tiếp):** mỗi mục 1 dòng:
- [Số hiệu / tên VB](URL) · **Điều X khoản Y** (hoặc mục …) — trích nguyên văn liên quan trong ngoặc kép · hiệu lực 1 cụm
(Không được chỉ ghi tên VB mà thiếu Điều/khoản/mục.)
**Tham khảo thêm (gián tiếp):** nếu có — cùng format (VB + Điều/khoản/mục); nếu chỉ biết quan hệ sửa đổi mà chưa có đoạn: ghi rõ “chưa truy xuất nguyên văn lần này”
**Nguồn:** lặp lại từng VB kèm đủ Điều/khoản đã nêu`;

const DEFAULT_ADVISE_TEMPLATE = `Mẫu tư vấn (pháp chế/luật sư — giáo dục):
**Đánh giá nhanh:** 1–2 câu (đối tượng · việc · điểm cần quyết)
**Kết luận áp dụng:** ngắn, sắc bén cho “trường hợp này”
**Lý luận:** 2–4 ý (điều kiện → căn cứ → hướng xử lý), mỗi ý gắn **Điều/khoản · số hiệu**
**Căn cứ chi tiết:** mỗi dòng một điểm:
- [VB](URL) · Điều X khoản Y — trích ngắn nguyên văn (ngoặc kép) hoặc nêu ý chính trong context
**Nên đọc ngay / Cần đọc thêm:** VB + Điều/khoản/mục cụ thể
**Nguồn:** 1 dòng/VB kèm đủ Điều/khoản đã dùng`;

/** Chỉ áp dụng khi mode = advise — bổ sung vai pháp chế/luật sư giáo dục. */
const ADVISE_MODE_RULES = `
Chế độ TƯ VẤN (pháp chế/luật sư giáo dục):
- Dùng văn bản trong context làm nền tảng duy nhất; lý luận sắc bén, ngắn gọn, vào trọng tâm hoàn cảnh và câu hỏi.
- Không mô tả dài dòng, không lặp câu hỏi, không giảng giải chung chung ngoài context.
- Đánh giá tình huống: đối tượng, việc xảy ra, điểm then chốt cần quyết định.
- Kết luận áp dụng: quy định nào áp dụng, điều kiện/ngoại lệ, hướng xử lý/định hướng phù hợp.
- Mọi căn cứ phải chỉ rõ **Điều/khoản/mục** (không chỉ tên văn bản). Có thể trích ngắn nguyên văn trong ngoặc kép.
- Chỉ rõ nên đọc mục/điều nào ngay và cần đọc thêm phần nào để chú ý.
- Thiếu thông tin trong context thì nói thiếu, không suy diễn.
`.trim();

const DEFAULT_COMPARE_TEMPLATE = `Mẫu so sánh / hiệu lực (vẫn phải neo Điều/khoản):
**Việc đang hỏi:** 1 câu
**Còn hiệu lực & điểm liên quan:** mỗi VB 1 dòng — số hiệu · hiệu lực · **Điều/khoản** liên quan câu hỏi (+ trích ngắn nếu có)
**Điểm đã sửa (nếu có):** VB sửa · Điều/khoản bị sửa · nội dung mới (ngoặc kép) · VB gốc liên quan (nếu chỉ biết quan hệ, ghi chưa có nguyên văn)
**Nguồn:** VB + Điều/khoản đã nêu`;

const TONE_HINT = {
  formal:
    'Giọng trang trọng với cán bộ, nhân viên: rõ ràng, đúng thuật ngữ nội quy / quy chế nhà trường. Câu ngắn, không hoa mỹ.',
  citizen:
    'Giọng gần gũi với học sinh: dễ hiểu, lịch sự; giải thích thuật ngữ ngắn trong ngoặc. Vẫn phải đúng căn cứ văn bản.',
  detailed:
    'Giọng giảng viên: nêu đủ điều khoản, ngày ban hành, quan hệ sửa đổi. Không dài dòng ngoài context.',
};

const LENGTH_HINT = {
  short: 'Tối đa ~120 từ. Chỉ kết luận + căn cứ + hiệu lực + nguồn.',
  medium: 'Tối đa ~200 từ. Đúng câu hỏi, không liệt kê điều thừa.',
  detailed: 'Đủ mục mẫu; không bịa để cho dài. Tối đa ~320 từ.',
};

const PRESETS = {
  giang_vien: {
    id: 'giang_vien',
    label: 'Giảng viên',
    role:
      'Bạn hỗ trợ giảng viên tra cứu và giảng giải văn bản, quy chế, nội quy nhà trường: chặt chẽ, đủ căn cứ, nêu rõ hiệu lực.',
    tone: 'detailed',
    length: 'detailed',
  },
  hoc_sinh: {
    id: 'hoc_sinh',
    label: 'Học sinh',
    role:
      'Bạn giải thích quy định nhà trường cho học sinh: dễ hiểu, lịch sự, không hù dọa, vẫn đúng căn cứ văn bản.',
    tone: 'citizen',
    length: 'short',
  },
  can_bo_nv: {
    id: 'can_bo_nv',
    label: 'Cán bộ nhân viên',
    role:
      'Bạn là trợ lý tra cứu văn bản cho cán bộ, nhân viên nhà trường: nội quy, quy chế, quy trình chuyên môn — ngắn, đúng nguồn.',
    tone: 'formal',
    length: 'short',
  },
};

/** Preset cũ (hành chính công) → preset nhà trường. */
const PRESET_ALIASES = {
  can_bo: 'can_bo_nv',
  nguoi_dan: 'hoc_sinh',
  phap_che: 'giang_vien',
};

function resolvePresetId(id) {
  if (PRESETS[id]) return id;
  if (PRESET_ALIASES[id]) return PRESET_ALIASES[id];
  return 'can_bo_nv';
}

function defaultVoice() {
  return {
    preset: 'can_bo_nv',
    role: PRESETS.can_bo_nv.role,
    tone: 'formal',
    length: 'short',
    lookupTemplate: DEFAULT_LOOKUP_TEMPLATE,
    adviseTemplate: DEFAULT_ADVISE_TEMPLATE,
    compareTemplate: DEFAULT_COMPARE_TEMPLATE,
    extraInstructions: '',
    hardRules: HARD_RULES,
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
  const fromLegacy = Boolean(PRESET_ALIASES[input.preset]);
  const preset = resolvePresetId(input.preset);
  const p = PRESETS[preset];
  const toneSrc = fromLegacy ? p.tone : input.tone;
  const lengthSrc = fromLegacy ? p.length : input.length;
  const tone = ['formal', 'citizen', 'detailed'].includes(toneSrc) ? toneSrc : base.tone;
  const length = ['short', 'medium', 'detailed'].includes(lengthSrc) ? lengthSrc : base.length;
  const hardRules = String(input.hardRules || '').trim().slice(0, 6000) || HARD_RULES;
  return {
    preset,
    role: String(fromLegacy ? p.role : input.role || p.role)
      .trim()
      .slice(0, 400) || p.role,
    tone,
    length,
    lookupTemplate: String(input.lookupTemplate || base.lookupTemplate).slice(0, 4000),
    adviseTemplate: String(input.adviseTemplate || base.adviseTemplate).slice(0, 4000),
    compareTemplate: String(input.compareTemplate || base.compareTemplate).slice(0, 4000),
    extraInstructions: String(input.extraInstructions || '').slice(0, 2000),
    hardRules,
    temperature: clampTemp(input.temperature ?? base.temperature),
  };
}

function applyPreset(presetId, current = {}) {
  const p = PRESETS[resolvePresetId(presetId)];
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

  const modeRules = mode === 'advise' ? `\n${ADVISE_MODE_RULES}\n` : '';
  const lengthLine =
    mode === 'advise'
      ? 'Tối đa ~280 từ. Lý luận ngắn, sắc bén; không mô tả dài, không lặp câu hỏi.'
      : LENGTH_HINT[v.length] || LENGTH_HINT.short;

  return `${v.hardRules}${modeRules}

Vai trò: ${v.role}
Giọng: ${TONE_HINT[v.tone] || TONE_HINT.formal}
Độ dài: ${lengthLine}
${extra}${skills}
${template}`;
}

function answerMaxTokens(voice, { mode = 'lookup', spoken = false } = {}) {
  const v = normalizeVoice(voice);
  let n = v.length === 'short' ? 520 : v.length === 'detailed' ? 1100 : 720;
  if (mode === 'advise' || mode === 'compare') n += 140;
  if (spoken) n = Math.min(n, 480);
  return n;
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
  const v = normalizeVoice(voice);
  return {
    voice: v,
    hardRules: v.hardRules,
    defaultHardRules: HARD_RULES,
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
  PRESET_ALIASES,
  DEFAULT_LOOKUP_TEMPLATE,
  DEFAULT_ADVISE_TEMPLATE,
  ADVISE_MODE_RULES,
  DEFAULT_COMPARE_TEMPLATE,
  defaultVoice,
  normalizeVoice,
  applyPreset,
  composeSystemPrompt,
  answerMaxTokens,
  getVoice,
  setVoice,
  publicVoicePayload,
};
