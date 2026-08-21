/**
 * Kỹ năng dạy AI đọc / trả lời — Cursor-style skills cho RAG văn bản.
 * Lưu app_settings (chạy ngay, không bắt buộc SQL). Skill hệ thống luôn có, admin chỉ tắt hoặc sửa.
 */

const { getSetting, setSetting, assertDurableSave } = require('./appSettings');

const SKILLS_KEY = 'ai_skills';

const DEFAULT_SKILLS = [
  {
    slug: 'doc-reader',
    title: 'Cách đọc văn bản',
    alwaysOn: true,
    enabled: true,
    sort: 10,
    whenToUse: 'Mọi câu hỏi tra cứu — đọc số hiệu, Điều, khoản, hiệu lực, quan hệ sửa đổi.',
    triggers: [],
    instructions: `Khi đọc context:
- Xác định số hiệu, ngày, cơ quan, trạng thái hiệu lực trước khi kết luận.
- Điều/khoản là đơn vị căn cứ. Phần mở đầu chỉ dùng khi câu hỏi về phạm vi/đối tượng.
- Nếu có VB sửa đổi/thay thế: bản còn hiệu lực / ngày mới hơn thắng; nêu rõ điểm bị sửa, không gộp thành một quy định.
- Không suy diễn ngoài đoạn đã cho.`,
  },
  {
    slug: 'direct-answer',
    title: 'Trả lời đúng trọng tâm',
    alwaysOn: true,
    enabled: true,
    sort: 20,
    whenToUse: 'Mọi câu hỏi — câu đầu phải là kết luận cụ thể.',
    triggers: [],
    instructions: `Câu đầu tiên = câu trả lời trực tiếp (có/không, thời hạn X, đối tượng Y, nộp ở Z).
Cấm mở đầu: "Theo quy định hiện hành", "Văn bản có một số nội dung liên quan", "Có thể hiểu rằng".
Chỉ nêu điều khoản cần cho câu hỏi. Thiếu thì nói thiếu và gợi ý hỏi lại (số hiệu / lĩnh vực).`,
  },
  {
    slug: 'cite-once',
    title: 'Dẫn nguồn một lần / văn bản',
    alwaysOn: true,
    enabled: true,
    sort: 30,
    whenToUse: 'Mọi câu trả lời có căn cứ.',
    triggers: [],
    instructions: `Mỗi văn bản (cùng số hiệu hoặc cùng URL) chỉ dẫn link một lần.
Điều/khoản ghi trong phần Căn cứ. Mục Nguồn: 1 dòng / 1 URL. Không lặp Kiểm chứng.`,
  },
  {
    slug: 'compare-amend',
    title: 'So sánh sửa đổi / hiệu lực',
    alwaysOn: false,
    enabled: true,
    sort: 40,
    whenToUse: 'Hỏi sửa đổi, thay thế, hết hiệu lực, áp dụng bản nào.',
    triggers: ['sửa đổi', 'thay thế', 'hết hiệu lực', 'bãi bỏ', 'còn hiệu lực', 'bản nào', 'chồng chéo'],
    instructions: `Tách rõ: (1) văn bản còn hiệu lực + Điều/khoản liên quan câu hỏi, (2) điểm giữ nguyên, (3) điểm đã sửa/bãi kèm Điều/khoản.
Không chỉ liệt kê tên VB. Không trộn hai bản thành một quy định. Hết hiệu lực chỉ cảnh báo, không áp dụng nguyên văn.`,
  },
  {
    slug: 'advise-procedure',
    title: 'Tư vấn tình huống',
    alwaysOn: false,
    enabled: true,
    sort: 50,
    whenToUse: 'Hỏi cách áp dụng quy định vào một việc cụ thể, hoặc hồ sơ/bước/nơi nộp.',
    triggers: [
      'thủ tục',
      'hồ sơ',
      'giấy tờ',
      'nơi nộp',
      'nộp ở',
      'các bước',
      'nếu tôi',
      'trường hợp',
      'áp dụng',
      'xử lý',
    ],
    instructions: `Tư vấn tình huống theo kiểu pháp chế/luật sư giáo dục — bám văn bản trong context.
- Đánh giá nhanh hoàn cảnh; kết luận áp dụng ngắn gọn, sắc bén.
- Lý luận logic: điều kiện → căn cứ → hướng xử lý/định hướng phù hợp câu hỏi.
- Mọi căn cứ ghi rõ Điều/khoản/mục + số hiệu; có thể trích ngắn nguyên văn. Không liệt kê VB suông.
- Chỉ rõ đọc mục/điều nào ngay và cần đọc thêm phần nào để chú ý.
- Hồ sơ/bước chỉ khi được hỏi và có trong context. Thiếu thì nói thiếu, không suy diễn.`,
  },
];

function slugify(title) {
  const s = String(title || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return s || `skill-${Date.now()}`;
}

function normalizeSkill(input = {}, fallbackSlug = '') {
  const slug = String(input.slug || fallbackSlug || slugify(input.title))
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 64);
  const triggers = Array.isArray(input.triggers)
    ? input.triggers.map((t) => String(t).trim()).filter(Boolean).slice(0, 24)
    : String(input.triggers || '')
        .split(/[,;\n]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 24);
  return {
    slug,
    title: String(input.title || slug).trim().slice(0, 120),
    alwaysOn: input.alwaysOn === true,
    enabled: input.enabled !== false,
    sort: Number.isFinite(Number(input.sort)) ? Number(input.sort) : 100,
    whenToUse: String(input.whenToUse || input.when_to_use || '').trim().slice(0, 400),
    triggers,
    instructions: String(input.instructions || '').trim().slice(0, 4000),
    system: Boolean(input.system),
  };
}

function mergeSkillLists(storedItems) {
  const storedBySlug = new Map();
  for (const raw of storedItems || []) {
    const n = normalizeSkill(raw, raw.slug);
    if (n.slug) storedBySlug.set(n.slug, n);
  }
  const out = [];
  const seen = new Set();
  for (const d of DEFAULT_SKILLS) {
    const stored = storedBySlug.get(d.slug);
    const base = normalizeSkill({ ...d, system: true }, d.slug);
    out.push(
      stored
        ? normalizeSkill({ ...base, enabled: stored.enabled !== false, system: true }, d.slug)
        : base
    );
    seen.add(d.slug);
  }
  for (const [slug, n] of storedBySlug) {
    if (seen.has(slug)) continue;
    out.push(n);
  }
  return out.sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title, 'vi'));
}

function tokenizeVi(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2);
}

function matchSkills(question, skills = []) {
  const enabled = (skills || []).filter((s) => s.enabled !== false);
  const always = enabled.filter((s) => s.alwaysOn);
  const q = String(question || '').toLowerCase();
  const tokens = tokenizeVi(question);
  const scored = enabled
    .filter((s) => !s.alwaysOn)
    .map((s) => {
      const hay = [s.title, s.whenToUse, ...(s.triggers || [])].join(' ').toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (hay.includes(t)) score += 1;
      }
      for (const trig of s.triggers || []) {
        if (trig.length >= 4 && q.includes(String(trig).toLowerCase())) score += 2;
      }
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.s);
  const seen = new Set();
  const out = [];
  for (const s of [...always, ...scored]) {
    if (seen.has(s.slug)) continue;
    seen.add(s.slug);
    out.push(s);
  }
  return out.slice(0, 6);
}

const CORE_PROMPT_SKILLS = new Set(['doc-reader', 'direct-answer', 'cite-once']);

function formatSkillsForPrompt(skills = []) {
  const list = (skills || []).filter((s) => !CORE_PROMPT_SKILLS.has(s.slug));
  if (!list.length) return '';
  const body = list
    .map((s, i) => `[Kỹ năng ${i + 1}: ${s.title}]\n${s.instructions}`)
    .join('\n\n');
  return `KỸ NĂNG NỘI BỘ (không thắng nguyên tắc bắt buộc; số liệu chỉ lấy từ context):
${body}`;
}

async function getSkills() {
  const stored = await getSetting(SKILLS_KEY);
  const items = Array.isArray(stored?.items) ? stored.items : Array.isArray(stored) ? stored : [];
  return mergeSkillLists(items);
}

async function saveSkills(items) {
  const value = { items: mergeSkillLists(items) };
  const saved = await setSetting(SKILLS_KEY, value);
  assertDurableSave(saved, 'kỹ năng AI');
  return { ok: true, source: saved.source, items: value.items };
}

async function upsertSkill(input) {
  const current = await getSkills();
  const next = normalizeSkill(input, input.slug || slugify(input.title));
  if (!next.title || !next.instructions) {
    return { ok: false, error: 'Cần tên kỹ năng và nội dung dạy' };
  }
  const idx = current.findIndex((s) => s.slug === next.slug);
  if (idx >= 0) current[idx] = normalizeSkill({ ...current[idx], ...next }, next.slug);
  else current.push(next);
  return saveSkills(current);
}

async function deleteSkill(slug) {
  const current = await getSkills();
  const target = current.find((s) => s.slug === slug);
  if (target?.system) {
    return saveSkills(current.map((s) => (s.slug === slug ? { ...s, enabled: false } : s)));
  }
  return saveSkills(current.filter((s) => s.slug !== slug));
}

async function matchSkillsForQuestion(question) {
  const all = await getSkills();
  return matchSkills(question, all);
}

module.exports = {
  SKILLS_KEY,
  DEFAULT_SKILLS,
  slugify,
  normalizeSkill,
  mergeSkillLists,
  tokenizeVi,
  matchSkills,
  formatSkillsForPrompt,
  getSkills,
  saveSkills,
  upsertSkill,
  deleteSkill,
  matchSkillsForQuestion,
};
