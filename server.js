require('dotenv').config();
const express = require('express'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const Database = require('better-sqlite3'), multer = require('multer'), nodemailer = require('nodemailer');
const cron = require('node-cron'), Razorpay = require('razorpay'), T = require('./templates');

const E = process.env, BASE = E.BASE_URL || 'http://localhost:3000', ADMIN = E.ADMIN_PASSWORD || 'admin';
const LIVE = !!(E.RAZORPAY_KEY_ID && E.RAZORPAY_KEY_SECRET); // no keys = demo payments
const rp = LIVE ? new Razorpay({ key_id: E.RAZORPAY_KEY_ID, key_secret: E.RAZORPAY_KEY_SECRET }) : null;
const mailer = E.SMTP_HOST ? nodemailer.createTransport({ host: E.SMTP_HOST, port: +(E.SMTP_PORT || 587), auth: { user: E.SMTP_USER, pass: E.SMTP_PASS } }) : null;

fs.mkdirSync('data/uploads', { recursive: true });
const db = new Database('data/app.db');
db.exec(`
CREATE TABLE IF NOT EXISTS event(id INTEGER PRIMARY KEY CHECK(id=1),name,tagline,description,day,t_start,t_end,venue,address,price INTEGER,banner,visibility,capacity INTEGER);
CREATE TABLE IF NOT EXISTS speakers(id INTEGER PRIMARY KEY,name,role,talk,photo,linkedin);
CREATE TABLE IF NOT EXISTS regs(id INTEGER PRIMARY KEY,name,email,company,status,order_id,payment_id,refund_id,created_at DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS queue(id INTEGER PRIMARY KEY,reg_id INTEGER,kind,to_email,subject,body,send_at,sent_at);`);
if (!db.prepare('SELECT 1 FROM event').get())
  db.prepare('INSERT INTO event VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    'Bengaluru Product Summit 2026', 'A one-day conference on building products people love.',
    'Talks, workshops and long coffee breaks for product people.\n\nExpect practical sessions, no fluff.',
    '2026-12-05', '10:00', '17:30', 'Taj Yeshwantpur', '2275, Tumkur Rd, Yeshwantpur, Bengaluru 560022', 149900, '', 'masked', 300);

// ---------- helpers ----------
const ev = () => db.prepare('SELECT * FROM event WHERE id=1').get();
const speakers = () => db.prepare('SELECT * FROM speakers ORDER BY id').all();
const safe = u => (/^(https?:\/\/|\/uploads\/)/.test(u || '') ? u : ''); // blocks javascript: URLs
const startAt = e => new Date(`${e.day}T${e.t_start}:00+05:30`), endAt = e => new Date(`${e.day}T${e.t_end}:00+05:30`);
const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const place = e => `${e.venue}, ${e.address}`;
const calUrl = e => 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(e.name) +
  '&dates=' + stamp(startAt(e)) + '/' + stamp(endAt(e)) + '&location=' + encodeURIComponent(place(e));
const mask = n => n.split(/\s+/).map(w => w[0] + '•'.repeat(Math.max(w.length - 1, 2))).join(' ');

function ctx(r, extra = {}) {
  const e = ev();
  return {
    name: r.name.split(' ')[0], event: e.name, paymentId: r.payment_id || '',
    date: startAt(e).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }),
    time: `${e.t_start}–${e.t_end} IST`, venue: place(e), page: BASE, ics: BASE + '/api/ics', cal: calUrl(e),
    map: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place(e)),
    price: '₹' + e.price / 100, receipt: String(r.id).padStart(5, '0'),
    speakers: speakers().map(s => `• ${s.name} – ${s.talk}`).join('\n'), ...extra
  };
}
function enqueue(r, kind, when = new Date(), extra) {
  const t = T.emails[kind], c = ctx(r, extra);
  db.prepare('INSERT INTO queue(reg_id,kind,to_email,subject,body,send_at) VALUES(?,?,?,?,?,?)')
    .run(r.id, kind, r.email, T.merge(t.subject, c), T.merge(t.body, c), when.toISOString());
}
async function flush() { // sends everything that is due; prints to console when SMTP isn't configured
  const due = db.prepare('SELECT * FROM queue WHERE sent_at IS NULL AND send_at<=?').all(new Date().toISOString());
  for (const m of due) {
    try {
      if (mailer) await mailer.sendMail({ from: E.MAIL_FROM || 'EventDesk <no-reply@example.com>', to: m.to_email, subject: m.subject, text: m.body });
      else console.log(`\n[MAIL -> ${m.to_email}] ${m.subject}\n${m.body}\n`);
      db.prepare('UPDATE queue SET sent_at=? WHERE id=?').run(new Date().toISOString(), m.id);
    } catch (err) { console.error('mail failed', m.id, err.message); }
  }
}
cron.schedule('* * * * *', flush);

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('data/uploads'));
const upload = multer({
  storage: multer.diskStorage({ destination: 'data/uploads', filename: (q, f, cb) => cb(null, crypto.randomUUID() + path.extname(f.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')) }),
  limits: { fileSize: 5e6 }, fileFilter: (q, f, cb) => cb(null, /^image\/(png|jpe?g|webp|gif)$/.test(f.mimetype))
});

app.get('/api/event', (q, s) => {
  const e = ev(), v = e.visibility, acc = db.prepare("SELECT name,company FROM regs WHERE status='accepted' ORDER BY id").all();
  const attendees = v === 'public' ? acc : v === 'masked' ? acc.map(a => ({ name: mask(a.name), company: a.company ? mask(a.company) : '' })) : [];
  s.json({ event: e, speakers: speakers(), attendees, acceptedCount: v === 'hidden' ? null : acc.length });
});

app.post('/api/register', async (q, s) => {
  try {
    const n = (q.body.name || '').trim().slice(0, 80), m = (q.body.email || '').trim().toLowerCase().slice(0, 120), c = (q.body.company || '').trim().slice(0, 80);
    if (!n || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)) return s.status(400).json({ error: 'Enter a name and a valid email.' });
    const e = ev();
    if (db.prepare("SELECT COUNT(*) n FROM regs WHERE status IN('accepted','pending_review')").get().n >= e.capacity) return s.status(409).json({ error: 'This event is sold out.' });
    if (db.prepare("SELECT 1 FROM regs WHERE email=? AND status IN('accepted','pending_review')").get(m)) return s.status(409).json({ error: 'This email is already registered.' });
    const id = db.prepare("INSERT INTO regs(name,email,company,status) VALUES(?,?,?,'unpaid')").run(n, m, c).lastInsertRowid;
    const order = LIVE ? await rp.orders.create({ amount: e.price, currency: 'INR', receipt: 'reg_' + id }) : { id: 'order_demo_' + id };
    db.prepare('UPDATE regs SET order_id=? WHERE id=?').run(order.id, id);
    s.json({ regId: id, orderId: order.id, amount: e.price, keyId: E.RAZORPAY_KEY_ID || null, demo: !LIVE, name: n, email: m, eventName: e.name });
  } catch (err) { console.error(err); s.status(500).json({ error: 'Could not start payment. Try again.' }); }
});

app.post('/api/verify', (q, s) => {
  const { regId, razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: g } = q.body;
  const r = db.prepare("SELECT * FROM regs WHERE id=? AND status='unpaid'").get(regId);
  if (!r || r.order_id !== o) return s.status(400).json({ error: 'Unknown order' });
  if (LIVE) {
    const x = crypto.createHmac('sha256', E.RAZORPAY_KEY_SECRET).update(o + '|' + p).digest('hex');
    if (g !== x) return s.status(400).json({ error: 'Bad signature' });
  }
  const pid = p || 'pay_demo_' + regId;
  db.prepare("UPDATE regs SET status='pending_review',payment_id=? WHERE id=?").run(pid, regId);
  enqueue({ ...r, payment_id: pid }, 'received'); flush();
  s.json({ ok: true });
});

app.get('/api/ics', (q, s) => {
  const e = ev();
  s.type('text/calendar').send(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EventDesk//EN', 'BEGIN:VEVENT',
    'UID:' + stamp(startAt(e)) + '@eventdesk', 'DTSTAMP:' + stamp(new Date()), 'DTSTART:' + stamp(startAt(e)), 'DTEND:' + stamp(endAt(e)),
    'SUMMARY:' + e.name, 'LOCATION:' + place(e).replace(/,/g, '\\,'),
    'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:Tomorrow: ' + e.name, 'END:VALARM',
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Starting in 1 hour', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
});

// ---------- admin ----------
const h = x => crypto.createHash('sha256').update(x || '').digest();
app.use('/api/admin', (q, s, n) => (crypto.timingSafeEqual(h(q.get('x-admin-password')), h(ADMIN)) ? n() : s.status(401).json({ error: 'Unauthorized' })));

app.get('/api/admin/data', (q, s) => s.json({ event: ev(), speakers: speakers(), regs: db.prepare("SELECT * FROM regs WHERE status!='unpaid' ORDER BY id DESC").all() }));

app.post('/api/admin/upload', upload.single('file'), (q, s) =>
  q.file ? s.json({ url: '/uploads/' + q.file.filename }) : s.status(400).json({ error: 'Upload a png, jpg, webp or gif under 5 MB.' }));

app.put('/api/admin/event', (q, s) => {
  const b = q.body;
  db.prepare('UPDATE event SET name=?,tagline=?,description=?,day=?,t_start=?,t_end=?,venue=?,address=?,price=?,banner=?,visibility=?,capacity=? WHERE id=1')
    .run(b.name, b.tagline, b.description, b.day, b.t_start, b.t_end, b.venue, b.address, Math.round(+b.price) || 0, safe(b.banner),
      ['public', 'masked', 'count', 'hidden'].includes(b.visibility) ? b.visibility : 'masked', +b.capacity || 0);
  s.json({ ok: true });
});

app.put('/api/admin/speakers', (q, s) => {
  db.transaction(list => {
    db.prepare('DELETE FROM speakers').run();
    for (const x of list) db.prepare('INSERT INTO speakers(name,role,talk,photo,linkedin) VALUES(?,?,?,?,?)').run(x.name || '', x.role || '', x.talk || '', safe(x.photo), safe(x.linkedin));
  })(Array.isArray(q.body) ? q.body : []);
  s.json({ ok: true });
});

app.post('/api/admin/regs/:id/decision', async (q, s) => {
  const r = db.prepare("SELECT * FROM regs WHERE id=? AND status='pending_review'").get(q.params.id);
  if (!r) return s.status(404).json({ error: 'This registration is not awaiting review.' });
  const e = ev();
  if (q.body.decision === 'accepted') {
    db.prepare("UPDATE regs SET status='accepted' WHERE id=?").run(r.id);
    enqueue(r, 'accepted');
    for (const [kind, min] of T.cadence) { const t = new Date(startAt(e) - min * 6e4); if (t > Date.now()) enqueue(r, kind, t); }
  } else if (q.body.decision === 'declined') {
    let note = 'Refund initiated; expect it in 5–7 working days.', rid = 'rfnd_demo';
    try { if (LIVE && r.payment_id) rid = (await rp.payments.refund(r.payment_id, { speed: 'normal' })).id; }
    catch (err) { console.error(err); rid = null; note = "We couldn't auto-refund; we'll process it manually within 48 hours."; }
    db.prepare("UPDATE regs SET status='declined',refund_id=? WHERE id=?").run(rid, r.id);
    enqueue(r, 'declined', new Date(), { joke: T.jokes[Math.floor(Math.random() * T.jokes.length)], refundNote: note });
  } else return s.status(400).json({ error: 'Decision must be accepted or declined.' });
  flush(); s.json({ ok: true });
});

app.listen(E.PORT || 3000, () => console.log(`EventDesk on ${BASE} | payments: ${LIVE ? 'Razorpay LIVE keys' : 'DEMO mode'} | mail: ${mailer ? 'SMTP' : 'console'} | admin: ${BASE}/#admin`));
