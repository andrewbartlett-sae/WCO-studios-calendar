const webAppUrl = "https://script.google.com/a/macros/sae.edu.au/s/AKfycbyMHnsDas6I5BgijywmpdufRa6AfTRsCGTkXZ_eC_pXKN9pEh-aVOvw2BAibSmJjU2I_w/exec";

let feeds = [];
let currentDate = new Date();
const startHour = 8;
const endHour = 21;
const version = "v1.01"; // Version number

// Track ongoing fetches
let currentAbortController = null;

async function fetchFeeds() {
  if (feeds.length > 0) return feeds; // Only fetch once

  if (currentAbortController) currentAbortController.abort();
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  const res = await fetch(webAppUrl, { signal });
  if (!res.ok) throw new Error(`Failed to fetch feeds: ${res.status}`);
  const data = await res.json();
  feeds = data;
  return feeds;
}

function setHeaderTitle() {
  let header = document.getElementById("calendarHeader");
  if (!header) {
    header = document.createElement("h1");
    header.id = "calendarHeader";
    document.body.prepend(header);

    // Version number (small, subtle)
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
    prevBtn.onclick = () => { changeDay(-1); };
    nav.appendChild(prevBtn);

    const todayBtn = document.createElement("button");
    todayBtn.textContent = "Today";
    todayBtn.onclick = () => {
      currentDate = new Date(); // Always system date
      clearCalendar();
      setHeaderTitle();
      refreshCalendar();
    };
    nav.appendChild(todayBtn);

    const nextBtn = document.createElement("button");
    nextBtn.textContent = "Next Day →";
    nextBtn.onclick = () => { changeDay(1); };
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
  table.innerHTML = `<tr><td colspan="${feeds.length + 1}" class="loading-cell">Loading...</td></tr>`;
}

function toGMT8(icalTime) {
  const d = icalTime.toJSDate();
  const utcTime = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utcTime + 8 * 60 * 60 * 1000);
}

function getTimeSlots(startHour, endHour) {
  const slots = [];
  for (let h = startHour; h <= endHour; h++) {
    slots.push(`${String(h).padStart(2,"0")}:00`);
    if (h < endHour) slots.push(`${String(h).padStart(2,"0")}:30`);
  }
  return slots;
}

function findSlotIndex(date, slots) {
  const h = date.getHours();
  const m = date.getMinutes();
  const slotStr = `${String(h).padStart(2,"0")}:${m < 30 ? "00" : "30"}`;
  return slots.indexOf(slotStr);
}

async function buildCalendar() {
  try {
    feeds = await fetchFeeds();
  } catch (err) {
    if (err.name === "AbortError") {
      console.log("Previous fetch aborted.");
      return;
    } else {
      console.error(err);
      return;
    }
  }

  const table = document.getElementById("calendarTable");
  const slots = getTimeSlots(startHour, endHour);
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
        for (let s = index; s <= endIndex && s < slots.length; s++) {
          tableData[s][i].push({ summary: ev.summary, start, end });
        }
      });
    } catch (e) {
      console.error(e);
      for (let row of tableData) row[i] = [{ summary: "Error" }];
    }
  }

  const rendered = Array.from({ length: feeds.length }, () => 0);

  let html = `<tr><th class="time-col">Time</th>`;
  feeds.forEach(f => { html += `<th class="feed-col">${f.name}</th>`; });
  html += "</tr>";

  for (let r = 0; r < slots.length; r++) {
    const [slotHour, slotMinute] = slots[r].split(":").map(Number);
    const slotTime = new Date(currentDate);
    slotTime.setHours(slotHour, slotMinute, 0, 0);

    const timeLabel = slotTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    html += `<tr><td class="time-cell">${timeLabel}</td>`;

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

      let cssClass = "available";

      if (cellEvents.length) {
        const ev = cellEvents[0];
        const evStart = ev.start;
        const evEnd = ev.end;
        const isReservation = ev.summary.includes("Reservation");
        const isCheckout = ev.summary.includes("Checkout");
        let isLate = false;

        if (isReservation) isLate = evStart < new Date(Date.now() - 30 * 60 * 1000);
        if (isCheckout) isLate = evEnd < new Date();

        let label = isReservation ? "Reservation" : isCheckout ? "Checkout" : "Booked";
        if (isLate) { label = `Late ${label}`; cssClass = "late"; }
        else if (isReservation) cssClass = "reservation";
        else if (isCheckout) cssClass = "checkout";
        else cssClass = "booked";

        displayText = `${label}<br>${evStart.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} - ${evEnd.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
      } else {
        let nextEventTime = null;
        for (let k = r + 1; k < slots.length; k++) {
          if (tableData[k][c].length) { nextEventTime = tableData[k][c][0].start; break; }
        }
        if (!nextEventTime) {
          nextEventTime = new Date(currentDate);
          nextEventTime.setHours(endHour, 0, 0, 0);
        }

        if (nextEventTime < new Date()) displayText = "";
        else if (slotTime < new Date()) displayText = `Available until ${nextEventTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
        else displayText = `Available<br>${slotTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} - ${nextEventTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
      }

      html += `<td class="cell ${cssClass}" rowspan="${span}">${displayText}</td>`;
    }
    html += "</tr>";
  }

  table.innerHTML = html;
}

function refreshCalendar() {
  buildCalendar().catch(err => console.error(err));
}

addNavButtons();
setHeaderTitle();
clearCalendar();
refreshCalendar();
setInterval(refreshCalendar, 60000);
