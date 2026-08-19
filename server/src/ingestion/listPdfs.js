/**
 * Liệt kê tất cả file PDF trong thư mục dữ liệu.
 * @param {string} dataDir - Đường dẫn tuyệt đối hoặc tương đối tới /data
 * @returns {string[]} Danh sách đường dẫn tuyệt đối tới file .pdf
 */
const fs = require('fs');
const path = require('path');

const { EXT_MAP } = require('./extractAnyText');

function listPdfFiles(dataDir) {
  return listIngestFiles(dataDir, ['.pdf']);
}

function listIngestFiles(dataDir, exts) {
  if (!dataDir || typeof dataDir !== 'string') {
    throw new Error('listIngestFiles: dataDir phải là chuỗi đường dẫn');
  }

  const absoluteDir = path.resolve(dataDir);

  if (!fs.existsSync(absoluteDir)) {
    throw new Error(`listIngestFiles: thư mục không tồn tại: ${absoluteDir}`);
  }

  const allowed = new Set(
    (exts || Object.keys(EXT_MAP)).map((e) => String(e).toLowerCase())
  );
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });

  return entries
    .filter((entry) => {
      if (!entry.isFile()) return false;
      const ext = path.extname(entry.name).toLowerCase();
      return allowed.has(ext);
    })
    .map((entry) => path.join(absoluteDir, entry.name))
    .sort();
}

module.exports = { listPdfFiles, listIngestFiles };
