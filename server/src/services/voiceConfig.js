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
- Câu đầu = kết luận đúng hỏi. Cấm mở đầu kiểu "theo quy định hiện hành". Chỉ điều/khoản cần cho câu hỏi.
- Căn cứ: Điều/khoản · số hiệu · cơ quan (hoặc cấp ban hành). Nguồn: 1 dòng/VB [Tên](URL). Ngoặc kép = nguyên văn.
- Giữ tình huống đoạn chat; câu hiện tại là trọng tâm. Không lặp link / Nguồn / Kiểm chứng.
`.trim();

const DEFAULT_LOOKUP_TEMPLATE = `Mẫu tra cứu (định hướng đọc, không phân tích sâu):
**Văn bản liên quan (trực tiếp):** liệt kê ngắn các VB gần nhất cần đọc
**Đọc ngay ở đâu:** chỉ rõ Điều/khoản/mục liên quan trực tiếp
**Tham khảo thêm:** nếu còn VB liên quan gián tiếp, liệt kê kèm mục/điều/khoản cần đọc để tham khảo
**Hiệu lực:** 1 dòng (nếu có sửa đổi thì nêu bản đang áp dụng)
**Nguồn:** 1 dòng/VB`;

const DEFAULT_ADVISE_TEMPLATE = `Mẫu tư vấn:
**Kết luận áp dụng nhanh:** trả lời thẳng hướng xử lý
**Căn cứ chính:** Điều/khoản · số hiệu · cơ quan
**Nên đọc trước:** chỉ rõ mục/điều cần đọc ngay
**Tham khảo thêm:** văn bản hoặc mục liên quan để đọc sâu
**Hồ sơ/bước:** chỉ khi được hỏi và có trong context
**Nguồn:** 1 dòng/VB`;

const DEFAULT_COMPARE_TEMPLATE = `Mẫu so sánh:
**Còn hiệu lực:** số hiệu · ngày
**Giữ / sửa / bãi:** chỉ ý đang hỏi + Điều/khoản
**Nguồn:** 1 dòng/VB`;

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

  return `${v.hardRules}

Vai trò: ${v.role}
Giọng: ${TONE_HINT[v.tone] || TONE_HINT.formal}
Độ dài: ${LENGTH_HINT[v.length] || LENGTH_HINT.short}
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
