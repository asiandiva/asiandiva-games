/* ---------------------------------------------------------------
   SIXTY BUCKS — weekly refresh
   Runs on GitHub's machines every Sunday. Three jobs:
     1. find games on Steam that aren't in the pool yet
     2. re-check prices on games already in the pool
     3. extend the calendar to 14 days out, never touching a day
        that's already been written
   Writes games.json and calendar.json. No dependencies.
--------------------------------------------------------------- */

import { readFile, writeFile } from 'node:fs/promises';

const POOL_FILE = 'games.json';
const CAL_FILE  = 'calendar.json';

const PER_DAY        = 6;
const HORIZON_DAYS   = 14;     // how far ahead we schedule
const MAX_LOOKUPS    = 220;    // new games checked per run, keeps the job under ~10 min
const MAX_REPRICE    = 60;     // existing games re-checked per run
const LOOKUP_DELAY   = 1500;   // ms between Steam calls. be polite or get rate limited
const MIN_PRICE      = 1.00;
const MAX_PRICE      = 200.00;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log   = (...a) => console.log(...a);

/* ---------- things that are not games ---------- */
const JUNK = /\b(soundtrack|ost|original score|artbook|art book|digital art|wallpaper|dlc|expansion pass|season pass|upgrade|bundle|pack|demo|beta|playtest|server|sdk|editor|trailer|teaser|prologue|benchmark|screensaver)\b/i;

// Steam's own content warnings. 1 = some nudity/sexual, 3 = adult only, 4 = frequent nudity/sexual
const ADULT_IDS = new Set([1, 3, 4]);

/* ---------- Steam ---------- */

// category1=998 is Steam's "Games" category, which already drops DLC, soundtracks and software
async function searchPage(params, start){
  const url = 'https://store.steampowered.com/search/results/?' + new URLSearchParams({
    json: '1', category1: '998', cc: 'us', l: 'english',
    count: '100', start: String(start), ...params
  });
  const res = await fetch(url, {headers:{'Accept-Language':'en-US,en'}});
  if (!res.ok) throw new Error('search failed: ' + res.status);
  const data = await res.json();
  return (data.items || []).map(it => {
    if (it.id) return Number(it.id);
    const m = /\/(?:apps|steam\/apps)\/(\d+)\//.exec(it.logo || '');
    return m ? Number(m[1]) : null;
  }).filter(Boolean);
}

async function gatherCandidates(){
  const found = new Set();
  const runs = [
    {params:{filter:'topsellers'},                 pages:6},   // recognisable, the good stuff
    {params:{filter:'popularnew'},                 pages:3},   // this month's releases
    {params:{sort_by:'Released_DESC'},             pages:2}    // very newest
  ];
  for (const run of runs){
    for (let p = 0; p < run.pages; p++){
      try {
        const ids = await searchPage(run.params, p * 100);
        ids.forEach(id => found.add(id));
        log(`  search ${JSON.stringify(run.params)} page ${p+1}: ${ids.length}`);
      } catch (e){ log('  search error:', e.message); }
      await sleep(800);
    }
  }
  return [...found];
}

// full detail for one app. returns a pool entry, or null if it fails a rule
async function inspect(appid){
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`;
  let json;
  try {
    const res = await fetch(url);
    if (res.status === 429){ log('  rate limited, backing off 30s'); await sleep(30000); return undefined; }
    if (!res.ok) return null;
    json = await res.json();
  } catch { return null; }

  const entry = json && json[appid];
  if (!entry || !entry.success || !entry.data) return null;
  const d = entry.data;

  if (d.type !== 'game') return null;
  if (d.is_free) return null;
  if (d.release_date && d.release_date.coming_soon) return null;
  if (JUNK.test(d.name || '')) return null;

  const ids = (d.content_descriptors && d.content_descriptors.ids) || [];
  if (ids.some(i => ADULT_IDS.has(i))) return null;

  const po = d.price_overview;
  if (!po || po.currency !== 'USD') return null;

  // `initial` is the list price. `final` is whatever the sale says today, which is not the answer.
  const price = po.initial / 100;
  if (price < MIN_PRICE || price > MAX_PRICE) return null;

  return {
    id: appid,
    name: (d.name || '').trim(),
    price: Number(price.toFixed(2)),
    checked: new Date().toISOString().slice(0, 10)
  };
}

/* ---------- files ---------- */
async function readJson(path, fallback){
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

/* ---------- calendar ---------- */
const dayKey = offset => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

function extendCalendar(calendar, pool, freshIds){
  // which games are already booked, and how recently
  const booked = new Map();
  for (const [date, list] of Object.entries(calendar))
    for (const g of list) booked.set(g.id, date);

  // new arrivals go out first, then whatever has been waiting longest
  const queue = [
    ...pool.filter(g => freshIds.has(g.id) && !booked.has(g.id)),
    ...pool.filter(g => !freshIds.has(g.id) && !booked.has(g.id)),
    ...pool.filter(g =>  booked.has(g.id)).sort((a,b) => booked.get(a.id).localeCompare(booked.get(b.id)))
  ];

  let added = 0, cursor = 0;
  for (let i = 0; i < HORIZON_DAYS; i++){
    const key = dayKey(i);
    if (calendar[key]) continue;              // already written, never touch it
    const six = [];
    while (six.length < PER_DAY && cursor < queue.length){
      const g = queue[cursor++];
      if (!six.some(x => x.id === g.id)) six.push({id:g.id, name:g.name, price:g.price});
    }
    if (six.length < PER_DAY) break;          // pool too small, stop rather than repeat
    calendar[key] = six;                       // price frozen into the day, on purpose
    added++;
  }
  return added;
}

function prune(calendar){
  const cutoff = dayKey(-45);
  for (const key of Object.keys(calendar)) if (key < cutoff) delete calendar[key];
}

/* ---------- main ---------- */
const pool     = await readJson(POOL_FILE, []);
const calendar = await readJson(CAL_FILE, {});
const known    = new Map(pool.map(g => [g.id, g]));

log(`pool: ${pool.length} games, calendar: ${Object.keys(calendar).length} days`);

log('searching Steam...');
const candidates = await gatherCandidates();
const unseen = candidates.filter(id => !known.has(id));
log(`${candidates.length} candidates, ${unseen.length} not in the pool`);

const freshIds = new Set();
let looked = 0;
for (const id of unseen.slice(0, MAX_LOOKUPS)){
  const entry = await inspect(id);
  looked++;
  if (entry){
    known.set(id, entry);
    freshIds.add(id);
    log(`  + ${entry.name} — $${entry.price}`);
  }
  await sleep(LOOKUP_DELAY);
}
log(`checked ${looked}, added ${freshIds.size}`);

// re-price the entries nobody has looked at in the longest time
const stale = [...known.values()]
  .filter(g => !freshIds.has(g.id))
  .sort((a,b) => (a.checked || '').localeCompare(b.checked || ''))
  .slice(0, MAX_REPRICE);

let changed = 0;
for (const g of stale){
  const entry = await inspect(g.id);
  if (entry){
    if (entry.price !== g.price){
      log(`  ~ ${g.name}: $${g.price} -> $${entry.price}`);
      changed++;
    }
    known.set(g.id, entry);
  } else {
    known.set(g.id, {...g, checked: new Date().toISOString().slice(0,10)});
  }
  await sleep(LOOKUP_DELAY);
}
log(`repriced ${stale.length}, ${changed} changed`);

const nextPool = [...known.values()].sort((a,b) => a.id - b.id);
prune(calendar);
const addedDays = extendCalendar(calendar, nextPool, freshIds);
log(`scheduled ${addedDays} new days`);

const ordered = {};
for (const k of Object.keys(calendar).sort()) ordered[k] = calendar[k];

await writeFile(POOL_FILE, JSON.stringify(nextPool, null, 1) + '\n');
await writeFile(CAL_FILE,  JSON.stringify(ordered,  null, 1) + '\n');
log(`done. pool is now ${nextPool.length} games across ${Object.keys(ordered).length} days`);
