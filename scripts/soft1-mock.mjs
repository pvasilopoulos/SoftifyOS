// Local emulator of SoftOne Soft1 Web Services, for developing and testing Settings → ERP without a real Soft1.
//   node scripts/soft1-mock.mjs [port]          (default 5711; URL in Settings → ERP: http://127.0.0.1:5711)
//   user: demo / pass: demo / appId: 1001
// Implements login, authenticate, getBrowserInfo, getBrowserData, getData, setData, delData, getTableFields
// for the activities object SOACTION (field names and "code|name" lookups as a real Soft1) and the characterisation list ACTCHAR. Data lives in memory
// (GET /__state returns it, POST /__touch/<key> changes a record as if edited in Soft1).
import http from 'node:http';

const port = Number(process.argv[2] ?? 5711);
const pad = (n) => String(n).padStart(2, '0');
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const day = (offset, h = 10) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(h, 0, 0, 0); return d; };

let seq = 5000, fin = 8820;
const actions = new Map();
const add = (o) => { const id = String(++seq); actions.set(id, { SOACTION: id, UPDDATE: local(new Date()), INSDATE: local(new Date()), ...o }); return id; };
add({ SOACTIONCODE: `OFF000${fin++}`, SERIES: '7001|ΠΡΟ', TRNDATE: local(day(-2, 0)), FROMDATE: local(day(-2, 9)), FINALDATE: local(day(12, 18)), TRDR: '1001', TRDBRANCH: '9999',
  COMMENTS: 'Β1Β. ΧΡΗΣΙΜΗ (ΑΠΟΚΛΕΙΣΤΙΚΗ ΧΡΗΣΗ ΡΑΔΙΟΦΩΝΟΥ ή/και TV) // 446.4', REMARKS: 'ΠΡΟΚΕΙΤΑΙ ΓΙΑ ΚΑΦΕΝΕΙΟ ΣΤΟ ΔΙΔΥΜΟΤΕΙΧΟ, ΕΙΧΕ ΔΥΟ ΧΩΡΟΥΣ.',
  ACTSTATES: '122|Εκτελεσμένη', ACTSTATUS: '', PRIORITY: '2', ORDEREDBY: 'P01|Demo Χρήστης', ACTOR: 'P01|Demo Χρήστης' });
add({ SOACTIONCODE: 'ΣΥΝ0002925', SERIES: '7002|ΣΥΝ', TRNDATE: local(day(-10, 0)), FROMDATE: local(day(-10, 11)), FINALDATE: local(day(-10, 12)), TRDR: '1001', TRDBRANCH: '9999',
  COMMENTS: 'Ενημέρωση χρήστη', REMARKS: '', ACTSTATES: '', ACTSTATUS: '1', PRIORITY: '1', ORDEREDBY: 'P01|Demo Χρήστης', ACTOR: 'P02|Μαρία Κωνσταντίνου' });
add({ SOACTIONCODE: 'ΣΥΝ0002926', SERIES: '7002|ΣΥΝ', TRNDATE: local(day(3, 0)), FROMDATE: local(day(3, 10)), FINALDATE: local(day(3, 11)), TRDR: '9999999', TRDBRANCH: '',
  COMMENTS: 'Πελάτης που δεν υπάρχει στο SoftifyOS', REMARKS: '', ACTSTATES: '', ACTSTATUS: '', PRIORITY: '2', ORDEREDBY: '', ACTOR: '' });
const chars = [['101', 'Ενημέρωση πελάτη', 1], ['121', 'Προς εκτέλεση', 1], ['122', 'Εκτελεσμένη', 1], ['123', 'Σε αναστολή', 0], ['203', 'Σε εξέλιξη', 1]];
const FIELDS = ['SOACTION', 'SOACTIONCODE', 'SERIES', 'TRNDATE', 'FROMDATE', 'FINALDATE', 'TRDR', 'TRDBRANCH', 'COMMENTS', 'REMARKS', 'ACTSTATES', 'ACTSTATUS', 'PRIORITY', 'ORDEREDBY', 'ACTOR', 'UPDDATE', 'INSDATE'];

const sessions = new Set(), browsers = new Map();
let calls = [];

function filterRows(object, filters) {
  if (object === 'ACTCHAR') return chars.map(([c, n, a]) => ({ key: c, cols: [`ACTCHAR;${c}`, c, n, a], names: ['ZOOMINFO', 'ACTCHAR.CODE', 'ACTCHAR.NAME', 'ACTCHAR.ISACTIVE'] }));
  const f = Object.fromEntries(String(filters || '').split('&').filter(Boolean).map((p) => p.split('=')).map(([k, v]) => [k.replace(/^SOACTION\./, ''), v]));
  return [...actions.values()].filter((a) => {
    for (const [k, v] of Object.entries(f)) {
      if (k.endsWith('_TO')) { if (String(a[k.slice(0, -3)]).slice(0, 10) > v) return false; }
      else if (k === 'UPDDATE' || k === 'TRNDATE') { if (String(a[k]).slice(0, 10) < v) return false; }
      else if (String(a[k]) !== v) return false;
    }
    return true;
  }).map((a) => ({ key: a.SOACTION, cols: [`SOACTION;${a.SOACTION}`, a.SOACTIONCODE, a.TRNDATE, a.COMMENTS], names: ['ZOOMINFO', 'SOACTION.SOACTIONCODE', 'SOACTION.TRNDATE', 'SOACTION.COMMENTS'] }));
}

function handle(b) {
  const need = () => { if (!sessions.has(b.clientID)) throw new Error('Invalid clientID / session expired'); };
  switch (b.service) {
    case 'login':
      if (b.username !== 'demo' || b.password !== 'demo' || String(b.appId) !== '1001') return { success: false, error: 'Login failed: λάθος στοιχεία' };
      return { success: true, clientID: 'tmp-login', objs: [{ COMPANY: '1000', COMPANYNAME: 'Δοκιμαστική Εταιρεία', BRANCH: '1000', BRANCHNAME: 'Κεντρικό', MODULE: '0', REFID: '1', REFIDNAME: 'demo' }] };
    case 'authenticate': { const id = `cid-${Math.random().toString(36).slice(2)}`; sessions.add(id); return { success: true, clientID: id }; }
    case 'getBrowserInfo': {
      need();
      const rows = filterRows(b.OBJECT, b.FILTERS);
      const reqID = `req-${Math.random().toString(36).slice(2)}`;
      browsers.set(reqID, rows);
      return { success: true, reqID, totalcount: rows.length, fields: (rows[0]?.names ?? ['ZOOMINFO']).map((name) => ({ name })) };
    }
    case 'getBrowserData': {
      need();
      const rows = browsers.get(b.reqID) ?? [];
      return { success: true, rows: rows.slice(b.START, b.START + b.LIMIT).map((r) => r.cols) };
    }
    case 'getData': {
      need();
      const a = actions.get(String(b.KEY));
      if (!a) return { success: false, error: `Record ${b.KEY} not found` };
      return { success: true, data: { SOACTION: [{ ...a }] } };
    }
    case 'setData': {
      need();
      const row = b.DATA?.SOACTION?.[0] ?? {};
      for (const k of Object.keys(row)) if (!FIELDS.includes(k)) return { success: false, error: `Field ${k} does not exist in SOACTION` };
      if (b.KEY) {
        const a = actions.get(String(b.KEY));
        if (!a) return { success: false, error: `Record ${b.KEY} not found` };
        Object.assign(a, row, { UPDDATE: local(new Date()) });
        return { success: true, id: a.SOACTION };
      }
      if (!row.TRDR) return { success: false, error: 'Υποχρεωτικό πεδίο: Συναλλασσόμενος' };
      const prefix = String(row.SERIES).startsWith('7001') ? 'OFF' : 'ΣΥΝ';
      return { success: true, id: add({ SOACTIONCODE: `${prefix}000${fin++}`, ...row }) };
    }
    case 'delData':
      need();
      if (!actions.delete(String(b.KEY))) return { success: false, error: `Record ${b.KEY} not found` };
      return { success: true };
    case 'getTableFields':
      need();
      return { success: true, fields: FIELDS.map((name) => ({ name, alias: name, datatype: /DATE/.test(name) ? 'DateTime' : 'String' })) };
    default:
      return { success: false, error: `Unknown service ${b.service}` };
  }
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    if (req.method === 'GET' && req.url === '/__state') return res.end(JSON.stringify({ actions: [...actions.values()], calls }));
    const touch = req.url?.match(/^\/__touch\/(\d+)$/);
    if (touch) {
      const a = actions.get(touch[1]);
      if (a) Object.assign(a, JSON.parse(body || '{}'), { UPDDATE: local(new Date(Date.now() + 1000)) });
      return res.end(JSON.stringify({ ok: !!a }));
    }
    try {
      const b = JSON.parse(body || '{}');
      calls.push(b.service); calls = calls.slice(-200);
      res.end(JSON.stringify(handle(b)));
    } catch (e) { res.end(JSON.stringify({ success: false, error: e.message })); }
  });
}).listen(port, '127.0.0.1', () => console.log(`Soft1 mock on http://127.0.0.1:${port} (demo / demo / appId 1001)`));
