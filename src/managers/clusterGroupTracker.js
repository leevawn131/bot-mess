const { execute } = require('../../modules/utils/database');
const { ensureAccountClusterSchema } = require('../../modules/utils/accountSchema');
const { ensureRentedGroupsSchema } = require('../../modules/utils/rentalSchema');
const accountProfilesManager = require('./accountProfilesManager');

class ClusterGroupTracker {
  /**
   * Cân bằng và gán cố định các Nhóm Thuê cho từng Cụm Profile
   * Quy tắc:
   * - Cụm 1 (Profiles: Default + Profile 1) -> Gánh Nhóm 1 đến 5.
   * - Cụm 2 (Profiles: Profile 2 + Profile 3) -> Gánh Nhóm 6 đến 10.
   * - Mỗi cụm phải có tối thiểu 1 nhóm thuê gói adminbot (rải đều lưu lượng).
   */
  async syncAndBalanceClusterGroups() {
    await ensureAccountClusterSchema();
    await ensureRentedGroupsSchema();

    // 1. Dọn dẹp (Cleanup) Khóa cứng: Xóa các nhóm đã hết hạn > 1 ngày, hoặc bị ngưng, hoặc nhóm trải nghiệm hết 1 giờ.
    await execute(`
      DELETE FROM group_profile_bindings 
      WHERE thread_id NOT IN ('1523319575522034', '844251878447942')
        AND (
          -- Nhóm thuê hết hạn quá 1 ngày
          thread_id IN (SELECT thread_id FROM rented_groups WHERE expire_date < datetime('now', '-1 day', 'localtime'))
          OR 
          -- Nhóm bị tạm ngưng
          thread_id IN (SELECT thread_id FROM rented_groups WHERE is_stopped = 1)
        )
    `).catch((err) => console.log("Lỗi dọn dẹp khóa cứng cụm:", err));

    let config = accountProfilesManager.loadConfig();
    let clusters = config && config.clusters ? config.clusters : [
      { cluster_id: 1, name: "Cụm 1", profiles: ["Default", "Profile 1"] }
    ];
    let numClusters = clusters.length;

    // 2. Lấy toàn bộ nhóm thuê cần gánh (còn hạn hoặc mới hết hạn < 1 ngày, và không bị ngưng)
    const rentedGroups = await execute(
      `SELECT * FROM rented_groups WHERE expire_date >= datetime('now', '-1 day', 'localtime') AND is_stopped = 0 AND thread_id NOT IN ('1523319575522034', '844251878447942') ORDER BY rented_at ASC`
    );

    if (!rentedGroups || rentedGroups.length === 0) {
      console.log('📭 Chưa có nhóm thuê bot active nào trong hệ thống.');
      return;
    }

    // Tự động mở rộng Cụm nếu lượng nhóm vượt quá năng lực (5 nhóm / cụm)
    const totalSlotsNeeded = Math.ceil(rentedGroups.length / 5);
    if (rentedGroups.length > numClusters * 5) {
      console.warn(`[⚠️] Có ${rentedGroups.length} nhóm thuê nhưng hiện chỉ có ${numClusters} cụm acc (${numClusters * 5} slot). Tự động mở rộng lên ${totalSlotsNeeded} Cụm...`);
      accountProfilesManager.ensureEnoughClusters(totalSlotsNeeded);
      config = accountProfilesManager.loadConfig();
      clusters = config && config.clusters ? config.clusters : clusters;
      numClusters = clusters.length;
    }

    // 3. Đọc các khóa cứng (bindings) ĐANG TỒN TẠI
    const assignments = new Map();
    const clusterSlotCount = new Map();
    
    for (const c of clusters) {
      assignments.set(c.cluster_id, []);
      clusterSlotCount.set(c.cluster_id, 0);
    }

    const existingBindingsRows = await execute(`SELECT thread_id, cluster_id, is_admin_rental FROM group_profile_bindings`);
    const existingBindingsMap = new Map();
    
    if (existingBindingsRows) {
      for (const row of existingBindingsRows) {
        existingBindingsMap.set(String(row.thread_id), row);
        
        // Cập nhật số lượng nhóm đã được gán vào Cụm này
        if (assignments.has(row.cluster_id)) {
          assignments.get(row.cluster_id).push(row);
          clusterSlotCount.set(row.cluster_id, clusterSlotCount.get(row.cluster_id) + 1);
        }
      }
    }

    // 4. Phân bổ các nhóm CHƯA ĐƯỢC GÁN vào các Cụm còn trống (dưới 5 nhóm)
    for (const group of rentedGroups) {
      const tId = String(group.thread_id);
      
      // Nếu nhóm đã được khóa cứng vào một Cụm rồi, thì GIỮ NGUYÊN, KHÔNG LÀM GÌ CẢ
      if (existingBindingsMap.has(tId)) {
        continue;
      }

      // Nếu nhóm chưa được khóa cứng, tìm Cụm đầu tiên còn trống (slot < 5)
      let assignedClusterId = null;
      for (const c of clusters) {
        const count = clusterSlotCount.get(c.cluster_id) || 0;
        if (count < 5) {
          assignedClusterId = c.cluster_id;
          break;
        }
      }

      // Gán vào Cụm tìm được (hoặc cụm cuối cùng nếu rủi ro đầy hết)
      if (!assignedClusterId) {
        assignedClusterId = clusters[clusters.length - 1].cluster_id;
      }

      const item = { thread_id: tId, cluster_id: assignedClusterId, is_admin_rental: group.is_admin_rental || 0 };
      if (!assignments.has(assignedClusterId)) assignments.set(assignedClusterId, []);
      assignments.get(assignedClusterId).push(item);
      clusterSlotCount.set(assignedClusterId, (clusterSlotCount.get(assignedClusterId) || 0) + 1);
      existingBindingsMap.set(tId, item);
    }

    // 5. Ghi nhận/cập nhật phân công cố định vào cơ sở dữ liệu SQLite
    for (const c of clusters) {
      const groupList = assignments.get(c.cluster_id) || [];
      const profilesJson = JSON.stringify(c.profiles || []);

      for (const item of groupList) {
        await execute(
          `INSERT INTO group_profile_bindings (thread_id, cluster_id, is_admin_rental, assigned_profiles)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(thread_id) DO UPDATE SET 
             cluster_id = EXCLUDED.cluster_id, 
             is_admin_rental = EXCLUDED.is_admin_rental,
             assigned_profiles = EXCLUDED.assigned_profiles`,
          [item.thread_id, c.cluster_id, item.is_admin_rental, profilesJson]
        );
      }
    }

    console.log(`✅ Đã đồng bộ khóa cứng Profile theo Nhóm cho ${numClusters} Cụm.`);
  }

  /**
   * Lấy thông tin các Profile được phân công cho Nhóm (thread_id)
   */
  async getAssignedProfilesForGroup(threadId) {
    await ensureAccountClusterSchema();
    const rows = await execute(
      `SELECT cluster_id, assigned_profiles FROM group_profile_bindings WHERE thread_id = ?`,
      [String(threadId)]
    );
    if (rows && rows.length > 0) {
      try {
        const profiles = JSON.parse(rows[0].assigned_profiles);
        return { cluster_id: rows[0].cluster_id, profiles };
      } catch (e) {}
    }
    return null;
  }

  /**
   * Tự đếm nhóm đang ở và tự out KHỎI các nhóm KHÔNG thuộc phân công của Cụm hiện tại
   */
  async checkAndLeaveExcessGroups(api, accountUid, profileName = null) {
    try {
      await ensureAccountClusterSchema();

      if (!api || typeof api.getThreadList !== 'function') return;

      let activeProfile = profileName;
      if (!activeProfile && accountUid) {
        const info = await accountProfilesManager.getProfileInfoByUid(accountUid);
        if (info) activeProfile = info.profileName;
      }
      if (!activeProfile) {
        activeProfile = accountProfilesManager.getActiveProfileName();
      }

      const config = accountProfilesManager.loadConfig();

      // Xác định activeProfile thuộc Cụm mấy
      let activeClusterId = 1;
      let activeClusterProfiles = ["Default", "Profile 1"];

      for (const c of config.clusters || []) {
        if (c.profiles && c.profiles.includes(activeProfile)) {
          activeClusterId = c.cluster_id;
          activeClusterProfiles = c.profiles;
          break;
        }
      }

      console.log(`[🔎] Đang kiểm tra danh sách nhóm của Profile "${activeProfile}" (Cụm ${activeClusterId})...`);

      // Ghi nhận liên kết UID với Active Profile
      await accountProfilesManager.registerActiveAccount(activeProfile, accountUid);

      // Lấy danh sách nhóm được phân công cố định cho Cụm này
      const assignedRows = await execute(
        `SELECT thread_id FROM group_profile_bindings WHERE cluster_id = ?`,
        [activeClusterId]
      );
      const allowedThreadIds = new Set((assignedRows || []).map(r => String(r.thread_id)));

      // Lấy danh sách nhóm account hiện đang tham gia trên Facebook
      const threadList = await new Promise((resolve) => {
        api.getThreadList(100, null, ["INBOX"], (err, list) => {
          if (err || !list) return resolve([]);
          const groupThreads = list.filter(t => t.isGroup && t.threadID);
          resolve(groupThreads);
        });
      });

      console.log(`[📊] Profile "${activeProfile}" (Cụm ${activeClusterId}) hiện có mặt trong ${threadList.length} nhóm.`);

      // Lưu trạng thái nhóm hiện tại vào SQLite
      await execute(`DELETE FROM account_joined_groups WHERE profile_name = ?`, [activeProfile]);
      for (const t of threadList) {
        await execute(
          `INSERT OR REPLACE INTO account_joined_groups (profile_name, uid, thread_id, thread_name, is_admin_rental)
           VALUES (?, ?, ?, ?, ?)`,
          [activeProfile, String(accountUid), String(t.threadID), t.name || "Group", allowedThreadIds.has(String(t.threadID)) ? 1 : 0]
        );
      }

      // Lọc các nhóm KHÔNG thuộc phân công của Cụm này (nhóm mới)
      // Loại trừ luôn 2 box test để chúng không bị tính
      const actualThreadList = threadList.filter(t => String(t.threadID) !== '1523319575522034' && String(t.threadID) !== '844251878447942');
      const invalidGroups = actualThreadList.filter(t => !allowedThreadIds.has(String(t.threadID)));

      // Xử lý các nhóm mới (được add lúc bot offline)
      const allBindingsRows = await execute(`SELECT thread_id FROM group_profile_bindings`);
      const allBindingsSet = new Set((allBindingsRows || []).map(r => String(r.thread_id)));

      for (const g of invalidGroups) {
        if (!allBindingsSet.has(String(g.threadID))) {
          // Nhóm hoàn toàn mới! Ghi danh vào Sổ đỏ (is_admin_rental = 0)
          console.log(`[+] Đã cấp quyền dùng thử cho nhóm mới (add lúc offline): ${g.threadID}`);
          const profilesJson = JSON.stringify(activeClusterProfiles || []);
          await execute(`INSERT OR IGNORE INTO group_profile_bindings (thread_id, cluster_id, is_admin_rental, assigned_profiles) VALUES (?, ?, 0, ?)`, [String(g.threadID), activeClusterId, profilesJson]);
          allowedThreadIds.add(String(g.threadID)); // Giờ nó đã hợp lệ cho cụm này!
          
          // LƯU Ý: Đã bỏ cơ chế tự động out sau 1 tiếng. Nhóm sẽ nằm ở đây vĩnh viễn.
        }
      }

      console.log(`[✅] Profile "${activeProfile}" đã đồng bộ danh sách nhóm (${threadList.length} nhóm).`);
    } catch (e) {
      console.error(`❌ Lỗi khi kiểm tra và tự out nhóm nhầm:`, e.message);
    }
  }
}

module.exports = new ClusterGroupTracker();
