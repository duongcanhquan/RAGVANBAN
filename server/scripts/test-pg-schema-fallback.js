const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  pgErrorText,
  missingColumnFromPgError,
  foldColumnIntoMetadata,
  writeWithColumnFallback,
  selectColumnsWithFallback,
  resetMissingDocumentColumns,
  omitKnownMissingColumns,
  rememberMissingDocumentColumn,
} = require('../src/services/pgSchemaFallback');

test('bắt tên cột từ lỗi schema cache của PostgREST', () => {
  const err = {
    code: 'PGRST204',
    message: "Could not find the 'byte_size' column of 'documents' in the schema cache.",
  };
  assert.match(pgErrorText(err), /byte_size/);
  assert.equal(missingColumnFromPgError(err), 'byte_size');
});

test('bắt tên cột từ lỗi Postgres does not exist', () => {
  assert.equal(
    missingColumnFromPgError({ message: 'column "content_sha256" of relation "documents" does not exist' }),
    'content_sha256'
  );
});

test('gấp cột thiếu vào metadata, không gửi lại top-level', () => {
  const next = foldColumnIntoMetadata(
    { file_name: 'a.pdf', byte_size: 1200, metadata: { display_name: 'A' } },
    'byte_size'
  );
  assert.equal(next.byte_size, undefined);
  assert.equal(next.metadata.byte_size, 1200);
  assert.equal(next.metadata.display_name, 'A');
  assert.equal(next.file_name, 'a.pdf');
});

test('ghi documents: thiếu byte_size thì retry không còn cột đó', async () => {
  resetMissingDocumentColumns();
  const calls = [];
  const { data, error } = await writeWithColumnFallback(async (body) => {
    calls.push(body);
    if (Object.prototype.hasOwnProperty.call(body, 'byte_size')) {
      return {
        data: null,
        error: { message: "Could not find the 'byte_size' column of 'documents' in the schema cache." },
      };
    }
    return { data: { id: 'ok-1' }, error: null };
  }, {
    file_name: 'a.pdf',
    byte_size: 99,
    content_sha256: 'ab'.repeat(32),
    metadata: { source: 'upload' },
  });
  assert.equal(error, null);
  assert.equal(data.id, 'ok-1');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].byte_size, 99);
  assert.equal(calls[1].byte_size, undefined);
  assert.equal(calls[1].metadata.byte_size, 99);
  assert.equal(omitKnownMissingColumns({ byte_size: 1, file_name: 'x' }).byte_size, undefined);
});

test('lần ghi sau nhớ cột thiếu — không gửi byte_size nữa', async () => {
  rememberMissingDocumentColumn('byte_size');
  const calls = [];
  await writeWithColumnFallback(async (body) => {
    calls.push(body);
    return { data: { id: 'ok-2' }, error: null };
  }, { file_name: 'b.pdf', byte_size: 3 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].byte_size, undefined);
  resetMissingDocumentColumns();
});

test('update thiếu cột thì gộp metadata cũ, không ghi đè JSONB', async () => {
  resetMissingDocumentColumns();
  const { body, error } = await writeWithColumnFallback(
    async (b) => {
      if (Object.prototype.hasOwnProperty.call(b, 'category_id')) {
        return {
          data: null,
          error: { message: "Could not find the 'category_id' column of 'documents' in the schema cache." },
        };
      }
      return { data: { id: 'ok-3' }, error: null };
    },
    { category_id: 'cat-1' },
    { loadMetadata: async () => ({ display_name: 'Giữ tên', content_sha256: 'aa' }) }
  );
  assert.equal(error, null);
  assert.equal(body.category_id, undefined);
  assert.equal(body.metadata.category_id, 'cat-1');
  assert.equal(body.metadata.display_name, 'Giữ tên');
  resetMissingDocumentColumns();
});

test('SELECT documents: thiếu display_name thì bỏ cột rồi đọc tiếp', async () => {
  resetMissingDocumentColumns();
  const calls = [];
  const { data, error, columns } = await selectColumnsWithFallback(async (select) => {
    calls.push(select);
    if (select.includes('display_name')) {
      return {
        data: null,
        error: { message: "Could not find the 'display_name' column of 'documents' in the schema cache." },
      };
    }
    return { data: [{ id: '1', file_name: 'a.pdf' }], error: null };
  }, ['id', 'file_name', 'display_name', 'metadata']);
  assert.equal(error, null);
  assert.equal(data[0].id, '1');
  assert.equal(columns.includes('display_name'), false);
  assert.ok(calls.length >= 2);
  resetMissingDocumentColumns();
});
