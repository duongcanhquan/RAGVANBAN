/**
 * Trích xuất metadata văn bản hành chính từ phần đầu tài liệu.
 * Schema mở rộng: cơ quan, văn bản thay thế, trạng thái 3 mức.
 */

const VALID_TRANG_THAI = new Set([
  'Còn hiệu lực',
  'Hết hiệu lực',
  'Bị thay thế một phần',
]);

/** Trạng thái được phép đưa vào retrieval (loại trừ hết hiệu lực). */
const ACTIVE_TRANG_THAI = ['Còn hiệu lực', 'Bị thay thế một phần'];

/**
 * Parse JSON metadata từ chuỗi LLM (loại bỏ markdown fence nếu có).
 */
function parseMetadataJson(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('parseMetadataJson: raw rỗng');
  }

  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Thử cắt object JSON đầu tiên nếu LLM thêm text
  const brace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (brace !== -1 && lastBrace > brace) {
    cleaned = cleaned.slice(brace, lastBrace + 1);
  }

  const parsed = JSON.parse(cleaned);
  return normalizeMetadata(parsed);
}

/**
 * Chuẩn hóa & validate schema metadata.
 */
function normalizeMetadata(input = {}) {
  let vanBanThayThe = input.van_ban_thay_the || [];
  if (typeof vanBanThayThe === 'string') {
    vanBanThayThe = vanBanThayThe
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(vanBanThayThe)) vanBanThayThe = [];

  const linkGoc = String(input.link_goc || input.url_file_goc || '').trim();

  const meta = {
    so_hieu: String(input.so_hieu || 'Không rõ').trim(),
    loai_van_ban: String(input.loai_van_ban || 'Không xác định').trim(),
    ngay_ban_hanh: String(input.ngay_ban_hanh || '').trim(),
    co_quan_ban_hanh: String(input.co_quan_ban_hanh || '').trim(),
    trang_thai: String(input.trang_thai || 'Còn hiệu lực').trim(),
    van_ban_thay_the: vanBanThayThe.map((x) => String(x).trim()).filter(Boolean),
    link_goc: linkGoc,
    // Alias tương thích ngược với pipeline cũ / UI
    url_file_goc: linkGoc,
    ten_file: String(input.ten_file || '').trim(),
    linh_vuc: String(input.linh_vuc || 'Chung').trim(),
  };

  if (!VALID_TRANG_THAI.has(meta.trang_thai)) {
    meta.trang_thai = 'Còn hiệu lực';
  }

  const dateMatch = meta.ngay_ban_hanh.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (dateMatch) {
    const [, y, m, d] = dateMatch;
    meta.ngay_ban_hanh = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return meta;
}

/**
 * Heuristic fallback khi không gọi LLM (dry-run / thiếu key).
 */
function heuristicMetadataFromText(textPrefix, { fileName, urlFileGoc }) {
  const head = (textPrefix || '').slice(0, 1200);
  const soHieuMatch = head.match(
    /(?:Số|So|No\.?)\s*[:：]?\s*([0-9]+\/[A-ZĐ\-0-9]+)/i
  );
  const hetHieuLuc = /hết hiệu lực|bãi bỏ/i.test(head);
  const biThayTheMotPhan = /thay thế một phần|sửa đổi.*bổ sung/i.test(head);

  let loai = 'Văn bản';
  if (/nghị định/i.test(head)) loai = 'Nghị định';
  else if (/thông tư/i.test(head)) loai = 'Thông tư';
  else if (/quyết định/i.test(head)) loai = 'Quyết định';
  else if (/luật/i.test(head)) loai = 'Luật';

  let trang_thai = 'Còn hiệu lực';
  if (hetHieuLuc) trang_thai = 'Hết hiệu lực';
  else if (biThayTheMotPhan) trang_thai = 'Bị thay thế một phần';

  const cqMatch = head.match(
    /(Chính phủ|Bộ [^\n,]{2,40}|Ủy ban nhân dân[^\n,]{0,40}|Quốc hội)/i
  );

  return normalizeMetadata({
    loai_van_ban: loai,
    so_hieu: soHieuMatch ? soHieuMatch[1] : fileName.replace(/\.pdf$/i, ''),
    ngay_ban_hanh: '',
    co_quan_ban_hanh: cqMatch ? cqMatch[1].trim() : '',
    trang_thai,
    van_ban_thay_the: [],
    link_goc: urlFileGoc,
    ten_file: fileName,
    linh_vuc: 'Chung',
  });
}

/**
 * Dùng LLM đọc ~1200 ký tự đầu để extract metadata JSON.
 */
async function extractMetadataFromPrefix(textPrefix, options = {}) {
  const { fileName = '', urlFileGoc = '', llm = null, useLlm = true } = options;
  const prefix = (textPrefix || '').slice(0, 1200);

  if (!useLlm || !llm) {
    return heuristicMetadataFromText(prefix, { fileName, urlFileGoc });
  }

  const prompt = `Bạn là chuyên viên pháp chế Việt Nam. Đọc đoạn đầu văn bản hành chính và trả về ĐÚNG một JSON (không giải thích) với schema:
{
  "so_hieu": string,
  "loai_van_ban": string,
  "ngay_ban_hanh": "YYYY-MM-DD hoặc rỗng",
  "co_quan_ban_hanh": string,
  "trang_thai": "Còn hiệu lực" | "Hết hiệu lực" | "Bị thay thế một phần",
  "van_ban_thay_the": string[],
  "link_goc": string,
  "ten_file": string,
  "linh_vuc": string
}

Quy tắc:
- Nếu không chắc trạng thái → "Còn hiệu lực".
- link_goc = "${urlFileGoc}"
- ten_file = "${fileName}"
- van_ban_thay_the: danh sách số hiệu văn bản thay thế (nếu có), ngược lại [].

Văn bản:
"""
${prefix}
"""`;

  const response = await llm.invoke(prompt);
  const content =
    typeof response?.content === 'string'
      ? response.content
      : Array.isArray(response?.content)
        ? response.content.map((c) => c.text || '').join('')
        : String(response);

  const meta = parseMetadataJson(content);
  meta.link_goc = urlFileGoc || meta.link_goc;
  meta.url_file_goc = meta.link_goc;
  meta.ten_file = fileName || meta.ten_file;
  return meta;
}

module.exports = {
  parseMetadataJson,
  normalizeMetadata,
  heuristicMetadataFromText,
  extractMetadataFromPrefix,
  VALID_TRANG_THAI,
  ACTIVE_TRANG_THAI,
};
