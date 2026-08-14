const fs = require('fs');
const path = require('path');
const { generateImage } = require('../../../src/ai/comfy');

const CACHE_DIR = path.resolve(__dirname, '../../../cache');

module.exports = {
    name: "taoanh",
    aliases: ["createimage"],
    description: "Tạo ảnh bằng AI đời tống (máy yếu)",
    usage: "\n/taoanh [yêu cầu]\nVí dụ:\n/taoanh a cyberpunk city at night\nẢnh được tạo chuẩn nhất khi viết yêu cầu bằng tiếng anh!",
    credits: "Antigravity",

    execute: async ({ api, event, args }) => {
        const { threadID, messageID } = event;
        const prompt = args.join(" ").trim();

        // Kiểm tra xem người dùng có nhập prompt hay không
        if (!prompt) {
            return api.sendMessage(
                "Vui lòng nhập prompt.\nVí dụ:\n/taoanh a cyberpunk city at night",
                threadID,
                messageID
            );
        }

        // 1. Gửi thông báo đang tạo ảnh
        api.sendMessage("🎨 Đang tạo ảnh...", threadID, messageID);

        let tempFilePath = null;
        try {
            // 2. Gọi hàm generateImage từ src/ai/comfy.js
            const imageBuffer = await generateImage(prompt);

            // Đảm bảo thư mục cache tồn tại
            if (!fs.existsSync(CACHE_DIR)) {
                fs.mkdirSync(CACHE_DIR, { recursive: true });
            }

            tempFilePath = path.join(CACHE_DIR, `taoanh_${Date.now()}_${Math.floor(Math.random() * 1000)}.png`);
            fs.writeFileSync(tempFilePath, imageBuffer);

            // 3. Khi thành công: Gửi ảnh lại Messenger
            await api.sendMessage(
                {
                    attachment: fs.createReadStream(tempFilePath)
                },
                threadID,
                messageID
            );
        } catch (error) {
            console.error('[Command taoanh] Error:', error.message || error);
            // 4. Nếu lỗi: Gửi thông báo lỗi
            api.sendMessage("❌ Không thể tạo ảnh.", threadID, messageID);
        } finally {
            // Xóa file ảnh tạm trong cache sau 5s
            if (tempFilePath) {
                setTimeout(() => {
                    try {
                        if (fs.existsSync(tempFilePath)) {
                            fs.unlinkSync(tempFilePath);
                        }
                    } catch (err) {
                        // Bỏ qua lỗi xóa file tạm
                    }
                }, 5000);
            }
        }
    }
};
