const axios = require('axios');
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
require('dotenv').config();

// ==========================================
// CẤU HÌNH
// ==========================================
const ADSPOWER_API = 'http://127.0.0.1:50325';
const USER_ID = 'k1cyhomj';          // Thay bằng user_id của bạn nếu cần
const API_KEY = process.env.ADSPOWER_APIKEY || ''; // Đọc từ file .env

// Tự động xác định đường dẫn lưu file appstate.json ở thư mục runtime cùng cấp với script này
const APPSTATE_PATH = path.join(__dirname, 'runtime', 'appstate.json');

// Lệnh chạy qua CMD của Windows để khởi động lại bot bằng PM2 trên WSL
const RESTART_CMD = 'wsl pm2 restart all'; // Hoặc thay 'all' bằng tên tiến trình PM2 của bạn (ví dụ: 'wsl pm2 restart index')

// ==========================================
// HÀM CHÍNH
// ==========================================
async function main() {
    let browser;
    try {
        console.log(`\n[1] Đang kết nối AdsPower để mở profile [${USER_ID}]...`);
        
        // Gọi AdsPower API để khởi động profile
        const startRes = await axios.get(`${ADSPOWER_API}/api/v1/browser/start`, {
            params: { user_id: USER_ID },
            // Truyền API Key theo tài liệu AdsPower (Verification)
            headers: { 
                'Authorization': `Bearer ${API_KEY}`
            } 
        });

        if (startRes.data.code !== 0) {
            throw new Error(`AdsPower API báo lỗi: ${startRes.data.msg || JSON.stringify(startRes.data)}`);
        }

        const wsUrl = startRes.data.data.ws.puppeteer;
        console.log(`[+] Profile mở thành công! WebSocket Debugger URL: ${wsUrl}`);

        console.log('\n[2] Đang attach Playwright qua CDP...');
        // Kết nối Playwright với debug port của AdsPower
        browser = await chromium.connectOverCDP(wsUrl);
        const contexts = browser.contexts();
        
        // Lấy context đầu tiên (mặc định của AdsPower)
        const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
        
        console.log('[+] Đã attach thành công. Đang kiểm tra giao diện đăng nhập...');
        
        const pages = context.pages();
        let page = pages.length > 0 ? pages[0] : await context.newPage();
        
        // Tìm xem có tab nào đang mở facebook.com không
        const fbPage = pages.find(p => p.url().includes('facebook.com'));
        if (fbPage) {
            page = fbPage;
            console.log(`[+] Đang thao tác trên tab Facebook đang mở: ${page.url()}`);
        } else {
            console.log('[+] Đang điều hướng đến facebook.com...');
            await page.goto('https://www.facebook.com', { waitUntil: 'networkidle' });
        }

        // Đợi trang load ổn định
        await page.waitForTimeout(2000);

        // Danh sách các selector có thể đại diện cho nút "Tiếp tục" / "Continue"
        const continueSelectors = [
            'text="Tiếp tục"',
            'text="Continue"',
            'div[role="button"]:has-text("Tiếp tục")',
            'div[role="button"]:has-text("Continue")',
            'button:has-text("Tiếp tục")',
            'button:has-text("Continue")',
            '[aria-label="Tiếp tục"]',
            '[aria-label="Continue"]'
        ];

        let clicked = false;
        for (const selector of continueSelectors) {
            try {
                const btn = page.locator(selector).first();
                if (await btn.isVisible()) {
                    console.log(`[+] Tìm thấy nút bấm phù hợp (${selector}). Đang tự động nhấn...`);
                    await btn.click();
                    clicked = true;
                    break;
                }
            } catch (e) {
                // Bỏ qua lỗi và tiếp tục thử selector khác
            }
        }

        if (clicked) {
            console.log('[+] Đã nhấn nút Tiếp tục. Đang chờ 5 giây để Facebook xử lý đăng nhập và cấp cookie...');
            await page.waitForTimeout(5000);
        } else {
            console.log('[i] Không thấy nút "Tiếp tục" cần nhấn (hoặc trình duyệt đã đăng nhập sẵn vào trang chủ).');
        }

        console.log('[+] Đang trích xuất cookie...');
        const cookies = await context.cookies();
        
        // Lọc các cookie liên quan đến Facebook
        const fbCookies = cookies.filter(c => 
            c.domain.includes('facebook.com') || c.domain.includes('messenger.com')
        );

        if (fbCookies.length === 0) {
            console.warn('[!] Không tìm thấy cookie Facebook. Bạn đã đăng nhập chưa?');
        } else {
            console.log(`[+] Lấy thành công ${fbCookies.length} cookie Facebook.`);
        }

        // Chuyển đổi cookie sang định dạng appstate.json tương thích với ws3-fca / fca-unofficial
        const appState = fbCookies.map(c => ({
            key: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            hostOnly: !c.domain.startsWith('.'),
            creation: new Date().toISOString(),
            lastAccessed: new Date().toISOString()
        }));

        console.log(`\n[3] Đang ghi appstate.json vào: ${APPSTATE_PATH}`);
        // Ghi file trực tiếp vào file system của WSL thông qua network path
        fs.writeFileSync(APPSTATE_PATH, JSON.stringify(appState, null, 2), 'utf8');
        console.log('[+] Ghi file thành công!');

        // Ngắt kết nối CDP
        await browser.close();
        console.log('[+] Đã ngắt kết nối Playwright.');

        // Tự động đóng profile AdsPower
        console.log(`\n[3.5] Đang yêu cầu AdsPower đóng profile [${USER_ID}]...`);
        try {
            const stopRes = await axios.get(`${ADSPOWER_API}/api/v1/browser/stop`, {
                params: { user_id: USER_ID },
                headers: { 
                    'Authorization': `Bearer ${API_KEY}`
                } 
            });
            if (stopRes.data.code === 0) {
                console.log('[+] Đã đóng profile AdsPower thành công!');
            } else {
                console.warn(`[!] AdsPower báo lỗi khi đóng profile: ${stopRes.data.msg}`);
            }
        } catch (stopErr) {
            console.warn(`[!] Không thể gửi yêu cầu đóng profile đến AdsPower: ${stopErr.message}`);
        }

        // 5. Restart container/PM2 (Bỏ qua nếu chạy tự động với --no-restart)
        if (process.argv.includes('--no-restart')) {
            console.log('\n[4] Phát hiện tham số --no-restart. Bỏ qua bước restart.');
            process.exit(0);
        }

        console.log(`\n[4] Đang khởi động lại container bằng lệnh: ${RESTART_CMD}`);
        exec(RESTART_CMD, (error, stdout, stderr) => {
            if (error) {
                console.error(`[-] Lỗi khi chạy lệnh restart: ${error.message}`);
                return;
            }
            if (stderr) {
                console.warn(`[!] STDERR: ${stderr}`);
            }
            console.log(`[+] Khởi động lại container hoàn tất!\nSTDOUT: ${stdout}`);
            process.exit(0);
        });

    } catch (err) {
        console.error(`\n[-] LỖI XẢY RA: ${err.message}`);
        console.log('[-] Vui lòng kiểm tra lại AdsPower, API Key, hoặc đường dẫn file chia sẻ mạng (\\wsl$\\Ubuntu).');
        
        if (browser) {
            await browser.close().catch(() => {});
        }
        process.exit(1);
    }
}

// Bắt đầu chạy script
main();
