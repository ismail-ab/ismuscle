const express = require('express');
const webpush = require('web-push');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── VAPID KEYS ───────────────────────────────────────────────────────────────
// Generate once and store in env vars on Heroku
let vapidPublic = process.env.VAPID_PUBLIC_KEY;
let vapidPrivate = process.env.VAPID_PRIVATE_KEY;

if (!vapidPublic || !vapidPrivate) {
  // Auto-generate for first run (dev only)
  const keys = webpush.generateVAPIDKeys();
  vapidPublic = keys.publicKey;
  vapidPrivate = keys.privateKey;
  console.log('⚠️  VAPID keys auto-generated for dev.');
  console.log('Set these on Heroku:');
  console.log('VAPID_PUBLIC_KEY=' + vapidPublic);
  console.log('VAPID_PRIVATE_KEY=' + vapidPrivate);
}

webpush.setVapidDetails(
  'mailto:ismuscle@app.com',
  vapidPublic,
  vapidPrivate
);

// ── SUBSCRIPTIONS STORE ───────────────────────────────────────────────────────
// In-memory (Heroku ephemeral) — for persistence use a DB
// For a single user this is fine — sub survives as long as dyno runs
let subscriptions = [];
const SUBS_FILE = '/tmp/subs.json';

function loadSubs() {
  try { subscriptions = JSON.parse(fs.readFileSync(SUBS_FILE,'utf8')); } catch(e) { subscriptions = []; }
}
function saveSubs() {
  try { fs.writeFileSync(SUBS_FILE, JSON.stringify(subscriptions)); } catch(e) {}
}
loadSubs();

// ── GTG SCHEDULE ─────────────────────────────────────────────────────────────
// Default GTG hours (user can override via API)
let gtgSchedule = {
  enabled: true,
  hours: [8, 10, 12, 14, 16, 18, 20], // 7 reminders/day
  daysOff: [0], // Sunday off by default (0=Sun, 6=Sat)
  exercises: ['Traction', 'Pompe inclinée'],
  repsTarget: 1
};

const SCHEDULE_FILE = '/tmp/gtg_schedule.json';
function loadSchedule() {
  try { gtgSchedule = {...gtgSchedule, ...JSON.parse(fs.readFileSync(SCHEDULE_FILE,'utf8'))}; } catch(e) {}
}
function saveSchedule() {
  try { fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(gtgSchedule)); } catch(e) {}
}
loadSchedule();

// GTG log
let gtgLog = [];
const LOG_FILE = '/tmp/gtg_log.json';
function loadLog() {
  try { gtgLog = JSON.parse(fs.readFileSync(LOG_FILE,'utf8')); } catch(e) { gtgLog = []; }
}
function saveLog() {
  try { fs.writeFileSync(LOG_FILE, JSON.stringify(gtgLog.slice(-500))); } catch(e) {}
}
loadLog();

// ── CRON: send GTG notifications ──────────────────────────────────────────────
cron.schedule('* * * * *', async () => {
  if (!gtgSchedule.enabled) return;
  const now = new Date();
  const hour = now.getHours();
  const min = now.getMinutes();
  const day = now.getDay(); // 0=Sun

  if (min !== 0) return;

  const activeDays = gtgSchedule.activeDays || [1,2,3,4,5,6];
  if (!activeDays.includes(day)) return;

  // Test day reminder — send at first scheduled hour
  const testDay = gtgSchedule.testDay;
  const isTestDay = (testDay === day);
  const firstHour = Math.min(...(gtgSchedule.hours || [8]));

  if (isTestDay && hour === firstHour) {
    const testPayload = JSON.stringify({
      title: '🎯 Jour de test GTG',
      body: 'Teste ton max AVANT toute rep GTG — frais, forme parfaite',
      tag: 'gtg-test-day',
      data: { type: 'test_day' }
    });
    for (const sub of subscriptions) {
      try { await webpush.sendNotification(sub, testPayload); } catch(e) {
        if (e.statusCode === 410) { subscriptions = subscriptions.filter(s=>s.endpoint!==sub.endpoint); saveSubs(); }
      }
    }
    return; // Don't send regular GTG on test day first hour
  }

  if (!gtgSchedule.hours.includes(hour)) return;

  // Pick random active exercise
  const exercises = (gtgSchedule.exercises || [])
    .filter(e => typeof e === 'string' ? true : e.active)
    .map(e => typeof e === 'string' ? e : e.name);

  if (!exercises.length) return;
  const exercise = exercises[Math.floor(Math.random() * exercises.length)];
  const reps = gtgSchedule.repsTarget || 1;

  const payload = JSON.stringify({
    title: '💪 GTG — Grease the Groove',
    body: `${reps} rep de ${exercise} — frais, forme parfaite`,
    tag: 'gtg-reminder',
    data: { exercise, reps, timestamp: now.toISOString() }
  });

  for (const sub of subscriptions) {
    try { await webpush.sendNotification(sub, payload); } catch(e) {
      if (e.statusCode === 410) { subscriptions = subscriptions.filter(s=>s.endpoint!==sub.endpoint); saveSubs(); }
    }
  }
});

// ── API ROUTES ────────────────────────────────────────────────────────────────

// VAPID public key
app.get('/api/vapid-key', (req, res) => {
  res.json({ publicKey: vapidPublic });
});

// Subscribe
app.post('/api/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({error:'Invalid subscription'});
  // Avoid duplicate
  const exists = subscriptions.find(s => s.endpoint === sub.endpoint);
  if (!exists) { subscriptions.push(sub); saveSubs(); }
  res.json({ ok: true });
});

// Unsubscribe
app.post('/api/unsubscribe', (req, res) => {
  subscriptions = subscriptions.filter(s => s.endpoint !== req.body.endpoint);
  saveSubs();
  res.json({ ok: true });
});

// GTG schedule get/set
app.get('/api/gtg/schedule', (req, res) => res.json(gtgSchedule));
app.post('/api/gtg/schedule', (req, res) => {
  gtgSchedule = {...gtgSchedule, ...req.body};
  saveSchedule();
  res.json(gtgSchedule);
});

// GTG log a rep
app.post('/api/gtg/log', (req, res) => {
  const entry = {
    ...req.body,
    timestamp: new Date().toISOString()
  };
  gtgLog.push(entry);
  saveLog();
  res.json({ ok: true, total: gtgLog.length });
});

// GTG log get (last 100)
app.get('/api/gtg/log', (req, res) => {
  res.json(gtgLog.slice(-100).reverse());
});

// Send test notification
app.post('/api/gtg/test', async (req, res) => {
  const payload = JSON.stringify({
    title: '💪 GTG — Test',
    body: '1 traction — frais, forme parfaite',
    tag: 'gtg-test'
  });
  let sent = 0;
  for (const sub of subscriptions) {
    try { await webpush.sendNotification(sub, payload); sent++; } catch(e) {}
  }
  res.json({ sent });
});

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Ismuscle running on port ${PORT}`));
