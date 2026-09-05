#!/usr/bin/env node

/**
 * 🛠️ SCRIPT QUẢN LÝ & BẢO LƯU / NỐI CHUỖI TƯƠNG TÁC (STREAK)
 * Dùng cho các trường hợp cụm / nhóm nghỉ lễ, bảo trì hoặc tạm ngưng bot vài ngày.
 *
 * Cách sử dụng:
 *   node scripts/maintain_streak.js --cluster 3            # Nối chuỗi cho tất cả nhóm thuộc Cụm 3
 *   node scripts/maintain_streak.js --cluster 3 --dry-run  # Chạy thử (không ghi file)
 *   node scripts/maintain_streak.js --cluster 3 --status   # Xem trạng thái streak hiện tại của Cụm 3
 *   node scripts/maintain_streak.js --thread <thread_id>   # Nối chuỗi cho 1 nhóm cụ thể
 *   node scripts/maintain_streak.js --all                  # Nối chuỗi cho toàn bộ các nhóm
 *   node scripts/maintain_streak.js --help                 # Xem hướng dẫn chi tiết
 */

const fs = require("fs");
const path = require("path");

const STATS_PATH = path.join(__dirname, "..", "message_stats.json");
const BACKUP_DIR = path.join(__dirname, "..", "cache", "backups");
const DAILY_TOP_STATE_PATH = path.join(__dirname, "..", "cache", "checktt_daily_top_state.json");

/**
 * Lấy ngày hôm qua theo giờ Việt Nam (UTC+7) dạng YYYY-MM-DD
 */
function getVNYesterdayKey(offsetDays = 1) {
    const now = new Date();
    const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    vnTime.setUTCDate(vnTime.getUTCDate() - offsetDays);
    const y = vnTime.getUTCFullYear();
    const m = String(vnTime.getUTCMonth() + 1).padStart(2, "0");
    const d = String(vnTime.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

/**
 * Lấy ngày hôm nay theo giờ Việt Nam (UTC+7)
 */
function getVNTodayKey() {
    const now = new Date();
    const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const y = vnTime.getUTCFullYear();
    const m = String(vnTime.getUTCMonth() + 1).padStart(2, "0");
    const d = String(vnTime.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

/**
 * Đọc toàn bộ file message_stats.json
 */
function readStats() {
    if (!fs.existsSync(STATS_PATH)) {
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(STATS_PATH, "utf8"));
    } catch (e) {
        console.error("❌ Lỗi khi đọc file message_stats.json:", e.message);
        return {};
    }
}

/**
 * Tạo bản sao lưu an toàn trước khi ghi file
 */
function backupStats(stats) {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(BACKUP_DIR, `message_stats_backup_${timestamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(stats, null, 2));
    return backupFile;
}

/**
 * Lấy danh sách threadID theo Cluster ID từ SQLite
 */
async function getThreadIDsByCluster(clusterId) {
    try {
        const { execute } = require("../modules/utils/database");
        const rows = await execute(
            "SELECT thread_id FROM group_profile_bindings WHERE cluster_id = ?",
            [Number(clusterId)]
        );
        if (Array.isArray(rows)) {
            return rows.map((r) => String(r.thread_id));
        }
    } catch (e) {
        console.error(`❌ Lỗi truy vấn nhóm của Cụm ${clusterId} từ database:`, e.message);
    }
    return [];
}

/**
 * Lấy tất cả binding các cụm từ SQLite
 */
async function getAllClusterBindings() {
    try {
        const { execute } = require("../modules/utils/database");
        const rows = await execute("SELECT thread_id, cluster_id FROM group_profile_bindings");
        return Array.isArray(rows) ? rows : [];
    } catch (e) {
        return [];
    }
}

/**
 * In hướng dẫn sử dụng
 */
function printHelp() {
    console.log(`
=============================================================================
🔥 TOOL QUẢN LÝ & DUY TRÌ CHUỖI TƯƠNG TÁC (STREAK) DÙNG LÂU DÀI 🔥
=============================================================================

CÚ PHÁP:
  node scripts/maintain_streak.js [TÙY CHỌN]

TÙY CHỌN CHỌN NHÓM:
  --cluster, -c <id>     Chỉ định Cụm cần xử lý (VD: --cluster 3 hoặc -c 1,2)
  --thread, -t <id>      Chỉ định Thread ID nhóm (VD: --thread 123456789)
  --threads <id1,id2>    Chỉ định nhiều Thread ID (phân cách bằng dấu phẩy)
  --all                  Áp dụng cho TOÀN BỘ các nhóm có trong bot

TÙY CHỌN HÀNH ĐỘNG:
  --status, -s           Chỉ kiểm tra và hiển thị tình trạng streak hiện tại (không sửa)
  --target-date <YYYY-MM-DD>  Đặt ngày mốc lastDate (Mặc định: ngày hôm qua ${getVNYesterdayKey()})
  --dry-run              Chạy thử nghiệm mô phỏng, KHÔNG ghi đè dữ liệu vào file
  --force-current <số>   (Tùy chọn) Ép toàn bộ streak hiện tại về một số ngày cụ thể
  --help, -h             Hiển thị bảng trợ giúp này

VÍ DỤ THỰC TẾ:
  1. Xem thống kê streak của Cụm 3:
     node scripts/maintain_streak.js --cluster 3 --status

  2. Nối chuỗi an toàn cho Cụm 3 sau đợt nghỉ (chạy thử trước):
     node scripts/maintain_streak.js --cluster 3 --dry-run

  3. Nối chuỗi thực tế cho Cụm 3:
     node scripts/maintain_streak.js --cluster 3

  4. Nối chuỗi cho 1 nhóm cụ thể:
     node scripts/maintain_streak.js --thread 1361699998859808

=============================================================================
`);
}

/**
 * Hàm thực thi chính
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.includes("--help") || args.includes("-h") || args.length === 0) {
        printHelp();
        process.exit(0);
    }

    const isDryRun = args.includes("--dry-run");
    const isStatusOnly = args.includes("--status") || args.includes("-s");

    // Lấy cluster ID
    let targetClusters = [];
    const clusterIdx = args.findIndex((a) => a === "--cluster" || a === "-c");
    if (clusterIdx !== -1 && args[clusterIdx + 1]) {
        targetClusters = args[clusterIdx + 1].split(",").map((c) => c.trim()).filter(Boolean);
    }

    // Lấy target thread ID
    let targetThreads = [];
    const threadIdx = args.findIndex((a) => a === "--thread" || a === "-t");
    if (threadIdx !== -1 && args[threadIdx + 1]) {
        targetThreads.push(args[threadIdx + 1].trim());
    }

    const threadsIdx = args.findIndex((a) => a === "--threads");
    if (threadsIdx !== -1 && args[threadsIdx + 1]) {
        targetThreads.push(...args[threadsIdx + 1].split(",").map((t) => t.trim()).filter(Boolean));
    }

    const isAll = args.includes("--all");

    // Lấy ngày đích (mặc định là ngày hôm qua theo giờ VN)
    let targetDate = getVNYesterdayKey();
    const dateIdx = args.findIndex((a) => a === "--target-date" || a === "-d");
    if (dateIdx !== -1 && args[dateIdx + 1]) {
        targetDate = args[dateIdx + 1].trim();
    }

    const todayKey = getVNTodayKey();
    const stats = readStats();
    const allKnownThreadIDs = Object.keys(stats);

    // Xác định danh sách threadID cần xử lý
    let selectedThreadIDs = new Set();

    if (targetClusters.length > 0) {
        console.log(`🔍 Đang quét danh sách nhóm thuộc Cụm [${targetClusters.join(", ")}]...`);
        for (const cId of targetClusters) {
            const tids = await getThreadIDsByCluster(cId);
            tids.forEach((tid) => selectedThreadIDs.add(tid));
            console.log(`   ➡️ Cụm ${cId}: Tìm thấy ${tids.length} nhóm trong cơ sở dữ liệu.`);
        }
    }

    if (targetThreads.length > 0) {
        targetThreads.forEach((tid) => selectedThreadIDs.add(tid));
    }

    if (isAll) {
        allKnownThreadIDs.forEach((tid) => selectedThreadIDs.add(tid));
    }

    const targetList = Array.from(selectedThreadIDs);

    if (targetList.length === 0) {
        console.log("⚠️ Không tìm thấy nhóm nào phù hợp với điều kiện đưa ra!");
        if (targetClusters.length > 0) {
            console.log("💡 Gợi ý: Nếu chưa gán nhóm vào Cụm trong bảng `group_profile_bindings`, hãy dùng `--thread <ID>` hoặc xem `--help`.");
        }
        process.exit(0);
    }

    console.log(`\n📋 Tổng cộng ${targetList.length} nhóm được chọn để ${isStatusOnly ? "kiểm tra" : "xử lý"}.`);
    console.log(`📅 Mốc ngày hôm nay (VN): ${todayKey}`);
    console.log(`📅 Mốc ngày nối chuỗi (lastDate): ${targetDate}`);
    if (isDryRun) {
        console.log(`🛡️ CHẾ ĐỘ CHẠY THỬ (DRY-RUN): Sẽ không có thay đổi nào được ghi vào file.\n`);
    }

    // =========================================================================
    // 1. CHẾ ĐỘ XEM TRẠNG THÁI (STATUS)
    // =========================================================================
    if (isStatusOnly) {
        console.log("\n📊 --- KẾT QUẢ THỐNG KÊ STREAK HIỆN TẠI ---");
        for (const threadID of targetList) {
            const threadData = stats[threadID] || {};
            const userIds = Object.keys(threadData).filter((uid) => /^\d+$/.test(uid));
            let totalStreakUsers = 0;
            let maxStreak = 0;
            let longestRecord = 0;
            let zeroStreakWithRecord = 0;

            for (const uid of userIds) {
                const streak = threadData[uid]?.streak;
                if (streak) {
                    const cur = Number(streak.current) || 0;
                    const lon = Number(streak.longest) || 0;
                    if (cur > 0) totalStreakUsers++;
                    if (cur > maxStreak) maxStreak = cur;
                    if (lon > longestRecord) longestRecord = lon;
                    if (cur === 0 && lon > 0) zeroStreakWithRecord++;
                }
            }

            console.log(`\n📌 Nhóm: ${threadID}`);
            console.log(`   - Tổng số thành viên ghi nhận: ${userIds.length}`);
            console.log(`   - Đang có chuỗi hoạt động: ${totalStreakUsers} người`);
            console.log(`   - Chuỗi dài nhất hiện tại: ${maxStreak} ngày 🔥`);
            console.log(`   - Kỷ lục chuỗi cao nhất nhóm: ${longestRecord} ngày 🏆`);
            console.log(`   - Số người bị về 0 (nhưng có kỷ lục cũ): ${zeroStreakWithRecord} người`);
        }
        console.log("\n✅ Hoàn tất kiểm tra trạng thái.");
        process.exit(0);
    }

    // =========================================================================
    // 2. CHẾ ĐỘ NỐI CHUỖI / BẢO LƯU (MAINTAIN / BRIDGE)
    // =========================================================================
    let totalUpdatedUsers = 0;
    let totalRestoredUsers = 0;
    let totalGroupsProcessed = 0;

    for (const threadID of targetList) {
        if (!stats[threadID]) {
            console.log(`⚠️ Nhóm ${threadID} chưa có dữ liệu tin nhắn trong message_stats.json, bỏ qua.`);
            continue;
        }

        const threadData = stats[threadID];
        const userIds = Object.keys(threadData).filter((uid) => /^\d+$/.test(uid));
        let groupUpdatedCount = 0;
        let groupRestoredCount = 0;

        for (const uid of userIds) {
            const userEntry = threadData[uid];
            if (!userEntry || typeof userEntry !== "object") continue;

            if (!userEntry.streak || typeof userEntry.streak !== "object") {
                userEntry.streak = {
                    current: 0,
                    lastDate: null,
                    lastTime: 0,
                    longest: 0,
                    brokenCount: 0
                };
            }

            const streak = userEntry.streak;
            const cur = Number(streak.current) || 0;
            const lon = Number(streak.longest) || 0;
            let isModified = false;

            // TRƯỜNG HỢP A: Chuỗi đã bị reset về 0 (nhưng trước đó từng có chuỗi / kỷ lục)
            if (cur === 0 && lon > 0) {
                streak.current = lon; // Khôi phục lại mức streak cũ
                if (Number(streak.brokenCount) > 0) {
                    streak.brokenCount = Number(streak.brokenCount) - 1; // Hoàn lại 1 lần đứt chuỗi do nghỉ
                }
                streak.lastDate = targetDate;
                groupRestoredCount++;
                isModified = true;
            }
            // TRƯỜNG HỢP B: Chuỗi vẫn còn giữ current > 0 nhưng lastDate bị cách xa ngày nghỉ
            else if (cur > 0) {
                if (streak.lastDate !== targetDate) {
                    streak.lastDate = targetDate;
                    groupUpdatedCount++;
                    isModified = true;
                }
            }

            if (isModified) {
                totalUpdatedUsers++;
            }
        }

        if (groupUpdatedCount > 0 || groupRestoredCount > 0) {
            totalGroupsProcessed++;
            console.log(`✅ Nhóm ${threadID}:`);
            console.log(`   - Đã khôi phục từ 0 ngày: ${groupRestoredCount} bạn.`);
            console.log(`   - Đã cập nhật mốc ngày nối chuỗi (${targetDate}): ${groupUpdatedCount + groupRestoredCount} bạn.`);
        }
    }

    console.log("\n=============================================================================");
    console.log(`🎉 TỔNG KẾT XỬ LÝ:`);
    console.log(`   - Số nhóm đã cập nhật: ${totalGroupsProcessed} nhóm.`);
    console.log(`   - Tổng số thành viên được nối / khôi phục chuỗi: ${totalUpdatedUsers} người.`);
    console.log(`   - Mốc ngày nhận diện: ${targetDate} (Khi thành viên chat hôm nay ${todayKey}, bot sẽ tự động nối tiếp chuỗi!).`);
    console.log("=============================================================================");

    if (!isDryRun && totalUpdatedUsers > 0) {
        const backupPath = backupStats(stats);
        console.log(`💾 Đã tạo bản sao lưu an toàn tại: ${backupPath}`);
        fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
        console.log(`✅ Đã lưu cập nhật thành công vào file message_stats.json!`);

        // Dọn dẹp danh sách lostUsers trong checktt_daily_top_state.json để báo cáo 6h sáng không bị gắn mác mất chuỗi
        try {
            if (fs.existsSync(DAILY_TOP_STATE_PATH)) {
                const dailyState = JSON.parse(fs.readFileSync(DAILY_TOP_STATE_PATH, "utf8"));
                let cleanedState = false;
                for (const threadID of targetList) {
                    if (dailyState[threadID + "_lostUsers"]) {
                        delete dailyState[threadID + "_lostUsers"];
                        cleanedState = true;
                    }
                }
                if (cleanedState) {
                    fs.writeFileSync(DAILY_TOP_STATE_PATH, JSON.stringify(dailyState, null, 2));
                    console.log(`🧹 Đã dọn dẹp danh sách cảnh báo mất chuỗi cho báo cáo Top 6h sáng.`);
                }
            }
        } catch (e) {
            console.error("⚠️ Lỗi dọn dẹp daily_top_state:", e.message);
        }
    } else if (isDryRun) {
        console.log(`ℹ️ Đã hoàn thành mô phỏng (DRY-RUN). Chạy lại không kèm '--dry-run' để áp dụng thực tế.`);
    } else {
        console.log(`ℹ️ Không có tài khoản nào cần cập nhật.`);
    }
}

main().catch((err) => {
    console.error("❌ Lỗi không xác định trong quá trình thực thi:", err);
    process.exit(1);
});
