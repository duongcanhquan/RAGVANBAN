/**
 * Cross-encoder rerank nhẹ (bigram/cụm từ) + tuỳ chọn Cohere Rerank API.
 */

const { tokenizeVi } = require('../ingestion/legalChunker');

function bigrams(tokens) {
  const out = []
  for (let i = 0; i < tokens.length - 1; i += 1) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`)
  }
  return out
}

function phraseOverlapScore(question, text) {
  const qTokens = tokenizeVi(question)
  if (!qTokens.length) return 0
  const hay = new Set(tokenizeVi(text))
  let unigram = 0
  for (const t of qTokens) {
    if (hay.has(t)) unigram += 1
  }
  const qBi = bigrams(qTokens)
  const hBi = new Set(bigrams([...hay]))
  let bi = 0
  for (const b of qBi) {
    if (hBi.has(b)) bi += 1
  }
  const u = unigram / qTokens.length
  const b = qBi.length ? bi / qBi.length : 0
  return u * 0.45 + b * 0.55
}

/**
 * Ghi đè score — kết hợp rerankLegal + cross phrase.
 */
function applyCrossEncoderRerank(question, matches, options = {}) {
  const weight = Number(options.weight) || 0.18
  const topN = Math.max(1, Number(options.topN) || 24)
  const list = (matches || []).slice(0, topN)
  const rest = (matches || []).slice(topN)

  const scored = list.map((m) => {
    const corpus = `${m.heading || ''} ${m.so_hieu || ''} ${m.text || ''}`
    const phrase = phraseOverlapScore(question, corpus)
    const base = Number(m.score) || 0
    return {
      ...m,
      phraseScore: phrase,
      score: base * (1 - weight) + phrase * weight,
    }
  })

  scored.sort((a, b) => (b.score || 0) - (a.score || 0))
  return [...scored, ...rest]
}

async function cohereRerank(question, matches, options = {}) {
  const apiKey = process.env.COHERE_API_KEY || process.env.COHERE_RERANK_API_KEY
  if (!apiKey) return matches

  const topN = Math.min(Number(options.topN) || 24, (matches || []).length)
  if (!topN) return matches

  const docs = matches.slice(0, topN).map((m) => ({
    id: m.id,
    text: `${m.heading || ''}\n${m.text || ''}`.slice(0, 4000),
  }))

  const model = process.env.COHERE_RERANK_MODEL || 'rerank-v3.5'
  const res = await fetch('https://api.cohere.com/v1/rerank', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      query: question,
      documents: docs.map((d) => d.text),
      top_n: topN,
    }),
  })

  if (!res.ok) return matches
  const json = await res.json().catch(() => ({}))
  const results = json.results || []
  if (!results.length) return matches

  const byIdx = new Map(results.map((r) => [r.index, r.relevance_score]))
  const head = matches.slice(0, topN).map((m, i) => ({
    ...m,
    cohereScore: byIdx.get(i) ?? null,
    score: byIdx.has(i) ? Number(byIdx.get(i)) : m.score,
  }))
  head.sort((a, b) => (b.score || 0) - (a.score || 0))
  return [...head, ...matches.slice(topN)]
}

async function rerankWithCrossEncoder(question, matches, options = {}) {
  if (options.enabled === false) return matches
  let out = applyCrossEncoderRerank(question, matches, options)
  if (options.useCohere && (process.env.COHERE_API_KEY || process.env.COHERE_RERANK_API_KEY)) {
    out = await cohereRerank(question, out, options)
  }
  return out
}

module.exports = {
  phraseOverlapScore,
  applyCrossEncoderRerank,
  cohereRerank,
  rerankWithCrossEncoder,
}
