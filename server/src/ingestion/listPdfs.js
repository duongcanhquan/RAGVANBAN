/**
 * Liệt kê tất cả file PDF trong thư mục dữ liệu.
 * @param {string} dataDir - Đường dẫn tuyệt đối hoặc tương đối tới /data
 * @returns {string[]} Danh sách đường dẫn tuyệt đối tới file .pdf
 */
const fs = require('fs');
const path = require('path');

function listPdfFiles(dataDir) {
  if (!dataDir || typeof dataDir !== 'string') {
    throw new Error('listPdfFiles: dataDir phải là chuỗi đường dẫn');
  }

  const absoluteDir = path.resolve(dataDir);

  if (!fs.existsSync(absoluteDir)) {
    throw new Error(`listPdfFiles: thư mục không tồn tại: ${absoluteDir}`);
  }

  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
    .map((entry) => path.join(absoluteDir, entry.name))
    .sort();
}

module.exports = { listPdfFiles };
