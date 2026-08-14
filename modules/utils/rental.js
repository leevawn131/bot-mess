const { execute } = require("./database");

const rentalCache = new Map(); // thread_id -> { expireDate: Date | null, isStopped: boolean, lastChecked: number, isAdminRental: boolean }

function parseDbDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === "number") return new Date(val);
  let s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
    s = s.replace(" ", "T") + "Z";
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

async function checkRentalStatus(threadID) {
  if (!threadID) return false;
  const now = Date.now();
  const cached = rentalCache.get(String(threadID));
  
  if (cached) {
    const isCacheFresh = now - cached.lastChecked < 10000; // 10s cooldown for DB checks
    if (cached.isStopped) return false; // Stopped/paused group -> Bot is disabled!
    const hasActiveRent = cached.expireDate && cached.expireDate.getTime() > now;
    if (hasActiveRent || (isCacheFresh && !cached.expireDate)) {
      return !!cached.expireDate;
    }
  }

  try {
    let result;
    try {
      result = await execute(
        "SELECT expire_date, is_admin_rental, is_stopped, paused_remaining_ms FROM rented_groups WHERE thread_id = ?",
        [String(threadID)]
      );
    } catch (dbErr) {
      // Fallback cho trường hợp bảng cũ chưa được migrate cột is_stopped / paused_remaining_ms
      result = await execute(
        "SELECT expire_date, is_admin_rental FROM rented_groups WHERE thread_id = ?",
        [String(threadID)]
      );
    }

    if (result && result.length > 0) {
      const expireDate = parseDbDate(result[0].expire_date);
      const isStopped = !!(result[0].is_stopped || 0);
      const hasActiveRent = !isStopped && !!(expireDate && expireDate.getTime() > now);

      rentalCache.set(String(threadID), {
        expireDate,
        isStopped,
        lastChecked: now,
        isAdminRental: !!result[0].is_admin_rental
      });

      return hasActiveRent;
    } else {
      rentalCache.set(String(threadID), {
        expireDate: null,
        isStopped: false,
        lastChecked: now,
        isAdminRental: false
      });
      return false;
    }
  } catch (error) {
    console.error(`[Rental] Error checking rental status for thread ${threadID}:`, error);
    return cached ? (!cached.isStopped && !!cached.expireDate) : false;
  }
}

async function isRentalStopped(threadID) {
  if (!threadID) return false;
  await checkRentalStatus(threadID);
  const cached = rentalCache.get(String(threadID));
  return cached ? !!cached.isStopped : false;
}

async function checkIsAdminRental(threadID) {
  if (!threadID) return false;
  const isRented = await checkRentalStatus(threadID);
  if (!isRented) return false;
  const cached = rentalCache.get(String(threadID));
  return cached ? !!cached.isAdminRental : false;
}

async function getRenterID(threadID) {
  if (!threadID) return null;
  try {
    const result = await execute(
      "SELECT renter_id FROM rented_groups WHERE thread_id = ?",
      [String(threadID)]
    );
    return result && result[0] ? String(result[0].renter_id || "") : null;
  } catch (error) {
    console.error(`[Rental] Error getting renter_id for thread ${threadID}:`, error);
    return null;
  }
}

function clearRentalCache(threadID) {
  if (threadID) {
    rentalCache.delete(String(threadID));
  } else {
    rentalCache.clear();
  }
}

async function getRentalExpiry(threadID) {
  if (!threadID) return null;
  await checkRentalStatus(threadID);
  const cached = rentalCache.get(String(threadID));
  if (cached && cached.isStopped) return null;
  if (cached && cached.expireDate && !isNaN(cached.expireDate.getTime())) {
    return cached.expireDate;
  }
  try {
    const result = await execute(
      "SELECT expire_date, is_stopped FROM rented_groups WHERE thread_id = ?",
      [String(threadID)]
    );
    if (result && result.length > 0) {
      if (result[0].is_stopped) return null;
      return parseDbDate(result[0].expire_date);
    }
  } catch (e) {}
  return null;
}

module.exports = {
  checkRentalStatus,
  isRentalStopped,
  checkIsAdminRental,
  getRenterID,
  clearRentalCache,
  getRentalExpiry
};
