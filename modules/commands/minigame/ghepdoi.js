const { checkCooldown } = require('../../utils/cooldown');
const { ensureMentionsFromHistory } = require('../../utils/mentionResolver');
const { getThreadInfoCached } = require('../../utils/threadInfo');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const prefix = process.env.BOT_PREFIX;

async function downloadAvatar(userId) {
    try {
        const token = global.Fca?.Data?.AccessToken || "6628568379|c1e620fa708a1d5696fb991c1bde5662";
        const url = `https://graph.facebook.com/${userId}/picture?width=512&height=512&access_token=${token}`;
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
        return Buffer.from(response.data);
    } catch (err) {
        console.error(`Lỗi tải avatar cho ${userId}:`, err.message);
        return null;
    }
}

function drawHeart(ctx, x, y, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, size * 0.85);
    ctx.bezierCurveTo(-size * 0.9, size * 0.1, -size * 0.9, -size * 0.7, 0, -size * 0.35);
    ctx.bezierCurveTo(size * 0.9, -size * 0.7, size * 0.9, size * 0.1, 0, size * 0.85);
    ctx.closePath();
    ctx.restore();
}

function drawRoundRect(ctx, x, y, width, height, radius) {
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, width, height, radius);
    } else {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + width, y, x + width, y + height, radius);
        ctx.arcTo(x + width, y + height, x, y + height, radius);
        ctx.arcTo(x, y + height, x, y, radius);
        ctx.arcTo(x, y, x + width, y, radius);
        ctx.closePath();
    }
}

function drawAvatar(ctx, img, x, y, radius, name, color) {
    ctx.save();

    // Outer glowing neon ring
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.restore();

    // Clip image
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();

    if (img) {
        ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
    } else {
        // Professional fallback avatar silhouette matching target design
        ctx.fillStyle = '#9ca3af';
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);

        ctx.fillStyle = '#4b5563';
        // Head
        ctx.beginPath();
        ctx.arc(x, y - radius * 0.15, radius * 0.35, 0, Math.PI * 2);
        ctx.fill();
        // Shoulders / Body
        ctx.beginPath();
        ctx.arc(x, y + radius * 0.9, radius * 0.7, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

module.exports = {
    name: "ghepdoi",
    description: "Ghép đôi (Hỗ trợ ghép 2 người cụ thể kèm ảnh Canvas)",
    usage: `\n${prefix}ghepdoi → Ghép đôi ngẫu nhiên 2 người\n${prefix}ghepdoi tao → Tìm duyên cho bản thân\n${prefix}ghepdoi @A @B → Ghép đôi 2 người chỉ định\n━━━━━━━━━━━━━\n💘 Hiển thị tỉ lệ hợp đôi và nhận xét vui kèm ảnh\n💡 Hỗ trợ: tag, reply, hoặc tìm tên`,

    async execute({ api, event, args }) {
        await ensureMentionsFromHistory(api, event);
        const { threadID, senderID, mentions, messageReply } = event;

        // Cooldown 3s
        const cooldown = checkCooldown({ command: "ghepdoi", key: threadID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi ghép đôi tiếp!`, threadID);
        }

        try {
            // 1. Lấy danh sách thành viên
            const threadInfo = await getThreadInfoCached(api, threadID);

            if (!threadInfo || typeof threadInfo !== 'object' || !threadInfo.userInfo) {
                return api.sendMessage("❌ Không thể lấy danh sách thành viên nhóm.", threadID);
            }

            const participants = threadInfo.userInfo;
            const botID = api.getCurrentUserID();

            // Lọc Bot ra
            let validMembers = participants.filter(p => p.id != botID);

            if (validMembers.length < 2) {
                return api.sendMessage("⚠️ Nhóm vắng quá, không đủ người để ghép!", threadID);
            }

            let person1 = null;
            let person2 = null;

            // Định nghĩa các biến
            const mentionIDs = Object.keys(mentions);
            const firstArg = args[0] ? args[0].toLowerCase() : "";
            const selfKeywords = ["tao", "tui", "tớ", "mình", "me", "em", "anh"];
            const isSelf = selfKeywords.includes(firstArg);

            // ====================================================
            // LOGIC CHỌN NGƯỜI
            // ====================================================

            // TRƯỜNG HỢP 1: TAG 2 NGƯỜI CỤ THỂ
            if (mentionIDs.length >= 2) {
                const id1 = mentionIDs[0];
                const id2 = mentionIDs[1];

                person1 = validMembers.find(p => p.id == id1);
                if (!person1) person1 = { id: id1, name: mentions[id1].replace("@", "") };

                person2 = validMembers.find(p => p.id == id2);
                if (!person2) person2 = { id: id2, name: mentions[id2].replace("@", "") };
            }

            // TRƯỜNG HỢP 2: TAO + TAG/REPLY
            else if (isSelf && (mentionIDs.length > 0 || messageReply)) {
                person1 = validMembers.find(p => p.id == senderID);
                if (!person1) person1 = { id: senderID, name: "Bạn" };

                let targetID = messageReply ? messageReply.senderID : mentionIDs[0];
                person2 = validMembers.find(p => p.id == targetID);
                if (!person2) {
                    const nameTag = mentions[targetID] || "Người ấy";
                    person2 = { id: targetID, name: nameTag.replace("@", "") };
                }
            }

            // CÁC TRƯỜNG HỢP CÒN LẠI
            else {
                let targetID1 = null;

                if (messageReply) targetID1 = messageReply.senderID;
                else if (mentionIDs.length > 0) targetID1 = mentionIDs[0];
                else if (isSelf) targetID1 = senderID;
                else if (args.length > 0) {
                    const searchName = args.join(" ").replace("@", "").trim().toLowerCase();
                    if (searchName) {
                        const match = validMembers.find(p => p.name && p.name.toLowerCase().includes(searchName));
                        if (match) targetID1 = match.id;
                    }
                }

                if (targetID1) {
                    person1 = validMembers.find(p => p.id == targetID1);
                    if (!person1) person1 = { id: targetID1, name: "Người ấy" };
                } else {
                    const index1 = Math.floor(Math.random() * validMembers.length);
                    person1 = validMembers[index1];
                }

                const remainingMembers = validMembers.filter(p => p.id != person1.id);
                if (remainingMembers.length === 0) {
                    return api.sendMessage(`⚠️ Không còn ai khác để ghép với ${person1.name}!`, threadID);
                }
                const index2 = Math.floor(Math.random() * remainingMembers.length);
                person2 = remainingMembers[index2];
            }

            // ====================================================
            // TÍNH TOÁN & VẼ CANVAS
            // ====================================================

            const matchRate = Math.floor(Math.random() * 101);

            let comment = "";
            let canvasComment = "";
            if (matchRate < 20) {
                comment = "💔 Thôi toang, không có hy vọng đâu.";
                canvasComment = "Thôi toang, không có hy vọng đâu.";
            } else if (matchRate < 50) {
                comment = "😐 Hơi nhạt, chắc chỉ làm bạn xã giao.";
                canvasComment = "Hơi nhạt, chắc chỉ làm bạn xã giao.";
            } else if (matchRate < 80) {
                comment = "❤️ Cũng ổn áp đấy, thử tìm hiểu xem.";
                canvasComment = "Cũng ổn áp đấy, thử tìm hiểu xem.";
            } else if (matchRate < 95) {
                comment = "💕 Đẹp đôi vãi! Bot đẩy thuyền kèo này!";
                canvasComment = "Đẹp đôi vãi! Bot đẩy thuyền kèo này!";
            } else {
                comment = "💍 ĐỊNH MỆNH! Cưới gấp đi chờ chi nữa!";
                canvasComment = "ĐỊNH MỆNH! Cưới gấp đi chờ chi nữa!";
            }

            const senderInfo = validMembers.find(p => p.id == senderID);
            const senderName = senderInfo ? senderInfo.name : "Bạn";

            let msgBody = "";

            if (person1.id == senderID) {
                msgBody = `💘 GÓC TÌM DUYÊN 💘`;
            }
            else {
                msgBody = `💍 GÓC MAI MỐI 💍\n👤 Ông mai/Bà mối: ${senderName}`;
            }

            // --- VẼ CANVAS ---
            const width = 800;
            const height = 400;
            const canvas = createCanvas(width, height);
            const ctx = canvas.getContext('2d');

            // Background gradient chuyển màu lãng mạn lấp lánh
            const bgGradient = ctx.createLinearGradient(0, 0, width, height);
            bgGradient.addColorStop(0, '#0c071e');
            bgGradient.addColorStop(0.5, '#280c33');
            bgGradient.addColorStop(1, '#0b081a');
            ctx.fillStyle = bgGradient;
            ctx.fillRect(0, 0, width, height);

            // Hiệu ứng phát sáng neon mờ ở nền (Orbs)
            const orb1 = ctx.createRadialGradient(520, 180, 10, 520, 180, 280);
            orb1.addColorStop(0, 'rgba(255, 42, 141, 0.25)');
            orb1.addColorStop(1, 'rgba(255, 42, 141, 0)');
            ctx.fillStyle = orb1;
            ctx.fillRect(0, 0, width, height);

            const orb2 = ctx.createRadialGradient(280, 180, 10, 280, 180, 280);
            orb2.addColorStop(0, 'rgba(168, 85, 247, 0.25)');
            orb2.addColorStop(1, 'rgba(168, 85, 247, 0)');
            ctx.fillStyle = orb2;
            ctx.fillRect(0, 0, width, height);

            // Các vị trí tim trang trí nổi bật xung quanh ảnh (trùng khớp vị trí ảnh mẫu)
            const floatingHearts = [
                { x: 790, y: 135, size: 7 },
                { x: 785, y: 215, size: 7 },
                { x: 700, y: 325, size: 6 },
                { x: 132, y: 300, size: 8 },
                { x: 245, y: 335, size: 6 },
                { x: 300, y: 345, size: 7 },
                { x: 500, y: 345, size: 7 },
                { x: 785, y: 60, size: 8 }
            ];

            ctx.save();
            ctx.fillStyle = '#ff3b94';
            for (const h of floatingHearts) {
                drawHeart(ctx, h.x, h.y, h.size);
                ctx.fill();
            }
            ctx.restore();

            // Tải avatar song song
            const [avatar1Buf, avatar2Buf] = await Promise.all([
                downloadAvatar(person1.id),
                downloadAvatar(person2.id)
            ]);

            let avatar1Img = null;
            let avatar2Img = null;

            if (avatar1Buf) {
                try { avatar1Img = await loadImage(avatar1Buf); } catch (e) { console.error("Lỗi parse avatar 1:", e); }
            }
            if (avatar2Buf) {
                try { avatar2Img = await loadImage(avatar2Buf); } catch (e) { console.error("Lỗi parse avatar 2:", e); }
            }

            // Vẽ 2 Avatars với vòng neon tương ứng
            drawAvatar(ctx, avatar1Img, 180, 195, 85, person1.name, '#b026ff'); // Tím Neon bên trái
            drawAvatar(ctx, avatar2Img, 620, 195, 85, person2.name, '#ff007f'); // Hồng Neon bên phải

            // Vẽ Tiêu đề phát sáng "GHÉP ĐÔI HOÀN HẢO"
            ctx.save();
            ctx.shadowColor = '#ff2a8d';
            ctx.shadowBlur = 16;
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 30px "DejaVu Sans", "Liberation Sans", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('GHÉP ĐÔI HOÀN HẢO', 400, 42);
            ctx.restore();

            // Vẽ Tên 2 người chơi
            const displayName1 = person1.name.length > 15 ? person1.name.substring(0, 13) + '..' : person1.name;
            const displayName2 = person2.name.length > 15 ? person2.name.substring(0, 13) + '..' : person2.name;

            ctx.save();
            ctx.font = 'bold 22px "DejaVu Sans", "Liberation Sans", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = '#ffffff';

            // Tên người thứ 1
            ctx.shadowColor = '#b026ff';
            ctx.shadowBlur = 10;
            ctx.fillText(displayName1, 180, 312);

            // Tên người thứ 2
            ctx.shadowColor = '#ff007f';
            ctx.shadowBlur = 10;
            ctx.fillText(displayName2, 620, 312);
            ctx.restore();

            // Vẽ Trái tim 3D đỏ lãng mạn phát sáng ở giữa
            ctx.save();
            ctx.shadowColor = '#ff0055';
            ctx.shadowBlur = 25;
            const heartGrad = ctx.createLinearGradient(400, 95, 400, 245);
            heartGrad.addColorStop(0, '#ff5e84');
            heartGrad.addColorStop(1, '#ff1e62');
            ctx.fillStyle = heartGrad;
            drawHeart(ctx, 400, 150, 72);
            ctx.fill();
            ctx.restore();

            // Vẽ phần trăm hợp nhau trong trái tim (chữ trắng đậm sắc nét)
            ctx.save();
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 30px "DejaVu Sans", "Liberation Sans", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${matchRate}%`, 400, 155);
            ctx.restore();

            // Vẽ Thanh Tỉ Lệ (Progress Bar capsule) dưới tim
            const barWidth = 240;
            const barHeight = 16;
            const barX = 400 - barWidth / 2;
            const barY = 250;

            ctx.save();
            drawRoundRect(ctx, barX, barY, barWidth, barHeight, 8);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
            ctx.fill();

            const fillWidth = (matchRate / 100) * barWidth;
            if (fillWidth > 0) {
                ctx.beginPath();
                drawRoundRect(ctx, barX, barY, fillWidth, barHeight, 8);
                const progressGrad = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);
                progressGrad.addColorStop(0, '#ff658e');
                progressGrad.addColorStop(1, '#ff2a6d');
                ctx.fillStyle = progressGrad;
                ctx.fill();
            }
            ctx.restore();

            // Ghi nhận xét ngắn (Chữ trắng phát sáng, tự ngắt dòng ở giữa)
            ctx.save();
            ctx.shadowColor = '#ff2a8d';
            ctx.shadowBlur = 10;
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 23px "DejaVu Sans", "Liberation Sans", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            const words = canvasComment.split(' ');
            let currentLine = '';
            const lines = [];
            const maxWidth = 300; // Giới hạn chiều rộng chữ ở giữa 300px

            for (let n = 0; n < words.length; n++) {
                let testLine = currentLine + words[n] + ' ';
                let testWidth = ctx.measureText(testLine).width;
                if (testWidth > maxWidth && n > 0) {
                    lines.push(currentLine.trim());
                    currentLine = words[n] + ' ';
                } else {
                    currentLine = testLine;
                }
            }
            lines.push(currentLine.trim());

            const startY = lines.length > 1 ? 306 : 318;
            const lineHeight = 28;
            for (let i = 0; i < lines.length; i++) {
                ctx.fillText(lines[i], 400, startY + (i * lineHeight));
            }
            ctx.restore();

            // Vẽ Dải Ruy-băng / Đường uốn lượn trang trí (Decorative Swirl Ribbon) dưới dòng chữ
            const flourishY = startY + (lines.length * lineHeight) + 8;
            ctx.save();
            ctx.shadowColor = '#ff2a8d';
            ctx.shadowBlur = 10;
            ctx.strokeStyle = '#ff3b94';
            ctx.lineWidth = 2.5;

            // Đường cong bên trái
            ctx.beginPath();
            ctx.moveTo(385, flourishY);
            ctx.bezierCurveTo(350, flourishY + 8, 315, flourishY + 8, 275, flourishY - 2);
            ctx.stroke();

            // Đường cong bên phải
            ctx.beginPath();
            ctx.moveTo(415, flourishY);
            ctx.bezierCurveTo(450, flourishY + 8, 485, flourishY + 8, 525, flourishY - 2);
            ctx.stroke();

            // Trái tim nhỏ chính giữa ruy-băng
            ctx.fillStyle = '#ff3b94';
            drawHeart(ctx, 400, flourishY + 3, 6);
            ctx.fill();

            // Trái tim nhỏ 2 đầu ruy-băng
            drawHeart(ctx, 270, flourishY - 3, 5);
            ctx.fill();
            drawHeart(ctx, 530, flourishY - 3, 5);
            ctx.fill();
            ctx.restore();

            // Lưu file ảnh vào cache
            const cacheDir = path.join(__dirname, 'cache');
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }
            const filePath = path.join(cacheDir, `ghepdoi_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`);
            fs.writeFileSync(filePath, canvas.toBuffer('image/png'));

            // Gửi tin nhắn kèm ảnh
            const msg = {
                body: msgBody
            };

            if (fs.existsSync(filePath)) {
                msg.attachment = fs.createReadStream(filePath);
            }

            return api.sendMessage(msg, threadID, (err, info) => {
                if (fs.existsSync(filePath)) {
                    fs.unlink(filePath, () => { });
                }
            });

        } catch (e) {
            console.log("=== LỖI GHEPDOI THẬT SỰ ===");
            console.log(e);
            return api.sendMessage(`❌ Lỗi hệ thống ghép đôi.\nChi tiết: ${e.message}\n${e.stack}`, threadID);
        }
    }
};

