const webAppUrl = "https://script.google.com/macros/s/AKfycbwdz5SJ3m7fHq_7U6nG8P7yH9TLHCM9fJ8F14SRFIx8pWVsom6P8NOIdhwOY0-MedSN/exec";
const webAppUrlAllCalendars = "https://script.google.com/a/macros/sae.edu.au/s/AKfycbyMHnsDas6I5BgijywmpdufRa6AfTRsCGTkXZ_eC_pXKN9pEh-aVOvw2BAibSmJjU2I_w/exec";

let feeds = [];
let currentDate = new Date();
const version = "v1.0";

// ---------------- Week Types ----------------
const weekTypes = {
  Default: {
    0: null, // Sunday closed
    1: { start: 8, end: 18 }, // Monday
    2: { start: 8, end: 18 }, // Tuesday
    3: { start: 8, end: 18 }, // Wednesday
    4: { start: 8, end: 18 }, // Thursday
    5: { start: 8, end: 18 }, // Friday
    6: null  // Saturday closed
  },
  Trimester: {
    0: null, // Sunday closed
    1: { start: 8, end: 18 }, // Monday
    2: { start: 8, end: 21 }, // Tuesday
    3: { start: 8, end: 21 }, // Wednesday
    4: { start: 8, end: 21 }, // Thursday
    5: { start: 8, end: 18 }, // Friday
    6: { start: 8, end: 18 }  // Saturday
  },
  Closed: {
    0: null,
    1: null,
    2: null,
    3: null,
    4: null,
    5: null,
    6: null
  }
};

// ---------------- Date Ranges for Week Types ----------------
const weekTypeRanges = [
  { type: "Trimester", start: "2025-09-15", end: "2025-12-14" },//25T3
  { type: "Closed", start: "2025-12-25", end: "2026-01-11" },   //Xmas break
  { type: "Trimester", start: "2026-02-02", end: "2026-05-03" } //26T1
];

// ---------------- Single-Day Overrides ----------------
const singleDayOverrides = [
  { date: "2025-08-21", hours: { start: 8, end: 12 } }, // special hours Showcase
  { date: "2026-05-26", hours: null }                   // Australia Day
];

// ---------------- Availability Helper ----------------
function getHoursForDate(date) {
  const isoDate = date.toISOString().split("T")[0];

  // 1️⃣ Check single-day overrides
  const override = singleDayOverrides.find(o => o.date === isoDate);
  if (override) return override.hours;

  // 2️⃣ Check week-type ranges
  for (const range of weekTypeRanges) {
    const startDate = new Date(range.start);
    const endDate = new Date(range.end);
    if (date >= startDate && date <= endDate) {
      const type = weekTypes[range.type];
      return type[date.getDay()] || null;
    }
  }

  // 3️⃣ Fallback to Default week type if nothing matched
  return weekTypes.Default[date.getDay()] || null;
}

function getTimeSlots() {
  const hours = getHoursForDate(currentDate);
  if (!hours) return []; // closed
  const slots = [];
  for (let h = hours.start; h <= hours.end; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    if (h < hours.end) slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
}

function toGMT8(icalTime) {
  const d = icalTime.toJSDate();
  const utcTime = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utcTime + 8 * 60 * 60 * 1000);
}

function findSlotIndex(date, slots) {
  const h = date.getHours();
  const m = date.getMinutes();
  const slotStr = `${String(h).padStart(2, "0")}:${m < 30 ? "00" : "30"}`;
  return slots.indexOf(slotStr);
}

// ---------------- Fetch Feeds ----------------
async function fetchFeedsParallelWithProgress() {
  const progress = document.getElementById("progressBar");
  const progressContainer = document.getElementById("progressContainer");
  progressContainer.style.display = "block";
  progress.style.width = "0%";

  const indexRes = await fetch(webAppUrl);
  if (!indexRes.ok) throw new Error("Failed to fetch feed index");
  const feedIndex = await indexRes.json();

  const totalSteps = feedIndex.length + 1;
  let completed = 1;
  progress.style.width = ((completed / totalSteps) * 100) + "%";

  const feedUrls = feedIndex.map((feed, i) => `${webAppUrl}?feed=${i}`);
  const feedsData = new Array(feedUrls.length);

  const fetchPromises = feedUrls.map((url, i) =>
    fetch(url)
      .then(res => res.ok ? res.json() : Promise.reject(`Failed feed ${i}`))
      .then(data => { feedsData[i] = data; })
      .catch(err => { console.error(err); feedsData[i] = { name: feedIndex[i].name, ics: "" }; })
      .finally(() => {
        completed++;
        progress.style.width = ((completed / totalSteps) * 100) + "%";
      })
  );

  await Promise.all(fetchPromises);
  progressContainer.style.display = "none";
  return feedsData;
}

// ---------------- Calendar UI ----------------
function setHeaderTitle() {
  let header = document.getElementById("calendarHeader");
  if (!header) {
    header = document.createElement("h1");
    header.id = "calendarHeader";
    document.body.prepend(header);

    const versionTag = document.createElement("div");
    versionTag.id = "calendarVersion";
    versionTag.textContent = version;
    document.body.insertBefore(versionTag, header.nextSibling);
  }
  const options = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
  header.textContent = `Studio Availability – ${currentDate.toLocaleDateString("en-GB", options)}`;
}

function addNavButtons() {
  let nav = document.getElementById("calendarNav");
  if (!nav) {
    nav = document.createElement("div");
    nav.id = "calendarNav";
    document.body.prepend(nav);

    const prevBtn = document.createElement("button");
    prevBtn.textContent = "← Previous Day";
    prevBtn.onclick = () => changeDay(-1);
    nav.appendChild(prevBtn);

    const todayBtn = document.createElement("button");
    todayBtn.textContent = "Today";
    todayBtn.onclick = () => { currentDate = new Date(); clearCalendar(); setHeaderTitle(); refreshCalendar(); };
    nav.appendChild(todayBtn);

    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "Refresh";
    refreshBtn.onclick = async () => { clearCalendar(); feeds = await fetchFeedsParallelWithProgress(); refreshCalendar(); };
    nav.appendChild(refreshBtn);

    const nextBtn = document.createElement("button");
    nextBtn.textContent = "Next Day →";
    nextBtn.onclick = () => changeDay(1);
    nav.appendChild(nextBtn);
  }
}

function changeDay(delta) {
  currentDate.setDate(currentDate.getDate() + delta);
  clearCalendar();
  setHeaderTitle();
  refreshCalendar();
}

function clearCalendar() {
  const table = document.getElementById("calendarTable");
  table.innerHTML = `<tr><td class="loading" colspan="${feeds.length + 1}">Loading...</td></tr>`;
}

// ---------------- Build Calendar ----------------
async function buildCalendar() {
  const table = document.getElementById("calendarTable");
  const slots = getTimeSlots();

  if (slots.length === 0) {
    table.innerHTML = `<tr><td colspan="${feeds.length + 1}" class="unavailable">Closed</td></tr>`;
    return;
  }

  const tableData = slots.map(() => feeds.map(() => []));

  for (let i = 0; i < feeds.length; i++) {
    try {
      const jcalData = ICAL.parse(feeds[i].ics);
      const comp = new ICAL.Component(jcalData);
      const events = comp.getAllSubcomponents("vevent").map(e => new ICAL.Event(e));
      events.forEach(ev => {
        const start = toGMT8(ev.startDate);
        const end = toGMT8(ev.endDate);
        if (start.toDateString() !== currentDate.toDateString()) return;
        let index = findSlotIndex(start, slots);
        const endIndex = findSlotIndex(end, slots);
        if (index < 0) index = 0;
        for (let s = index; s <= endIndex && s < slots.length; s++) tableData[s][i].push({ summary: ev.summary, start, end });
      });
    } catch (e) {
      console.error(e);
      for (let row of tableData) row[i] = [{ summary: "Error" }];
    }
  }

  let html = `<tr><th>Time</th>`;
  feeds.forEach(f => html += `<th>${f.name}</th>`);
  html += `</tr>`;

  const rendered = Array.from({ length: feeds.length }, () => 0);

  for (let r = 0; r < slots.length; r++) {
    const [slotHour, slotMinute] = slots[r].split(":").map(Number);
    const slotTime = new Date(currentDate);
    slotTime.setHours(slotHour, slotMinute, 0, 0);

    const timeLabel = slotTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    html += `<tr><td class="timeCell">${timeLabel}</td>`;

    for (let c = 0; c < feeds.length; c++) {
      if (rendered[c] > 0) { rendered[c]--; continue; }

      const cellEvents = tableData[r][c];
      let displayText = "";
      let span = 1;

      for (let k = r + 1; k < slots.length; k++) {
        const nextEvents = tableData[k][c];
        const nextContent = nextEvents.length ? nextEvents[0].summary : "Available";
        if ((cellEvents.length ? cellEvents[0].summary : "Available") !== nextContent) break;
        span++;
      }
      rendered[c] = span - 1;

      const classes = ["cell"];

      if (cellEvents.length) {
        const ev = cellEvents[0];
        const evStart = ev.start;
        const evEnd = ev.end;

        const isReservation = ev.summary.includes("Reservation");
        const isCheckout = ev.summary.includes("Checkout");
        let isLate = false;
        if (isReservation) isLate = evStart < new Date(Date.now() - 30*60*1000);
        if (isCheckout) isLate = evEnd < new Date();

        let label = isReservation ? "Reservation" : isCheckout ? "Checkout" : "Booked";
        if (isReservation) classes.push("reservation");
        else if (isCheckout) classes.push("checkout");
        else classes.push("booked");
        if (isLate) { classes.push("late"); label = "Late " + label; }

        displayText = `${label}<br>${evStart.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})} - ${evEnd.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}`;
      } else {
        classes.push("available");

        let nextEventTime = null;
        for (let k = r + 1; k < slots.length; k++) {
          if (tableData[k][c].length) { nextEventTime = tableData[k][c][0].start; break; }
        }
        if (!nextEventTime) {
          nextEventTime = new Date(currentDate);
          nextEventTime.setHours(getHoursForDate(currentDate).end, 0, 0, 0);
        }

        if (nextEventTime < new Date()) displayText = "";
        else if (slotTime < new Date()) displayText = `Available until ${nextEventTime.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}`;
        else displayText = `Available<br>${slotTime.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})} - ${nextEventTime.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}`;
      }

      html += `<td class="${classes.join(" ")}" rowspan="${span}">${displayText}</td>`;
    }
    html += "</tr>";
  }

  table.innerHTML = html;
}

function refreshCalendar() { buildCalendar().catch(err => console.error(err)); }

// ---------------- Initial Load ----------------
addNavButtons();
setHeaderTitle();
clearCalendar();

fetchFeedsParallelWithProgress()
  .then(data => { feeds = data; refreshCalendar(); setInterval(refreshCalendar, 60000); })
  .catch(err => console.error(err));
