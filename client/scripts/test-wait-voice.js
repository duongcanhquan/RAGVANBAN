/**
 * Motion copy + mic transcript / lỗi giọng nói.
 * node scripts/test-wait-voice.js
 */
import assert from 'node:assert/strict'
import { digitizeFunLine, chatWaitScene } from '../src/lib/waitScenes.js'
import {
  speechErrorMessage,
  mergeListenTranscript,
  shouldCommitListen,
  joinListenParts,
  isRetryableListenError,
} from '../src/lib/speechListen.js'

const ocr = digitizeFunLine(42, 'Đang OCR trang 12/28…')
assert.match(ocr, /OCR|trang|đọc/i)

const search = chatWaitScene('Đang tìm văn bản còn hiệu lực…')
assert.equal(search.kind, 'search')
assert.ok(search.line.length > 8)

const compose = chatWaitScene('Đã tìm 6 đoạn · đang soạn trả lời…')
assert.equal(compose.kind, 'compose')

assert.match(speechErrorMessage('not-allowed'), /micro/i)
assert.match(speechErrorMessage('no-speech'), /mic|giọng/i)
assert.equal(speechErrorMessage('aborted'), '')
assert.match(speechErrorMessage('network'), /Chrome|Edge|mạng/i)

const results = [
  { isFinal: true, 0: { transcript: 'hỏi về nghị định' } },
  { isFinal: false, 0: { transcript: ' 168' } },
]
const merged = mergeListenTranscript(results, 1)
assert.equal(merged.finalText, 'hỏi về nghị định')
assert.equal(merged.display, 'hỏi về nghị định 168')
assert.equal(merged.interim, '168')

assert.equal(shouldCommitListen('hi'), false)
assert.equal(shouldCommitListen('nghỉ học'), true)
assert.equal(shouldCommitListen('thủ tục cấp căn cước'), true)
assert.equal(shouldCommitListen('  ab  '), false)

assert.equal(joinListenParts('câu một', 'câu hai', 'đang nói'), 'câu một câu hai đang nói')
assert.equal(isRetryableListenError('no-speech'), true)
assert.equal(isRetryableListenError('network'), true)
assert.equal(isRetryableListenError('not-allowed'), false)

console.log('✓ wait scenes + speech listen')
