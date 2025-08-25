import { weekTypes, weekTypeRanges, singleDayOverrides } from "./calendarConfig.js";

// ---------------- URLs ----------------
const webAppUrl = "https://script.google.com/macros/s/AKfycbxcb7lxSS6CvmhXfqNFku5wxxu-2JVk5xiKgNAHxXc5AAVdYeYhvkjDRhND-n49z0sj/exec";

let feeds = [];
let currentDate = new Date();
const version = "v1.9";

const columnWidthThreshold = 80;//pixels

// ---------------- Availability Helper ----------------
function getHoursForDate(date) {
  const isoDate = date.toISOString().split("T")[0];
  const override = singleDayOverrides.find((o) => o.date === isoDate);
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

function toGMT8(icalTime) {
  const d = icalTime.toJSDate();
  const utcTime = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utcTime + 8 * 60 * 60 * 1000);
}

// ---------------- Fetch Feeds ----------------
let currentFetchController = null; // track active fetch batch
let activeFetchId = 0;             // unique ID for each batch

async function fetchFeedsParallelWithProgress() {
  // Cancel previous batch if running
  if (currentFetchController) {
    currentFetchController.abort();
  }

  currentFetchController = new AbortController();
  const signal = currentFetchController.signal;
  const fetchId = ++activeFetchId;

  const progress = document.getElementById("progressBar");
  const progressContainer = document.getElementById("progressContainer");

  // Start fresh loading state
  progressContainer.classList.add("loading");
  progress.style.width = "0%";

  try {
    // Get the feed index (list of all feeds + names)
    const indexRes = await fetch(webAppUrl, { signal });
    if (!indexRes.ok) throw new Error("Failed to fetch feed index");
    const feedIndex = await indexRes.json();

    const totalSteps = feedIndex.length + 1;
    let completed = 1;
    progress.style.width = (completed / totalSteps) * 100 + "%";

    const feedUrls = feedIndex.map((feed, i) => `${webAppUrl}?feed=${i}`);
    const feedsData = new Array(feedUrls.length);

    const fetchPromises = feedUrls.map((url, i) =>
      fetch(url, { signal })
        .then(res => (res.ok ? res.json() : Promise.reject(`Failed feed ${i}`)))
        .then(data => { feedsData[i] = data; })
        .catch(err => {
          if (err.name === "AbortError") {
            console.log(`⏹️ Aborted fetch for feed "${feedIndex[i].name}" (expected)`);
            return;
          }
          console.error(`❌ Error fetching feed "${feedIndex[i].name}"`, err);
          feedsData[i] = { name: feedIndex[i].name, ics: "" };
        })
        .finally(() => {
          if (!signal.aborted && fetchId === activeFetchId) {
            completed++;
            progress.style.width = (completed / totalSteps) * 100 + "%";
          }
        })
    );

    await Promise.all(fetchPromises);

    if (!signal.aborted && fetchId === activeFetchId) {
      // ✅ Progress bar finishes smoothly
      progress.style.width = "100%";
      setTimeout(() => {
        progressContainer.classList.remove("loading");
        // Reset width after fade-out ends
        setTimeout(() => { progress.style.width = "0%"; }, 500);
      }, 300);

      return feedsData; // 🔥 return valid data
    } else {
      console.log("⏹️ Fetch batch aborted (expected)");
      return; // ❌ don’t overwrite feeds on abort
    }

  } catch (err) {
    if (err.name === "AbortError" || err.message === "Fetch aborted") {
      console.log("⏹️ Fetch batch aborted (expected)");
    } else {
      console.error("❌ Fetch failed:", err);
    }

    if (fetchId === activeFetchId) {
      progress.style.width = "0%";
      progressContainer.classList.remove("loading");
    }
    return; // ❌ don't overwrite feeds on error
  }
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

  // Add/remove currentDate class
  const today = new Date();
  if (
    currentDate.getFullYear() === today.getFullYear() &&
    currentDate.getMonth() === today.getMonth() &&
    currentDate.getDate() === today.getDate()
  ) {
    header.classList.add("neonOrange");
  } else {
    header.classList.remove("neonOrange");
  }
}

function addNavButtons() {
  let nav = document.getElementById("calendarNav");
  if (!nav) {
    nav = document.createElement("div");
    nav.id = "calendarNav";
    document.body.prepend(nav);

    /*const weekBackBtn = document.createElement("button");
    weekBackBtn.textContent = "« Previous Week";
    weekBackBtn.onclick = () => changeDay(-7);
    nav.appendChild(weekBackBtn);*/

    const prevBtn = document.createElement("button");
    prevBtn.textContent = "← Previous Day";
    prevBtn.onclick = () => changeDay(-1);
    nav.appendChild(prevBtn);

    const todayBtn = document.createElement("button");
    todayBtn.textContent = "Today";
    todayBtn.onclick = () => {
      currentDate = new Date();
      clearCalendar();
      setHeaderTitle();
      refreshCalendar();
    };
    nav.appendChild(todayBtn);

    const nextBtn = document.createElement("button");
    nextBtn.textContent = "Next Day →";
    nextBtn.onclick = () => changeDay(1);
    nav.appendChild(nextBtn);

    /*const weekForwardBtn = document.createElement("button");
    weekForwardBtn.textContent = "Next Week »";
    weekForwardBtn.onclick = () => changeDay(7);
    nav.appendChild(weekForwardBtn);*/

    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.style.marginLeft = "10px";
    dateInput.onchange = () => {
      const selectedDate = new Date(dateInput.value);
      if (!isNaN(selectedDate)) {
        currentDate = selectedDate;
        clearCalendar();
        setHeaderTitle();
        refreshCalendar();
      }
    };
    nav.appendChild(dateInput);

    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "Refresh";
    refreshBtn.onclick = async () => {
      const data = await fetchFeedsParallelWithProgress();
      if (data) {  // ✅ only replace feeds if valid array returned
        feeds = data;
        refreshCalendar();
      }
};
    nav.appendChild(refreshBtn);
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
  table.innerHTML = `
    <table class="calendarTable">
      <tr>
        <td class="loading" colspan="99">Loading...</td>
      </tr>
    </table>
  `;
}

// ---------------- Timeline Builder ----------------
function buildAccurateTimeline(feeds, currentDate) {
  const hours = getHoursForDate(currentDate);
  if (!hours) return [];

  const startOfDay = new Date(currentDate);
  startOfDay.setHours(hours.start, 0, 0, 0);

  const endOfDay = new Date(currentDate);
  endOfDay.setHours(hours.end, 0, 0, 0);

  const bookableEnd = new Date(currentDate);
  bookableEnd.setHours(hours.end - 1, 0, 0, 0); // closing-1h

  const timelines = [];

  for (let i = 0; i < feeds.length; i++) {
    try {
      const jcalData = ICAL.parse(feeds[i].ics);
      const comp = new ICAL.Component(jcalData);
      const events = comp.getAllSubcomponents("vevent").map(e => new ICAL.Event(e));

      // 🟢 Keep any event that overlaps today at all
      const todaysEvents = events
        .map(ev => ({
          summary: ev.summary,
          start: toGMT8(ev.startDate),
          end: toGMT8(ev.endDate),
        }))
        .filter(ev => ev.start < endOfDay && ev.end > startOfDay)
        .sort((a, b) => a.start - b.start);

      // If no events, just one availability block
      if (todaysEvents.length === 0) {
        timelines[i] = [{
          type: "available",
          start: startOfDay,
          end: bookableEnd
        }];
        continue;
      }

      let timeline = [];
      let cursor = startOfDay;

      todaysEvents.forEach(ev => {
        // Clip event time to today’s window
        const evStart = ev.start < startOfDay ? startOfDay : ev.start;
        const evEnd = ev.end > bookableEnd ? bookableEnd : ev.end;

        if (evStart > cursor) {
          timeline.push({
            type: "available",
            start: new Date(cursor),
            end: new Date(evStart)
          });
        }

        let type = "booked";
        if (ev.summary.includes("Reservation")) type = "reservation";
        else if (ev.summary.includes("Checkout")) type = "checkout";
        timeline.push({ type, start: evStart, end: evEnd });

        cursor = new Date(Math.max(cursor, evEnd));
      });

      if (cursor < bookableEnd) {
        timeline.push({
          type: "available",
          start: new Date(cursor),
          end: bookableEnd
        });
      }

      timelines[i] = timeline;

    } catch (e) {
      console.error(`Error parsing feed [${i}] "${feeds[i].name}":`, e);
      timelines[i] = [{ type: "error" }];
    }
  }
  return timelines;
}

// ---------------- Responsive Feed Split ----------------
function calculateFeedsPerTable() {
  const textMeasure = document.createElement("span");
  textMeasure.style.visibility = "hidden";
  textMeasure.style.whiteSpace = "nowrap";
  textMeasure.textContent = "Reservation";
  document.body.appendChild(textMeasure);
  const minColWidth = Math.max(columnWidthThreshold, textMeasure.getBoundingClientRect().width + 20);
  document.body.removeChild(textMeasure);

  const availableWidth = window.innerWidth - 40;
  const maxCols = Math.floor(availableWidth / minColWidth);

  return Math.max(1, (maxCols - 1) || 1);
}

// ---------------- Table Renderer ----------------
function renderCalendarTable(feeds, timelines) {
  if (feeds.length === 0) return "";

  const breakpoints = new Set();

  timelines.forEach(tl =>
    tl.forEach(seg => {
      if (seg.start && seg.end) {
        breakpoints.add(seg.start.getTime());
        breakpoints.add(seg.end.getTime());
      }
    })
  );

  const hours = getHoursForDate(currentDate);
  if (hours) {
    for (let h = hours.start; h < hours.end - 1; h++) {
      const anchor = new Date(currentDate);
      anchor.setHours(h, 0, 0, 0);
      breakpoints.add(anchor.getTime());
    }
  }

  const sortedBreaks = Array.from(breakpoints).sort((a, b) => a - b).map(t => new Date(t));

  if (sortedBreaks.length === 0) {
    return `<table class="calendarTable"><tr><td class="unavailableLarge" colspan="${feeds.length + 1}">Campus Closed</td></tr></table>`;
  }

  let html = `<table class="calendarTable"><tr><th>Time</th>${feeds.map(f => `<th>${f.name}</th>`).join("")}</tr>`;

  const rowspanRemaining = Array(feeds.length).fill(0);
  const now = new Date();

  for (let i = 0; i < sortedBreaks.length - 1; i++) {
    const rowStart = sortedBreaks[i];
    const rowEnd = sortedBreaks[i + 1];
    const timeLabel = rowStart.toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit", hour12:true });
    const isCurrent = rowStart <= now && rowEnd > now && rowStart.toDateString() === now.toDateString();

    html += `<tr><td class="timeCell${isCurrent ? " currentTimeCell" : ""}">${timeLabel}</td>`;

    feeds.forEach((f, idx) => {
      if (rowspanRemaining[idx] > 0) { rowspanRemaining[idx]--; return; }

      const seg = timelines[idx].find(s => s.start <= rowStart && s.end >= rowEnd);
      if (!seg) { html += `<td class="cell unavailable"></td>`; return; }

      let span = 1;
      for (let j = i + 1; j < sortedBreaks.length - 1; j++) {
        const nextStart = sortedBreaks[j];
        const nextEnd = sortedBreaks[j + 1];
        const nextSeg = timelines[idx].find(s => s.start <= nextStart && s.end >= nextEnd);
        if (nextSeg && nextSeg.type === seg.type && seg.start.getTime() === nextSeg.start.getTime() && seg.end.getTime() === nextSeg.end.getTime()) {
          span++;
        } else break;
      }
      rowspanRemaining[idx] = span - 1;

      let classes = ["cell", seg.type];
      let label = "";

      if (seg.type === "available") {
        if (seg.end < now) {
          classes.push("past");
          label = "";
        } else if (seg.start <= now && seg.end > now) {
          classes.push("current");
          label = `Available until<br>${seg.end.toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit", hour12:true})}`;
        } else {
          classes.push("upcoming");
          if (rowStart.toDateString() === now.toDateString()) {
            label = `Available until<br>${seg.end.toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit", hour12:true})}`;
          } else {
            label = `Available<br>${seg.start.toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit", hour12:true})} – ${seg.end.toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit", hour12:true})}`;
          }
        }
      } else if (seg.type === "error") {
        label = "Error";
      } else {
        // Reservation / Checkout / Booked
        label = `${seg.type.charAt(0).toUpperCase() + seg.type.slice(1)}<br>${seg.start.toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit", hour12:true})} – ${seg.end.toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit", hour12:true})}`;

        // 🟢 Late conditions:
        if (seg.type === "checkout" && now > seg.end) {
          classes.push("late");
          label += " (Late)";
        }
        if (seg.type === "reservation" && now > new Date(seg.start.getTime() + 30 * 60000)) {
          classes.push("late");
          label += "<br>NO SHOW";
        }
      }

      html += `<td class="${classes.join(" ")}" rowspan="${span}">${label}</td>`;
    });

    html += "</tr>";
  }

  if (hours) {
    const closingMinus1 = new Date(currentDate);
    closingMinus1.setHours(hours.end - 1, 0, 0, 0);
    const closingMinus1Label = closingMinus1.toLocaleTimeString("en-US", { hour: "numeric", minute:"2-digit", hour12:true });
    html += `<tr><td class="timeCell">${closingMinus1Label}</td>`;
    for (let c=0;c<feeds.length;c++) { html += `<td class="cell unavailable">Studios Closing</td>`; }
    html += "</tr>";

    const closingTime = new Date(currentDate);
    closingTime.setHours(hours.end, 0, 0, 0);
    const closingLabel = closingTime.toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit", hour12:true});
    html += `<tr><td class="timeCell">${closingLabel}</td>`;
    for (let c=0;c<feeds.length;c++) { html += `<td class="cell unavailable">Campus Closed</td>`; }
    html += "</tr>";
  }

  html += "</table>";
  return html;
}

// ---------------- Build Calendar ----------------
async function buildCalendar() {
  const table = document.getElementById("calendarTable");
  if (feeds.length === 0) return;

  const timelines = buildAccurateTimeline(feeds, currentDate);
  const feedsPerTable = calculateFeedsPerTable();
  const tableCount = Math.ceil(feeds.length / feedsPerTable);
  const baseSize = Math.floor(feeds.length / tableCount);
  const remainder = feeds.length % tableCount;

  let index = 0;
  let allTablesHtml = "";
  for (let t=0; t<tableCount; t++) {
    const thisSize = baseSize + (t < remainder ? 1 : 0);
    const start = index;
    const end = start + thisSize;
    const slicedFeeds = feeds.slice(start,end);
    const slicedTimelines = timelines.slice(start,end);
    const html = renderCalendarTable(slicedFeeds,slicedTimelines);
    allTablesHtml += `<div style="margin-bottom:24px;">${html}</div>`;
    index = end;
  }
  table.innerHTML = allTablesHtml;
}

function refreshCalendar() { buildCalendar().catch(err=>console.error(err)); }

// ---------------- Auto Refresh ----------------
function startAutoRefresh(intervalMs = 60000) {
  setInterval(async () => {
    try {
      console.log("🔄 Auto-refreshing feeds...");
      const data = await fetchFeedsParallelWithProgress();
      if (data) {  // safe update only
        feeds = data;
        refreshCalendar();
      }
    } catch (err) {
      console.error("Auto-refresh failed:", err);
    }
  }, intervalMs);
}

// ---------------- Initial Load ----------------
setHeaderTitle();
document.body.prepend(document.getElementById("progressContainer"));
addNavButtons();
clearCalendar();

fetchFeedsParallelWithProgress()
  .then(data => { 
    if (data) {              // ✅ only set feeds if valid data returned
      feeds = data; 
      refreshCalendar();
    }
    startAutoRefresh();       // auto-refresh still starts regardless
  })
  .catch(err => console.error(err));

window.addEventListener("resize", ()=>{ refreshCalendar(); });
