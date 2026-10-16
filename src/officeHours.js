// Office hours: Mon-Fri 8:00-18:00 America/Chicago (handles daylight saving).
export function isBusinessHours(date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', hourCycle: 'h23' })
      .formatToParts(date).map((x) => [x.type, x.value]),
  );
  return !['Sat', 'Sun'].includes(p.weekday) && Number(p.hour) >= 8 && Number(p.hour) < 18;
}
