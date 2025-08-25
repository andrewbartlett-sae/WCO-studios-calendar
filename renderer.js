import { weekTypes, weekTypeRanges, singleDayOverrides } from "./calendarConfig.js";

// ---------------- URLs ----------------
const webAppUrl = "https://script.google.com/macros/s/AKfycbxcb7lxSS6CvmhXfqNFku5wxxu-2JVk5xiKgNAHxXc5AAVdYeYhvkjDRhND-n49z0sj/exec";

// ---------------- URL Params → CSS Variable ----------------
(function applySizeParam() {
  const params = new URLSearchParams(window.location.search);
  const size = params.get("size");
  if (size && !isNaN(size)) {
    document.documentElement.style.setProperty("--defaultSize", `${size}px`);
    console.log(`✅ Applied --defaultSize: ${size}px`);
  }
})();

// ---------------- Globals ----------------
const version = "v1.9";
const columnWidthThreshold = 80;
let feeds = [];
let currentDate = new Date();
let scrollTargetSelector = null;

// ---------------- Helpers ----------------
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

function toGMT8(icalTime) {
  const d = icalTime.toJSDate();
  const utcTime = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utcTime + 8 * 60 * 60 * 1000);
}

// ---------------- Fetch Feeds ----------------
let currentFetchController = null;
let activeFetchId = 0;

async function fetchFeedsParallelWithProgress() {
  if (currentFetchController) currentFetchController.abort();
  currentFetchController = new AbortController();
  const signal = currentFetchController.signal;
  const fetchId = ++activeFetchId;

  const progress = document.getElementById("progressBar");
  const progressContainer = document.getElementById("progressContainer");
  progressContainer.classList.add("loading");
  progress.style.width = "0%";

  try {
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
            console.log(`⏹️ Aborted fetch for "${feedIndex[i].name}"`);
            return;
          }
          console.error(`❌ Error fetching "${feedIndex[i].name}"`, err);
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
      progress.style.width = "100%";
      setTimeout(() => {
        progressContainer.classList.remove("loading");
        setTimeout(() => { progress.style.width = "0%"; }, 500);
      }, 300);
      return feedsData;
    }

  } catch (err) {
    if (err.name !== "AbortError") console.error("❌ Fetch failed:", err);
  }

  if (fetchId === activeFetchId) {
    progress.style.width = "0%";
    progressContainer.classList.remove("loading");
  }
  return;
}

// ---------------- Calendar UI ----------------
function setHeaderTitle() {
  let header = document.getElementById("calendarHeader");
  if (!header) {
    header = document.createElement("h2");
    header.id = "calendarHeader";
    document.body.prepend(header);

    const versionTag = document.createElement("div");
    versionTag.id = "calendarVersion";
    versionTag.textContent = version;
    document.body.insertBefore(versionTag, header.nextSibling);
  }
  const opts = { weekday:"long", day:"numeric", month:"long", year:"numeric" };
  header.innerHTML = `Studio Availability<br>${currentDate.toLocaleDateString("en-GB", opts)}`;

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

    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.style.marginLeft = "10px";
    dateInput.onchange = () => {
      const d = new Date(dateInput.value);
      if (!isNaN(d)) {
        currentDate = d;
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
      if (data) { feeds = data; refreshCalendar(); }
    };
    nav.appendChild(refreshBtn);

    const prevBtn = document.createElement("button");
    prevBtn.textContent = "← Previous Day";
    prevBtn.onclick = () => changeDay(-1);
    nav.appendChild(prevBtn);

    const todayBtn = document.createElement("button");
    todayBtn.textContent = "Today";
    todayBtn.onclick = () => changeToToday(); // top nav (no scroll)
    nav.appendChild(todayBtn);

    const nextBtn = document.createElement("button");
    nextBtn.textContent = "Next Day →";
    nextBtn.onclick = () => changeDay(1);
    nav.appendChild(nextBtn);
  }
}

// ---------------- Navigation ----------------
function changeDay(delta, triggerEl) {
  currentDate.setDate(currentDate.getDate() + delta);
  clearCalendar();
  setHeaderTitle();

  if (triggerEl) {
    const block = triggerEl.closest(".calendarBlock");
    if (block) scrollTargetSelector = block.dataset.index;
  } else {
    scrollTargetSelector = null; // no scroll if top nav
  }
  refreshCalendar();
}

function changeToToday(triggerEl) {
  currentDate = new Date();
  clearCalendar();
  setHeaderTitle();

  if (triggerEl) {
    const block = triggerEl.closest(".calendarBlock");
    if (block) scrollTargetSelector = block.dataset.index;
  } else {
    scrollTargetSelector = null;
  }
  refreshCalendar();
}

function clearCalendar() {
  const table = document.getElementById("calendarTable");
  table.innerHTML = `<table class="calendarTable"><tr><td class="loading" colspan="99">Loading...</td></tr></table>`;
}

// ---------------- Timeline Builder ----------------
function buildAccurateTimeline(feeds, currentDate) {
  const hours = getHoursForDate(currentDate);
  if (!hours) return [];
  const startOfDay = new Date(currentDate);
  startOfDay.setHours(hours.start, 10, 0, 0);
  const endOfDay = new Date(currentDate);
  endOfDay.setHours(hours.end, 0, 0, 0);
  const bookableEnd = new Date(currentDate);
  bookableEnd.setHours(hours.end - 1, 0, 0, 0);

  const timelines = [];
  for (let i = 0; i < feeds.length; i++) {
    try {
      const jcal = ICAL.parse(feeds[i].ics);
      const comp = new ICAL.Component(jcal);
      const events = comp.getAllSubcomponents("vevent").map(e => new ICAL.Event(e));
      const todaysEvents = events
        .map(ev => ({ summary:ev.summary, start:toGMT8(ev.startDate), end:toGMT8(ev.endDate) }))
        .filter(ev => ev.start < endOfDay && ev.end > startOfDay)
        .sort((a,b)=>a.start-b.start);

      if (todaysEvents.length === 0) {
        timelines[i] = [{ type:"available", start:startOfDay, end:bookableEnd }];
        continue;
      }

      let cursor = startOfDay;
      let timeline = [];
      todaysEvents.forEach(ev => {
        const evStart = ev.start<startOfDay?startOfDay:ev.start;
        const evEnd = ev.end>bookableEnd?bookableEnd:ev.end;
        if (evStart>cursor) {
          timeline.push({ type:"available", start:new Date(cursor), end:new Date(evStart) });
        }
        let type="booked";
        if (ev.summary.includes("Reservation")) type="reservation";
        else if (ev.summary.includes("Checkout")) type="checkout";
        timeline.push({ type, start:evStart, end:evEnd });
        cursor=new Date(Math.max(cursor,evEnd));
      });
      if (cursor<bookableEnd) {
        timeline.push({ type:"available", start:new Date(cursor), end:bookableEnd });
      }
      timelines[i]=timeline;
    } catch(e) {
      console.error(`Parse error [${i}] "${feeds[i].name}":`, e);
      timelines[i]=[{type:"error"}];
    }
  }
  return timelines;
}

// ---------------- Responsive Feed Split ----------------
function calculateFeedsPerTable() {
  const span=document.createElement("span");
  span.style.visibility="hidden"; span.style.whiteSpace="nowrap";
  span.textContent="Reservation"; document.body.appendChild(span);
  const minColWidth=Math.max(columnWidthThreshold, span.getBoundingClientRect().width+20);
  document.body.removeChild(span);
  const availableWidth=window.innerWidth-40;
  const maxCols=Math.floor(availableWidth/minColWidth);
  return Math.max(1,(maxCols-1)||1);
}

// ---------------- Table Renderer ----------------
function renderCalendarTable(feeds, timelines) {
  if (feeds.length === 0) return "";

  const breakpoints=new Set();
  timelines.forEach(tl=>tl.forEach(seg=>{
    if(seg.start&&seg.end){
      breakpoints.add(seg.start.getTime());
      breakpoints.add(seg.end.getTime());
    }
  }));

  const hours=getHoursForDate(currentDate);
  if(hours){
    for(let h=hours.start; h<hours.end-1; h++){
      const anchor=new Date(currentDate);
      if(h===hours.start){anchor.setHours(h,10,0,0);}
      else{anchor.setHours(h,0,0,0);}
      breakpoints.add(anchor.getTime());
    }
  }

  const sortedBreaks=Array.from(breakpoints).sort((a,b)=>a-b).map(t=>new Date(t));

  // --- always build the header row ---
  let html=`<table class="calendarTable"><tr><th>Time</th>${feeds.map(f=>`<th>${f.name}</th>`).join("")}</tr>`;

  if (sortedBreaks.length === 0) {
    // No breakpoints => campus closed, but still show headers
    html += `<tr><td class="timeCell"></td>`;
    for(let c=0;c<feeds.length;c++){
      html += `<td class="cell unavailableLarge">Campus Closed</td>`;
    }
    html += `</tr></table>`;
    return html;
  }

  // ---- otherwise continue normal rendering ----
  const rowspanRemaining=Array(feeds.length).fill(0);
  const now=new Date();

  for(let i=0;i<sortedBreaks.length-1;i++){
    const rowStart=sortedBreaks[i], rowEnd=sortedBreaks[i+1];
    const timeLabel=rowStart.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true});
    const isCurrent=rowStart<=now && rowEnd>now && rowStart.toDateString()===now.toDateString();
    html+=`<tr><td class="timeCell${isCurrent?" currentTimeCell":""}">${timeLabel}</td>`;

    feeds.forEach((f,idx)=>{
      if(rowspanRemaining[idx]>0){rowspanRemaining[idx]--;return;}
      const seg=timelines[idx].find(s=>s.start<=rowStart&&s.end>=rowEnd);
      if(!seg){html+=`<td class="cell unavailable"></td>`;return;}

      let span=1;
      for(let j=i+1;j<sortedBreaks.length-1;j++){
        const ns=sortedBreaks[j], ne=sortedBreaks[j+1];
        const nSeg=timelines[idx].find(s=>s.start<=ns&&s.end>=ne);
        if(nSeg&&nSeg.type===seg.type&&seg.start.getTime()===nSeg.start.getTime()&&seg.end.getTime()===nSeg.end.getTime())
          span++;
        else break;
      }
      rowspanRemaining[idx]=span-1;

      let classes=["cell",seg.type], label="";
      if(seg.type==="available"){
        if(seg.end<now){classes.push("past");}
        else if(seg.start<=now && seg.end>now){
          classes.push("current");
          label=`Available until<br>${seg.end.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true})}`;
        } else {
          classes.push("upcoming");
          if(rowStart.toDateString()===now.toDateString()){
            label=`Available until<br>${seg.end.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true})}`;
          } else {
            label=`Available<br>${seg.start.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true})} – ${seg.end.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true})}`;
          }
        }
      } else if(seg.type==="error"){label="Error";}
      else {
        label=`${seg.type.charAt(0).toUpperCase()+seg.type.slice(1)}<br>${seg.start.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true})} – ${seg.end.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true})}`;
        if(seg.type==="checkout"&&now>seg.end){classes.push("late");label+=" (Late)";}
        if(seg.type==="reservation"&&now>new Date(seg.start.getTime()+30*60000)){classes.push("late");label+="<br>NO SHOW";}
      }

      html+=`<td class="${classes.join(" ")}" rowspan="${span}">${label}</td>`;
    });

    html+="</tr>";
  }

  // add closing rows
  if(hours){
    const c1=new Date(currentDate);c1.setHours(hours.end-1,0,0,0);
    const c1Label=c1.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true});
    html+=`<tr><td class="timeCell">${c1Label}</td>`;
    for(let c=0;c<feeds.length;c++){html+=`<td class="cell unavailable">Studios Closing</td>`;}
    html+="</tr>";
    const c2=new Date(currentDate);c2.setHours(hours.end,0,0,0);
    const c2Label=c2.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true});
    html+=`<tr><td class="timeCell">${c2Label}</td>`;
    for(let c=0;c<feeds.length;c++){html+=`<td class="cell unavailable">Campus Closed</td>`;}
    html+="</tr>";
  }

  html+="</table>";
  return html;
}

// ---------------- Build Calendar ----------------
async function buildCalendar() {
  const table=document.getElementById("calendarTable");
  if(feeds.length===0) return;

  const timelines=buildAccurateTimeline(feeds,currentDate);
  const feedsPerTable=calculateFeedsPerTable();
  const tableCount=Math.ceil(feeds.length/feedsPerTable);
  const baseSize=Math.floor(feeds.length/tableCount);
  const remainder=feeds.length%tableCount;

  let index=0, allTablesHtml="";
  const opts={weekday:"long",day:"numeric",month:"long",year:"numeric"};
  const headerText=`Studio Availability<br>${currentDate.toLocaleDateString("en-GB",opts)}`;
  const today=new Date();
  const isToday=currentDate.toDateString()===today.toDateString();
  const headerHtml=`<h2 class="calendarHeader ${isToday?"neonOrange":""}">${headerText}</h2>`;
  const navHtml=`
    <div class="calendarNavDup" style="text-align:center; margin:10px 0;">
      <button type="button" onclick="changeDay(-1,this)">← Previous Day</button>
      <button type="button" onclick="changeToToday(this)">Today</button>
      <button type="button" onclick="changeDay(1,this)">Next Day →</button>
    </div>
  `;

  for(let t=0;t<tableCount;t++){
    const thisSize=baseSize+(t<remainder?1:0);
    const start=index,end=start+thisSize;
    const slicedFeeds=feeds.slice(start,end);
    const slicedTimelines=timelines.slice(start,end);
    const html=renderCalendarTable(slicedFeeds,slicedTimelines);

    if(tableCount>3 && t>0){
      allTablesHtml+=`
        <div class="calendarBlock" data-index="${t}">
          ${headerHtml}
          ${navHtml}
          <div class="calendarTableWrap" style="margin-bottom:24px;">${html}</div>
        </div>`;
    } else {
      allTablesHtml+=`
        <div class="calendarBlock" data-index="${t}">
          <div class="calendarTableWrap" style="margin-bottom:24px;">${html}</div>
        </div>`;
    }
    index=end;
  }

  table.innerHTML=allTablesHtml;
  if(scrollTargetSelector!==null){
    const block=document.querySelector(`.calendarBlock[data-index="${scrollTargetSelector}"]`);
    if(block){const header=block.querySelector("h2.calendarHeader"); if(header) header.scrollIntoView({behavior:"smooth",block:"start"});}
    scrollTargetSelector=null;
  }
}

function refreshCalendar(){ buildCalendar().catch(console.error); }

// ---------------- Auto Refresh ----------------
function startAutoRefresh(intervalMs=60000){
  setInterval(async()=>{
    try{
      console.log("🔄 Auto-refresh...");
      const data=await fetchFeedsParallelWithProgress();
      if(data){feeds=data; refreshCalendar();}
    }catch(e){console.error("Auto-refresh failed:",e);}
  },intervalMs);
}

// ---------------- Initial Load ----------------
setHeaderTitle();
document.body.prepend(document.getElementById("progressContainer"));
addNavButtons();
clearCalendar();
fetchFeedsParallelWithProgress().then(data=>{
  if(data){feeds=data; refreshCalendar();}
  startAutoRefresh();
}).catch(console.error);

window.addEventListener("resize",()=>refreshCalendar());

// expose for inline duplicate navs
window.changeDay=changeDay;
window.changeToToday=changeToToday;
window.setHeaderTitle=setHeaderTitle;
window.clearCalendar=clearCalendar;
window.refreshCalendar=refreshCalendar;
