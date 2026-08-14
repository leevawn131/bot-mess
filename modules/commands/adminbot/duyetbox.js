const ITEMS_PER_PAGE = 10;

module.exports = {
    name: "duyetbox",
    aliases: ["duyet", "pending"],
    description: "Duyệt tin nhắn đang chờ cho bot",
    usage: "\n!duyetbox [số trang]\n!duyetbox spam [số trang]",
    execute: async ({ api, event, args, config }) => {
        const { threadID, messageID, senderID } = event;
        
        // Admin check
        const adminIDs = config.adminIDs || [];
        if (!adminIDs.map(id => String(id)).includes(String(senderID))) {
            return api.sendMessage("⚠️ Chỉ Chủ bot mới được sử dụng lệnh này.", threadID, messageID);
        }

        let isSpam = false;
        let pageArgIndex = 0;
        
        if (args[0] && args[0].toLowerCase() === "spam") {
            isSpam = true;
            pageArgIndex = 1;
        }

        let initialPage = 1;
        if (args[pageArgIndex] && !isNaN(args[pageArgIndex])) {
            initialPage = parseInt(args[pageArgIndex], 10);
        }

        const type = isSpam ? "OTHER" : "PENDING";
        
        api.sendMessage(`🔍 Đang tải danh sách tin nhắn ${isSpam ? "spam" : "đang chờ"}, vui lòng đợi...`, threadID, async (err, info) => {
            try {
                const list = await api.getThreadList(100, null, [type]);
                const pendingList = list;
                
                if (pendingList.length === 0) {
                    const msgOut = `❌ Hiện tại không có tin nhắn ${isSpam ? "spam" : "đang chờ"} nào.`;
                    api.sendMessage(msgOut, threadID);
                    if (info && info.messageID) {
                        try { api.unsendMessage(info.messageID); } catch (e) {}
                    }
                    return;
                }

                // Pagination
                const totalItems = pendingList.length;
                const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
                const currentPage = Math.max(1, Math.min(initialPage, totalPages));
                const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
                const pageItems = pendingList.slice(startIndex, startIndex + ITEMS_PER_PAGE);

                let msg = `📌 DANH SÁCH TIN NHẮN ${isSpam ? "SPAM" : "ĐANG CHỜ"} (Trang ${currentPage}/${totalPages})\n`;
                msg += `🌐 Tổng số: ${totalItems}\n`;
                msg += `────────────────\n`;
                
                pageItems.forEach((t, i) => {
                    const index = startIndex + i + 1;
                    const name = t.name || t.threadID;
                    msg += `${index}. ${name} (${t.isGroup ? "Nhóm" : "Cá nhân"})\n`;
                });
                
                msg += `────────────────\n`;
                msg += `👉 Reply tin nhắn này để thao tác:\n`;
                msg += `• "1 2 3" hoặc "d 1 2" để DUYỆT các vị trí\n`;
                msg += `• "tc 1 2" để TỪ CHỐI các vị trí\n`;
                msg += `• "d all" để DUYỆT TẤT CẢ\n`;
                msg += `• "tc all" để TỪ CHỐI TẤT CẢ\n`;
                msg += `• Số trang (VD: "2") để chuyển trang`;

                api.sendMessage(msg, threadID, (sendErr, sendInfo) => {
                    if (sendErr || !sendInfo) return;
                    
                    if (!Array.isArray(global.client.handleReply)) {
                        global.client.handleReply = [];
                    }
                    global.client.handleReply = global.client.handleReply.filter(
                        h => !(h.threadID === threadID && h.name === "duyetbox")
                    );

                    global.client.handleReply.push({
                        name: "duyetbox",
                        messageID: sendInfo.messageID,
                        author: senderID,
                        threadID: threadID,
                        pendingList: pendingList,
                        page: currentPage,
                        isSpam: isSpam
                    });
                });
            } catch (err2) {
                api.sendMessage(`❌ Lỗi khi lấy danh sách: ${err2.message || err2}`, threadID);
            }
            if (info && info.messageID) {
                try { api.unsendMessage(info.messageID); } catch (e) {}
            }
        });
    },

    handleReply: async ({ api, event }) => {
        const { threadID, messageID, senderID, body, messageReply } = event;
        if (!messageReply) return;

        const list = global.client && Array.isArray(global.client.handleReply) ? global.client.handleReply : [];
        const handleData = list.find(h => String(h.messageID) === String(messageReply.messageID) && h.name === "duyetbox");
        if (!handleData) return;

        if (String(handleData.author) !== String(senderID)) {
            return api.sendMessage("⚠️ Chỉ người gọi lệnh mới được thao tác!", threadID, messageID);
        }

        const input = String(body || "").trim().toLowerCase();
        if (!input) return;

        let pendingList = handleData.pendingList || [];
        const isSpam = handleData.isSpam;

        if (pendingList.length === 0) return;

        if (!isNaN(input) && !input.includes(" ")) {
            const newPage = parseInt(input, 10);
            const totalPages = Math.ceil(pendingList.length / ITEMS_PER_PAGE) || 1;
            if (newPage < 1 || newPage > totalPages) {
                return api.sendMessage(`⚠️ Trang không hợp lệ! Vui lòng nhập từ 1 đến ${totalPages}.`, threadID, messageID);
            }
            
            const startIndex = (newPage - 1) * ITEMS_PER_PAGE;
            const pageItems = pendingList.slice(startIndex, startIndex + ITEMS_PER_PAGE);

            let msg = `📌 DANH SÁCH TIN NHẮN ${isSpam ? "SPAM" : "ĐANG CHỜ"} (Trang ${newPage}/${totalPages})\n`;
            msg += `🌐 Tổng số: ${pendingList.length}\n`;
            msg += `────────────────\n`;
            pageItems.forEach((t, i) => {
                const index = startIndex + i + 1;
                const name = t.name || t.threadID;
                msg += `${index}. ${name} (${t.isGroup ? "Nhóm" : "Cá nhân"})\n`;
            });
            msg += `────────────────\n`;
            msg += `👉 Reply tin nhắn này để thao tác:\n`;
            msg += `• "1 2 3" hoặc "d 1 2" để DUYỆT\n`;
            msg += `• "tc 1 2" để TỪ CHỐI\n`;
            msg += `• "d all" để DUYỆT TẤT CẢ\n`;
            msg += `• "tc all" để TỪ CHỐI TẤT CẢ\n`;
            msg += `• Số trang (VD: "2") để chuyển trang`;

            return api.sendMessage(msg, threadID, (sendErr, sendInfo) => {
                if (sendErr || !sendInfo) return;
                handleData.messageID = sendInfo.messageID;
                handleData.page = newPage;
            });
        }

        const parseIndexes = (inputStr) => {
            const indexes = [];
            const parts = inputStr.split(/[\s,]+/);
            for (const part of parts) {
                if (part.includes('-')) {
                    const [start, end] = part.split('-').map(Number);
                    if (!isNaN(start) && !isNaN(end) && start <= end) {
                        for (let i = start; i <= end; i++) indexes.push(i);
                    }
                } else {
                    const num = Number(part);
                    if (!isNaN(num) && num > 0) indexes.push(num);
                }
            }
            return Array.from(new Set(indexes));
        };

        let action = null;
        let isAll = false;
        let targetIndexes = [];

        if (input.includes("đồng ý all") || input.includes("d all") || input.includes("accept all") || input.includes("duyệt all") || input.includes("duyet all")) {
            action = 'accept';
            isAll = true;
        } else if (input.includes("từ chối all") || input.includes("tc all") || input.includes("reject all") || input.includes("xoá all") || input.includes("xoa all")) {
            action = 'reject';
            isAll = true;
        } else if (input.startsWith("từ chối") || input.startsWith("tc ") || input.startsWith("xoá ") || input.startsWith("xoa ")) {
            action = 'reject';
            const cleanStr = input.replace(/^(từ chối|tc|xoá|xoa)\s*/, "");
            targetIndexes = parseIndexes(cleanStr);
        } else if (input.startsWith("đồng ý") || input.startsWith("d ") || input.startsWith("duyệt ") || input.startsWith("duyet ")) {
            action = 'accept';
            const cleanStr = input.replace(/^(đồng ý|d|duyệt|duyet)\s*/, "");
            targetIndexes = parseIndexes(cleanStr);
        } else {
            targetIndexes = parseIndexes(input);
            if (targetIndexes.length > 0) {
                action = 'accept';
            }
        }

        if (!action) {
            return api.sendMessage("⚠️ Cú pháp không hợp lệ!", threadID, messageID);
        }

        let targets = [];
        if (isAll) {
            targets = [...pendingList];
        } else {
            for (const idx of targetIndexes) {
                if (idx >= 1 && idx <= pendingList.length) {
                    targets.push(pendingList[idx - 1]);
                }
            }
        }

        if (targets.length === 0) {
            return api.sendMessage("⚠️ Không tìm thấy vị trí phù hợp.", threadID, messageID);
        }

        const isAccept = action === 'accept';
        const actionLabel = isAccept ? "Duyệt" : "Từ chối";
        
        api.sendMessage(`⏳ Bắt đầu ${actionLabel.toLowerCase()} ${targets.length} tin nhắn...\n⏱️ Quá trình này có thể mất một chút thời gian.`, threadID);

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            try {
                if (isAccept) {
                    await new Promise(resolve => {
                        api.handleMessageRequest(target.threadID, true, (err) => {
                            if (err) {
                                api.sendMessage("✅ Bot đã kết nối thành công qua lệnh duyệt của Admin.", target.threadID, (err2) => {
                                    if (err2) failCount++;
                                    else successCount++;
                                    resolve();
                                });
                            } else {
                                api.sendMessage("✅ Bot đã kết nối thành công qua lệnh duyệt của Admin.", target.threadID, (err2) => {
                                    successCount++;
                                    resolve();
                                });
                            }
                        });
                    });
                } else {
                    await new Promise(resolve => {
                        api.handleMessageRequest(target.threadID, false, (err) => {
                            if (err) failCount++;
                            else successCount++;
                            resolve();
                        });
                    });
                }
            } catch (e) {
                failCount++;
            }
            
            await new Promise(res => setTimeout(res, 1000 + Math.random() * 1000));
        }

        api.sendMessage(`🎉 Hoàn tất tiến trình ${actionLabel.toLowerCase()}!\n✅ Thành công: ${successCount}\n❌ Thất bại: ${failCount}`, threadID);
    }
};
