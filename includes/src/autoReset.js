const moment = require('moment-timezone');

module.exports = function () {
  setInterval(async () => {
    const thoiGianHienTai = moment.tz("Asia/Ho_Chi_Minh");

    const timeRestart = [
      { gio: 2, phut: 30, giay: 0 },
      { gio: 4, phut: 30, giay: 0 },
      { gio: 7, phut: 30, giay: 0 },
      { gio: 10, phut: 30, giay: 0 },
      { gio: 13, phut: 30, giay: 0 },
      { gio: 15, phut: 30, giay: 0 },
      { gio: 19, phut: 0, giay: 0 },
      { gio: 20, phut: 30, giay: 0 },
      { gio: 22, phut: 30, giay: 0 },
      { gio: 23, phut: 40, giay: 0 }
    ];

    for (const thoiDiem of timeRestart) {
      if (
        thoiGianHienTai.hour() === thoiDiem.gio &&
        thoiGianHienTai.minute() === thoiDiem.phut &&
        thoiGianHienTai.second() === thoiDiem.giay
      ) {
        console.log(`[AUTO-RESET] Đã đến thời điểm reset: ${thoiDiem.gio}:${thoiDiem.phut}:${thoiDiem.giay}. Đang khởi động lại bot...`);
        process.exit(1);
      }
    }
  }, 1000);
};