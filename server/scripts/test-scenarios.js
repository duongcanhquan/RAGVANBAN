const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildScenarioRow,
  filterScenarioItems,
  presentScenario,
  formatScenariosForPrompt,
} = require('../src/services/knowledgeStore');
const { expandCategoryIds } = require('../src/services/categoryScope');

test('buildScenarioRow lấy câu hỏi và câu trả lời', () => {
  const row = buildScenarioRow({
    question: 'Học sinh nghỉ học cần giấy gì?',
    answer: 'Đơn xin nghỉ có xác nhận phụ huynh.',
    categoryId: 'cat-1',
  });
  assert.equal(row.suggested_question, 'Học sinh nghỉ học cần giấy gì?');
  assert.equal(row.sample_answer, 'Đơn xin nghỉ có xác nhận phụ huynh.');
  assert.equal(row.category_id, 'cat-1');
  assert.ok(row.title.includes('Học sinh'));
});

test('filterScenarioItems theo hạng mục và từ khóa', () => {
  const items = [
    {
      id: '1',
      category_id: 'gv',
      title: 'Giờ giảng',
      suggested_question: 'Giảng viên dạy bù thế nào?',
      sample_answer: 'Đăng ký phòng.',
    },
    {
      id: '2',
      category_id: 'hs',
      title: 'Nghỉ học',
      suggested_question: 'Học sinh nghỉ ốm',
      sample_answer: 'Nộp đơn.',
    },
  ];
  const onlyHs = filterScenarioItems(items, { categoryIds: ['hs'] });
  assert.equal(onlyHs.length, 1);
  assert.equal(onlyHs[0].id, '2');
  const q = filterScenarioItems(items, { q: 'giảng viên' });
  assert.equal(q.length, 1);
  assert.equal(q[0].id, '1');
});

test('presentScenario alias question/answer', () => {
  const p = presentScenario({
    suggested_question: 'Q',
    sample_answer: 'A',
    category_id: 'x',
  });
  assert.equal(p.question, 'Q');
  assert.equal(p.answer, 'A');
});

test('chọn mục cha gồm hạng mục con', () => {
  const ids = expandCategoryIds(
    [
      { id: 'nganh', parent_id: null },
      { id: 'hang', parent_id: 'nganh' },
      { id: 'chu-de', parent_id: 'hang' },
    ],
    ['nganh']
  );
  assert.ok(ids.includes('hang'));
  assert.ok(ids.includes('chu-de'));
});

test('formatScenariosForPrompt đưa bài mẫu vào prompt', () => {
  const block = formatScenariosForPrompt([
    {
      id: 's1',
      title: 'Cấp lại CCCD',
      suggested_question: 'Hồ sơ cấp lại CCCD gồm gì?',
      sample_answer: 'Đơn + CMND cũ',
    },
  ]);
  assert.match(block, /Bài mẫu/);
  assert.match(block, /CCCD/);
  assert.match(block, /Bố cục mẫu/);
});
