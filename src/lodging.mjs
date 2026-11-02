// Date and holiday logic shared by the lodging sites, in the browser and at the
// edge. Dates are YYYY-MM-DD strings with UTC math.

const DAY = 86400000;
export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const toD = (s) => new Date(s + 'T00:00:00Z');
const toS = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => toS(new Date(toD(s).getTime() + n * DAY));
export const nightsBetween = (a, b) => Math.round((toD(b) - toD(a)) / DAY);
export const addMonths = (m, n) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1));
  return toS(d).slice(0, 7);
};
export const monthsSpanning = (a, b) => {
  const out = [];
  for (let m = a.slice(0, 7); m <= b.slice(0, 7); m = addMonths(m, 1)) out.push(m);
  return out;
};
// "Nov 6–8", or "Nov 27 – Dec 1" across a month boundary.
export const fmtSpan = (a, b) => {
  const x = toD(a), y = toD(b);
  return x.getUTCMonth() === y.getUTCMonth()
    ? `${MO[x.getUTCMonth()]} ${x.getUTCDate()}–${y.getUTCDate()}`
    : `${MO[x.getUTCMonth()]} ${x.getUTCDate()} – ${MO[y.getUTCMonth()]} ${y.getUTCDate()}`;
};

// PriceLabs gives each date a demand level but no holiday name, so the names come
// from the calendar. Nights that count: a Monday holiday is its weekend.
const nthWeekday = (y, m, wd, n) => {
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  return addDays(first, (wd - toD(first).getUTCDay() + 7) % 7 + (n - 1) * 7);
};
// `long` is the three-night stay such a weekend is sold as: Friday to Monday.
const mondayWeekend = (name, monday) => ({
  name,
  nights: [addDays(monday, -2), addDays(monday, -1)],
  long: { a: addDays(monday, -3), d: monday },
});
export const holidays = (y) => [
  { name: 'New Year’s', nights: [`${y}-01-01`, `${y}-12-31`] },
  mondayWeekend('MLK weekend', nthWeekday(y, 1, 1, 3)),
  mondayWeekend('Presidents’ Day weekend', nthWeekday(y, 2, 1, 3)),
  mondayWeekend('Memorial Day weekend', addDays(nthWeekday(y, 6, 1, 1), -7)),   // last Monday of May
  { name: 'Fourth of July', nights: [`${y}-07-03`, `${y}-07-04`] },
  mondayWeekend('Labor Day weekend', nthWeekday(y, 9, 1, 1)),
  { name: 'Thanksgiving', nights: [nthWeekday(y, 11, 4, 4)] },
  { name: 'Christmas', nights: [`${y}-12-24`, `${y}-12-25`] },
];
// The holiday a stay's nights (not its check-out day) include, if any.
export function holidayIn(a, d) {
  const all = holidays(a.slice(0, 4)).concat(holidays(d.slice(0, 4)));
  const hit = all.find((h) => h.nights.some((n) => n >= a && n < d));
  return hit ? hit.name : null;
}
