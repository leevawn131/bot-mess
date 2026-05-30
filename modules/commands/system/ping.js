const os = require("os");
const { checkCooldown } = require('../../utils/cooldown');

module.exports = {
    name: "ping",
    description: "Kiểm tra trạng thái bot",
    usage: "\n!ping → Kiểm tra độ trễ, RAM, uptime của bot\n━{13}\n📊 Hiển thị: Ping, bộ nhớ, thời gian hoạt động",
    execute: async ({ api, event, args }) => {
        const { threadID, messageID, senderID } = event;

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "ping", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        try {
            // 1. Tính độ trễ
            const ping = Date.now() - parseInt(event.timestamp || Date.now());

            // 2. Tính RAM của BOT (Bot ăn bao nhiêu)
            const botMemUsage = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);

            // 3. Tính RAM của MÁY CHỦ (System RAM)
            const totalMem = os.totalmem(); // Tổng RAM (bytes)
            const freeMem = os.freemem();   // RAM trống (bytes)
            const usedMem = totalMem - freeMem; // RAM đã dùng

            // Đổi sang MB cho dễ đọc
            const systemUsedMB = (usedMem / 1024 / 1024).toFixed(0);
            const systemTotalMB = (totalMem / 1024 / 1024).toFixed(0);
            
            // Tính phần trăm đã dùng
            const percent = Math.round((usedMem / totalMem) * 100);

            // 4. Thời gian chạy (Uptime)
            const uptime = process.uptime();
            const h = Math.floor(uptime / 3600);
            const m = Math.floor((uptime % 3600) / 60);
            const s = Math.floor(uptime % 60);

            // 5. Thông tin CPU (bonus thêm cho ngầu)
            const cpuModel = os.cpus()[0].model.trim();
            const cpuCores = os.cpus().length;

            const msg = `🏓 PONG!\n` +
                        `━━━━━━━━━━━━━\n` +
                        `📶 Độ trễ: ${ping}ms\n` +
                        `🤖 Bot RAM: ${botMemUsage} MB\n` +
                        `🖥️ System RAM: ${systemUsedMB}MB / ${systemTotalMB}MB (${percent}%)\n` +
                        `🧠 CPU: ${cpuCores} core(s) - ${cpuModel}\n` +
                        `⏰ Uptime: ${h}H ${m}M ${s}S`;

            // Gửi tin nhắn
            return api.sendMessage(msg, event.threadID, String(event.messageID));

        } catch (e) {
            console.error(e);
            api.sendMessage("❌ Lỗi khi lấy thông số server.", event.threadID);
        }
    }
};