/**
 * Tải nội dung website chính thống làm dữ liệu tham khảo.
 * Ưu tiên miền .gov.vn / cơ quan nhà nước; fallback Jina Reader khi HTML sparse/Cloudflare.
 */

const cheerio = require('cheerio');

const OFFICIAL_HOST_RE =
  /(\.gov\.vn$|\.chinhphu\.vn$|\.quochoi\.vn$|\.toaan\.gov\.vn$|\.moj\.gov\.vn$|\.mof\.gov\.vn$|\.mic\.gov\.vn$|\.most\.gov\.vn$|\.molisa\.gov\.vn$|\.mpi\.gov\.vn$|\.thuvienphapluat\.vn$|\.luatvietnam\.vn$)/i;

const MIN_TEXT_LEN = 40;

function assertSafeUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new Error('URL không hợp lệ');
  }
  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error('Chỉ chấp nhận http/https');
  }
  if (u.username || u.password) {
    throw new Error('URL không được chứa thông tin đăng nhập');
  }
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1)/.test(host)
  ) {
    throw new Error('Không cho phép URL nội bộ (SSRF protection)');
  }
  return u;
}

function isOfficialHost(hostname) {
  return OFFICIAL_HOST_RE.test(String(hostname || '').toLowerCase());
}

function htmlToText(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, svg, nav, footer, header, aside').remove();
  const title = $('title').first().text().trim() || $('h1').first().text().trim();
  const main =
    $('article').text() ||
    $('main').text() ||
    $('[role=main]').text() ||
    $('.content, .main-content, #content, #main').text() ||
    $('body').text();

  const text = String(main || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return { title, text };
}

function looksBlockedHtml(html) {
  const h = String(html || '').toLowerCase();
  return (
    h.includes('cf-browser-verification') ||
    h.includes('cloudflare') && h.includes('challenge') ||
    h.includes('just a moment') ||
    h.includes('enable javascript')
  );
}

async function fetchHtml(url, signal) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal,
    headers: {
      'User-Agent': 'HCC-VanBanThongMinh/1.0 (+reference-ingest)',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!res.ok) {
    throw new Error(`Không tải được trang: HTTP ${res.status}`);
  }
  const ctype = String(res.headers.get('content-type') || '');
  if (!/text\/html|application\/xhtml|text\/plain/i.test(ctype) && ctype) {
    throw new Error(`Content-Type không hỗ trợ: ${ctype}`);
  }
  return res.text();
}

async function fetchViaJina(url, signal) {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const res = await fetch(jinaUrl, {
    redirect: 'follow',
    signal,
    headers: {
      Accept: 'text/plain',
      'User-Agent': 'HCC-VanBanThongMinh/1.0 (+jina-reader-fallback)',
    },
  });
  if (!res.ok) {
    throw new Error(`Jina Reader không tải được trang: HTTP ${res.status}`);
  }
  const text = String(await res.text() || '').trim();
  if (text.length < MIN_TEXT_LEN) {
    throw new Error('Jina Reader trả về quá ít nội dung text');
  }
  const titleLine = text.split('\n').find((l) => l.trim()) || '';
  const title = titleLine.replace(/^title:\s*/i, '').trim() || new URL(url).hostname;
  return { title, text };
}

/**
 * @param {string} url
 * @returns {Promise<{ text: string, title: string, url: string, official: boolean, kind: string }>}
 */
async function extractWebPage(url) {
  const u = assertSafeUrl(url);
  const official = isOfficialHost(u.hostname);
  const pageUrl = u.toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.WEB_FETCH_TIMEOUT_MS) || 20000);

  try {
    let title = u.hostname;
    let text = '';
    let viaJina = false;

    try {
      const html = await fetchHtml(pageUrl, controller.signal);
      if (!looksBlockedHtml(html)) {
        const parsed = htmlToText(html);
        title = parsed.title || title;
        text = parsed.text;
      }
    } catch {
      /* thử Jina bên dưới */
    }

    if (text.length < MIN_TEXT_LEN) {
      const jina = await fetchViaJina(pageUrl, controller.signal);
      title = jina.title || title;
      text = jina.text;
      viaJina = true;
    }

    if (!text || text.length < MIN_TEXT_LEN) {
      throw new Error('Trang gần như không có nội dung text để số hóa');
    }

    const max = Number(process.env.WEB_MAX_CHARS) || 120000;
    return {
      text: text.slice(0, max),
      title: title || u.hostname,
      url: pageUrl,
      official,
      kind: viaJina ? 'web_jina' : 'web',
      host: u.hostname,
    };
  } finally {
    clearTimeout(timer);
  }
}

function webCatalogFileName(page) {
  const crypto = require('crypto');
  const id = crypto.createHash('sha256').update(String(page.url || '')).digest('hex').slice(0, 10);
  const title =
    String(page.title || page.host || 'web')
      .slice(0, 72)
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim() || 'web';
  return `${title}.${id}.web.txt`;
}

module.exports = {
  extractWebPage,
  assertSafeUrl,
  isOfficialHost,
  htmlToText,
  webCatalogFileName,
  looksBlockedHtml,
  fetchViaJina,
};
