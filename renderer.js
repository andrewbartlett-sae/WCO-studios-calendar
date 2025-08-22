const webAppUrl = "https://script.google.com/.../exec";

let feeds = [];
let currentDate = new Date();
const startHour = 8;
const endHour = 21;
let abortControllers = [];

async function fetchFeeds() {
  const res = await fetch(webAppUrl);
  if (!res.ok) throw new Error(`Failed to fetch feeds: ${res.status}`);
  const data = await res.json();
  return data;
}

function setHeaderTitle() {
  let header = document.getElementById("calendarHeader");
  if (!header) {
    header = document.createElement('h1');
    header.id = "calendarHeader";
    header.style.color = "#eee";
    header.style.textAlign = "center";
    header.style.marginBottom = "20px";
    document.body.prepend(header);
  }
  const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  header.textContent = `Studio Availability – ${currentDate.toLocaleDateString('en-GB', options)}`;
}

const todayBtn = document.createElement('button');
todayBtn.textContent = "Today";
todayBtn.style.marginRight = "10px";
todayBtn.onclick = () => {
    currentDate = new Date();  // reset to today
    cancelPreviousRequests();  // cancel any in-progress feed loads
    clearCalendar();           // clear the table immediately
    setHeaderTitle();          // update the date header
    buildCalendar();           // rebuild the calendar
};
nav.appendChild(todayBtn);

function addNavButtons() {
  let nav = document.getElementById("calendarNav");
  if (!nav) {
    nav = document.createElement('div');
    nav.id = "calendarNav";
    nav.style.textAlign = "center";
    nav.style.marginBottom = "10px";
    document.body.prepend(nav);

    const prevBtn = document.createElement('button');
    prevBtn.textContent = "← Previous Day";
    prevBtn.style.marginRight = "10px";
    prevBtn.onclick = () => { changeDay(-1); };
    nav.appendChild(prevBtn);

    const todayBtn = document.createElement('button');
    todayBtn.textContent = "Today";
    todayBtn.style.marginRight = "10px";
    todayBtn.onclick = () => {
        currentDate = new Date();
        cancelPreviousRequests();
        clearCalendar();
        setHeaderTitle();
        buildCalendar();
    };
    nav.appendChild(todayBtn);

    const nextBtn = document.createElement('button');
    nextBtn.textContent = "Next Day →";
    nextBtn.onclick = () => { changeDay(1); };
    nav.appendChild(nextBtn);
  }
}

// Cancel previous requests
function cancelPreviousRequests() {
  abortControllers.forEach(ac => ac.abort());
  abortControllers = [];
}

// Change day helper
function changeDay(offset) {
  currentDate.setDate(currentDate.getDate() + offset);
  cancelPreviousRequests();
  clearCalendar();
  setHeaderTitle();
  buildCalendar();
}

// Clear calendar table immediately
function clearCalendar() {
  const table = document.getElementById("calendarTable");
  table.innerHTML = "";
}

// Generate slots
function getTimeSlots(startHour, endHour) {
  const slots = [];
  for (let h = startHour; h <= endHour; h++) {
    slots.push(`${String(h).padStart(2,'0')}:00`);
    if (h < endHour) slots.push(`${String(h).padStart(2,'0')}:30`);
  }
  return slots;
}

// Build empty table for instant rendering
function renderEmptyTable(feeds, slots) {
  const table = document.getElementById("calendarTable");
  const darkBg = "#1e1e1e";
  const textColor = "#eee";
  const colWidth = `${Math.floor(100 / (feeds.length + 1))}%`;

  let html = `<tr><th style="width:${colWidth}; background-color:${darkBg}; color:${textColor}; border:1px solid #555">Time</th>`;
  feeds.forEach(f => {
    html += `<th style="width:${colWidth}; background-color:${darkBg}; color:${textColor}; border:1px solid #555">${f.name}</th>`;
  });
  html += "</tr>";

  for (let r = 0; r < slots.length; r++) {
    const [hour, min] = slots[r].split(':').map(Number);
    const slotTime = new Date(currentDate);
    slotTime.setHours(hour, min, 0, 0);
    const timeLabel = slotTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    html += `<tr><td style="width:${colWidth}; background-color:${darkBg}; color:${textColor}; border:1px solid #555; font-weight:bold;">${timeLabel}</td>`;
    feeds.forEach(() => {
      html += `<td class="feed-cell" style="background-color:#2a2a2a; text-align:center; vertical-align:middle; color:#eee; width:${colWidth}; border:1px solid #555; font-weight:bold;">Loading...</td>`;
    });
    html += "</tr>";
  }

  table.innerHTML = html;
}

// Update a single feed column as data comes in
function updateFeedColumn(feedIndex, tableData, slots) {
  const table = document.getElementById("calendarTable");
  const rows = table.rows;
  const colOffset = 1; // first column is time

  for (let r = 0; r < slots.length; r++) {
    const cellEvents = tableData[r][feedIndex];
    const cell = rows[r+1].cells[colOffset + feedIndex];
    if (!cell) continue;

    if (cellEvents.length) {
      const ev = cellEvents[0];
      const evStart = ev.start;
      const evEnd = ev.end;
      const isReservation = ev.summary.includes("Reservation");
      const isCheckout = ev.summary.includes("Checkout");
      let isLate = false;
      if (isReservation) isLate = evStart < new Date();
      if (isCheckout) isLate = evEnd < new Date();

      let label = isReservation ? "Reservation" : isCheckout ? "Checkout" : "Booked";
      if (isLate) label = `Late ${label}`, cell.style.color = "#FAA";
      if (isReservation) cell.style.backgroundColor = "#4a90e2";
      if (isCheckout) cell.style.backgroundColor = "#4caf50";

      cell.innerHTML = `${label}<br>${evStart.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} - ${evEnd.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`;
    } else {
      // Available
      let nextEventTime = null;
      for (let k = r + 1; k < slots.length; k++) {
        if (tableData[k][feedIndex].length) { nextEventTime = tableData[k][feedIndex][0].start; break; }
      }
      if (!nextEventTime) {
        nextEventTime = new Date(currentDate);
        nextEventTime.setHours(endHour, 0, 0, 0);
      }
      const slotTimeParts = slots[r].split(':');
      const slotTime = new Date(currentDate);
      slotTime.setHours(parseInt(slotTimeParts[0]), parseInt(slotTimeParts[1]), 0, 0);

      if (nextEventTime < new Date()) cell.innerHTML = "";
      else if (slotTime < new Date()) cell.innerHTML = `Available until ${nextEventTime.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`;
      else cell.innerHTML = `Available<br>${slotTime.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} - ${nextEventTime.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`;
    }
  }
}

// Main incremental builder
async function buildCalendar() {
  cancelPreviousRequests();
  feeds = await fetchFeeds();
  setHeaderTitle();
  addNavButtons();

  const slots = getTimeSlots(startHour, endHour);
  renderEmptyTable(feeds, slots);

  // Create tableData skeleton
  const tableData = slots.map(() => feeds.map(() => []));

  // Fetch each feed in parallel
  feeds.forEach((feed, i) => {
    const controller = new AbortController();
    abortControllers.push(controller);

    (async () => {
      try {
        const jcalData = ICAL.parse(feed.ics);
        const comp = new ICAL.Component(jcalData);
        const events = comp.getAllSubcomponents("vevent").map(e => new ICAL.Event(e));
        events.forEach(ev => {
          const start = ev.startDate.toJSDate();
          const end = ev.endDate.toJSDate();
          if (start.toDateString() !== currentDate.toDateString()) return;
          let index = findSlotIndex(start, slots);
          const endIndex = findSlotIndex(end, slots);
          if (index < 0) index = 0;
          for (let s = index; s <= endIndex && s < slots.length; s++) {
            tableData[s][i].push({ summary: ev.summary, start, end });
          }
        });
        updateFeedColumn(i, tableData, slots);
      } catch(e) {
        console.error(`Error fetching ICS for feed ${feed.name}:`, e);
      }
    })();
  });
}

// Refresh calendar
function refreshCalendar() {
  buildCalendar().catch(err => console.error(err));
}

// Initial render
buildCalendar();
setInterval(() => { refreshCalendar(); }, 60000);
