/**
 * Kỹ năng AI + vòng học mỗi ngày.
 * node scripts/test-ai-skills.js
 */
const assert = require('assert');
const {
  matchSkills,
  formatSkillsForPrompt,
  mergeSkillLists,
  DEFAULT_SKILLS,
  slugify,
} = require('../src/services/skillStore');
const { isWeakAnswer, clusterKey, proposeLessons } = require('../src/services/learnLoop');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

test('mergeSkillLists giữ skill hệ thống, admin tắt được', () => {
  const list = mergeSkillLists([{ slug: 'doc-reader', enabled: false, title: 'Cách đọc văn bản' }]);
  const doc = list.find((s) => s.slug === 'doc-reader');
  assert.strictEqual(doc.enabled, false);
  assert.strictEqual(doc.system, true);
  assert.ok(list.some((s) => s.slug === 'direct-answer' && s.enabled));
});

test('mergeSkillLists làm mới hướng dẫn skill hệ thống, không kẹt bản cũ', () => {
  const list = mergeSkillLists([
    {
      slug: 'advise-procedure',
      enabled: true,
      instructions: 'Chỉ liệt kê hồ sơ/bước. Thiếu thì nói chưa có trong kho.',
    },
  ]);
  const advise = list.find((s) => s.slug === 'advise-procedure');
  assert.match(advise.instructions, /tình huống/i);
  assert.ok(!/Chỉ liệt kê hồ sơ\/bước/.test(advise.instructions));
});

test('matchSkills luôn gắn alwaysOn và kích hoạt so sánh khi hỏi sửa đổi', () => {
  const matched = matchSkills(
    'Nghị định này sửa đổi bản nào, bản nào còn hiệu lực?',
    DEFAULT_SKILLS
  );
  assert.ok(matched.some((s) => s.slug === 'doc-reader'));
  assert.ok(matched.some((s) => s.slug === 'compare-amend'));
});

test('formatSkillsForPrompt không cho skill thắng luật cứng', () => {
  const block = formatSkillsForPrompt(DEFAULT_SKILLS.slice(0, 1));
  assert.match(block, /nguyên tắc bắt buộc/i);
  assert.match(block, /Cách đọc văn bản/);
});

test('slugify tiếng Việt', () => {
  assert.ok(slugify('Tư vấn thủ tục').includes('tu-van'));
});

test('isWeakAnswer bắt câu không tìm thấy', () => {
  assert.equal(isWeakAnswer({ question: 'x', answer: 'Không tìm thấy trong kho', citations_used: [] }), true);
  assert.equal(
    isWeakAnswer({
      question: 'x',
      answer: 'Thời hạn là 07 ngày. Nguồn: [NĐ](https://a)',
      citations_used: [{ url: 'https://a' }],
    }),
    false
  );
});

test('proposeLessons gom câu hỏi yếu thành bài mẫu', () => {
  const logs = [
    { question: 'Hồ sơ cấp lại CCCD gồm gì?', answer: 'Không tìm thấy trong kho', citations_used: [] },
    { question: 'Cấp lại CCCD cần hồ sơ nào?', answer: 'Không tìm thấy trong kho', citations_used: [] },
  ];
  const { suggestions, stats } = proposeLessons(logs, { skills: DEFAULT_SKILLS, scenarios: [] });
  assert.ok(stats.weak >= 2);
  assert.ok(suggestions.some((s) => s.kind === 'scenario'));
  const key = clusterKey('Hồ sơ cấp lại CCCD gồm gì?');
  assert.ok(key.includes('cccd') || key.includes('hoso') || key.length > 3);
});

console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
