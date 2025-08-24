import { weekTypes, weekTypeRanges, singleDayOverrides } from "./calendarConfig.js";

// ---------------- URLs ----------------
const webAppUrl = "https://script.google.com/macros/s/AKfycbzwcZ7wgnhWfqhfM6CxhdYK7MGbDlJy_l5ZLtna0MK9pxN1KjnN32ZAFiviaFW3kQI/exec";

let feeds = [];
let currentDate = new Date();
const version = "v1.0";

// ---------------- Availability Helper ----------------
function getHoursForDate(date) {
  const isoDate = date.toISOString().split("T")[0];
  const override = singleDayOverrides.find(o => o.date === isoDate);
  if (override) return override.hours;

  for (const range of weekTypeRanges) {
    const startDate = new Date(range.start);
    const endDate = new Date(range.end);
    if (date >= startDate && date <= endDate) {
      const type = weekTypes[range.type];
      return type[date.getDay()] || null;
    }
  }
  return weekTypes.Default[date.getDay()] || null;
}

function getTimeSlots() {
  const hours = getHoursForDate(currentDate);
  if (!hours) return [];
  const slots = [];
  // First slot is 8:10 (or whatever the start hour is)
  slots.push(`${String(hours.start).padStart(2,"0")}:10`);
  // The rest are on the hour, up to the hour before closing - 2
  for (let h = hours.start + 1; h < hours.end - 2; h++) {
    slots.push(`${String(h).padStart(2,"0")}:00`);
  }
  // Add the last slot, which is closing time minus 2 hours
  if (hours.end - 2 >= hours.start) {
    slots.push(`${String(hours.end - 2).padStart(2,"0")}:00`);
  }
  return slots;
}

function getTimeSlots_old() {
  const hours = getHoursForDate(currentDate);
  if (!hours) return [];
  const slots = [];
  for (let h = hours.start; h <= hours.end; h++) {
    slots.push(`${String(h).padStart(2,"0")}:00`);
    if (h < hours.end) slots.push(`${String(h).padStart(2,"0")}:30`);
  }
  return slots;
}

function toGMT8(icalTime) {
  const d = icalTime.toJSDate();
  const utcTime = d.getTime() + d.getTimezoneOffset()*60000;
  return new Date(utcTime + 8*60*60*1000);
}

function findSlotIndex(date, slots) {
  const h = date.getHours();
  const m = date.getMinutes();
  const slotStr = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  return slots.indexOf(slotStr);
}

// ---------------- Fetch Feeds ----------------
async function fetchFeedsParallelWithProgress() {
  const progress = document.getElementById("progressBar");
  const progressContainer = document.getElementById("progressContainer");
  progressContainer.classList.add("loading");
  
  progress.style.width = "0%";

  const indexRes = await fetch(webAppUrl);
  if (!indexRes.ok) throw new Error("Failed to fetch feed index");
  const feedIndex = await indexRes.json();

  const totalSteps = feedIndex.length + 1;
  let completed = 1;
  progress.style.width = ((completed/totalSteps)*100) + "%";

  const feedUrls = feedIndex.map((feed,i)=>`${webAppUrl}?feed=${i}`);
  const feedsData = new Array(feedUrls.length);

  const fetchPromises = feedUrls.map((url,i) =>
    fetch(url)
      .then(res=>res.ok?res.json():Promise.reject(`Failed feed ${i}`))
      .then(data=>{ feedsData[i]=data; })
      .catch(err=>{ console.error(err); feedsData[i]={ name: feedIndex[i].name, ics:"" }; })
      .finally(()=>{ completed++; progress.style.width=((completed/totalSteps)*100)+"%"; })
  );

  await Promise.all(fetchPromises);
  progressContainer.classList.remove("loading");
  return feedsData;
}

// ---------------- Calendar UI ----------------
function setHeaderTitle() {
  let header = document.getElementById("calendarHeader");
  if (!header) {
    header = document.createElement("h1");
    header.id="calendarHeader";
    header.classList.add("neonOrange");
    document.body.prepend(header);

    const versionTag = document.createElement("div");
    versionTag.id="calendarVersion";
    versionTag.textContent=version;
    document.body.insertBefore(versionTag, header.nextSibling);
  }
  const options={ weekday:"long", day:"numeric", month:"long", year:"numeric" };
  header.textContent=`Studio Availability – ${currentDate.toLocaleDateString("en-GB", options)}`;
}

function addNavButtons() {
  let nav = document.getElementById("calendarNav");
  if (!nav) {
    nav=document.createElement("div");
    nav.id="calendarNav";
    document.body.prepend(nav);

    const prevBtn=document.createElement("button");
    prevBtn.textContent="← Previous Day";
    prevBtn.onclick=()=>changeDay(-1);
    nav.appendChild(prevBtn);

    const todayBtn=document.createElement("button");
    todayBtn.textContent="Today";
    todayBtn.onclick=()=>{ currentDate=new Date(); clearCalendar(); setHeaderTitle(); refreshCalendar(); };
    nav.appendChild(todayBtn);

    const refreshBtn=document.createElement("button");
    refreshBtn.textContent="Refresh";
    refreshBtn.onclick=async()=>{ feeds=await fetchFeedsParallelWithProgress(); refreshCalendar(); };
    nav.appendChild(refreshBtn);

    const nextBtn=document.createElement("button");
    nextBtn.textContent="Next Day →";
    nextBtn.onclick=()=>changeDay(1);
    nav.appendChild(nextBtn);
  }
}

function changeDay(delta) {
  currentDate.setDate(currentDate.getDate()+delta);
  clearCalendar();
  setHeaderTitle();
  refreshCalendar();
}

function clearCalendar() {
  const table = document.getElementById("calendarTable");
  table.innerHTML = `
    <table class="calendarTable">
      <tr>
        <td class="loading" colspan="99">Loading...</td>
      </tr>
    </table>
  `;
}

// ---------------- Build Calendar ----------------
async function buildCalendar() {
  const table = document.getElementById("calendarTable");
  const slots = getTimeSlots();

  if (slots.length === 0) {
    table.innerHTML = `
      <table class="calendarTable">
        <tr>
          <td class="unavailableLarge" colspan="${feeds.length + 1}">Campus Closed</td>
        </tr>
      </table>
    `;
    return;
  }

  const tableData = slots.map(() => feeds.map(() => []));

  for (let i = 0; i < feeds.length; i++) {
    try {
      console.debug(`Processing feed [${i}]: ${feeds[i].name}`);
      const jcalData = ICAL.parse(feeds[i].ics);
      const comp = new ICAL.Component(jcalData);
      const events = comp.getAllSubcomponents("vevent").map(e => new ICAL.Event(e));
      console.debug(`Feed [${i}] "${feeds[i].name}" has ${events.length} events`);

      events.forEach(ev => {
        console.debug('Event:', ev.summary, ev.startDate.toJSDate(), ev.endDate.toJSDate());
        const start = toGMT8(ev.startDate);
        const end = toGMT8(ev.endDate);
        if (start.toDateString() !== currentDate.toDateString()) return;
        for (let s = 0; s < slots.length; s++) {
          // Get slot start and end times
          const [slotHour, slotMinute] = slots[s].split(":").map(Number);
          const slotStart = new Date(currentDate);
          slotStart.setHours(slotHour, slotMinute, 0, 0);

          let slotEnd;
          if (s < slots.length - 1) {
            const [nextHour, nextMinute] = slots[s + 1].split(":").map(Number);
            slotEnd = new Date(currentDate);
            slotEnd.setHours(nextHour, nextMinute, 0, 0);
          } else {
            // Last slot ends at closing time minus 1 hour
            const hours = getHoursForDate(currentDate);
            slotEnd = new Date(currentDate);
            slotEnd.setHours(hours.end - 1, 0, 0, 0);
          }

          // If event overlaps with this slot, add it
          if (start < slotEnd && end > slotStart) {
            tableData[s][i].push({ summary: ev.summary, start, end });
          }
        }
      });
    } catch (e) {
      console.error(`Error parsing feed [${i}] "${feeds[i].name}":`, e);
      for (let row of tableData) row[i] = [{ summary: "Error" }];
    }
  }

  const feedsPerTable = window.innerWidth < 1280 ? 7 : feeds.length;
  const tableCount = Math.ceil(feeds.length / feedsPerTable);

  let allTablesHtml = "";

  for (let t = 0; t < tableCount; t++) {
    const feedStart = t * feedsPerTable;
    const feedEnd = Math.min(feedStart + feedsPerTable, feeds.length);
    const feedsSlice = feeds.slice(feedStart, feedEnd);

    let html = `<table class="calendarTable" style="margin-bottom:24px;width:100%;" id="calendarTable${t}">`;
    html += `<tr><th>Time</th>`;
    feedsSlice.forEach(f => html += `<th>${f.name}</th>`);
    html += `</tr>`;

    const rendered = Array.from({ length: feedsSlice.length }, () => 0);

    for (let r = 0; r < slots.length; r++) {
      const [slotHour, slotMinute] = slots[r].split(":").map(Number);
      const slotTime = new Date(currentDate);
      slotTime.setHours(slotHour, slotMinute, 0, 0);

      const timeLabel = slotTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      const now = new Date();
      const isCurrent =
        slotTime.getHours() === now.getHours() &&
        slotTime.toDateString() === now.toDateString();

      html += `<tr><td class="timeCell${isCurrent ? " currentTimeCell" : ""}">${timeLabel}</td>`;

      for (let c = feedStart; c < feedEnd; c++) {
        const localC = c - feedStart;
        if (rendered[localC] > 0) { rendered[localC]--; continue; }

        const cellEvents = tableData[r][c];
        let displayText = "";
        let span = 1;

        for (let k = r + 1; k < slots.length; k++) {
          const nextEvents = tableData[k][c];
          // Only merge if both cells have events and they are the same event (same start/end)
          if (
            cellEvents.length &&
            nextEvents.length &&
            cellEvents[0].summary === nextEvents[0].summary &&
            cellEvents[0].start.getTime() === nextEvents[0].start.getTime() &&
            cellEvents[0].end.getTime() === nextEvents[0].end.getTime()
          ) {
            span++;
          } else if (
            !cellEvents.length &&
            !nextEvents.length
          ) {
            // Both are available, merge
            span++;
          } else {
            break;
          }
        }
        rendered[localC] = span - 1;

        const classes = ["cell"];

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
          if (isReservation) classes.push("reservation");
          else if (isCheckout) classes.push("checkout");
          else classes.push("booked");
          if (isLate) { classes.push("late"); label = "Late " + label; }

          displayText = `${label}<br>${evStart.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} - ${evEnd.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
        } else {
          classes.push("available");

          let nextEventTime = null;
          for (let k = r + 1; k < slots.length; k++) {
            if (tableData[k][c].length) {
              nextEventTime = tableData[k][c][0].start;
              break;
            }
          }
          if (!nextEventTime) {
            const hours = getHoursForDate(currentDate);
            nextEventTime = new Date(currentDate);
            nextEventTime.setHours(hours.end - 1, 0, 0, 0);
          }

          if (nextEventTime < new Date()) displayText = "";
          else if (slotTime < new Date()) displayText = `Available until<br>${nextEventTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
          else displayText = `Available<br>${slotTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} - ${nextEventTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
        }

        html += `<td class="${classes.join(" ")}" rowspan="${span}">${displayText}</td>`;
      }
      html += "</tr>";
    }

    // Add "Closing" and "Closed" rows
    const hours = getHoursForDate(currentDate);
    const closingMinus1 = new Date(currentDate);
    closingMinus1.setHours(hours.end - 1, 0, 0, 0);
    const closingMinus1Label = closingMinus1.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    html += `<tr><td class="timeCell">${closingMinus1Label}</td>`;
    for (let c = feedStart; c < feedEnd; c++) {
      html += `<td class="cell unavailable">Studios Closing</td>`;
    }
    html += `</tr>`;

    const closingTime = new Date(currentDate);
    closingTime.setHours(hours.end, 0, 0, 0);
    const closingLabel = closingTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    html += `<tr><td class="timeCell">${closingLabel}</td>`;
    for (let c = feedStart; c < feedEnd; c++) {
      html += `<td class="cell unavailable">Campus Closed</td>`;
    }
    html += `</tr>`;

    html += `</table>`;
    allTablesHtml += html;
  }

  table.innerHTML = allTablesHtml;
}

function refreshCalendar(){ buildCalendar().catch(err=>console.error(err)); }

// ---------------- Initial Load ----------------
setHeaderTitle();
document.body.prepend(document.getElementById("progressContainer")); // Move loading bar to top if not already
addNavButtons();
clearCalendar();

fetchFeedsParallelWithProgress()
  .then(data=>{ feeds=data; refreshCalendar(); setInterval(refreshCalendar,60000); })
  .catch(err=>console.error(err));

window.addEventListener("resize", () => {
  refreshCalendar();
});
