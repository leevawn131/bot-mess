const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { execFileSync } = require('child_process');

function getBraveUserDataDir() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    if (process.platform === 'linux') {
        return path.join(homeDir, '.config', 'BraveSoftware', 'Brave-Browser');
    } else if (process.platform === 'win32') {
        return path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'User Data');
    } else if (process.platform === 'darwin') {
        return path.join(homeDir, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser');
    }
    return path.join(homeDir, '.config', 'BraveSoftware', 'Brave-Browser');
}

function checkCookiesLive(cookies) {
    return new Promise((resolve) => {
        try {
            const utils = require('../../includes/f/utils');
            const jar = utils.getJar();
            for (const c of cookies) {
                const str = `${c.key}=${c.value}; expires=${c.expires || ''}; domain=${c.domain}; path=${c.path};`;
                jar.setCookie(str, `https://${c.domain.replace(/^\./, '')}`);
            }

            utils.get('https://www.facebook.com/', jar, null, {}).then(res => {
                const updatedCookies = jar.getCookies('https://www.facebook.com');
                const cUserCookie = updatedCookies.find(c => c.cookieString().startsWith('c_user='));
                const isCleared = !cUserCookie || cUserCookie.cookieString().includes('c_user=deleted') || cUserCookie.cookieString().includes('c_user=EXPIRED');
                
                const location = res.headers && res.headers['location'] ? res.headers['location'] : '';
                const isCheckpointRedirect = location.includes('/checkpoint') || location.includes('/login');
                
                if (isCleared || isCheckpointRedirect) {
                    resolve(false);
                } else {
                    resolve(true);
                }
            }).catch(e => resolve(false));
        } catch (e) {
            resolve(false);
        }
    });
}

function extractBraveAppstate(profileDir) {
    try {
        const baseDir = getBraveUserDataDir();
        let dbPath = path.join(baseDir, profileDir, 'Cookies');
        if (!fs.existsSync(dbPath)) {
            dbPath = path.join(baseDir, profileDir, 'Network', 'Cookies');
        }
        if (!fs.existsSync(dbPath)) {
            console.log(`[!] Không tìm thấy database Cookies cho Profile "${profileDir}" tại ${dbPath}`);
            return null;
        }

        const tmpDb = path.join(require('os').tmpdir(), `extract_cookies_${profileDir.replace(/\s+/g, '_')}_${Date.now()}.db`);
        fs.copyFileSync(dbPath, tmpDb);

        const key = crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1');
        const iv = Buffer.alloc(16, ' ');

        const sql = `SELECT name, hex(encrypted_value), value, host_key, path, expires_utc FROM cookies WHERE host_key LIKE '%facebook%' OR host_key LIKE '%messenger%'`;
        let out = '';
        try {
            out = execFileSync('sqlite3', [tmpDb, sql]).toString();
        } catch (e) {
            console.log(`[!] Lỗi khi đọc file SQLite cookies cho Profile "${profileDir}":`, e.message);
        } finally {
            try { fs.unlinkSync(tmpDb); } catch (e) {}
        }

        if (!out) return null;

        const cookies = [];
        const lines = out.split('\n').filter(Boolean);
        for (const line of lines) {
            const parts = line.split('|');
            const name = parts[0];
            const hex = parts[1];
            let val = parts[2];
            const host_key = parts[3];
            const p = parts[4] || '/';
            const expiresUtc = parseInt(parts[5]) || 0;

            if (hex) {
                try {
                    const buf = Buffer.from(hex, 'hex');
                    if (buf.slice(0, 3).toString() === 'v10') {
                        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
                        const dec = Buffer.concat([decipher.update(buf.slice(3)), decipher.final()]);
                        val = dec.slice(32).toString('utf8');
                    }
                } catch (err) {}
            }

            if (val && name) {
                const domain = host_key.startsWith('.') ? host_key.slice(1) : host_key;
                let expiresString = '';
                if (expiresUtc > 0) {
                    const unixMs = (expiresUtc / 1000) - 11644473600000;
                    expiresString = new Date(unixMs).toUTCString();
                } else {
                    expiresString = new Date(Date.now() + 180 * 86400000).toUTCString();
                }

                cookies.push({
                    key: name,
                    value: val,
                    domain: domain,
                    path: p,
                    hostOnly: !host_key.startsWith('.'),
                    creation: new Date().toISOString(),
                    lastAccessed: new Date().toISOString(),
                    expires: expiresString
                });
            }
        }

        const hasCUser = cookies.some(c => c.key === 'c_user' || c.key === 'i_user');
        if (!hasCUser) {
            console.log(`[!] Profile "${profileDir}" thiếu cookie c_user / i_user trong DB.`);
            return null;
        }

        return cookies;
    } catch (err) {
        console.error(`[!] Lỗi trích xuất cookie trực tiếp từ SQLite cho Profile "${profileDir}":`, err.message);
        return null;
    }
}

module.exports = {
    extractBraveAppstate,
    checkCookiesLive
};
