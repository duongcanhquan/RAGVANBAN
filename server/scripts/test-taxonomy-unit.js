/**
 * Unit tests cây chuyên mục + catalog local — không cần API key.
 * Chạy: node scripts/test-taxonomy-unit.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildCategoryTree,
  pathForCategory,
  suggestCategoryId,
  slugify,
  DEFAULT_TREE,
} = require('../src/services/taxonomyStore');

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

function flattenSeedLike(nodes, parentId = null, acc = []) {
  const { randomUUID } = require('crypto');
  nodes.forEach((n, i) => {
    const id = n.slug || randomUUID();
    acc.push({
      id,
      parent_id: parentId,
      name: n.name,
      slug: n.slug,
      kind: n.kind,
      sort_order: i,
    });
    if (n.children?.length) flattenSeedLike(n.children, id, acc);
  });
  return acc;
}

function attachDocsToCategoryTree(catTree, docs) {
  const byCat = new Map();
  const uncategorized = [];
  for (const doc of docs) {
    if (doc.category_id) {
      if (!byCat.has(doc.category_id)) byCat.set(doc.category_id, []);
      byCat.get(doc.category_id).push(doc);
    } else uncategorized.push(doc);
  }
  const walk = (node) => {
    const children = (node.children || []).map(walk);
    const ownDocs = byCat.get(node.id) || [];
    const docCount = ownDocs.length + children.reduce((s, c) => s + (c.docCount || 0), 0);
    return { ...node, documents: ownDocs, children, docCount };
  };
  const tree = catTree.map(walk);
  if (uncategorized.length) {
    tree.push({
      id: 'uncategorized',
      label: 'Chưa gắn chuyên mục',
      documents: uncategorized,
      children: [],
      docCount: uncategorized.length,
    });
  }
  return tree;
}

function run() {
  test('slugify bỏ dấu tiếng Việt', () => {
    assert.strictEqual(slugify('Thuế · Tài chính'), 'thue-tai-chinh');
  });

  const flat = flattenSeedLike(DEFAULT_TREE);
  const tree = buildCategoryTree(flat);

  test('cây mặc định có chuyên mục gốc + chuyên môn con', () => {
    assert.ok(tree.length >= 6);
    const hcc = tree.find((n) => n.slug === 'hanh-chinh-cong');
    assert.ok(hcc);
    assert.ok(hcc.children.some((c) => c.slug === 'thu-tuc-hanh-chinh'));
  });

  test('pathForCategory nối Cha / Con', () => {
    const bhxh = flat.find((c) => c.slug === 'bao-hiem-xa-hoi');
    const p = pathForCategory(flat, bhxh.id);
    assert.ok(p.includes('Lao động'));
    assert.ok(p.includes('Bảo hiểm xã hội'));
  });

  test('suggestCategoryId nhận BHXH', () => {
    const id = suggestCategoryId(flat, {
      fileName: 'quyet-dinh-bhxh.pdf',
      text: 'bao hiem xa hoi nguoi lao dong',
    });
    const cat = flat.find((c) => c.id === id);
    assert.ok(cat);
    assert.strictEqual(cat.slug, 'bao-hiem-xa-hoi');
  });

  test('suggestCategoryId bỏ dấu tiếng Việt', () => {
    const id = suggestCategoryId(flat, { text: 'Bảo hiểm xã hội bắt buộc' });
    const cat = flat.find((c) => c.id === id);
    assert.strictEqual(cat.slug, 'bao-hiem-xa-hoi');
  });

  test('suggestCategoryId fallback chưa phân loại', () => {
    const id = suggestCategoryId(flat, { fileName: 'xyz.bin', text: 'lorem ipsum' });
    const cat = flat.find((c) => c.id === id);
    assert.strictEqual(cat.slug, 'chua-phan-loai');
  });

  test('attachDocs đếm doc ở cha = tổng con', () => {
    const bhxh = flat.find((c) => c.slug === 'bao-hiem-xa-hoi');
    const built = attachDocsToCategoryTree(tree, [
      { id: 'd1', category_id: bhxh.id, label: 'NĐ 115' },
      { id: 'd2', category_id: null, label: 'Lẻ' },
    ]);
    const lao = built.find((n) => n.slug === 'lao-dong-bhxh');
    assert.strictEqual(lao.docCount, 1);
    const uncat = built.find((n) => n.id === 'uncategorized');
    assert.strictEqual(uncat.docCount, 1);
  });

  test('localDocuments upsert + update category', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hcc-docs-'));
    const origCwd = process.cwd();
    // module uses __dirname path — test via require functions against real file is OK
    // isolate by writing through API then reading
    const {
      upsertLocalDocument,
      listLocalDocuments,
      updateLocalDocumentCategory,
      countLocalDocuments,
      LOCAL_PATH,
    } = require('../src/services/localDocuments');

    const backup = fs.existsSync(LOCAL_PATH) ? fs.readFileSync(LOCAL_PATH, 'utf8') : null;
    try {
      const inserted = upsertLocalDocument({
        fileName: 'test-vb.pdf',
        soHieu: '01/2024',
        categoryId: 'cat-1',
        folderPath: 'Thuế / TNCN',
      });
      assert.ok(inserted.id);
      const listed = listLocalDocuments();
      assert.ok(listed.items.some((d) => d.id === inserted.id));
      const upd = updateLocalDocumentCategory(inserted.id, {
        categoryId: 'cat-2',
        folderPath: 'Đất đai',
        chuyenMon: 'Nhà ở',
      });
      assert.strictEqual(upd.ok, true);
      const after = listLocalDocuments().items.find((d) => d.id === inserted.id);
      assert.strictEqual(after.category_id, 'cat-2');
      assert.ok(countLocalDocuments().count >= 1);

      // cleanup test row
      const data = JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf8'));
      data.items = data.items.filter((d) => d.id !== inserted.id);
      fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2), 'utf8');
    } finally {
      if (backup != null) fs.writeFileSync(LOCAL_PATH, backup, 'utf8');
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      process.chdir(origCwd);
    }
  });

  console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

run();
