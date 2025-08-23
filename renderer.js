const webAppUrlAllCalendars = "https://script.google.com/a/macros/sae.edu.au/s/AKfycbyMHnsDas6I5BgijywmpdufRa6AfTRsCGTkXZ_eC_pXKN9pEh-aVOvw2BAibSmJjU2I_w/exec";
const webAppUrl = "https://script.google.com/macros/s/AKfycbwdz5SJ3m7fHq_7U6nG8P7yH9TLHCM9fJ8F14SRFIx8pWVsom6P8NOIdhwOY0-MedSN/exec";

let feeds = [];
let currentDate = new Date();
const startHour = 8;
const endHour = 21;
const version = "v1.2"; // loading bar added

async function fetchFeeds() {
  const res = await fetch(webAppUrlAllCalendars);
  if (!res.ok) throw new Error(`Failed to fetch feeds: ${res.status}`);
  return await res.json();
}

// Fetch feeds in parallel with progress updates
async function fetchFeedsWithProgress(feedIndex) {
  const bar = document.getElementById("progressBar");
  if (!bar) console.warn("Progress bar element not found");

  feeds = Array(feedIndex.length); // pre-fill

  let loadedCount = 0;

  const fetchPromises = feedIndex.map(async (f, i) => {
    if (!f.url) {
      console.error("Feed missing URL:", f.name);
      feeds[i] = { name: f.name, ics: "" };
      return;
    }

    try {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(`Failed to fetch ${f.name}: ${res.status}`);
      const ics = await res.text();
      feeds[i] = { name: f.name, ics };
    } catch (err) {
      console.error("Error fetching feed:", f.name, err);
      feeds[i] = { name: f.name, ics: "" };
    } finally {
      loadedCount++;
      if (bar) bar.style.width = `${Math.round((loadedCount / feedIndex.length) * 100)}%`;
    }
  });

  await Promise.all(fetchPromises);
  console.log("All feeds fetched:", feeds);
}

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
  const options = {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  };
  header.textContent = `Studio Availability – ${currentDate.toLocaleDateString(
    "en-GB",
    options
  )}`;
}

function addNavButtons() {
  let nav = document.getElementById("calendarNav");
  if (!nav) {
    nav = document.createElement("div");
    nav.id = "calendarNav";
    document.body.prepend(nav);

    const prevBtn = document.createElement("button");
    prevBtn.textContent = "← Previous Day";
    prevBtn.onclick = () => {
      changeDay(-1);
    };
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

    const refreshBts = document.createElement("button");
    refreshBts.textContent = "Refresh";
    refreshBts.onclick = async () => {
      clearCalendar();
      try {
        feeds = await fetchFeeds();  // refetch from Google Apps Script
        refreshCalendar();           // rebuild table with fresh data
      } catch (err) {
        console.error(err);
      }
    };
    nav.appendChild(refreshBts);

    const nextBtn = document.createElement("button");
    nextBtn.textContent = "Next Day →";
    nextBtn.onclick = () => {
      changeDay(1);
    };
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
  table.innerHTML = `<tr><td class="loading" colspan="${
    feeds.length + 1
  }">Loading...</td></tr>`;
}

function toGMT8(icalTime) {
  const d = icalTime.toJSDate();
  const utcTime = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utcTime + 8 * 60 * 60 * 1000);
}

function getTimeSlots(startHour, endHour) {
  const slots = [];
  for (let h = startHour; h <= endHour; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    if (h < endHour) slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
}

function findSlotIndex(date, slots) {
  const h = date.getHours();
  const m = date.getMinutes();
  const slotStr = `${String(h).padStart(2, "0")}:${m < 30 ? "00" : "30"}`;
  return slots.indexOf(slotStr);
}

async function buildCalendar() {
  const table = document.getElementById("calendarTable");
  const slots = getTimeSlots(startHour, endHour);
  const tableData = slots.map(() => feeds.map(() => []));

  // -- Parse events --
  for (let i = 0; i < feeds.length; i++) {
    try {
      const jcalData = ICAL.parse(feeds[i].ics);
      const comp = new ICAL.Component(jcalData);
      const events = comp
        .getAllSubcomponents("vevent")
        .map((e) => new ICAL.Event(e));
      events.forEach((ev) => {
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

  // -- Build HTML --
  let html = `<tr><th>Time</th>`;
  feeds.forEach((f) => {
    html += `<th>${f.name}</th>`;
  });
  html += "</tr>";

  const rendered = Array.from({ length: feeds.length }, () => 0);

  for (let r = 0; r < slots.length; r++) {
    const [slotHour, slotMinute] = slots[r].split(":").map(Number);
    const slotTime = new Date(currentDate);
    slotTime.setHours(slotHour, slotMinute, 0, 0);

    const timeLabel = slotTime.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    html += `<tr><td class="timeCell">${timeLabel}</td>`;

    for (let c = 0; c < feeds.length; c++) {
      if (rendered[c] > 0) {
        rendered[c]--;
        continue;
      }

      const cellEvents = tableData[r][c];
      let displayText = "";
      let span = 1;

      // merge identical rows
      for (let k = r + 1; k < slots.length; k++) {
        const nextEvents = tableData[k][c];
        const nextContent = nextEvents.length
          ? nextEvents[0].summary
          : "Available";
        if (
          (cellEvents.length ? cellEvents[0].summary : "Available") !==
          nextContent
        )
          break;
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

        if (isReservation)
          isLate = evStart < new Date(Date.now() - 30 * 60 * 1000);
        if (isCheckout) isLate = evEnd < new Date();

        let label = isReservation
          ? "Reservation"
          : isCheckout
          ? "Checkout"
          : "Booked";

        if (isReservation) classes.push("reservation");
        else if (isCheckout) classes.push("checkout");
        else classes.push("booked");

        if (isLate) {
          classes.push("late");
          label = "Late " + label;
        }

        displayText = `${label}<br>${evStart.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        })} - ${evEnd.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        })}`;
      } else {
        classes.push("available");

        // find next event
        let nextEventTime = null;
        for (let k = r + 1; k < slots.length; k++) {
          if (tableData[k][c].length) {
            nextEventTime = tableData[k][c][0].start;
            break;
          }
        }
        if (!nextEventTime) {
          nextEventTime = new Date(currentDate);
          nextEventTime.setHours(endHour, 0, 0, 0);
        }

        if (nextEventTime < new Date()) {
          displayText = "";
        } else if (slotTime < new Date()) {
          displayText = `Available until ${nextEventTime.toLocaleTimeString(
            "en-US",
            { hour: "numeric", minute: "2-digit" }
          )}`;
        } else {
          displayText = `Available<br>${slotTime.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })} - ${nextEventTime.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })}`;
        }
      }

      html += `<td class="${classes.join(" ")}" rowspan="${span}">${displayText}</td>`;
    }
    html += "</tr>";
  }

  table.innerHTML = html;
}

function refreshCalendar() {
  buildCalendar().catch((err) => console.error(err));
}

// ---- INITIAL LOAD ----
addNavButtons();
setHeaderTitle();
clearCalendar();

fetchFeedsWithProgress()
  .then((data) => {
    feeds = data;
    refreshCalendar();
    setInterval(refreshCalendar, 60000);
  })
  .catch((err) => console.error(err));
