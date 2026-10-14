'use strict';

// Official holiday breaks, including substituted days off:
// https://english.beijing.gov.cn/workinginbeijing/laborrights/publicholidays/
const HOLIDAYS = {
  2026: [
    ['01-01', '01-03'], ['02-15', '02-23'], ['04-04', '04-06'],
    ['05-01', '05-05'], ['06-19', '06-21'], ['09-25', '09-27'],
    ['10-01', '10-07'],
  ],
};

function getDeepseekRate(now = new Date()) {
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  // Weekends remain off-peak even on Chinese make-up working days.
  if (day === 0 || day === 6 || !((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10))) {
    return 'off-peak';
  }
  // During peak windows the UTC and China calendar dates are identical.
  const holidays = HOLIDAYS[now.getUTCFullYear()];
  if (!holidays) return 'unknown';
  const date = now.toISOString().slice(5, 10);
  return holidays.some(([start, end]) => date >= start && date <= end) ? 'off-peak' : 'peak';
}

module.exports = { getDeepseekRate };
