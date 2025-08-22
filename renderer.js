const webAppUrl = "https://script.google.com/a/macros/sae.edu.au/s/AKfycbyMHnsDas6I5BgijywmpdufRa6AfTRsCGTkXZ_eC_pXKN9pEh-aVOvw2BAibSmJjU2I_w/exec";

let feeds = [];
let currentDate = new Date();
const startHour = 8;
const endHour = 21;

let pendingControllers = [];

// Fetch feeds from Apps Script
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
        prevBtn.onclick = () => changeDay(-1);
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
        nextBtn.onclick = () => changeDay(1);
        nav.appendChild(nextBtn);
    }
}

function changeDay(offset) {
    currentDate.setDate(currentDate.getDate() + offset);
    cancelPreviousRequests();
    clearCalendar();
    setHeaderTitle();
    buildCalendar();
}

function cancelPreviousRequests() {
    pendingControllers.forEach(ctrl => ctrl.abort());
    pendingControllers = [];
}

function clearCalendar() {
    const table = document.getElementById("calendarTable");
    if (table) table.innerHTML = "";
}

// Convert ICAL time to GMT+8 Date object
function toGMT8(icalTime) {
    const d = icalTime.toJSDate();
    const utcTime = d.getTime() + d.getTimezoneOffset() * 60000;
    return new Date(utcTime + 8 * 60 * 60 * 1000);
}

function getTimeSlots(startHour, endHour) {
    const slots = [];
    for (let h = startHour; h <= endHour; h++) {
        slots.push(`${String(h).padStart(2,'0')}:00`);
        if (h < endHour) slots.push(`${String(h).padStart(2,'0')}:30`);
    }
    return slots;
}

function findSlotIndex(date, slots) {
    const h = date.getHours();
    const m = date.getMinutes();
    const slotStr = `${String(h).padStart(2,'0')}:${m < 30 ? '00' : '30'}`;
    return slots.indexOf(slotStr);
}

// Render empty table placeholder
function renderEmptyTable(feeds) {
    const table = document.getElementById("calendarTable");
    const colWidth = `${Math.floor(100 / (feeds.length + 1))}%`;
    let html = `<tr><th style="width:${colWidth}; background-color:#1e1e1e; color:#eee; border:1px solid #555">Time</th>`;
    feeds.forEach(f => {
        html += `<th style="width:${colWidth}; background-color:#1e1e1e; color:#eee; border:1px solid #555">${f.name}</th>`;
    });
    html += "</tr>";

    const slots = getTimeSlots(startHour, endHour);
    slots.forEach(slot => {
        html += `<tr><td style="background-color:#1e1e1e; color:#eee; border:1px solid #555; font-weight:bold;">${slot}</td>`;
        feeds.forEach(() => {
            html += `<td style="background-color:#2a2a2a; color:#eee; border:1px solid #555; font-weight:bold; text-align:center;">Loading...</td>`;
        });
        html += "</tr>";
    });

    table.innerHTML = html;
}

// Build calendar table with partial updates
async function buildCalendar() {
    cancelPreviousRequests();
    const controller = new AbortController();
    pendingControllers.push(controller);

    try {
        feeds = await fetchFeeds();
        if (controller.signal.aborted) return;

        addNavButtons();
        renderEmptyTable(feeds);

        const table = document.getElementById("calendarTable");
        const slots = getTimeSlots(startHour, endHour);
        const tableData = slots.map(() => feeds.map(() => []));
        const rendered = Array.from({length: feeds.length}, () => 0);

        // Load each feed in parallel
        feeds.forEach((feed, i) => {
            (async () => {
                if (controller.signal.aborted) return;

                try {
                    // Fetch the ICS via proxy if needed
                    const res = await fetch(feed.ics, { signal: controller.signal });
                    if (controller.signal.aborted) return;
                    const text = await res.text();
                    if (controller.signal.aborted) return;

                    const jcalData = ICAL.parse(text);
                    const comp = new ICAL.Component(jcalData);
                    const events = comp.getAllSubcomponents("vevent").map(e => new ICAL.Event(e));

                    events.forEach(ev => {
                        const start = toGMT8(ev.startDate);
                        const end = toGMT8(ev.endDate);
                        if (start.toDateString() !== new Date().toDateString() && currentDate.toDateString() !== start.toDateString()) return;
                        let index = findSlotIndex(start, slots);
                        const endIndex = findSlotIndex(end, slots);
                        if (index < 0) index = 0;
                        for (let s = index; s <= endIndex && s < slots.length; s++) {
                            tableData[s][i].push({ summary: ev.summary, start, end });
                        }
                    });

                    if (!controller.signal.aborted) {
                        renderTablePartial(table, slots, tableData, rendered, feeds);
                    }
                } catch(e) {
                    console.error("Error fetching ICS:", e);
                    for (let row of tableData) row[i] = [{ summary: "Error" }];
                    if (!controller.signal.aborted) renderTablePartial(table, slots, tableData, rendered, feeds);
                }
            })();
        });
    } catch(e) {
        console.error("Error fetching feeds:", e);
    }
}

// Render table partially
function renderTablePartial(table, slots, tableData, rendered, feeds) {
    const darkBg = "#1e1e1e";
    const textColor = "#eee";
    const availableBg = "#2a2a2a";
    const colWidth = `${Math.floor(100 / (feeds.length + 1))}%`;

    let html = `<tr><th style="width:${colWidth}; background-color:${darkBg}; color:${textColor}; border:1px solid #555">Time</th>`;
    feeds.forEach(f => {
        html += `<th style="width:${colWidth}; background-color:${darkBg}; color:${textColor}; border:1px solid #555">${f.name}</th>`;
    });
    html += "</tr>";

    for (let r = 0; r < slots.length; r++) {
        const [slotHour, slotMinute] = slots[r].split(':').map(Number);
        const slotTime = new Date(currentDate);
        slotTime.setHours(slotHour, slotMinute, 0, 0);

        const timeLabel = slotTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        html += `<tr><td style="width:${colWidth}; background-color:${darkBg}; color:${textColor}; border:1px solid #555; font-weight:bold;">${timeLabel}</td>`;

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

            let bgColor = availableBg;
            let color = textColor;

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
                if (isLate) label = `Late ${label}`, color = "#FAA";

                if (isReservation) bgColor = "#4a90e2";   // Blue
                if (isCheckout) bgColor = "#4caf50";      // Green

                displayText = `${label}<br>${evStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${evEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
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
                else if (slotTime < new Date()) displayText = `Available until ${nextEventTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
                else displayText = `Available<br>${slotTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${nextEventTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
            }

            html += `<td style="background-color:${bgColor}; text-align:center; vertical-align:middle; color:${color}; width:${colWidth}; border:1px solid #555; font-weight:bold;" rowspan="${span}">${displayText}</td>`;
        }

        html += "</tr>";
    }

    table.innerHTML = html;
}

function refreshCalendar() {
    cancelPreviousRequests();
    clearCalendar();
    buildCalendar().catch(err => console.error(err));
}

// initial build
addNavButtons();
setHeaderTitle();
clearCalendar();
buildCalendar();

// auto-refresh every 1 minute
setInterval(() => {
    refreshCalendar();
}, 60000);
