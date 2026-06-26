#!/usr/bin/env node
/**
 * Script to refresh Facebook appstate.json with fresh cookies
 * Usage: node refresh-appstate.js <email> <password>
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const login = require("./includes/f");

const args = process.argv.slice(2);
const envEmail = process.env.FB_EMAIL || process.env.FACEBOOK_EMAIL || "";
const envPassword = process.env.FB_PASSWORD || process.env.FACEBOOK_PASSWORD || "";

if (args.length < 2 && (!envEmail || !envPassword)) {
  console.log(`
❌ Cách sử dụng: node refresh-appstate.js <email> <password>

Ví dụ:
  node refresh-appstate.js your-email@gmail.com your-password

⚠️  CẢNH BÁO:
  - Chỉ chạy khi bot đang dừng
  - Nhập đúng email/password để tránh khóa tài khoản
  - Script sẽ lưu appstate.json mới vào thư mục gốc
`);
  process.exit(1);
}

const email = args[0] || envEmail;
const password = args[1] || envPassword;

console.log("⏳ Đang kết nối tới Facebook...");
console.log("📧 Email:", email);

login({
  email: email,
  password: password,
}, (err, api) => {
  if (err) {
    console.error("❌ Lỗi đăng nhập:");
    const errMsg = String(err?.message || err || "");
    if (errMsg.includes("2-FA") || errMsg.includes("2FA")) {
      console.error("ℹ️  Tài khoản bật 2FA, cần vô hiệu hóa tạm thời hoặc dùng app password");
    } else {
      console.error(errMsg);
    }
    process.exit(1);
  }

  try {
    // Lấy appState từ api
    const appState = api.getAppState();
    
    if (!appState || appState.length === 0) {
      console.error("❌ Không thể lấy appState từ Facebook");
      process.exit(1);
    }

    // Lưu vào runtime dir và giữ file gốc đồng bộ cho công cụ cũ
    const runtimeDir = path.join(__dirname, 'runtime');
    const runtimeOutputPath = path.join(runtimeDir, 'appstate.json');
    const legacyOutputPath = path.join(__dirname, 'appstate.json');
    const appStateText = JSON.stringify(appState, null, 2);

    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(runtimeOutputPath, appStateText);
    fs.writeFileSync(legacyOutputPath, appStateText);
    
    console.log("✅ Appstate.json đã được làm mới!");
    console.log(`📁 Lưu tại: ${runtimeOutputPath}`);
    console.log(`📊 Số cookies: ${appState.length}`);
    console.log("🔄 Bot sẽ tự load appstate mới khi khởi động lại");
    
    process.exit(0);
  } catch (err) {
    console.error("❌ Lỗi khi lưu appstate:");
    console.error(err.message || err);
    process.exit(1);
  }
});
