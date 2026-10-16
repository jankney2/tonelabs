// Office hours: Mon-Fri 8:00-18:00 America/Chicago (handles daylight saving).
export function isBusinessHours(date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', hourCycle: 'h23' })
      .formatToParts(date).map((x) => [x.type, x.value]),
  );
  return !['Sat', 'Sun'].includes(p.weekday) && Number(p.hour) >= 8 && Number(p.hour) < 18;
}

// Twice-daily slots for slow-changing reference data (Ringsnitch trackers and users):
// the first cron tick (minute < 30) of the 8:00 and 13:00 hours in Chicago, every day, daylight saving included.
export function isReferenceSyncSlot(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(date));
  return date.getUTCMinutes() < 30 && (hour === 8 || hour === 13);
}
