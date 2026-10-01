// MODULE: Dependencies & Setup
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// MODULE: Admin Configuration
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin@2026';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'civic-admin-2026';

function requireAdminKey(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: missing or invalid admin API key.' });
  }
  next();
}

app.use(express.json());
app.use(express.static(__dirname));

// MODULE: File Paths
const USERS_FILE = path.join(__dirname, 'users.json');
const VOTES_FILE = path.join(__dirname, 'votes.json');
const ELECTION_FILE = path.join(__dirname, 'election.json');
const WHITELIST_FILE = path.join(__dirname, 'whitelist.json');

// MODULE: Data Storage Helpers
function loadJson(filePath, defaultData) {
  if (!fs.existsSync(filePath)) {
    saveJson(filePath, defaultData);
    return defaultData;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
    return defaultData;
  }
}

function saveJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Failed to write ${filePath}:`, err.message);
  }
}

// Memory Stores
let electionData = loadJson(ELECTION_FILE, {
  election: { name: '2026 Civic General Election', status: 'open', start: '', end: '', resultsAnnounced: false },
  candidates: []
});
let votes = loadJson(VOTES_FILE, []);
let whitelist = loadJson(WHITELIST_FILE, ["voter@example.com", "admin@example.com"]);
const otpStore = {};

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// MODULE: Frontend Routing
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// MODULE: Public Endpoints
app.get('/api/election', (req, res) => res.json({ ...electionData.election, candidates: electionData.candidates }));
app.get('/api/users', (req, res) => res.json(loadJson(USERS_FILE, []).map(({ password, ...user }) => user)));
app.get('/api/votes', (req, res) => res.json(votes));

// MODULE: Authentication & OTP Endpoints
app.post('/api/users/login', (req, res) => {
  const { id, password } = req.body;
  const users = loadJson(USERS_FILE, []);
  const user = users.find(u => u.id.toLowerCase() === id.toLowerCase());

  if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid Voter ID or password.' });
  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

// Request Registration OTP (Checks Whitelist Permission)
app.post('/api/users/request-reg-otp', (req, res) => {
  const { id, name, phone, email, password } = req.body;

  if (!whitelist.includes(email.toLowerCase())) {
    return res.status(403).json({ error: 'Permission Denied: This email is not authorized to register.' });
  }

  const users = loadJson(USERS_FILE, []);
  if (users.find(u => u.id.toLowerCase() === id.toLowerCase())) {
    return res.status(400).json({ error: 'Voter ID is already registered.' });
  }

  const otp = generateOTP();
  otpStore[id] = {
    otp,
    expiresAt: Date.now() + 15 * 60 * 1000,
    regData: { id, name, phone, email, password, hasVoted: false }
  };
  res.json({ success: true, otp });
});

app.post('/api/users/verify-reg-otp', (req, res) => {
  const { id, otp } = req.body;
  const record = otpStore[id];
  if (!record || record.otp !== otp || Date.now() > record.expiresAt) return res.status(400).json({ error: 'Invalid or expired OTP.' });

  const users = loadJson(USERS_FILE, []);
  users.push(record.regData);
  saveJson(USERS_FILE, users);
  delete otpStore[id];

  const { password, ...safeUser } = record.regData;
  res.json({ success: true, user: safeUser });
});

// Forgot Password OTP
app.post('/api/users/request-otp', (req, res) => {
  const { voterId } = req.body;
  const users = loadJson(USERS_FILE, []);
  const user = users.find(u => u.id.toLowerCase() === voterId.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Voter ID not found.' });

  const otp = generateOTP();
  otpStore[user.id] = { otp, expiresAt: Date.now() + 15 * 60 * 1000 };
  res.json({ success: true, otp, email: user.email });
});

app.post('/api/users/reset-with-otp', (req, res) => {
  const { voterId, otp, newPassword } = req.body;
  const record = otpStore[voterId];
  if (!record || record.otp !== otp || Date.now() > record.expiresAt) return res.status(400).json({ error: 'Invalid or expired OTP.' });

  const users = loadJson(USERS_FILE, []);
  const user = users.find(u => u.id.toLowerCase() === voterId.toLowerCase());
  user.password = newPassword;
  saveJson(USERS_FILE, users);
  delete otpStore[voterId];
  res.json({ success: true });
});

// Internal Password Change
app.post('/api/users/change-password', (req, res) => {
  const { voterId, currentPassword, newPassword } = req.body;
  const users = loadJson(USERS_FILE, []);
  const user = users.find(u => u.id === voterId);
  if (!user || user.password !== currentPassword) return res.status(401).json({ error: 'Incorrect current password.' });

  user.password = newPassword;
  saveJson(USERS_FILE, users);
  res.json({ success: true });
});

// MODULE: Voting Endpoints
app.post('/api/votes/cast', (req, res) => {
  const { voterId, candidateId, timestamp, hash } = req.body;
  if (electionData.election.resultsAnnounced || electionData.election.status !== 'open') return res.status(403).json({ error: 'Voting is closed.' });

  const users = loadJson(USERS_FILE, []);
  const voter = users.find(u => u.id === voterId);
  if (voter.hasVoted) return res.status(400).json({ error: 'Voter has already cast a ballot.' });

  voter.hasVoted = true;
  saveJson(USERS_FILE, users);
  votes.push({ voterId, candidateId, timestamp, hash });
  saveJson(VOTES_FILE, votes);
  res.json({ success: true });
});

app.post('/api/votes/revoke', (req, res) => {
  const { voterId } = req.body;
  if (electionData.election.resultsAnnounced || electionData.election.status !== 'open') return res.status(403).json({ error: 'Cannot revoke vote now.' });

  const users = loadJson(USERS_FILE, []);
  const voter = users.find(u => u.id === voterId);
  votes = votes.filter(v => v.voterId !== voterId);
  saveJson(VOTES_FILE, votes);
  voter.hasVoted = false;
  saveJson(USERS_FILE, users);
  res.json({ success: true });
});

// MODULE: Admin Endpoints
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) res.json({ success: true, apiKey: ADMIN_API_KEY });
  else res.status(401).json({ error: 'Invalid admin credentials.' });
});

app.post('/api/admin/election/settings', requireAdminKey, (req, res) => {
  electionData.election = { ...electionData.election, ...req.body };
  saveJson(ELECTION_FILE, electionData);
  res.json({ success: true });
});

app.post('/api/admin/election/announce', requireAdminKey, (req, res) => {
  electionData.election.resultsAnnounced = Boolean(req.body.announced);
  saveJson(ELECTION_FILE, electionData);
  res.json({ success: true });
});

app.post('/api/admin/candidates/add', requireAdminKey, (req, res) => {
  const newCandidate = { id: 'c' + Date.now(), name: req.body.name, party: req.body.party };
  electionData.candidates.push(newCandidate);
  saveJson(ELECTION_FILE, electionData);
  res.json({ success: true, candidate: newCandidate });
});

app.delete('/api/admin/candidates/:id', requireAdminKey, (req, res) => {
  electionData.candidates = electionData.candidates.filter(c => c.id !== req.params.id);
  saveJson(ELECTION_FILE, electionData);
  res.json({ success: true });
});

app.post('/api/admin/election/reset', requireAdminKey, (req, res) => {
  votes = [];
  saveJson(VOTES_FILE, votes);
  const users = loadJson(USERS_FILE, []);
  users.forEach(u => (u.hasVoted = false));
  saveJson(USERS_FILE, users);
  res.json({ success: true });
});

// Admin Whitelist Endpoints
app.get('/api/admin/whitelist', requireAdminKey, (req, res) => res.json(whitelist));

app.post('/api/admin/whitelist', requireAdminKey, (req, res) => {
  const { email } = req.body;
  if (email && !whitelist.includes(email.toLowerCase())) {
    whitelist.push(email.toLowerCase());
    saveJson(WHITELIST_FILE, whitelist);
  }
  res.json({ success: true, whitelist });
});

app.delete('/api/admin/whitelist/:email', requireAdminKey, (req, res) => {
  whitelist = whitelist.filter(e => e !== req.params.email.toLowerCase());
  saveJson(WHITELIST_FILE, whitelist);
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));