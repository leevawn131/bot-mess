/**
 * Parses money strings containing multipliers such as k/K (thousands) and tr/TR/m/M (millions).
 * Handles decimal separators and thousand separators gracefully.
 * E.g., "50k" -> 50000, "2.5tr" -> 2500000, "2,5m" -> 2500000, "50.000k" -> 50000000, "1.500.000" -> 1500000
 * 
 * @param {string|number} input 
 * @returns {number} The parsed integer or NaN if invalid
 */
function parseMoneyAmount(input) {
  if (input === null || input === undefined) return NaN;
  if (typeof input === "number") return Math.round(input);
  
  let s = String(input).trim().toLowerCase();
  if (!s) return NaN;

  // Check for k, tr, m suffix
  const suffixMatch = s.match(/^([\d.,\s]+)(k|tr|m)$/);
  if (suffixMatch) {
    let numStr = suffixMatch[1].replace(/\s/g, ""); // remove spaces
    const suffix = suffixMatch[2];

    // Standardize commas to dots for parsing decimals
    numStr = numStr.replace(/,/g, ".");

    // If there is exactly one dot and it is followed by 3 digits (e.g. "50.000"), it's a thousand separator
    // If there are multiple dots, they are all thousand separators
    let dotsCount = (numStr.match(/\./g) || []).length;
    if (dotsCount > 1) {
      numStr = numStr.replace(/\./g, "");
    } else if (dotsCount === 1) {
      const parts = numStr.split(".");
      if (parts[1].length === 3) {
        numStr = numStr.replace(/\./g, "");
      }
    }

    let val = parseFloat(numStr);
    if (isNaN(val)) return NaN;

    if (suffix === "k") {
      val *= 1000;
    } else if (suffix === "tr" || suffix === "m") {
      val *= 1000000;
    }
    return Math.round(val);
  }

  // Regular number (no suffix)
  let cleanStr = s.replace(/\s/g, "");
  cleanStr = cleanStr.replace(/,/g, ".");
  
  let dotsCount = (cleanStr.match(/\./g) || []).length;
  if (dotsCount > 1) {
    cleanStr = cleanStr.replace(/\./g, "");
  } else if (dotsCount === 1) {
    const parts = cleanStr.split(".");
    if (parts[1].length === 3) {
      cleanStr = cleanStr.replace(/\./g, "");
    }
  }

  let val = parseFloat(cleanStr);
  return isNaN(val) ? NaN : Math.round(val);
}

module.exports = {
  parseMoneyAmount
};
