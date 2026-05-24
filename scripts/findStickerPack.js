const https = require('https');
const { URL } = require('url');

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function extractUrls(html) {
  const urls = new Set();
  const hrefRe = /href\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = hrefRe.exec(html))) {
    try {
      const u = new URL(m[1], 'https://duckduckgo.com');
      urls.add(u.toString());
    } catch (e) {
      // ignore
    }
  }
  return Array.from(urls);
}

async function search(term) {
  const q = encodeURIComponent(term + ' sticker facebook messenger');
  const url = `https://duckduckgo.com/html/?q=${q}`;
  console.log('Fetching search results from DuckDuckGo...');
  const html = await fetchHtml(url);
  const urls = extractUrls(html);
  const candidates = urls.filter(u => /facebook\.com|messenger\.com|stickers|sticker/gi.test(u));
  if (candidates.length === 0) {
    console.log('No obvious sticker pack URLs found. Here are other links:');
    urls.slice(0, 20).forEach(u => console.log('-', u));
  } else {
    console.log('Possible sticker pack URLs:');
    candidates.forEach(u => console.log('-', u));
  }
  console.log('\nIf you find a Facebook/Messenger sticker URL, pass it to the bot script to fetch sticker IDs.');
}

const term = process.argv.slice(2).join(' ');
if (!term) {
  console.error('Usage: node scripts/findStickerPack.js "Pocket Peaches"');
  process.exit(1);
}

search(term).catch(err => {
  console.error('Error:', err.message || err);
  process.exit(2);
});
