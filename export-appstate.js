const axios = require('axios');
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { exec, execSync, spawn } = require('child_process');
const os = require('os');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ==========================================
// CẤU HÌNH
// ==========================================
const CHROME_IP = process.env.CHROME_IP || '127.0.0.1';
const CHROME_PORT = process.env.CHROME_PORT || '9222';
const APPSTATE_PATH = path.join(__dirname, 'runtime', 'appstate.json');
const LEGACY_APPSTATE_PATH = path.join(__dirname, 'appstate.json');
const RESTART_CMD = process.env.RESTART_CMD || 'pm2 restart botmess';

function getRunningBraveUserDataDir() {
    try {
        const stdout = execSync("ps aux | grep brave | grep -v grep", { encoding: 'utf8' });
        const match = stdout.match(/--user-data-dir=([^\s"'\\]+)/);
        if (match && match[1]) {
            console.log(`[+] Tìm thấy user-data-dir của Brave đang chạy: ${match[1]}`);
            return match[1];
        }
    } catch (e) {
        // ignore
    }
    return null;
}

function getBraveUserDataDir() {
    if (process.env.CHROME_PROFILE_PATH) {
        return process.env.CHROME_PROFILE_PATH;
    }
    const runningDir = getRunningBraveUserDataDir();
    if (runningDir) return runningDir;

    const homedir = os.homedir();
    return path.join(homedir, '.config/BraveSoftware/Brave-Browser');
}

function getBraveProfileDirectories(userDataDir) {
    let targetProfiles = null;
    const accountProfilesPath = path.join(__dirname, 'runtime', 'account_profiles.json');
    if (fs.existsSync(accountProfilesPath)) {
        try {
            const config = JSON.parse(fs.readFileSync(accountProfilesPath, 'utf8'));
            if (Array.isArray(config.clusters)) {
                targetProfiles = [];
                for (const c of config.clusters) {
                    const activeP = c.active_profile || (c.profiles ? c.profiles[0] : null);
                    if (activeP && !targetProfiles.includes(activeP)) targetProfiles.push(activeP);
                }
            }
        } catch (e) {}
    }

    if (!userDataDir) return targetProfiles && targetProfiles.length > 0 ? targetProfiles : ['Default'];
    try {
        if (!fs.existsSync(userDataDir)) return targetProfiles && targetProfiles.length > 0 ? targetProfiles : ['Default'];
        const files = fs.readdirSync(userDataDir);
        const candidates = [];
        
        for (const file of files) {
            if (file === 'Default' || file.startsWith('Profile ')) {
                if (targetProfiles && targetProfiles.length > 0 && !targetProfiles.includes(file)) {
                    continue; // Bỏ qua profile không thuộc active_profile của các Cụm hiện tại
                }
                const fullPath = path.join(userDataDir, file);
                try {
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        let mtime = stat.mtimeMs;
                        const prefPath = path.join(fullPath, 'Preferences');
                        if (fs.existsSync(prefPath)) {
                            mtime = fs.statSync(prefPath).mtimeMs;
                        }
                        candidates.push({ name: file, mtime });
                    }
                } catch (e) {}
            }
        }
        
        if (candidates.length > 0) {
            candidates.sort((a, b) => b.mtime - a.mtime);
            return candidates.map(c => c.name);
        }
    } catch (e) {}
    return targetProfiles && targetProfiles.length > 0 ? targetProfiles : ['Default'];
}

function getBraveExecutablePath() {
    const paths = [
        '/usr/bin/brave-browser',
        '/usr/bin/brave',
        '/opt/brave.com/brave/brave-browser',
        '/snap/bin/brave'
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return '/usr/bin/brave-browser';
}

function removeBraveLockFiles(profilePath, profileDirName = '') {
    if (!profilePath) return;
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];
    const dirsToCheck = [profilePath];
    if (profileDirName) {
        dirsToCheck.push(path.join(profilePath, profileDirName));
    }
    for (const d of dirsToCheck) {
        for (const file of lockFiles) {
            const filePath = path.join(d, file);
            try {
                if (fs.existsSync(filePath) || fs.lstatSync(filePath).isSymbolicLink()) {
                    fs.unlinkSync(filePath);
                }
            } catch (e) {}
        }
    }
}

function getBotUIDFallback() {
    try {
        const filePath = path.join(__dirname, 'modules', 'data', 'memberNicknames.json');
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            for (const group of Object.values(data)) {
                for (const [uid, nickname] of Object.entries(group)) {
                    if (nickname.includes('Bot') || nickname.includes('bot') || nickname.includes('『 / 』')) {
                        return uid;
                    }
                }
            }
        }
    } catch (e) {}
    return "61589883934433"; // UID mặc định của Bot
}

async function cleanupBrowser(browser, spawnedBraveProc, isCDP, shouldCloseCDPBrowser) {
    try {
        if (browser) {
            const contexts = typeof browser.contexts === 'function' ? browser.contexts() : [browser];
            for (const ctx of contexts) {
                const pages = ctx.pages ? ctx.pages() : [];
                for (const p of pages) {
                    await p.close().catch(() => {});
                }
            }
            console.log('[+] Đã đóng tất cả các tab đang mở.');
            await browser.close().catch(() => {});
            console.log('[+] Đã đóng hẳn trình duyệt hoàn toàn.');
        }
    } catch (e) {}

    if (shouldCloseCDPBrowser && spawnedBraveProc) {
        try {
            if (process.platform === 'win32') {
                execSync(`taskkill /pid ${spawnedBraveProc.pid} /T /F`);
            } else {
                process.kill(-spawnedBraveProc.pid, 'SIGTERM');
            }
            console.log('[+] Đã đóng tiến trình Brave GUI.');
        } catch (e) {
            try {
                spawnedBraveProc.kill('SIGTERM');
            } catch (err) {}
        }
    }

    // Đóng browser context sạch sẽ bằng API của Playwright
}

function getCredentialsForProfile(profileName = "", profileIndex = 0) {
    let emailVal = "";
    let passVal = "";
    let twoFactorSecret = "";
    let gmailPassVal = "";

    let rawName = String(profileName || "").trim();
    let numMatch = rawName.match(/(\d+)/);
    let pNum = numMatch ? parseInt(numMatch[1], 10) : null;
    let isDefault = /default/i.test(rawName) || (pNum === null && rawName === "");

    // 1. Danh sách key chính xác cho Profile này trong .env
    const specificKeys = [];
    if (isDefault) {
        specificKeys.push("PROFILE_DEFAULT", "PROFILE_0");
    } else if (pNum !== null) {
        specificKeys.push(`PROFILE_${pNum}`);
    }

    for (const key of specificKeys) {
        if (!emailVal) emailVal = process.env[`${key}_EMAIL`] || process.env[`${key}_USER`] || process.env[`${key}_USERNAME`] || "";
        if (!passVal) passVal = process.env[`${key}_PASS`] || process.env[`${key}_PASSWORD`] || "";
        if (!twoFactorSecret) twoFactorSecret = process.env[`${key}_2FA`] || process.env[`${key}_2FA_SECRET`] || process.env[`${key}_SECRET`] || "";
        if (!gmailPassVal) gmailPassVal = process.env[`${key}_GMAIL_PASS`] || process.env[`${key}_GOOGLE_PASS`] || "";
    }

    // 2. Chỉ fallback theo danh sách FB_EMAIL, FB_PASSWORD, FB_2FA nếu tồn tại đúng vị trí index của profile đó
    const listIndex = isDefault ? 0 : (pNum !== null ? pNum : profileIndex);
    const emails = (process.env.FB_EMAIL || "").split(',').map(s => s.trim()).filter(Boolean);
    const passwords = (process.env.FB_PASSWORD || "").split(',').map(s => s.trim()).filter(Boolean);
    const twoFactorSecrets = (process.env.FB_2FA || "").split(',').map(s => s.trim()).filter(Boolean);

    if (!emailVal && emails.length > listIndex) emailVal = emails[listIndex] || "";
    if (!passVal && passwords.length > listIndex) passVal = passwords[listIndex] || "";
    if (!twoFactorSecret && twoFactorSecrets.length > listIndex) twoFactorSecret = twoFactorSecrets[listIndex] || "";

    // 3. Mật khẩu Gmail fallback sang GOOGLE_PASSWORD hoặc passVal của chính profile này
    if (!gmailPassVal) gmailPassVal = process.env.GOOGLE_PASSWORD || passVal;

    return { 
        email: emailVal, 
        password: passVal, 
        twoFactorSecret: twoFactorSecret ? twoFactorSecret.replace(/\s+/g, '') : "",
        gmailPassword: gmailPassVal
    };
}

const tls = require('tls');

async function fetchFacebookCodeFromGmail(email, passwordInput, timeoutMs = 30000) {
    if (!email) return null;
    let rawPwds = (passwordInput || "") + "," + (process.env.GOOGLE_PASSWORD || "");
    const passwordsToTry = Array.from(new Set(String(rawPwds).split(',').map(s => s.trim()).filter(Boolean)));
    
    for (const pwd of passwordsToTry) {
        const code = await new Promise((resolve) => {
            let resolved = false;
            const timer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    try { client.end(); } catch (e) {}
                    resolve(null);
                }
            }, Math.min(timeoutMs, 10000));

            const client = tls.connect(993, 'imap.gmail.com', { rejectUnauthorized: false }, () => {});
            let step = 0;
            let buffer = '';

            client.on('data', (data) => {
                buffer += data.toString('utf8');
                if (step === 0 && buffer.includes('* OK')) {
                    step = 1;
                    buffer = '';
                    client.write(`A1 LOGIN "${email}" "${pwd}"\r\n`);
                } else if (step === 1 && buffer.includes('A1 OK')) {
                    step = 2;
                    buffer = '';
                    client.write(`A2 SELECT INBOX\r\n`);
                } else if (step === 1 && (buffer.includes('A1 NO') || buffer.includes('A1 BAD'))) {
                    if (!resolved) { resolved = true; clearTimeout(timer); client.end(); resolve(null); }
                } else if (step === 2 && buffer.includes('A2 OK')) {
                    step = 3;
                    buffer = '';
                    client.write(`A3 SEARCH UNSEEN FROM "security@facebookmail.com"\r\n`);
                } else if (step === 3 && buffer.includes('A3 OK')) {
                    const match = buffer.match(/\* SEARCH ([\d\s]+)/);
                    let msgId = '';
                    if (match && match[1].trim()) {
                        const ids = match[1].trim().split(/\s+/);
                        msgId = ids[ids.length - 1];
                    }
                    step = 4;
                    buffer = '';
                    if (msgId) {
                        client.write(`A4 FETCH ${msgId} (BODY[TEXT])\r\n`);
                    } else {
                        client.write(`A4 FETCH * (BODY[TEXT])\r\n`);
                    }
                } else if (step === 4 && buffer.includes('A4 OK')) {
                    client.write(`A5 LOGOUT\r\n`);
                    const codeMatch = buffer.match(/\b(\d{6,8})\b/);
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timer);
                        client.end();
                        resolve(codeMatch ? codeMatch[1] : null);
                    }
                }
            });

            client.on('error', () => {
                if (!resolved) { resolved = true; clearTimeout(timer); resolve(null); }
            });
        });

        if (code) return code;
    }
    return null;
}

async function fetchFacebookCodeFromGmailBrowserTab(context, creds = {}) {
    let code = null;
    let gmailPage = null;
    try {
        const targetEmail = creds.email || "";
        console.log(`[📩] Đang mở Tab Gmail (${targetEmail}) trực tiếp trên trình duyệt Brave để quét mã...`);
        gmailPage = await context.newPage();
        await gmailPage.goto('https://mail.google.com/mail/u/0/#search/from%3Asecurity%40facebookmail.com', { 
            waitUntil: 'domcontentloaded', 
            timeout: 15000 
        }).catch(() => {});
        
        await gmailPage.waitForTimeout(3500).catch(() => {});

        // NẾU CHƯA ĐĂNG NHẬP GMAIL TRÊN WEB (Trình duyệt chuyển sang accounts.google.com)
        if (gmailPage.url().includes('accounts.google.com')) {
            console.log('[🔑] Gmail chưa đăng nhập trên web. Đang tự động điền tài khoản & mật khẩu Google...');
            // 1. Nhập Email Google
            const emailInput = gmailPage.locator('input[type="email"]:visible, input[name="identifier"]:visible, #identifierId:visible').first();
            if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
                await emailInput.fill(targetEmail).catch(() => {});
                const nextBtn = gmailPage.locator('#identifierNext:visible, button:has-text("Next"):visible, button:has-text("Tiếp theo"):visible').first();
                if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await nextBtn.click({ force: true }).catch(() => {});
                    await gmailPage.waitForTimeout(3500).catch(() => {});
                }
            }

            // 2. Nhập Mật khẩu Google (thử lần lượt từ GOOGLE_PASSWORD)
            const pwdInput = gmailPage.locator('input[type="password"]:visible, input[name="Passwd"]:visible').first();
            if (await pwdInput.isVisible({ timeout: 3000 }).catch(() => false)) {
                let googlePwds = (process.env.GOOGLE_PASSWORD || "").split(',').map(s => s.trim()).filter(Boolean);
                if (creds.password && !googlePwds.includes(creds.password)) googlePwds.push(creds.password);
                if (creds.gmailPassword && !googlePwds.includes(creds.gmailPassword)) googlePwds.push(creds.gmailPassword);
                
                for (let gIdx = 0; gIdx < googlePwds.length; gIdx++) {
                    const gPwd = googlePwds[gIdx];
                    console.log(`[🔑] Thử mật khẩu Google trên web (${gIdx + 1}/${googlePwds.length})...`);
                    await pwdInput.fill('').catch(() => {});
                    await pwdInput.fill(gPwd).catch(() => {});
                    const pwdNextBtn = gmailPage.locator('#passwordNext:visible, button:has-text("Next"):visible, button:has-text("Tiếp theo"):visible').first();
                    if (await pwdNextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                        await pwdNextBtn.click({ force: true }).catch(() => {});
                        await gmailPage.waitForTimeout(4000).catch(() => {});
                    }
                    if (!gmailPage.url().includes('accounts.google.com')) {
                        console.log(`[✅] Đăng nhập Google web thành công với mật khẩu #${gIdx + 1}!`);
                        break;
                    }
                }
            }

            // Sau khi đăng nhập Google web xong, quay lại Gmail search
            await gmailPage.goto('https://mail.google.com/mail/u/0/#search/from%3Asecurity%40facebookmail.com', { 
                waitUntil: 'domcontentloaded', 
                timeout: 15000 
            }).catch(() => {});
            await gmailPage.waitForTimeout(3500).catch(() => {});
        }

        const latestMsg = gmailPage.locator('tr.zA').first();
        if (await latestMsg.isVisible({ timeout: 5000 }).catch(() => false)) {
            await latestMsg.click({ force: true }).catch(() => {});
            await gmailPage.waitForTimeout(2000).catch(() => {});
        }

        const bodyText = await gmailPage.evaluate(() => document.body.innerText).catch(() => "");
        const match = bodyText.match(/mã xác nhận[^\d]*(\d{6})/i) || 
                      bodyText.match(/mã của bạn là[^\d]*(\d{6})/i) || 
                      bodyText.match(/is your Facebook code[^\d]*(\d{6})/i) ||
                      bodyText.match(/\b(\d{6})\b/);

        if (match) {
            code = match[1];
            console.log(`[🔐] Đã đọc thành công mã 6 số từ Tab Gmail trên web: ${code}`);
        }
    } catch (e) {
        console.warn(`[!] Lỗi khi đọc tab Gmail: ${e.message}`);
    } finally {
        if (gmailPage) {
            await gmailPage.close().catch(() => {});
        }
    }
    return code;
}

async function handleFacebookGmailRecovery(page, creds) {
    try {
        // 1. Nếu đang ở trang thông báo sai mật khẩu -> Bấm "Hãy tìm tài khoản của bạn và đăng nhập" hoặc chuyển thẳng sang /login/identify/
        const findAccLink = page.locator('a:has-text("Hãy tìm tài khoản của bạn và đăng nhập"), a:has-text("Find your account and log in"), a[href*="identify"], text=/Hãy tìm tài khoản|Find your account/i').first();
        if (await findAccLink.isVisible({ timeout: 1500 }).catch(() => false)) {
            console.log('[+] Bấm link "Hãy tìm tài khoản của bạn và đăng nhập"...');
            await findAccLink.click({ force: true }).catch(() => {});
            await page.waitForTimeout(3000).catch(() => {});
        }

        if (!page.url().includes('login/identify') && !page.url().includes('recover')) {
            console.log('[+] Chuyển hướng trực tiếp tới trang Tìm tài khoản: https://www.facebook.com/login/identify/');
            await page.goto('https://www.facebook.com/login/identify/', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
            await page.waitForTimeout(3000).catch(() => {});
        }

        // 2. Màn hình "Tìm tài khoản của bạn" (/login/identify/) - Ảnh 1
        if (page.url().includes('login/identify') || await page.getByText(/Tìm tài khoản của bạn|Find your account/i).first().isVisible({ timeout: 1000 }).catch(() => false)) {
            const emailInput = page.locator('input[placeholder*="Số di động hoặc email"], input[name="email"], input[type="text"]:visible').first();
            if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
                console.log(`[+] Nhập Gmail vào ô Tìm tài khoản: ${creds.email}`);
                await emailInput.fill(creds.email).catch(() => {});
                await page.waitForTimeout(500).catch(() => {});

                const searchBtn = page.locator('button:has-text("Tiếp tục"), button[type="submit"], div[role="button"]:has-text("Tiếp tục")').first();
                if (await searchBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
                    console.log('[+] Bấm "Tiếp tục" tìm tài khoản...');
                    await searchBtn.click({ force: true }).catch(() => {});
                    console.log('[⏳] Đang chờ 5s cho Facebook load màn hình chọn phương thức nhận mã...');
                    await page.waitForTimeout(5000).catch(() => {});
                }
            }
        }

        // 3. Màn hình "Chọn phương thức đăng nhập" (/recover/initiate/) - Ảnh 2
        if (page.url().includes('recover/initiate') || await page.getByText(/Chọn phương thức đăng nhập|Choose a way to log in/i).first().isVisible({ timeout: 1000 }).catch(() => false)) {
            console.log('[+] Đã đến màn hình Chọn phương thức đăng nhập...');
            
            // Selector click trực tiếp vào khối option "Nhận mã qua email" hoặc hình tròn radio
            const emailOptionBox = page.locator('div:has-text("Nhận mã qua email"), label:has-text("Nhận mã qua email"), text=/Nhận mã qua email|Send code via email/i, input[type="radio"]').first();
            if (await emailOptionBox.isVisible({ timeout: 2000 }).catch(() => false)) {
                console.log('[+] Click chọn khối option "Nhận mã qua email"...');
                await emailOptionBox.click({ force: true }).catch(() => {});
                await page.waitForTimeout(1500).catch(() => {});
            }

            const continueBtn = page.locator('button:has-text("Tiếp tục"), div[role="button"]:has-text("Tiếp tục"), button[type="submit"]').first();
            if (await continueBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                console.log('[+] Bấm "Tiếp tục" để Facebook gửi mã về Gmail...');
                await continueBtn.click({ force: true }).catch(() => {});
                console.log('[⏳] Đang chờ Facebook gửi mã và load màn hình nhập mã...');
                await page.waitForTimeout(5000).catch(() => {});
            }
        }

        // 4. Màn hình "Xác nhận tài khoản" / Nhập mã từ Gmail (/recover/code/) - Ảnh 3
        if (page.url().includes('recover/code') || await page.getByText(/Xác nhận tài khoản|Nhập mã|Enter code/i).first().isVisible({ timeout: 1000 }).catch(() => false)) {
            console.log(`[📩] Đang tiến hành đọc mã xác nhận Facebook từ Gmail (${creds.email})...`);
            let gmailCode = await fetchFacebookCodeFromGmail(creds.email, creds.gmailPassword, 12000);
            
            if (!gmailCode) {
                console.log('[🌐] Đang thử mở Tab Gmail trực tiếp trên trình duyệt Brave để đọc mã xác nhận...');
                gmailCode = await fetchFacebookCodeFromGmailBrowserTab(page.context(), creds);
            }

            if (gmailCode) {
                console.log(`[🔐] Lấy mã từ Gmail thành công: ${gmailCode}`);
                const codeInput = page.locator('input[placeholder*="Nhập mã"], input[name="n"], input[type="text"]:visible').first();
                if (await codeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
                    console.log('[+] Điền mã xác nhận từ Gmail...');
                    await codeInput.click({ force: true }).catch(() => {});
                    await codeInput.fill('').catch(() => {});
                    await codeInput.pressSequentially(gmailCode, { delay: 80 }).catch(() => {
                        return codeInput.fill(gmailCode);
                    });
                    await codeInput.dispatchEvent('input').catch(() => {});
                    await codeInput.dispatchEvent('change').catch(() => {});
                    await page.waitForTimeout(800).catch(() => {});

                    console.log('[+] Bấm "Tiếp tục"...');
                    await codeInput.press('Enter').catch(() => {});
                    const submitBtn = page.locator('button:has-text("Tiếp tục"), div[role="button"]:has-text("Tiếp tục"), button[type="submit"]').first();
                    if (await submitBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
                        await submitBtn.click({ force: true }).catch(() => {});
                    }
                    await page.waitForTimeout(5000).catch(() => {});
                }
            } else {
                console.warn('[!] Không lấy được mã từ Gmail tự động (vui lòng kiểm tra mật khẩu ứng dụng Gmail trong .env).');
            }
        }

        // 5. Màn hình "Tạo mật khẩu mới" (/recover/password/) - Ảnh 4
        if (page.url().includes('recover/password') || await page.getByText(/Tạo mật khẩu mới|Create a new password/i).first().isVisible({ timeout: 1000 }).catch(() => false)) {
            console.log('[+] Phát hiện màn hình Tạo mật khẩu mới...');
            const skipBtn = page.locator('button:has-text("Bỏ qua"), a:has-text("Bỏ qua"), div[role="button"]:has-text("Bỏ qua"), button:has-text("Skip")').first();
            if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                console.log('[+] Bấm nút "Bỏ qua"...');
                await skipBtn.click({ force: true }).catch(() => {});
                console.log('[⏳] Đang chờ 5s để load vào trang chủ Facebook...');
                await page.waitForTimeout(5000).catch(() => {});
                return true;
            }
        }
    } catch (e) {
        console.warn(`[!] Lỗi khi xử lý khôi phục qua Gmail: ${e.message}`);
    }
    return false;
}

async function handleFacebookContinue(context, timeoutMs = 60000, profileIndex = 0, profileDirName = 'Default') {
    try {
        const pages = context.pages();
        const validPages = pages.filter(p => !p.url().startsWith('brave://') && !p.url().startsWith('brave-extension://') && !p.url().startsWith('about:'));
        
        let page;
        // 1. Tìm hoặc mở Facebook
        const fbPage = validPages.find(p => p.url().includes('facebook.com') || p.url().includes('messenger.com'));
        if (fbPage) {
            page = fbPage;
            console.log(`[+] Đang kiểm tra tab Facebook đang mở: ${page.url()}`);
        } else {
            console.log('[+] Không có tab Facebook nào. Đang tạo tab mới để mở facebook.com...');
            page = await context.newPage();
            await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        }

        // Đè window.open để buộc chuyển hướng trên cùng tab hiện tại
        await page.addInitScript(() => {
            window.open = (url) => {
                window.location.href = url;
                return window;
            };
        }).catch(() => {});
        await page.evaluate(() => {
            window.open = (url) => {
                window.location.href = url;
                return window;
            };
        }).catch(() => {});

        await page.waitForTimeout(2000).catch(() => {});

        const googleAccountSelectors = [
            'div[role="link"]:visible',
            '[data-email]:visible',
            '[data-identifier]:visible',
            'div[class*="account"]:visible',
            'div[class*="Account"]:visible',
            'div.vdLzCc:visible',
            'div.z5n58c:visible',
            'text="@gmail.com":visible',
            'p:has-text("@gmail.com"):visible'
        ];

        const selectGoogleAccount = async (targetPage) => {
            const creds = getCredentialsForProfile(profileDirName, profileIndex);
            const targetEmail = creds.email;
            const fbEmails = (process.env.FB_EMAIL || "").split(',').map(e => e.trim()).filter(Boolean);
            
            // 1. Ưu tiên tìm chọn đúng Email trùng khớp với Profile hiện tại trước
            if (targetEmail) {
                try {
                    const emailLoc = targetPage.locator(`text="${targetEmail}":visible, [data-email="${targetEmail}"]:visible, p:has-text("${targetEmail}"):visible, div:has-text("${targetEmail}"):visible`).first();
                    if (await emailLoc.isVisible({ timeout: 800 })) {
                        console.log(`[+] Tìm thấy tài khoản Google khớp với Email Profile #${profileIndex + 1} (${targetEmail}). Đang click chọn...`);
                        await emailLoc.click({ timeout: 4000 });
                        return true;
                    }
                } catch (e) {}
            }

            // 2. Thử các email khác trong danh sách FB_EMAIL nếu không tìm thấy targetEmail
            for (const email of fbEmails) {
                if (email === targetEmail) continue;
                try {
                    const emailLoc = targetPage.locator(`text="${email}":visible, [data-email="${email}"]:visible, p:has-text("${email}"):visible, div:has-text("${email}"):visible`).first();
                    if (await emailLoc.isVisible({ timeout: 800 })) {
                        console.log(`[+] Tìm thấy tài khoản Google khớp với FB_EMAIL (${email}). Đang click chọn...`);
                        await emailLoc.click({ timeout: 4000 });
                        return true;
                    }
                } catch (e) {}
            }

            // 3. Fallback: chọn bất kỳ selector tài khoản nào có sẵn
            for (const selector of googleAccountSelectors) {
                try {
                    const btn = targetPage.locator(selector).first();
                    if (await btn.isVisible({ timeout: 800 })) {
                        console.log(`[+] Tìm thấy tài khoản Google để click (${selector}) trên trang: ${targetPage.url()}`);
                        await btn.click({ timeout: 4000 });
                        return true;
                    }
                } catch (e) {}
            }
            return false;
        };

        const handleGoogleSignIn = async (targetPage) => {
            try {
                // 0. Bấm nút "Cho phép" / "Allow" nếu ở trang cấp quyền Google OAuth (Google Consent Screen)
                const allowSelectors = [
                    'button:has-text("Cho phép"):visible',
                    'button:has-text("Allow"):visible',
                    'span:has-text("Cho phép"):visible',
                    'span:has-text("Allow"):visible',
                    'div[role="button"]:has-text("Cho phép"):visible',
                    'div[role="button"]:has-text("Allow"):visible',
                    '#submit_approve_access:visible'
                ];
                for (const sel of allowSelectors) {
                    try {
                        const allowBtn = targetPage.locator(sel).first();
                        if (await allowBtn.isVisible({ timeout: 600 }).catch(() => false)) {
                            console.log(`[+] Click nút "Cho phép / Allow" của Google (${sel})...`);
                            await allowBtn.click({ timeout: 4000 }).catch(() => {});
                            await targetPage.waitForTimeout(4000).catch(() => {});
                            return true;
                        }
                    } catch (e) {}
                }

                // 1. Điền Mật khẩu Google nếu yêu cầu nhập Mật khẩu (Ưu tiên cao nhất)
                const pwdInput = targetPage.locator('input[type="password"]:visible, input[name="Passwd"]:visible, input[name="password"]:visible').first();
                if (await pwdInput.isVisible({ timeout: 500 }).catch(() => false)) {
                    const creds = getCredentialsForProfile(profileDirName, profileIndex);
                    let googlePwds = (process.env.GOOGLE_PASSWORD || "").split(',').map(s => s.trim()).filter(Boolean);
                    if (creds.password && !googlePwds.includes(creds.password)) googlePwds.push(creds.password);
                    if (creds.gmailPassword && !googlePwds.includes(creds.gmailPassword)) googlePwds.push(creds.gmailPassword);

                    for (let gIdx = 0; gIdx < googlePwds.length; gIdx++) {
                        const gPwd = googlePwds[gIdx];
                        console.log(`[🔑] Đang nhập mật khẩu Google (${gIdx + 1}/${googlePwds.length}) cho Profile "${profileDirName}"...`);
                        await pwdInput.fill('').catch(() => {});
                        await pwdInput.fill(gPwd).catch(() => {});
                        const nextBtn = targetPage.locator('#passwordNext:visible, button:has-text("Next"):visible, button:has-text("Tiếp theo"):visible, [data-primary-action-label] button:visible').first();
                        if (await nextBtn.isVisible({ timeout: 500 }).catch(() => false)) {
                            console.log('[+] Click nút "Next / Tiếp theo" của Google...');
                            await nextBtn.click({ timeout: 4000 }).catch(() => {});
                            await targetPage.waitForTimeout(4000).catch(() => {});
                            if (!targetPage.url().includes('accounts.google.com')) return true;
                        }
                    }
                }

                // 2. Điền Email Google nếu yêu cầu nhập Email/Tài khoản
                const emailInput = targetPage.locator('input[type="email"]:visible, input[name="identifier"]:visible, #identifierId:visible').first();
                if (await emailInput.isVisible({ timeout: 500 }).catch(() => false)) {
                    const creds = getCredentialsForProfile(profileDirName, profileIndex);
                    let emailVal = creds.email;
                    if (emailVal) {
                        console.log(`[+] Đang nhập Email Google từ .env cho Profile "${profileDirName}": ${emailVal}...`);
                        await emailInput.fill(emailVal).catch(() => {});
                        const nextBtn = targetPage.locator('#identifierNext:visible, button:has-text("Next"):visible, button:has-text("Tiếp theo"):visible').first();
                        if (await nextBtn.isVisible({ timeout: 500 }).catch(() => false)) {
                            await nextBtn.click({ timeout: 3000 }).catch(() => {});
                            await targetPage.waitForTimeout(3000).catch(() => {});
                            return true;
                        }
                    }
                }

                // 3. Thử chọn tài khoản nếu đang ở màn hình chọn tài khoản
                const accountSelected = await selectGoogleAccount(targetPage);
                if (accountSelected) {
                    console.log('[+] Đã click chọn tài khoản Google.');
                    await targetPage.waitForTimeout(3000).catch(() => {});
                    return true;
                }

                // 4. Thử bấm các nút Next/Tiếp theo/Cho phép thông thường nếu đã tự điền sẵn
                const googleNextSelectors = [
                    '#passwordNext:visible',
                    '#identifierNext:visible',
                    'button:has-text("Next"):visible',
                    'button:has-text("Tiếp theo"):visible',
                    'button:has-text("Cho phép"):visible',
                    'button:has-text("Allow"):visible',
                    'span:has-text("Next"):visible',
                    'span:has-text("Tiếp theo"):visible',
                    'span:has-text("Cho phép"):visible',
                    'span:has-text("Allow"):visible',
                    '[data-primary-action-label] button:visible'
                ];
                for (const sel of googleNextSelectors) {
                    try {
                        const nextBtn = targetPage.locator(sel).first();
                        if (await nextBtn.isVisible({ timeout: 500 })) {
                            console.log(`[+] Tìm thấy nút Next/Cho phép của Google (${sel}). Đang click...`);
                            await nextBtn.click({ timeout: 4000 });
                            await targetPage.waitForTimeout(3000).catch(() => {});
                            return true;
                        }
                    } catch (e) {}
                }
            } catch (e) {}
            return false;
        };

        const passwordSelectors = [
            'input[type="password"]:visible',
            'input[name="pass"]:visible',
            '[placeholder*="Mật khẩu"]:visible',
            '[placeholder*="Password"]:visible'
        ];

        console.log(`[+] Bắt đầu giám sát và tương tác tự động với trang Facebook (tối đa ${timeoutMs / 1000} giây)...`);
        const startTime = Date.now();
        let done = false;
        let checkpointSequenceExecuted = false;
        let googleLoginLogged = false;
        let pwdAttemptIndex = 0;
        
        while (Date.now() - startTime < timeoutMs && !done) {
            const url = page.url();

            // Kiểm tra Captcha & Meta Security Challenge ("Complete a challenge to verify you're a human")
            const hasCaptcha = await page.locator('iframe[src*="recaptcha"], iframe[src*="captcha"], [class*="recaptcha"], [id*="recaptcha"]').first().isVisible({ timeout: 500 }).catch(() => false)
                || await page.getByText(/I'm not a robot|Tôi không phải là người máy|verify you're a human|Solve a puzzle|Complete a challenge/i).first().isVisible({ timeout: 500 }).catch(() => false);
            if (hasCaptcha) {
                console.log('[⚠️] Phát hiện mã Captcha / Thử thách xác minh Meta trên màn hình. Vui lòng giải đố/xác minh trên cửa sổ trình duyệt!');
                await page.waitForTimeout(4000).catch(() => {});
                continue;
            }
            
            // Xử lý Checkpoint "Bỏ qua" (ví dụ màn hình "Lưu trình duyệt tự động?")
            if (url.includes('/checkpoint')) {
                const isAutoTextVisible = await page.getByText(/tự động/i).first().isVisible({ timeout: 500 }).catch(() => false);
                const skipBtn = page.locator('span:has-text("Bỏ qua"), button:has-text("Bỏ qua"), div[role="button"]:has-text("Bỏ qua")').first();
                if (isAutoTextVisible && await skipBtn.isVisible({ timeout: 500 }).catch(() => false)) {
                    console.log('[+] Phát hiện màn hình checkpoint "Tự động". Đang click "Bỏ qua"...');
                    await skipBtn.click({ timeout: 4000 }).catch(() => {});
                    await page.waitForTimeout(3000).catch(() => {});
                    continue;
                }
            }
            
            const currentCookies = await page.context().cookies().catch(() => []);
            const hasSessionCookie = currentCookies.some(c => 
                (c.name === 'c_user' || c.name === 'i_user') && 
                (c.domain.includes('facebook.com') || c.domain.includes('messenger.com'))
            );

            // Nếu đã có session cookie c_user/i_user và đang ở trang auth_platform (màn hình chờ sau khi xác minh Google)
            if (hasSessionCookie && url.includes('auth_platform')) {
                console.log('[+] Đang hoàn tất xác minh Google và chuyển hướng về trang chủ Facebook...');
                await page.waitForTimeout(4000).catch(() => {});
            }

            const refreshedUrl = page.url();
            const isLoggedIn = hasSessionCookie && (
                               refreshedUrl.includes('facebook.com/home') || 
                               refreshedUrl.includes('facebook.com/messages') || 
                               refreshedUrl.includes('facebook.com/watch') || 
                               refreshedUrl.includes('facebook.com/groups') ||
                               (refreshedUrl.includes('facebook.com') && !refreshedUrl.includes('login') && !isCheckpointUrl(refreshedUrl))
            );
            
            if (isLoggedIn) {
                console.log('[+] Đăng nhập thành công vào Facebook. Tiến hành làm mới trang để đồng bộ cookie & token fb_dtsg...');
                await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
                await page.waitForTimeout(3000).catch(() => {});
                done = true;
                break;
            }

            // A. Nếu ở trang Google Account Chooser / Login
            if (url.includes('accounts.google.com')) {
                if (!googleLoginLogged) {
                    console.log('[+] Đang ở trang Google Sign-In. Đang chờ xử lý tự động hoặc bạn tự xác minh (như nhập mã 2FA)...');
                    googleLoginLogged = true;
                }
                const debugPath = path.join(__dirname, 'runtime', 'debug_google.png');
                await page.screenshot({ path: debugPath }).catch(() => {});
                await handleGoogleSignIn(page);
                await page.waitForTimeout(3000).catch(() => {});
                continue;
            }

            // B. Nếu có popup Google đang mở
            const allPages = page.context().pages();
            const googlePopup = allPages.find(p => p.url().includes('accounts.google.com'));
            if (googlePopup) {
                if (!googleLoginLogged) {
                    console.log('[+] Phát hiện popup Google Sign-In đang mở. Đang chờ xử lý...');
                    googleLoginLogged = true;
                }
                await handleGoogleSignIn(googlePopup);
                await page.waitForTimeout(3000).catch(() => {});
                continue;
            }

            // C.0. Kiểm tra nếu đang ở trang Khôi phục / Tìm tài khoản / Gmail Recovery
            if (url.includes('login/identify') || url.includes('recover') || await page.getByText(/Tìm tài khoản của bạn|Find your account|Chọn phương thức đăng nhập|Xác nhận tài khoản|Tạo mật khẩu mới/i).first().isVisible({ timeout: 500 }).catch(() => false)) {
                console.log(`[🔄] Đang ở trang Khôi phục / Tìm tài khoản. Kích hoạt luồng nhận mã qua Gmail cho Profile "${profileDirName}"...`);
                const credsFullRec = getCredentialsForProfile(profileDirName, profileIndex);
                const recovered = await handleFacebookGmailRecovery(page, credsFullRec);
                if (recovered) {
                    done = true;
                    break;
                }
                await page.waitForTimeout(2000).catch(() => {});
                continue;
            }

            // C. Kiểm tra các phần tử tương tác trên trang Facebook
            let hasPasswordInput = false;
            let pwdInputLocator = null;
            for (const selector of passwordSelectors) {
                try {
                    const el = page.locator(selector).first();
                    if (await el.isVisible({ timeout: 500 })) {
                        pwdInputLocator = el;
                        hasPasswordInput = true;
                        break;
                    }
                } catch (e) {}
            }

            // Chỉ điền mật khẩu nếu ô nhập không bị khóa
            const isPwdDisabled = hasPasswordInput ? await pwdInputLocator.isDisabled().catch(() => true) : false;

            if (hasPasswordInput && pwdInputLocator && !isPwdDisabled) {
                const creds = getCredentialsForProfile(profileDirName, profileIndex);
                const currentPassword = creds.password || "";

                if (!currentPassword) {
                    console.warn(`[!] Cảnh báo: Mật khẩu cho Profile "${profileDirName}" trống hoặc chưa thiết lập trong .env.`);
                    await page.waitForTimeout(3000).catch(() => {});
                } else {
                    console.log(`[+] Đang nhập mật khẩu cho Profile "${profileDirName}"...`);

                    // Re-query ô email & password tươi mới trên trang
                    const currentPwdEl = page.locator('input[type="password"]:visible, input[name="pass"]:visible, [placeholder*="Mật khẩu"]:visible, [placeholder*="Password"]:visible').first();
                    const currentEmailEl = page.locator('input[type="text"]:visible, input[name="email"]:visible, [placeholder*="Email"]:visible, [placeholder*="Số điện thoại"]:visible').first();

                        if (await currentEmailEl.isVisible({ timeout: 500 }).catch(() => false)) {
                            let emailVal = creds.email;
                            if (!emailVal || emailVal === "your-facebook-email@example.com") {
                                emailVal = getBotUIDFallback();
                            }
                            const currentEmailText = await currentEmailEl.inputValue().catch(() => "");
                            if (currentEmailText === "") {
                                console.log(`[+] Điền email/SĐT cho Profile "${profileDirName}": ${emailVal}`);
                                await currentEmailEl.fill(emailVal).catch(() => {});
                            }
                        }

                        if (await currentPwdEl.isVisible({ timeout: 500 }).catch(() => false)) {
                            await currentPwdEl.fill(currentPassword).catch(() => {});
                            console.log('[+] Gửi mật khẩu đăng nhập...');
                            await currentPwdEl.press('Enter').catch(() => {});

                            const loginBtn = page.locator('button[name="login"]:visible, button[type="submit"]:visible, button:has-text("Đăng nhập"):visible, button:has-text("Log in"):visible, #loginbutton:visible').first();
                            if (await loginBtn.isVisible({ timeout: 500 }).catch(() => false)) {
                                await loginBtn.click({ force: true }).catch(() => {});
                            }
                        }

                        // Chờ Facebook xử lý và điều hướng trang
                        await page.waitForNavigation({ timeout: 6000 }).catch(() => {});
                        await page.waitForTimeout(2000).catch(() => {});

                        // Kiểm tra xem Facebook có báo sai mật khẩu hay không
                        const wrongPwdErr = page.locator('text=/incorrect|không chính xác|không đúng|Wrong password|Invalid password|Hãy tìm tài khoản|Find your account/i').first();
                        const isRecoveryUrl = page.url().includes('login/identify') || page.url().includes('recover');
                        if (await wrongPwdErr.isVisible({ timeout: 1000 }).catch(() => false) || isRecoveryUrl) {
                            console.log(`[❌] Mật khẩu bị Facebook báo SAI! Kích hoạt ngay luồng Tìm tài khoản & Nhận mã qua Gmail cho Profile "${profileDirName}"...`);
                            const credsFullRec = getCredentialsForProfile(profileDirName, profileIndex);
                            await handleFacebookGmailRecovery(page, credsFullRec);
                            continue; // Bỏ qua việc điền lại mật khẩu, tiếp tục luồng khôi phục
                        }

                        console.log('[⏳] Mật khẩu đã gửi. Đang kiểm tra trang xác thực 2FA/xác minh...');

                        const credsFull = getCredentialsForProfile(profileDirName, profileIndex);

                        const enter2FACodeIfPresent = async () => {
                            if (!credsFull.twoFactorSecret) return false;
                            const codeInput = page.locator('input[type="text"]:visible, input[type="number"]:visible, input[name="approvals_code"]:visible, input[id*="code"]:visible, input[placeholder*="Mã"]:visible, input[aria-label*="Mã"]:visible').first();
                            if (await codeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
                                try {
                                    const totp = require('./includes/f/node_modules/totp-generator');
                                    const code2FA = totp(credsFull.twoFactorSecret);
                                    console.log(`[🔐] Đã tự tạo mã 2FA 6 số: ${code2FA}`);
                                    console.log('[+] Điền mã 2FA vào ô xác thực...');
                                    await codeInput.click({ force: true }).catch(() => {});
                                    await codeInput.fill('').catch(() => {});
                                    await codeInput.pressSequentially(code2FA, { delay: 80 }).catch(() => {
                                        return codeInput.fill(code2FA);
                                    });
                                    await codeInput.dispatchEvent('input').catch(() => {});
                                    await codeInput.dispatchEvent('change').catch(() => {});
                                    await page.waitForTimeout(800).catch(() => {});

                                    console.log('[+] Gửi mã 2FA...');
                                    await codeInput.press('Enter').catch(() => {});

                                    const submitCodeBtn = page.locator('button:has-text("Tiếp tục"), button:has-text("Tiếp"), button:has-text("Continue"), button[type="submit"]:visible, div[role="button"]:has-text("Tiếp tục")').first();
                                    if (await submitCodeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                                        await submitCodeBtn.click({ force: true }).catch(() => {});
                                    }
                                    console.log('[⏳] Đang chờ 5s để load vào trang chủ Facebook...');
                                    await page.waitForTimeout(5000).catch(() => {});
                                    return true;
                                } catch (totpErr) {
                                    console.warn(`[!] Lỗi khi sinh/điền mã 2FA: ${totpErr.message}`);
                                }
                            }
                            return false;
                        };

                        // Bước 1: Nếu đã ở màn hình "Đi đến ứng dụng xác thực" / có ô nhập mã 2FA -> Điền mã 2FA ngay lập tức
                        const isDirectAuthAppScreen = await page.getByText(/Đi đến ứng dụng xác thực|Go to your authentication app|Nhập mã xác thực|Check your authentication app/i).first().isVisible({ timeout: 2000 }).catch(() => false)
                            || await page.locator('input[type="text"]:visible, input[type="number"]:visible, input[name="approvals_code"]:visible').first().isVisible({ timeout: 2000 }).catch(() => false);

                        if (isDirectAuthAppScreen) {
                            console.log('[+] Phát hiện màn hình "Đi đến ứng dụng xác thực". Tiến hành nhập mã 2FA ngay...');
                            const doneDirect = await enter2FACodeIfPresent();
                            if (doneDirect) {
                                break;
                            }
                        }

                        // Bước 2: NẾU KHÔNG THẤY ô 2FA trực tiếp -> Mới bấm "Tôi không có thiết bị khác / Thử cách khác"
                        console.log('[+] Không thấy ô 2FA trực tiếp. Tiến hành thử bấm "Tôi không có thiết bị khác / Thử cách khác"...');
                        const tryOtherBtn = page.locator('text=/Tôi không có thiết bị khác|Thử cách khác|Try another way|Other ways/i').first();
                        if (await tryOtherBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                            console.log('[+] Bấm chọn "Tôi không có thiết bị khác / Thử cách khác"...');
                            await tryOtherBtn.click({ force: true }).catch(() => {});
                            await page.waitForTimeout(3000).catch(() => {});
                        }

                        // Bước 3: Chọn tùy chọn "Ứng dụng xác thực" trong bảng nổi (modal)
                        const authAppOption = page.locator('text=/Ứng dụng xác thực|Authentication app|Authenticator/i').first();
                        if (await authAppOption.isVisible({ timeout: 2000 }).catch(() => false)) {
                            console.log('[+] Chọn phương thức "Ứng dụng xác thực"...');
                            await authAppOption.click({ force: true }).catch(() => {});
                            await page.waitForTimeout(1500).catch(() => {});

                            const modalContinueBtn = page.locator('button:has-text("Tiếp tục"), button:has-text("Tiếp"), button:has-text("Continue"), div[role="button"]:has-text("Tiếp tục"), div[role="button"]:has-text("Tiếp")').first();
                            if (await modalContinueBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                                console.log('[+] Bấm "Tiếp tục" sau khi chọn Ứng dụng xác thực...');
                                await modalContinueBtn.click({ force: true }).catch(() => {});
                                await page.waitForTimeout(3000).catch(() => {});
                            }
                        }

                        // Bước 4: Nhập mã 2FA TOTP sau khi qua các bước chọn
                        await enter2FACodeIfPresent();
                }
                continue;
            }

            // D. CHẠY CHUỖI BƯỚC GIẢI CHECKPOINT & XÁC THỰC 2FA
            const credsLoop = getCredentialsForProfile(profileDirName, profileIndex);

            // 1. Nếu có ô nhập mã 2FA 6 số hiển thị -> Điền mã ngay lập tức
            const directCodeInput = page.locator('input[type="text"]:visible, input[type="number"]:visible, input[name="approvals_code"]:visible, input[id*="code"]:visible, input[placeholder*="Mã"]:visible, input[aria-label*="Mã"]:visible').first();
            if (await directCodeInput.isVisible({ timeout: 1000 }).catch(() => false)) {
                if (credsLoop.twoFactorSecret) {
                    try {
                        const totp = require('./includes/f/node_modules/totp-generator');
                        const code2FA = totp(credsLoop.twoFactorSecret);
                        console.log(`[🔐] Tự tạo mã 2FA 6 số: ${code2FA}`);
                        console.log('[+] Điền mã 2FA vào ô xác thực...');
                        await directCodeInput.click({ force: true }).catch(() => {});
                        await directCodeInput.fill('').catch(() => {});
                        await directCodeInput.pressSequentially(code2FA, { delay: 80 }).catch(() => {
                            return directCodeInput.fill(code2FA);
                        });
                        await directCodeInput.dispatchEvent('input').catch(() => {});
                        await directCodeInput.dispatchEvent('change').catch(() => {});
                        await page.waitForTimeout(800).catch(() => {});
                        await directCodeInput.press('Enter').catch(() => {});

                        const submitBtn = page.locator('button:has-text("Tiếp tục"), button:has-text("Tiếp"), button:has-text("Continue"), button[type="submit"]:visible, div[role="button"]:has-text("Tiếp tục")').first();
                        if (await submitBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
                            await submitBtn.click({ force: true }).catch(() => {});
                        }
                        await page.waitForTimeout(4000).catch(() => {});
                    } catch (e) {}
                }
            } else {
                // 2. Nếu không có ô 2FA trực tiếp -> Mới bấm "Tôi không có thiết bị khác / Thử cách khác"
                const findTryOtherWayButton = async (targetPage = page) => {
                    const selectors = [
                        targetPage.getByRole('button', { name: /Tôi không có thiết bị khác|Thử cách khác|Try another way/i }).first(),
                        targetPage.locator('button, [role="button"], a, [tabindex]').filter({ hasText: /Tôi không có thiết bị khác|Thử cách khác|Try another way/i }).first(),
                        targetPage.getByText(/Tôi không có thiết bị khác|Thử cách khác|Try another way/i).first()
                    ];
                    for (const sel of selectors) {
                        try {
                            if (await sel.isVisible({ timeout: 500 }).catch(() => false)) {
                                return sel;
                            }
                        } catch (e) {}
                    }
                    return null;
                };

                const tryOtherWayBtn = await findTryOtherWayButton();
                if (tryOtherWayBtn) {
                    console.log('[+] Tìm thấy nút "Tôi không có thiết bị khác / Thử cách khác". Đang click...');
                    await tryOtherWayBtn.click({ force: true, timeout: 3000 }).catch(() => {});
                    await page.waitForTimeout(2500).catch(() => {});

                    // Chọn tùy chọn "Ứng dụng xác thực" trong modal (nếu có)
                    const authAppOption = page.locator('text=/Ứng dụng xác thực|Authentication app|Authenticator/i').first();
                    if (await authAppOption.isVisible({ timeout: 2000 }).catch(() => false)) {
                        console.log('[+] Chọn phương thức "Ứng dụng xác thực"...');
                        await authAppOption.click({ force: true }).catch(() => {});
                        await page.waitForTimeout(1500).catch(() => {});

                        const modalContinueBtn = page.locator('button:has-text("Tiếp tục"), button:has-text("Tiếp"), button:has-text("Continue"), div[role="button"]:has-text("Tiếp tục"), div[role="button"]:has-text("Tiếp")').first();
                        if (await modalContinueBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                            console.log('[+] Bấm "Tiếp tục" sau khi chọn Ứng dụng xác thực...');
                            await modalContinueBtn.click({ force: true }).catch(() => {});
                            await page.waitForTimeout(3000).catch(() => {});
                        }
                    }

                    // Nhập mã 2FA ngay sau khi đi qua modal
                    const postModalCodeInput = page.locator('input[type="text"]:visible, input[type="number"]:visible, input[name="approvals_code"]:visible, input[id*="code"]:visible, input[placeholder*="Mã"]:visible, input[aria-label*="Mã"]:visible').first();
                    if (await postModalCodeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
                        if (credsLoop.twoFactorSecret) {
                            try {
                                const totp = require('./includes/f/node_modules/totp-generator');
                                const code2FA = totp(credsLoop.twoFactorSecret);
                                console.log(`[🔐] Tự tạo mã 2FA 6 số: ${code2FA}`);
                                console.log('[+] Điền mã 2FA vào ô xác thực...');
                                await postModalCodeInput.click({ force: true }).catch(() => {});
                                await postModalCodeInput.fill('').catch(() => {});
                                await postModalCodeInput.pressSequentially(code2FA, { delay: 80 }).catch(() => {
                                    return postModalCodeInput.fill(code2FA);
                                });
                                await postModalCodeInput.dispatchEvent('input').catch(() => {});
                                await postModalCodeInput.dispatchEvent('change').catch(() => {});
                                await page.waitForTimeout(800).catch(() => {});
                                await postModalCodeInput.press('Enter').catch(() => {});

                                const submitBtn = page.locator('button:has-text("Tiếp tục"), button:has-text("Tiếp"), button:has-text("Continue"), button[type="submit"]:visible, div[role="button"]:has-text("Tiếp tục")').first();
                                if (await submitBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
                                    await submitBtn.click({ force: true }).catch(() => {});
                                }
                                await page.waitForTimeout(4000).catch(() => {});
                            } catch (e) {}
                        }
                    }
                }
            }

            // E.0. Xử lý màn hình "Bạn đã đăng nhập. Tin cậy thiết bị này?" / "Lưu trình duyệt" / "Trust this device"
            const trustDeviceBtn = page.locator('button, [role="button"], input[type="submit"], [type="submit"], div[role="button"], a[role="button"]')
                .filter({ hasText: /Tin cậy thiết bị này|Tin cậy thiết bị|Tin cậy trình duyệt này|Tin cậy|Trust this device|Trust this browser|Trust device|Lưu trình duyệt|Save browser|Lưu thông tin đăng nhập|Lưu trình duyệt này/i })
                .first();

            if (await trustDeviceBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
                console.log('[+] Phát hiện màn hình "Bạn đã đăng nhập. Tin cậy thiết bị này?". Đang click nút Tin cậy thiết bị...');
                await trustDeviceBtn.click({ force: true, timeout: 4000 }).catch(() => {});
                await page.waitForTimeout(3000).catch(() => {});
                continue;
            }

            // E. Nút Tiếp tục/Continue thông thường (chỉ click khi không có ô nhập mã code)
            const hasCodeInput = url.includes('codesubmit') || 
                                 (isCheckpointUrl(url) && 
                                  await page.locator('input[type="text"]:visible, input[type="number"]:visible, input:not([type]):visible').first().isVisible({ timeout: 300 }).catch(() => false));

            if (!hasCodeInput) {
                const continueBtn = page.locator('button, [role="button"], input[type="submit"], [type="submit"]').filter({ hasText: /Tiếp tục|Continue/i }).first();
                if (await continueBtn.isVisible({ timeout: 500 }).catch(() => false)) {
                    console.log('[+] Click nút Tiếp tục thông thường...');
                    await continueBtn.click({ force: true, timeout: 4000 }).catch(() => {});
                    await page.waitForTimeout(3000).catch(() => {});
                    continue;
                }
            }

            await page.waitForTimeout(1500).catch(() => {});
        }

        // Đóng các tab rác
        const allPages = context.pages();
        for (const p of allPages) {
            if (p !== page) {
                await p.close().catch(() => {});
            }
        }

        const finalDebugPath = path.join(__dirname, 'runtime', 'debug_final.png');
        await page.screenshot({ path: finalDebugPath }).catch(() => {});
        console.log(`[i] Đã chụp ảnh màn hình cuối cùng tại: ${finalDebugPath}`);
    } catch (e) {
        console.warn(`[!] Lỗi khi xử lý nút Tiếp tục/Mật khẩu/Xác minh: ${e.message}`);
        try {
            const finalDebugPath = path.join(__dirname, 'runtime', 'debug_final.png');
            await page.screenshot({ path: finalDebugPath }).catch(() => {});
        } catch (err) {}
    }
}

function isCheckpointUrl(url) {
    if (!url) return false;
    try {
        const u = new URL(url);
        const pName = u.pathname.toLowerCase();
        if (pName.includes('/checkpoint') || pName.includes('/account_status') || pName.includes('/disabled')) {
            return true;
        }
    } catch (e) {
        if ((url.includes('/checkpoint/') || url.includes('/checkpoint?')) && !url.includes('checkpoint_src=')) {
            return true;
        }
    }
    return false;
}

async function checkContextCheckpoint(context) {
    if (!context) return { isCheckpoint: false, url: '' };
    try {
        const pages = typeof context.pages === 'function' ? context.pages() : [];
        for (const p of pages) {
            const url = p.url() || '';
            if (isCheckpointUrl(url)) {
                return { isCheckpoint: true, url };
            }
            const title = await p.title().catch(() => '');
            if (/confirm your identity|account locked|tài khoản bị khóa/i.test(title)) {
                return { isCheckpoint: true, url };
            }
            const hasLockText = await p.locator('text=/Tài khoản của bạn đã bị khóa|We locked your account|Xác nhận danh tính|Confirm your identity/i').first().isVisible({ timeout: 500 }).catch(() => false);
            if (hasLockText) {
                return { isCheckpoint: true, url };
            }
        }
    } catch (e) {}
    return { isCheckpoint: false, url: '' };
}

async function main() {
    let browser;
    let isCDP = false;
    let shouldCloseCDPBrowser = false;
    let spawnedBraveProc = null;
    let cookies = [];

    try {
        const profilePath = getBraveUserDataDir();
        const allProfiles = getBraveProfileDirectories(profilePath);
        
        let targetProfile = process.argv.slice(2).find(arg => !arg.startsWith('--')) || '';
        let candidateProfilesToUse = [];
        
        const activeInfoPath = path.join(__dirname, 'runtime', 'active_profile.json');

        if (targetProfile) {
            candidateProfilesToUse = [targetProfile];
        } else {
            let lastActive = null;
            if (fs.existsSync(activeInfoPath)) {
                try {
                    const info = JSON.parse(fs.readFileSync(activeInfoPath, 'utf8'));
                    lastActive = info.profileDir;
                } catch (e) {}
            }

            if (lastActive && allProfiles.includes(lastActive)) {
                console.log(`[i] Profile hoạt động gần nhất: "${lastActive}". Tiến hành xoay vòng sang profile khác...`);
                candidateProfilesToUse = allProfiles.filter(p => p !== lastActive);
                if (candidateProfilesToUse.length === 0) candidateProfilesToUse = allProfiles;
                else candidateProfilesToUse.push(lastActive);
            } else {
                candidateProfilesToUse = allProfiles;
            }
        }

        // Lọc bỏ các profile đang trong thời gian 1 tiếng bị Facebook khóa tính năng
        const blockedPath = path.join(__dirname, 'runtime', 'blocked_accounts.json');
        let blockedData = {};
        if (fs.existsSync(blockedPath)) {
            try { blockedData = JSON.parse(fs.readFileSync(blockedPath, 'utf8')); } catch (e) {}
        }

        const now = Date.now();
        const validCandidates = [];
        for (const pDir of candidateProfilesToUse) {
            const bInfo = blockedData[pDir];
            if (bInfo && bInfo.unblockAt && now < bInfo.unblockAt) {
                const remainMins = Math.ceil((bInfo.unblockAt - now) / (60 * 1000));
                console.log(`[⏳] Bỏ qua Profile "${pDir}" do đang bị khóa tính năng (còn ${remainMins} phút nữa mới hết 1 tiếng).`);
            } else {
                validCandidates.push(pDir);
            }
        }

        let finalProfiles = validCandidates;
        if (finalProfiles.length === 0) {
            console.warn('[⚠️] Tất cả Profile đều đang trong thời gian 1 tiếng bị khóa tính năng! Sẽ tiếp tục dùng danh sách mặc định...');
            finalProfiles = candidateProfilesToUse;
        }

        candidateProfilesToUse = finalProfiles;
        console.log(`[i] Dò thấy danh sách các Profile Brave khả dụng: ${JSON.stringify(candidateProfilesToUse)}`);

        // 0. (Đã bị loại bỏ theo yêu cầu của user: luôn luôn sử dụng Trình duyệt để lấy cookie cho chuẩn)

        // 1. Thử kết nối CDP trước (nếu đang có Brave GUI chạy cổng 9222)
        console.log(`\n[1] Đang thử kết nối CDP tới Google Brave tại ${CHROME_IP}:${CHROME_PORT}...`);
        
        let cdpProfileMatches = true;
        if (targetProfile) {
            try {
                const psOutput = require("child_process").execSync("ps aux | grep brave").toString();
                const match = psOutput.match(/--remote-debugging-port=9222.*--profile-directory=([^\s]+)/);
                if (match && match[1]) {
                    let activeCdpProfile = match[1];
                    // Normalize "Profile 1" vs "Profile\ 1"
                    activeCdpProfile = activeCdpProfile.replace(/\\ /g, ' ');
                    if (activeCdpProfile !== targetProfile) {
                        console.log(`[!] Bỏ qua CDP vì Brave đang mở Profile "${activeCdpProfile}" (không khớp với mục tiêu "${targetProfile}").`);
                        cdpProfileMatches = false;
                    }
                }
            } catch (e) {}
        }

        if (cdpProfileMatches) {
            try {
                const versionRes = await axios.get(`http://${CHROME_IP}:${CHROME_PORT}/json/version`, { timeout: 3000 });
                let wsUrl = versionRes.data.webSocketDebuggerUrl;
            if (wsUrl) {
                wsUrl = wsUrl.replace(/localhost|127\.0\.0\.1/, CHROME_IP);
                console.log(`[+] Lấy WebSocket thành công: ${wsUrl}`);
                console.log('[2] Đang attach Playwright qua CDP...');
                browser = await chromium.connectOverCDP(wsUrl);
                const contexts = browser.contexts();
                const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
                
                let cdpProfileName = targetProfile || (typeof activeCdpProfile !== 'undefined' ? activeCdpProfile : 'Default');
                let cdpIndex = 0;
                const cdpNumMatch = String(cdpProfileName).match(/(\d+)/);
                if (cdpNumMatch) cdpIndex = parseInt(cdpNumMatch[1], 10);
                
                await handleFacebookContinue(context, 45000, cdpIndex, cdpProfileName);
                const cdpCookies = await context.cookies();
                const fbCookies = cdpCookies.filter(c => c.domain.includes('facebook.com') || c.domain.includes('messenger.com'));
                const hasUserCookie = fbCookies.some(c => c.name === 'c_user' || c.name === 'i_user');
                const cpInfo = await checkContextCheckpoint(context);
                
                if (hasUserCookie && !cpInfo.isCheckpoint) {
                    cookies = cdpCookies;
                    isCDP = true;
                    console.log(`[+] Kết nối CDP thành công. Lấy được ${fbCookies.length} cookies.`);
                } else {
                    if (cpInfo.isCheckpoint) {
                        console.warn(`[⚠️] Profile CDP hiện tại bị dính link checkpoint (${cpInfo.url}). Tự động ngắt CDP để xoay vòng quét các Profile khác...`);
                    } else {
                        console.log('[!] Brave CDP hiện tại không có session Facebook hợp lệ. Tiến hành đóng và quét từng Profile...');
                    }
                    await browser.close().catch(() => {});
                    browser = null;
                }
            }
        } catch (cdpErr) {
            console.log(`[i] Không thể kết nối CDP (${cdpErr.message}). Chuyển sang quét tự động từng Profile...`);
        }
        }

        // 2. Nếu chưa lấy được cookie từ CDP, duyệt lần lượt qua danh sách candidateProfilesToUse (luân phiên fallback)
        if (!isCDP) {
            const execPath = getBraveExecutablePath();
            let activeProfileFound = false;

            for (let i = 0; i < candidateProfilesToUse.length; i++) {
                const profileDir = candidateProfilesToUse[i];
                console.log(`\n==========================================`);
                console.log(`[🔄] Đang thử Profile [${i + 1}/${candidateProfilesToUse.length}]: "${profileDir}"`);
                console.log(`==========================================`);

                // Dọn dẹp lock files cũ của Profile
                removeBraveLockFiles(profilePath, profileDir);

                if (profilePath) {
                    removeBraveLockFiles(profilePath);
                    removeBraveLockFiles(path.join(profilePath, profileDir));
                }

                let currentCookies = [];
                let currentBrowser = null;
                let currentSpawnedProc = null;
                let currentIsCDP = false;

                // Thử chạy Brave GUI có debug port cho Profile này
                try {
                    console.log(`[2] Khởi chạy Brave GUI với debug port. Profile: ${profilePath}, Profile Directory: ${profileDir}`);
                    const guiEnv = { ...process.env };
                    const uid = process.getuid ? process.getuid() : 1000;
                    if (!guiEnv.DISPLAY) {
                        if (fs.existsSync('/tmp/.X11-unix/X1')) guiEnv.DISPLAY = ':1';
                        else guiEnv.DISPLAY = ':0';
                    }
                    if (!guiEnv.XAUTHORITY) {
                        const xauthPaths = [
                            `/run/user/${uid}/gdm/Xauthority`,
                            `/run/user/${uid}/Xauthority`,
                            path.join(os.homedir(), '.Xauthority')
                        ];
                        for (const p of xauthPaths) {
                            if (fs.existsSync(p)) {
                                guiEnv.XAUTHORITY = p;
                                break;
                            }
                        }
                    }

                    currentSpawnedProc = spawn(execPath, [
                        `--remote-debugging-port=${CHROME_PORT}`,
                        `--user-data-dir=${profilePath}`,
                        `--profile-directory=${profileDir}`,
                        'https://www.facebook.com'
                    ], {
                        detached: true,
                        stdio: 'ignore',
                        env: guiEnv
                    });
                    currentSpawnedProc.unref();

                    let connected = false;
                    let versionRes;
                    console.log('[+] Đang chờ Brave GUI mở cổng debug...');
                    for (let attempt = 0; attempt < 10; attempt++) {
                        try {
                            versionRes = await axios.get(`http://${CHROME_IP}:${CHROME_PORT}/json/version`, { timeout: 1000 });
                            if (versionRes && versionRes.data && versionRes.data.webSocketDebuggerUrl) {
                                connected = true;
                                break;
                            }
                        } catch (e) {}
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }

                    if (connected && versionRes?.data?.webSocketDebuggerUrl) {
                        let wsUrl = versionRes.data.webSocketDebuggerUrl.replace(/localhost|127\.0\.0\.1/, CHROME_IP);
                        console.log(`[+] Lấy WebSocket thành công: ${wsUrl}`);
                        currentBrowser = await chromium.connectOverCDP(wsUrl);
                        const contexts = currentBrowser.contexts();
                        const context = contexts.length > 0 ? contexts[0] : await currentBrowser.newContext();

                        await handleFacebookContinue(context, 60000, i, profileDir);
                        currentCookies = await context.cookies();
                        currentIsCDP = true;
                    }
                } catch (guiErr) {
                    console.log(`[i] Không thể tự chạy Brave GUI (${guiErr.message}). Thử Headless...`);
                }

                // Nếu GUI thất bại hoặc không lấy được cookie, thử Headless cho Profile này
                const currentFbCookiesTest = currentCookies.filter(c => c.domain.includes('facebook.com') || c.domain.includes('messenger.com'));
                const currentHasUserCookieTest = currentFbCookiesTest.some(c => c.name === 'c_user' || c.name === 'i_user');

                if (!currentHasUserCookieTest) {
                    await cleanupBrowser(currentBrowser, currentSpawnedProc, currentIsCDP, true);
                    currentBrowser = null;
                    currentSpawnedProc = null;

                    // Dọn dẹp SingletonLock trước khi mở headless
                    removeBraveLockFiles(profilePath, profileDir);
                    await new Promise(r => setTimeout(r, 800));

                    try {
                        console.log(`[+] Khởi chạy Brave headless cho Profile: ${profileDir}`);
                        removeBraveLockFiles(profilePath, profileDir);

                        const env = { ...process.env };
                        const uid = process.getuid ? process.getuid() : 1000;
                        if (!env.DBUS_SESSION_BUS_ADDRESS) {
                            const dbusPath = `/run/user/${uid}/bus`;
                            if (fs.existsSync(dbusPath)) {
                                env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${dbusPath}`;
                            }
                        }
                        if (!env.DISPLAY) {
                            if (fs.existsSync('/tmp/.X11-unix/X1')) env.DISPLAY = ':1';
                            else env.DISPLAY = ':0';
                        }
                        if (!env.XDG_RUNTIME_DIR && fs.existsSync(`/run/user/${uid}`)) {
                            env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
                        }

                        currentBrowser = await chromium.launchPersistentContext(profilePath, {
                            headless: true,
                            executablePath: execPath || undefined,
                            args: [
                                `--profile-directory=${profileDir}`
                            ],
                            env: env
                        });

                        await handleFacebookContinue(currentBrowser, 60000, i, profileDir);
                        if (currentBrowser) {
                            currentCookies = await currentBrowser.cookies().catch(() => []);
                        }
                        currentIsCDP = false;
                    } catch (headlessErr) {
                        console.warn(`[!] Lỗi khi chạy Headless cho Profile "${profileDir}": ${headlessErr.message}`);
                    }
                }

                // Kiểm tra xem Profile này có session c_user / i_user sống hay không
                const fbCookies = currentCookies.filter(c => c.domain.includes('facebook.com') || c.domain.includes('messenger.com'));
                const hasUserCookie = fbCookies.some(c => c.name === 'c_user' || c.name === 'i_user');
                const currentContext = currentBrowser ? (typeof currentBrowser.contexts === 'function' ? currentBrowser.contexts()[0] : currentBrowser) : null;
                const cpInfo = await checkContextCheckpoint(currentContext);

                if (hasUserCookie && !cpInfo.isCheckpoint) {
                    console.log(`\n[✅] THÀNH CÔNG! Profile "${profileDir}" đang hoạt động (lấy được ${fbCookies.length} cookie Facebook).`);
                    activeProfileFound = true;

                    const profileAppState = fbCookies.map(c => {
                        const domain = c.domain.startsWith('.') ? c.domain.substring(1) : c.domain;
                        const expires = c.expires && c.expires > 0 
                            ? new Date(c.expires * 1000).toUTCString() 
                            : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
                        return {
                            key: c.name,
                            value: c.value,
                            domain: domain,
                            path: c.path,
                            hostOnly: !c.domain.startsWith('.'),
                            creation: new Date().toISOString(),
                            lastAccessed: new Date().toISOString(),
                            expires: expires
                        };
                    });

                    const appstatesDir = path.join(__dirname, 'runtime', 'appstates');
                    if (!fs.existsSync(appstatesDir)) fs.mkdirSync(appstatesDir, { recursive: true });

                    const profileAppstatePath = path.join(appstatesDir, `appstate_${profileDir}.json`);
                    fs.writeFileSync(profileAppstatePath, JSON.stringify(profileAppState, null, 2), 'utf8');
                    console.log(`[💾] Đã lưu appstate riêng cho Profile "${profileDir}" tại: ${profileAppstatePath}`);

                    if (cookies.length === 0) {
                        cookies = currentCookies;
                        browser = currentBrowser;
                        spawnedBraveProc = currentSpawnedProc;
                        isCDP = currentIsCDP;
                        shouldCloseCDPBrowser = true;
                        try {
                            const activeInfoPath = path.join(__dirname, 'runtime', 'active_profile.json');
                            fs.writeFileSync(activeInfoPath, JSON.stringify({ profileDir, updatedAt: new Date().toISOString() }, null, 2));
                        } catch (e) {}
                        break;
                    }

                    await cleanupBrowser(currentBrowser, currentSpawnedProc, currentIsCDP, true);
                    currentBrowser = null;
                    currentSpawnedProc = null;
                } else {
                    if (cpInfo.isCheckpoint) {
                        console.warn(`[⚠️] Profile "${profileDir}" bị dính link checkpoint (${cpInfo.url}). Tự động bỏ qua và chuyển sang Profile tiếp theo...`);
                    } else {
                        console.warn(`[⚠️] Profile "${profileDir}" bị khóa hoặc chưa đăng nhập Facebook.`);
                    }
                    await cleanupBrowser(currentBrowser, currentSpawnedProc, currentIsCDP, true);
                    currentBrowser = null;
                    currentSpawnedProc = null;
                }
            }

            if (!activeProfileFound || !cookies || cookies.length === 0) {
                throw new Error("Tất cả các Profile Brave đều bị khóa, văng checkpoint hoặc chưa đăng nhập Facebook.");
            }
        }

        const fbCookies = cookies.filter(c => 
            c.domain.includes('facebook.com') || c.domain.includes('messenger.com')
        );

        const hasUserCookie = fbCookies.some(c => c.name === 'c_user' || c.name === 'i_user');
        if (!hasUserCookie) {
            throw new Error("Không tìm thấy session đăng nhập Facebook (thiếu c_user hoặc i_user). Vui lòng đăng nhập lại tài khoản trên Brave.");
        }

        console.log(`[+] Lấy thành công ${fbCookies.length} cookie Facebook (bao gồm cả session c_user/i_user).`);

async function saveAppStateAndExit(cookiesList, b, proc, cdp, closeCdp, targetProfile) {
    const fbCookies = (cookiesList || []).filter(c => 
        c.key ? (c.domain.includes('facebook.com') || c.domain.includes('messenger.com'))
              : (c.domain.includes('facebook.com') || c.domain.includes('messenger.com'))
    );

    const appState = fbCookies.map(c => {
        if (c.key) return c; // Đã đúng chuẩn FCA
        const domain = c.domain.startsWith('.') ? c.domain.substring(1) : c.domain;
        const expires = c.expires && c.expires > 0 
            ? new Date(c.expires * 1000).toUTCString() 
            : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
        return {
            key: c.name,
            value: c.value,
            domain: domain,
            path: c.path,
            hostOnly: !c.domain.startsWith('.'),
            creation: new Date().toISOString(),
            lastAccessed: new Date().toISOString(),
            expires: expires
        };
    });

    const runtimeDir = path.dirname(APPSTATE_PATH);
    if (!fs.existsSync(runtimeDir)) {
        fs.mkdirSync(runtimeDir, { recursive: true });
    }

    console.log(`\n[3] Ghi appstate.json vào:`);
    console.log(`   - ${APPSTATE_PATH}`);
    console.log(`   - ${LEGACY_APPSTATE_PATH}`);
    
    if (!targetProfile) {
        fs.writeFileSync(APPSTATE_PATH, JSON.stringify(appState, null, 2), 'utf8');
        fs.writeFileSync(LEGACY_APPSTATE_PATH, JSON.stringify(appState, null, 2), 'utf8');
    }
    console.log('[+] Ghi file thành công!');

    if (targetProfile) {
        const appstatesDir = path.join(__dirname, 'runtime', 'appstates');
        if (!fs.existsSync(appstatesDir)) fs.mkdirSync(appstatesDir, { recursive: true });
        const profileAppstatePath = path.join(appstatesDir, `appstate_${targetProfile}.json`);
        fs.writeFileSync(profileAppstatePath, JSON.stringify(appState, null, 2), 'utf8');
        console.log(`[💾] Đã sao chép appstate riêng cho Profile "${targetProfile}" tại: ${profileAppstatePath}`);
        
        try {
            const activeInfoPath = path.join(__dirname, 'runtime', 'active_profile.json');
            fs.writeFileSync(activeInfoPath, JSON.stringify({ profileDir: targetProfile, updatedAt: new Date().toISOString() }, null, 2));
        } catch (e) {}
    }

    // Reset cờ kiểm tra báo cáo top để bot tự động quét và gửi bù ngay khi nhận appstate mới
    try {
        const lastCheckPath = path.join(__dirname, 'cache', 'top_reports_last_check.json');
        if (fs.existsSync(lastCheckPath)) {
            fs.unlinkSync(lastCheckPath);
            console.log('[🧹] Đã reset top_reports_last_check.json để bot kiểm tra lại báo cáo TOP ngay sau khi có appstate mới.');
        }
    } catch (e) {}

    await cleanupBrowser(b, proc, cdp, closeCdp);

    console.log('\n[4] Đã lưu appstate thành công. Hoàn tất!');
    process.exit(0);
}

        await saveAppStateAndExit(cookies, browser, spawnedBraveProc, isCDP, shouldCloseCDPBrowser, targetProfile);

    } catch (err) {
        console.error(`\n[-] LỖI XẢY RA: ${err.message}`);
        console.log('[-] Vui lòng kiểm tra lại Google Brave và thiết lập debug port.');
        await cleanupBrowser(browser, spawnedBraveProc, isCDP, shouldCloseCDPBrowser);
        process.exit(1);
    }
}

main();
