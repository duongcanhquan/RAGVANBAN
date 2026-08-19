/**
 * Vòng học mỗi ngày — gom câu hỏi yếu từ chat_logs, đề xuất bài mẫu / kỹ năng.
 * Không tự ghi luật vào prompt: admin phải duyệt.
 */

const { tokenizeVi } = require('./skillStore');

function getVerifyReport(log = {}) {
  if (log.verify_report && typeof log.verify_report === 'object') return log.verify_report;
  if (log.tags?.verify && typeof log.tags.verify === 'object') return log.tags.verify;
  return null;
}

function getFeedback(log = {}) {
  const fb = log.tags?.feedback;
  return fb === 'up' || fb === 'down' ? fb : null;
}

function isWeakAnswer(log = {}) {
  if (getFeedback(log) === 'down') return true;
  const answer = String(log.answer || '');
  const verify = getVerifyReport(log);
  if (verify && verify.ok === false) return true;
  const cites = log.citations_used || log.sources;
  const emptyCites =
    !cites ||
    (Array.isArray(cites) && cites.length === 0) ||
    (typeof cites === 'object' && !Array.isArray(cites) && !Object.keys(cites).length);
  if (/không tìm thấy/i.test(answer)) return true;
  if (/chưa có căn cứ|nguồn:\s*\(không có\)/i.test(answer)) return true;
  if (emptyCites && answer.length < 80) return true;
  return false;
}

function pickBestAnswer(logs = []) {
  const score = (log) => {
    let s = 0;
    const verify = getVerifyReport(log);
    if (verify?.ok === true) s += 100;
    if (getFeedback(log) === 'up') s += 50;
    if (getFeedback(log) === 'down') s -= 80;
    const cites = log.citations_used || log.sources;
    if (Array.isArray(cites) && cites.length) s += 30;
    const answer = String(log.answer || '');
    s += Math.min(answer.length, 800) / 20;
    if (/không tìm thấy|chưa có căn cứ|nguồn:\s*\(không có\)/i.test(answer)) s -= 40;
    return s;
  };
  const best = [...(logs || [])].sort((a, b) => score(b) - score(a))[0];
  return String(best?.answer || '').trim().slice(0, 20000);
}

function clusterKey(question) {
  const stop = new Set([
    'của',
    'cho',
    'với',
    'trong',
    'theo',
    'như',
    'nào',
    'gì',
    'hay',
    'và',
    'các',
    'một',
    'này',
    'được',
    'phải',
    'cần',
  ]);
  const tokens = tokenizeVi(question)
    .filter((t) => t.length > 3 && !stop.has(t))
    .slice(0, 8);
  return tokens.sort().slice(0, 4).join(' ');
}

function coversSkill(question, skills = []) {
  const q = String(question || '').toLowerCase();
  return (skills || []).some((s) => {
    if (!s.enabled) return false;
    if (s.alwaysOn) return false;
    return (s.triggers || []).some((t) => t.length >= 4 && q.includes(String(t).toLowerCase()));
  });
}

function coversScenario(question, scenarios = []) {
  const tokens = tokenizeVi(question);
  if (!tokens.length) return false;
  return (scenarios || []).some((s) => {
    const hay = [s.title, s.situation, s.suggested_question, ...(s.tags || [])]
      .join(' ')
      .toLowerCase();
    let hit = 0;
    for (const t of tokens) {
      if (hay.includes(t)) hit += 1;
    }
    return hit >= 2;
  });
}

/**
 * @returns {{ suggestions: object[], stats: object }}
 */
function proposeLessons(logs = [], { skills = [], scenarios = [] } = {}) {
  const weak = (logs || []).filter((l) => l?.question && isWeakAnswer(l));
  const clusters = new Map();
  for (const log of weak) {
    const key = clusterKey(log.question);
    if (!key) continue;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(log);
  }

  const suggestions = [];
  for (const [key, items] of clusters) {
    if (items.length < 2) continue;
    const sample = items[0];
    const q = String(sample.question || '').trim();
    if (!coversScenario(q, scenarios)) {
      suggestions.push({
        id: `sc:${key}`,
        kind: 'scenario',
        title: `Bài mẫu: ${q.slice(0, 80)}`,
        reason: `${items.length} câu hỏi tương tự chưa có bài mẫu / trả lời yếu.`,
        question: q,
        sampleAnswer: pickBestAnswer(items),
        count: items.length,
      });
    }
    if (!coversSkill(q, skills) && suggestions.filter((s) => s.kind === 'skill').length < 4) {
      suggestions.push({
        id: `sk:${key}`,
        kind: 'skill',
        title: `Kỹ năng: ${key}`,
        reason: 'Chủ đề lặp lại nhưng chưa có kỹ năng kích hoạt.',
        question: q,
        whenToUse: `Khi cán bộ hỏi về: ${key}`,
        triggers: key.split(' ').slice(0, 6),
        instructions: `Khi câu hỏi liên quan «${key}»: trả lời đúng trọng tâm từ context; nêu Điều/khoản và số hiệu; thiếu thì nói chưa có trong kho — không bịa.`,
        count: items.length,
      });
    }
  }

  suggestions.sort((a, b) => (b.count || 0) - (a.count || 0));
  return {
    suggestions: suggestions.slice(0, 12),
    stats: {
      scanned: (logs || []).length,
      weak: weak.length,
      clusters: clusters.size,
    },
  };
}

const LEARN_KEY = 'ai_learn';

async function getLearnState() {
  const { getSetting } = require('./appSettings');
  const stored = await getSetting(LEARN_KEY);
  if (stored && typeof stored === 'object') return stored;
  return { lastRun: '', suggestions: [], dismissed: [], stats: {} };
}

async function runDailyLearn() {
  const { listChatLogs } = require('./supabase');
  const { getSkills } = require('./skillStore');
  const { listScenarios } = require('./knowledgeStore');
  const { setSetting, assertDurableSave } = require('./appSettings');

  const logs = await listChatLogs({ limit: 150 });
  const skills = await getSkills();
  const scenarios = (await listScenarios({ limit: 80 })).items || [];
  const { suggestions, stats } = proposeLessons(logs.items || [], { skills, scenarios });
  const prev = await getLearnState();
  const dismissed = new Set(prev.dismissed || []);
  const fresh = suggestions.filter((s) => !dismissed.has(s.id));
  const value = {
    lastRun: new Date().toISOString(),
    stats,
    suggestions: fresh,
    dismissed: prev.dismissed || [],
  };
  const saved = await setSetting(LEARN_KEY, value);
  assertDurableSave(saved, 'vòng học AI');
  return { ok: true, source: saved.source, ...value };
}

async function dismissLearn(id) {
  const { setSetting, assertDurableSave } = require('./appSettings');
  const prev = await getLearnState();
  const dismissed = [...new Set([...(prev.dismissed || []), String(id)])].slice(-200);
  const value = {
    ...prev,
    dismissed,
    suggestions: (prev.suggestions || []).filter((s) => s.id !== id),
  };
  const saved = await setSetting(LEARN_KEY, value);
  assertDurableSave(saved, 'vòng học AI');
  return { ok: true, ...value };
}

async function approveLearn(suggestion, { createdBy } = {}) {
  if (!suggestion?.kind) return { ok: false, error: 'Thiếu gợi ý' };
  if (suggestion.kind === 'scenario') {
    const { createScenario } = require('./knowledgeStore');
    const made = await createScenario({
      title: suggestion.title.replace(/^Bài mẫu:\s*/i, '').slice(0, 200),
      situation: suggestion.question || suggestion.title,
      suggested_question: suggestion.question || '',
      sample_answer: String(suggestion.sampleAnswer || '').slice(0, 20000),
      tags: ['hoc-moi-ngay'],
      created_by: createdBy || 'learn-loop',
    });
    if (!made.ok) return made;
    await dismissLearn(suggestion.id);
    return { ok: true, kind: 'scenario', item: made.item };
  }
  if (suggestion.kind === 'skill') {
    const { upsertSkill } = require('./skillStore');
    const made = await upsertSkill({
      title: suggestion.title.replace(/^Kỹ năng:\s*/i, '').slice(0, 120),
      whenToUse: suggestion.whenToUse || '',
      triggers: suggestion.triggers || [],
      instructions: suggestion.instructions || '',
      alwaysOn: false,
      enabled: true,
      sort: 80,
    });
    if (!made.ok) return made;
    await dismissLearn(suggestion.id);
    return { ok: true, kind: 'skill' };
  }
  return { ok: false, error: 'Loại gợi ý không hỗ trợ' };
}

module.exports = {
  isWeakAnswer,
  getVerifyReport,
  pickBestAnswer,
  clusterKey,
  coversSkill,
  coversScenario,
  proposeLessons,
  LEARN_KEY,
  getLearnState,
  runDailyLearn,
  dismissLearn,
  approveLearn,
};
