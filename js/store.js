const KEY = "hjemme-v2";
const LEGACY_KEY = "hjemme-v1";
const COLORS = ["#c15f3e", "#3f6f55", "#4d6d8b", "#b08968", "#7c3f6b", "#2a6f6f"];
const WEEKDAYS = ["ma", "ti", "on", "to", "fr", "lø", "sø"];

function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function memberColor(index) {
  return COLORS[index % COLORS.length];
}

function todayIso() {
  const d = new Date();
  return isoDate(d);
}

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIsoDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(iso, days) {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

function demoState() {
  const lars = uid();
  const mia = uid();
  const noah = uid();
  const now = Date.now();
  const today = todayIso();
  return {
    setupDone: true,
    householdId: null,
    householdName: "Familien",
    currentMemberId: lars,
    members: [
      { id: lars, name: "Lars", color: COLORS[0] },
      { id: mia, name: "Mia", color: COLORS[1] },
      { id: noah, name: "Noah", color: COLORS[2] }
    ],
    suggestions: ["Mælk", "Rugbrød", "Kaffe", "Smør", "Æg", "Bananer", "Opvasketabs", "Toiletpapir"],
    shopping: [
      { id: uid(), text: "Mælk", done: false, assigneeId: lars, createdAt: now },
      { id: uid(), text: "Rugbrød", done: false, assigneeId: null, createdAt: now },
      { id: uid(), text: "Bananer", done: false, assigneeId: noah, createdAt: now },
      { id: uid(), text: "Kaffe", done: false, assigneeId: mia, createdAt: now },
      { id: uid(), text: "Opvasketabs", done: true, assigneeId: null, createdAt: now }
    ],
    listPhotos: [],
    chores: [
      { id: uid(), text: "Opvask", assigneeId: lars, cadence: "daily", doneOn: null },
      { id: uid(), text: "Tøm skrald", assigneeId: noah, cadence: "weekly", doneOn: null },
      { id: uid(), text: "Støvsug stuen", assigneeId: mia, cadence: "weekly", doneOn: today },
      { id: uid(), text: "Rengør køleskab", assigneeId: lars, cadence: "monthly", doneOn: null }
    ],
    events: [
      { id: uid(), title: "Hent Noah efter fodbold", date: today, time: "16:30", assigneeIds: [lars], kind: "event" },
      { id: uid(), title: "Pakke i Netto", date: today, time: "18:00", assigneeIds: [mia], kind: "event" },
      { id: uid(), title: "Forældremøde", date: addDays(today, 1), time: "19:00", assigneeIds: [lars, mia], kind: "event" },
      { id: uid(), title: "Svømning", date: addDays(today, 3), time: "15:00", assigneeIds: [noah, mia], kind: "event" },
      { id: uid(), title: "Noahs fødselsdag", date: addDays(today, 42), time: null, assigneeIds: [noah], kind: "marker", yearly: true },
      { id: uid(), title: "Bryllupsdag", date: addDays(today, 88), time: null, assigneeIds: [lars, mia], kind: "marker", yearly: true },
      { id: uid(), title: "Mias fødselsdag", date: addDays(today, 150), time: null, assigneeIds: [mia], kind: "marker", yearly: true }
    ],
    notes: [
      { id: uid(), title: "Kode til cykelskur", body: "1234. Hænger hos naboen, hvis vi glemmer den.", updatedAt: now }
    ]
  };
}

function emptyState() {
  return {
    setupDone: false,
    householdId: null,
    householdName: "Hjemme",
    currentMemberId: null,
    members: [],
    suggestions: [],
    shopping: [],
    listPhotos: [],
    chores: [],
    events: [],
    notes: []
  };
}

function migrate(raw) {
  const next = { ...emptyState(), ...raw };
  if (!Array.isArray(next.suggestions)) next.suggestions = [];
  if (!Array.isArray(next.listPhotos)) next.listPhotos = [];
  if (!Array.isArray(next.events)) next.events = [];
  if (!Array.isArray(next.notes)) next.notes = [];
  if (Array.isArray(raw.pickups) && !raw.events?.length) {
    next.events = raw.pickups
      .filter((p) => p.status !== "done")
      .map((p) => {
        const when = String(p.when || "");
        return {
          id: p.id || uid(),
          title: p.text || "Aftale",
          date: when.slice(0, 10) || todayIso(),
          time: when.length >= 16 ? when.slice(11, 16) : null,
          assigneeIds: p.assigneeId ? [p.assigneeId] : []
        };
      });
  }
  delete next.expenses;
  delete next.pickups;
  delete next.writeId;
  delete next.updatedAt;
  if (!next.householdId) next.householdId = null;
  next.events = next.events.map((event) => {
    const ids = Array.isArray(event.assigneeIds)
      ? event.assigneeIds
      : event.assigneeId
        ? [event.assigneeId]
        : [];
    const copy = { ...event, assigneeIds: ids, kind: event.kind || "event" };
    delete copy.assigneeId;
    if (copy.kind === "marker" && copy.yearly == null) copy.yearly = true;
    return copy;
  });
  return next;
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY);
    if (!raw) return emptyState();
    return migrate(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

function saveState(state) {
  const copy = { ...state };
  delete copy.expenses;
  delete copy.pickups;
  localStorage.setItem(KEY, JSON.stringify(copy));
  localStorage.removeItem(LEGACY_KEY);
}

function resetStorage() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(LEGACY_KEY);
}

function choreIsDone(chore) {
  if (!chore.doneOn) return false;
  if (chore.cadence === "once") return true;
  if (chore.cadence === "daily") return chore.doneOn === todayIso();
  if (chore.cadence === "weekly") return isSameWeek(chore.doneOn, todayIso());
  if (chore.cadence === "monthly") return chore.doneOn.slice(0, 7) === todayIso().slice(0, 7);
  return false;
}

function isSameWeek(isoA, isoB) {
  return weekKey(parseIsoDate(isoA)) === weekKey(parseIsoDate(isoB));
}

function weekKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-${week}`;
}

function isoWeekNumber(iso) {
  const d = parseIsoDate(iso);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

function isYearlyMarker(event) {
  return event.kind === "marker" && event.yearly !== false;
}

function eventOccursOn(event, iso) {
  if (isYearlyMarker(event)) return event.date.slice(5) === iso.slice(5);
  return event.date === iso;
}

function nextOccurrence(event, fromIso = todayIso()) {
  if (!isYearlyMarker(event)) return event.date;
  const monthDay = event.date.slice(5);
  const year = Number(fromIso.slice(0, 4));
  let next = `${year}-${monthDay}`;
  if (next < fromIso) next = `${year + 1}-${monthDay}`;
  return next;
}

function upcomingMarkers(state, afterDays = 14, limit = 4) {
  const today = todayIso();
  const soon = addDays(today, afterDays);
  return state.events
    .filter((e) => e.kind === "marker")
    .map((event) => ({ event, when: nextOccurrence(event, today) }))
    .filter((item) => item.when >= soon)
    .sort((a, b) => a.when.localeCompare(b.when))
    .slice(0, limit);
}

function eventsOn(state, iso) {
  return state.events
    .filter((e) => eventOccursOn(e, iso))
    .sort((a, b) => {
      const markerA = a.kind === "marker" ? 0 : 1;
      const markerB = b.kind === "marker" ? 0 : 1;
      if (markerA !== markerB) return markerA - markerB;
      return String(a.time || "00:00").localeCompare(String(b.time || "00:00"));
    });
}

function eventDatesInMonth(state, year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  return new Set(state.events.filter((e) => e.date.startsWith(prefix)).map((e) => e.date));
}

function monthCells(year, month) {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i += 1) {
    const d = new Date(year, month, 1 - (startOffset - i));
    cells.push({ iso: isoDate(d), mute: true });
  }
  for (let day = 1; day <= days; day += 1) {
    cells.push({ iso: isoDate(new Date(year, month, day)), mute: false });
  }
  while (cells.length % 7 !== 0) {
    const last = parseIsoDate(cells[cells.length - 1].iso);
    last.setDate(last.getDate() + 1);
    cells.push({ iso: isoDate(last), mute: true });
  }
  return cells;
}

function formatDayHeading(iso) {
  const date = parseIsoDate(iso);
  const today = todayIso();
  const tomorrow = addDays(today, 1);
  const weekday = new Intl.DateTimeFormat("da-DK", { weekday: "long" }).format(date);
  const rest = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "long" }).format(date);
  if (iso === today) return `I dag · ${rest}`;
  if (iso === tomorrow) return `I morgen · ${rest}`;
  return `${weekday} · ${rest}`;
}

function formatEventWhen(event) {
  if (!event.time) return "Hele dagen";
  if (event.date === todayIso()) return `I dag ${event.time}`;
  if (event.date === addDays(todayIso(), 1)) return `I morgen ${event.time}`;
  const day = new Intl.DateTimeFormat("da-DK", {
    weekday: "short",
    day: "numeric",
    month: "short"
  }).format(parseIsoDate(event.date));
  return `${day} ${event.time}`;
}

function mondayOf(iso) {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDate(d);
}

function weekDays(iso) {
  const start = mondayOf(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function formatWeekTitle(iso) {
  const days = weekDays(iso);
  const a = parseIsoDate(days[0]);
  const b = parseIsoDate(days[6]);
  const start = new Intl.DateTimeFormat("da-DK", {
    day: "numeric",
    month: a.getMonth() === b.getMonth() ? undefined : "short"
  }).format(a);
  const end = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short" }).format(b);
  return `${start}–${end}`;
}

function formatWeekDayName(iso) {
  return new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "short" }).format(
    parseIsoDate(iso)
  );
}

function formatMonthTitle(year, month) {
  const label = new Intl.DateTimeFormat("da-DK", { month: "long", year: "numeric" }).format(
    new Date(year, month, 1)
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function weekdayLabel() {
  return new Intl.DateTimeFormat("da-DK", { weekday: "long" }).format(new Date());
}

function formatMarkerDate(iso) {
  return new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "long" }).format(parseIsoDate(iso));
}

function daysUntil(iso) {
  const a = parseIsoDate(todayIso());
  const b = parseIsoDate(iso);
  return Math.round((b - a) / 86400000);
}

function formatAhead(iso) {
  const n = daysUntil(iso);
  if (n <= 0) return "i dag";
  if (n === 1) return "i morgen";
  if (n < 21) return `om ${n} dage`;
  const weeks = Math.round(n / 7);
  if (n < 60) return `om ${weeks} uger`;
  const months = Math.round(n / 30);
  return `om ${months} ${months === 1 ? "måned" : "måneder"}`;
}

function nextEvents(state, fromIso, limit = 3) {
  return state.events
    .filter((e) => e.kind !== "marker")
    .filter((e) => e.date > fromIso || e.date === fromIso)
    .sort((a, b) => `${a.date}${a.time || ""}`.localeCompare(`${b.date}${b.time || ""}`))
    .slice(0, limit);
}
