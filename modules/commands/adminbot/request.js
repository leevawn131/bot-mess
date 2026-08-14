const ITEMS_PER_PAGE = 10;

/**
 * Lấy danh sách lời mời kết bạn từ Facebook
 */
async function fetchFriendRequests(api) {
    // 1. Ưu tiên gọi API chính thức từ FCA (api.getFriendRequests)
    if (typeof api.getFriendRequests === "function") {
        try {
            const list = await api.getFriendRequests(100);
            if (Array.isArray(list)) {
                return list.map(item => ({
                    userID: String(item.userID || item.id),
                    name: item.name || `Người dùng ${item.userID}`
                }));
            }
        } catch (e) {
            console.error("Lỗi api.getFriendRequests:", e?.message || e);
            if (e?.message?.includes("Rate Limit")) {
                throw e; // Ném lỗi ra ngoài để hiển thị cho người dùng
            }
        }
    }

    // 2. Các phương thức dự phòng nếu FCA chưa nạp hàm mới
    return new Promise((resolve) => {
        api.httpGet('https://mbasic.facebook.com/friends/requests/', {}, (err1, html1) => {
            if (!err1 && html1) {
                const list1 = parseMbasicRequests(html1);
                if (list1 && list1.length > 0) return resolve(list1);
            }

            api.httpGet('https://mbasic.facebook.com/reqs.php', {}, (err2, html2) => {
                if (!err2 && html2) {
                    const list2 = parseMbasicRequests(html2);
                    if (list2 && list2.length > 0) return resolve(list2);
                }

                api.httpGet('https://www.facebook.com/friends/requests/', {}, (err3, html3) => {
                    if (!err3 && html3) {
                        const list3 = parseDesktopRequests(html3);
                        if (list3 && list3.length > 0) return resolve(list3);
                    }

                    const form4 = {
                        q: "query FriendingQuery{viewer{friend_requests(first:100){edges{node{id,name}}}}}"
                    };

                    api.httpPost('https://www.facebook.com/api/graphql/', form4, (err4, res4) => {
                        if (!err4 && res4) {
                            const list4 = parseGraphQLRequests(res4);
                            if (list4 && list4.length > 0) return resolve(list4);
                        }
                        resolve([]);
                    });
                }, true);
            }, true);
        }, true);
    });
}

function parseMbasicRequests(html) {
    const list = [];
    const seen = new Set();

    const regexHover = /href="\/friends\/hovercard\/mbasic\/\?uid=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/gi;
    let match;
    while ((match = regexHover.exec(html)) !== null) {
        const userID = match[1];
        const name = match[2].trim();
        if (!seen.has(userID) && name && !name.includes("Facebook") && !name.includes("Help")) {
            seen.add(userID);
            list.push({ userID, name });
        }
    }

    if (list.length === 0) {
        const regexProfile = /href="\/(?:profile\.php\?id=|)(\d{9,16})[^"]*"[^>]*>([^<]+)<\/a>/gi;
        while ((match = regexProfile.exec(html)) !== null) {
            const userID = match[1];
            const name = match[2].trim();
            if (!seen.has(userID) && name && !name.includes("Facebook") && !name.includes("Help") && !name.includes("Menu") && !name.includes("Trang chủ")) {
                seen.add(userID);
                list.push({ userID, name });
            }
        }
    }

    if (list.length === 0) {
        const regexIDs = /(?:confirm_id|uid|subject_id)=(\d{9,16})/gi;
        while ((match = regexIDs.exec(html)) !== null) {
            const userID = match[1];
            if (!seen.has(userID)) {
                seen.add(userID);
                list.push({ userID, name: `Người dùng ${userID}` });
            }
        }
    }

    return list;
}

function parseDesktopRequests(html) {
    const list = [];
    const seen = new Set();

    const regexNode = /"(?:from|user|node)"\s*:\s*\{\s*"id"\s*:\s*"(\d{9,16})"\s*,\s*"name"\s*:\s*"([^"]+)"/gi;
    let match;
    while ((match = regexNode.exec(html)) !== null) {
        const userID = match[1];
        const name = match[2];
        if (!seen.has(userID) && name) {
            seen.add(userID);
            list.push({ userID, name });
        }
    }

    if (list.length === 0) {
        const regexGen = /"id"\s*:\s*"(\d{9,16})"[^}]*?"name"\s*:\s*"([^"]+)"/gi;
        while ((match = regexGen.exec(html)) !== null) {
            const userID = match[1];
            const name = match[2];
            if (!seen.has(userID) && name && !name.includes("Bundle") && !name.includes("Worker")) {
                seen.add(userID);
                list.push({ userID, name });
            }
        }
    }

    return list;
}

function parseGraphQLRequests(resDataStr) {
    const list = [];
    const seen = new Set();
    try {
        const json = typeof resDataStr === 'string' ? JSON.parse(resDataStr) : resDataStr;
        const requests = json?.data?.viewer?.friend_requests?.edges || json?.data?.actor?.friend_requests?.edges || [];
        for (const edge of requests) {
            const node = edge?.node;
            if (node && node.id && !seen.has(node.id)) {
                seen.add(node.id);
                list.push({ userID: String(node.id), name: node.name || 'Người dùng Facebook' });
            }
        }
    } catch (e) {}
    return list;
}

/**
 * Phân tích danh sách số thứ tự từ chuỗi nhập vào (VD: "1 2 3", "1, 2, 3", "1-5")
 */
function parseIndexes(inputStr) {
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
}

/**
 * Tạo tin nhắn hiển thị danh sách lời mời kết bạn
 */
function renderListMessage(requestsList, page) {
    const totalRequests = requestsList.length;
    const totalPages = Math.ceil(totalRequests / ITEMS_PER_PAGE) || 1;
    const currentPage = Math.max(1, Math.min(page, totalPages));

    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const pageItems = requestsList.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    let msg = `📌 DANH SÁCH LỜI MỜI KẾT BẠN (Trang ${currentPage}/${totalPages})\n`;
    msg += `🌐 Tổng số lời mời: ${totalRequests}\n`;
    msg += `────────────────\n`;

    if (pageItems.length === 0) {
        msg += `❌ Hiện tại không có lời mời kết bạn nào.\n`;
    } else {
        pageItems.forEach((item, index) => {
            const stt = index + 1;
            msg += `${stt}. ${item.name} (${item.userID})\n`;
        });
    }

    msg += `────────────────\n`;
    msg += `👉 Reply tin nhắn này để thao tác:\n`;
    msg += `• "1 2 3" hoặc "đồng ý 1 2" để ĐỒNG Ý các vị trí tương ứng\n`;
    msg += `• "từ chối 1 2" (hoặc "tc 1 2") để TỪ CHỐI các vị trí\n`;
    msg += `• "đồng ý all" (hoặc "d all") để ĐỒNG Ý TẤT CẢ\n`;
    msg += `• "từ chối all" (hoặc "tc all") để TỪ CHỐI TẤT CẢ\n`;
    msg += `• Số trang (VD: "2") để chuyển sang trang khác`;

    return { msg, currentPage, totalPages };
}

module.exports = {
    name: "request",
    aliases: ["req", "lmkb", "friendrequest", "banbe", "kettban"],
    description: "Xem và xử lý danh sách lời mời kết bạn (sử dụng api.getFriendRequests và api.handleFriendRequest)",
    usage: "!request [số trang]",

    execute: async ({ api, event, args }) => {
        const threadID = String(event.threadID);
        const senderID = String(event.senderID);

        let initialPage = 1;
        if (args[0] && !isNaN(args[0])) {
            initialPage = parseInt(args[0], 10);
        }

        api.sendMessage("🔍 Đang tải danh sách lời mời kết bạn, vui lòng chờ...", threadID, async (err, info) => {
            try {
                const requestsList = await fetchFriendRequests(api);
                const { msg, currentPage, totalPages } = renderListMessage(requestsList, initialPage);

                api.sendMessage(msg, threadID, (sendErr, sendInfo) => {
                    if (sendErr || !sendInfo) return;

                    if (!Array.isArray(global.client.handleReply)) {
                        global.client.handleReply = [];
                    }

                    global.client.handleReply = global.client.handleReply.filter(
                        h => !(h.threadID === threadID && h.name === "request")
                    );

                    global.client.handleReply.push({
                        name: "request",
                        messageID: sendInfo.messageID,
                        author: senderID,
                        threadID: threadID,
                        requestsList: requestsList,
                        page: currentPage,
                        totalPages: totalPages
                    });
                });
            } catch (fetchErr) {
                const errMsg = fetchErr?.message || "Lỗi không xác định khi lấy danh sách lời mời kết bạn.";
                api.sendMessage(`❌ ${errMsg}`, threadID);
            }

            if (info?.messageID) {
                try { api.unsendMessage(info.messageID); } catch (e) {}
            }
        });
    },

    handleReply: async ({ api, event }) => {
        const { threadID, messageID, senderID, body, messageReply } = event;
        if (!messageReply) return;

        const list = global.client && Array.isArray(global.client.handleReply) ? global.client.handleReply : [];
        const handleData = list.find(h => String(h.messageID) === String(messageReply.messageID) && h.name === "request");
        if (!handleData) return;

        if (String(handleData.author) !== String(senderID)) {
            return api.sendMessage("⚠️ Chỉ người gọi lệnh mới được phép thực hiện thao tác này!", threadID, messageID);
        }

        const input = String(body || "").trim().toLowerCase();
        if (!input) return;

        let requestsList = handleData.requestsList || [];
        const currentPage = handleData.page || 1;

        if (requestsList.length === 0) {
            try {
                requestsList = await fetchFriendRequests(api);
                handleData.requestsList = requestsList;
            } catch (e) {
                return api.sendMessage(`❌ ${e?.message || "Không thể nạp lại danh sách lời mời."}`, threadID, messageID);
            }
        }

        // 1. Chuyển trang
        if (!isNaN(input)) {
            const newPage = parseInt(input, 10);
            const totalPages = Math.ceil(requestsList.length / ITEMS_PER_PAGE) || 1;

            if (newPage < 1 || newPage > totalPages) {
                return api.sendMessage(`⚠️ Trang không hợp lệ! Vui lòng nhập từ 1 đến ${totalPages}.`, threadID, messageID);
            }

            const { msg } = renderListMessage(requestsList, newPage);
            return api.sendMessage(msg, threadID, (sendErr, sendInfo) => {
                if (sendErr || !sendInfo) return;
                handleData.messageID = sendInfo.messageID;
                handleData.page = newPage;
            });
        }

        // 2. Xác định hành động (Đồng ý / Từ chối)
        let action = null; // 'accept' hoặc 'reject'
        let isAll = false;
        let targetIndexes = [];

        if (input.includes("đồng ý all") || input.includes("d all") || input.includes("y all") || input.includes("accept all")) {
            action = 'accept';
            isAll = true;
        } else if (input.includes("từ chối all") || input.includes("tc all") || input.includes("n all") || input.includes("reject all") || input.includes("deny all") || input.includes("delete all")) {
            action = 'reject';
            isAll = true;
        } else if (input.startsWith("từ chối") || input.startsWith("tc ") || input.startsWith("n ") || input.startsWith("deny ") || input.startsWith("reject ")) {
            action = 'reject';
            const cleanStr = input.replace(/^(từ chối|tc|n|deny|reject)\s*/, "");
            targetIndexes = parseIndexes(cleanStr);
        } else if (input.startsWith("đồng ý") || input.startsWith("d ") || input.startsWith("y ") || input.startsWith("accept ")) {
            action = 'accept';
            const cleanStr = input.replace(/^(đồng ý|d|y|accept)\s*/, "");
            targetIndexes = parseIndexes(cleanStr);
        } else {
            targetIndexes = parseIndexes(input);
            if (targetIndexes.length > 0) {
                action = 'accept';
            }
        }

        if (!action) {
            return api.sendMessage("⚠️ Cú pháp không hợp lệ! Vui lòng nhập ví dụ: '1 2', 'đồng ý 1', 'từ chối 2' hoặc 'đồng ý all'.", threadID, messageID);
        }

        let targets = [];
        if (isAll) {
            targets = [...requestsList];
        } else {
            const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
            const pageItems = requestsList.slice(startIndex, startIndex + ITEMS_PER_PAGE);

            for (const idx of targetIndexes) {
                if (idx >= 1 && idx <= pageItems.length) {
                    targets.push(pageItems[idx - 1]);
                } else if (idx >= 1 && idx <= requestsList.length) {
                    targets.push(requestsList[idx - 1]);
                }
            }
        }

        const uniqueTargets = [];
        const seenIDs = new Set();
        for (const t of targets) {
            if (t && t.userID && !seenIDs.has(t.userID)) {
                seenIDs.add(t.userID);
                uniqueTargets.push(t);
            }
        }

        if (uniqueTargets.length === 0) {
            return api.sendMessage("⚠️ Không tìm thấy người dùng phù hợp với số thứ tự bạn chọn.", threadID, messageID);
        }

        const isAccept = action === 'accept';
        const actionLabel = isAccept ? "Chấp nhận" : "Từ chối";

        api.sendMessage(`⏳ Bắt đầu ${actionLabel.toLowerCase()} ${uniqueTargets.length} lời mời kết bạn...\n⏱️ Thời gian chờ ngẫu nhiên 3 - 5s mỗi lần.`, threadID);

        let successCount = 0;
        let failCount = 0;
        let isLoggedOut = false;

        for (let i = 0; i < uniqueTargets.length; i++) {
            const target = uniqueTargets[i];

            let apiErr = null;
            try {
                await new Promise((resolve) => {
                    api.handleFriendRequest(target.userID, isAccept, (err) => {
                        if (err) apiErr = err;
                        resolve();
                    });
                });
            } catch (e) {
                apiErr = e;
            }

            if (apiErr) {
                failCount++;
                console.error(`❌ Lỗi handleFriendRequest (${target.userID}):`, apiErr);

                const errString = String(apiErr.error || apiErr.err || apiErr.message || apiErr).toLowerCase();
                if (errString.includes("login") || errString.includes("logged out") || errString.includes("checkpoint") || errString.includes("1357004")) {
                    isLoggedOut = true;
                    api.sendMessage(`⛔ BỊ ĐĂNG XUẤT HOẶC PHIÊN ĐĂNG NHẬP HẾT HẠN!\n⚠️ Lỗi: ${errString}\n🛑 Tiến trình bị DỪNG NGAY LẬP TỨC (không bảo lưu tiến trình).`, threadID);
                    break;
                }
            } else {
                successCount++;
            }

            if (i < uniqueTargets.length - 1 && !isLoggedOut) {
                const randomDelay = Math.floor(Math.random() * 2001) + 3000;
                await new Promise(res => setTimeout(res, randomDelay));
            }
        }

        if (!isLoggedOut) {
            api.sendMessage(`🎉 Hoàn tất tiến trình ${actionLabel.toLowerCase()} lời mời kết bạn!\n✅ Thành công: ${successCount}\n❌ Thất bại: ${failCount}`, threadID);
        }
    }
};
