const _threadInfoCache = new Map();
const THREAD_INFO_TTL = 5 * 60 * 1000; // 5 phút

// Tạm tắt console.error khi gọi getThreadInfo để ws3-fca không spam log
async function _quietGetThreadInfo(api, key) {
  const _origErr = console.error;
  console.error = () => {};
  try {
    return await api.getThreadInfo(key);
  } finally {
    console.error = _origErr;
  }
}

async function getThreadInfoCached(api, threadID) {
  const key = String(threadID);
  const cached = _threadInfoCache.get(key);
  if (cached && Date.now() - cached.ts < THREAD_INFO_TTL) {
    return cached.data;
  }
  try {
    const info = await _quietGetThreadInfo(api, key);
    if (info) {
      _threadInfoCache.set(key, { data: info, ts: Date.now() });
    }
    return info;
  } catch (err) {
    // Trả về cache cũ nếu có, dù đã hết hạn
    if (cached) return cached.data;
    return null;
  }
}

function clearThreadInfoCache(threadID) {
  const key = String(threadID);
  _threadInfoCache.delete(key);
}

module.exports = { getThreadInfoCached, clearThreadInfoCache };
