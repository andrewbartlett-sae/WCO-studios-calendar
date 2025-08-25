export const weekTypes = {
  Default: {//Tri Break Hours
    0: null,                 //Sunday
    1: { start: 8, end: 18 },//Monday
    2: { start: 8, end: 18 },//Tuesday
    3: { start: 8, end: 18 },//Wednesday
    4: { start: 8, end: 18 },//Thursday
    5: { start: 8, end: 18 },//Friday
    6: null                  //Saturday
  },
  Trimester: {
    0: null,                 //Sunday
    1: { start: 8, end: 18 },//Monday
    2: { start: 8, end: 21 },//Tuesday
    3: { start: 8, end: 21 },//Wednesday
    4: { start: 8, end: 21 },//Thursday
    5: { start: 8, end: 18 },//Friday
    6: { start: 8, end: 18 }//Saturday
  },
  Closed: { 0:null,1:null,2:null,3:null,4:null,5:null,6:null }
};

export const weekTypeRanges = [
  { type: "Trimester", start: "2025-05-26", end: "2025-08-24" },//25T2
  { type: "Trimester", start: "2025-09-15", end: "2025-12-14" },//25T3
  { type: "Closed", start: "2025-12-25", end: "2026-01-11" },   //Xmas Break
  { type: "Trimester", start: "2026-02-02", end: "2026-05-03" }, //26T1
];

export const singleDayOverrides = [
  { date: "2025-08-21", hours: { start: 8, end: 12 } }, //Early close Showcase
  { date: "2026-01-26", hours: null }, //Australia Day
  /*{ date: "2025-08-24", hours: { start: 6, end: 23 }  },//Test day*/
];
