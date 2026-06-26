const { execute } = require("./database");

const rentalCache = new Map(); // thread_id -> { expireDate: Date | null, lastChecked: number }

async function checkRentalStatus(threadID) {
  if (!threadID) return false;
  const now = Date.now();
  const cached = rentalCache.get(String(threadID));
  
  if (cached) {
    const isCacheFresh = now - cached.lastChecked < 10000; // 10s cooldown for DB checks
    const hasActiveRent = cached.expireDate && cached.expireDate.getTime() > now;
    if (hasActiveRent || (isCacheFresh && !cached.expireDate)) {
      return !!cached.expireDate;
    }
  }

  try {
    const result = await execute(
      "SELECT expire_date, is_admin_rental FROM rented_groups WHERE thread_id = ? AND expire_date > CURRENT_TIMESTAMP",
      [String(threadID)]
    );

    if (result && result.length > 0) {
      const expireDate = new Date(result[0].expire_date);
      rentalCache.set(String(threadID), {
        expireDate,
        lastChecked: now,
        isAdminRental: !!result[0].is_admin_rental
      });
      return true;
    } else {
      rentalCache.set(String(threadID), {
        expireDate: null,
        lastChecked: now,
        isAdminRental: false
      });
      return false;
    }
  } catch (error) {
    console.error(`[Rental] Error checking rental status for thread ${threadID}:`, error);
    return cached ? !!cached.expireDate : false;
  }
}

async function checkIsAdminRental(threadID) {
  if (!threadID) return false;
  const isRented = await checkRentalStatus(threadID);
  if (!isRented) return false;
  const cached = rentalCache.get(String(threadID));
  return cached ? !!cached.isAdminRental : false;
}

function clearRentalCache(threadID) {
  if (threadID) {
    rentalCache.delete(String(threadID));
  } else {
    rentalCache.clear();
  }
}

module.exports = {
  checkRentalStatus,
  checkIsAdminRental,
  clearRentalCache
};
