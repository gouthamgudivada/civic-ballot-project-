// MODULE: Initial Config & State
const PUBLIC_KEY = "8lvSUqSABNcl9lxOb";
const SERVICE_ID = "service_07wztv3";
const TEMPLATE_ID = "template_arn9sqm";

emailjs.init({ publicKey: PUBLIC_KEY });

const state = {
  election: { name: "", status: "open", start: "", end: "", resultsAnnounced: false },
  candidates: [],
  voters: [],
  votes: [],
  whitelist: [],
  auditLog: [],
  currentVoter: null,
  currentAdmin: false,
  adminKey: null,
  selectedCandidate: null,
  lastReceipt: null,
  pendingReg: null
};

// MODULE: Utilities
function adminHeaders() {
  return { 'Content-Type': 'application/json', 'x-admin-key': state.adminKey || '' };
}

async function parseJsonSafe(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toastText').textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// MODULE: Data Fetching
async function syncAllData() {
  const resE = await fetch('/api/election');
  const dataE = await parseJsonSafe(resE);
  state.election = { name: dataE.name, status: dataE.status, start: dataE.start, end: dataE.end, resultsAnnounced: !!dataE.resultsAnnounced };
  state.candidates = dataE.candidates || [];

  const resU = await fetch('/api/users');
  state.voters = await parseJsonSafe(resU);

  const resV = await fetch('/api/votes');
  state.votes = await parseJsonSafe(resV);

  if (state.currentAdmin) {
    const resW = await fetch('/api/admin/whitelist', { headers: adminHeaders() });
    state.whitelist = await parseJsonSafe(resW);
  }

  updateStatusBadge();
}

async function logAudit(action) {
  const prevHash = state.auditLog.length ? state.auditLog[state.auditLog.length - 1].hash : "GENESIS";
  const time = new Date().toISOString();
  const hash = await sha256(prevHash + "|" + action + "|" + time);
  state.auditLog.push({ time, action, hash });
  if (document.getElementById('adminAudit').classList.contains('active')) renderAuditTrail();
}

// MODULE: Navigation & Auth UI
function switchLoginTab(which) {
  document.querySelectorAll('.role-tabs button').forEach(b => b.classList.remove('active'));
  document.getElementById(which === 'voter' ? 'tabVoter' : which === 'register' ? 'tabRegister' : 'tabAdmin').classList.add('active');

  document.getElementById('voterLoginForm').style.display = which === 'voter' ? 'block' : 'none';
  document.getElementById('userRegisterForm').style.display = which === 'register' ? 'block' : 'none';
  document.getElementById('adminLoginForm').style.display = which === 'admin' ? 'block' : 'none';
  document.getElementById('forgotPasswordForm').style.display = 'none';
  document.getElementById('loginError').style.display = 'none';

  if (which === 'register') backToRegStep1();
}

function toggleForgotPassword(show) {
  document.getElementById('voterLoginForm').style.display = show ? 'none' : 'block';
  document.getElementById('forgotPasswordForm').style.display = show ? 'block' : 'none';
  document.getElementById('loginError').style.display = 'none';
}

function showError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.style.display = 'block';
}

// MODULE: Authentication Logic
async function loginVoter() {
  document.getElementById('loginError').style.display = 'none';
  const id = document.getElementById('voterIdInput').value.trim();
  const pass = document.getElementById('voterPassInput').value;

  if (!id || !pass) return showError("Please enter Voter ID and Password.");

  const res = await fetch('/api/users/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, password: pass })
  });

  if (res.ok) {
    const data = await parseJsonSafe(res);
    state.currentVoter = data.user;
    await syncAllData();
    enterApp('voter');
  } else {
    const err = await parseJsonSafe(res);
    showError(err.error || "Invalid Voter ID or password.");
  }
}

async function requestRegistrationOTP() {
  const name = document.getElementById('regFullName').value.trim();
  const phone = document.getElementById('regPhone').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const id = document.getElementById('regVoterId').value.trim();
  const password = document.getElementById('regPassword').value;

  if (!name || !phone || !email || !id || !password) return showError('All fields are required.');

  const res = await fetch('/api/users/request-reg-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name, phone, email, password })
  });
  const data = await parseJsonSafe(res);

  if (res.ok) {
    state.pendingReg = { id, email };
    emailjs.send(SERVICE_ID, TEMPLATE_ID, { to_email: email, passcode: data.otp })
      .then(() => {
        showToast(`OTP sent to ${email}`);
        document.getElementById('regStep1').style.display = 'none';
        document.getElementById('regStep2').style.display = 'block';
      })
      .catch(() => {
        // Fallback if EmailJS fails in demo
        showToast(`Verification OTP: ${data.otp}`);
        document.getElementById('regStep1').style.display = 'none';
        document.getElementById('regStep2').style.display = 'block';
      });
  } else {
    showError(data.error || 'Registration failed.');
  }
}

async function verifyOTPAndRegister() {
  const otp = document.getElementById('regOtpInput').value.trim();
  if (!otp) return showError('Enter OTP');

  const res = await fetch('/api/users/verify-reg-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: state.pendingReg.id, otp })
  });

  if (res.ok) {
    const data = await parseJsonSafe(res);
    state.currentVoter = data.user;
    await syncAllData();
    showToast('Registration successful!');
    enterApp('voter');
  } else {
    const err = await parseJsonSafe(res);
    showError(err.error || 'Invalid OTP');
  }
}

function backToRegStep1() {
  document.getElementById('regStep1').style.display = 'block';
  document.getElementById('regStep2').style.display = 'none';
}

// Forgot Password Flow
async function sendOTPUI() {
  const voterId = document.getElementById('resetVoterIdInput').value.trim();
  if (!voterId) return showError('Enter Voter ID');

  const res = await fetch('/api/users/request-otp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voterId })
  });
  const data = await parseJsonSafe(res);

  if (res.ok) {
    emailjs.send(SERVICE_ID, TEMPLATE_ID, { to_email: data.email, passcode: data.otp })
      .then(() => showToast(`OTP sent to your email`))
      .catch(() => showToast(`OTP generated: ${data.otp}`));
  } else {
    showError(data.error || 'Failed to request OTP');
  }
}

async function resetWithOTPUI() {
  const voterId = document.getElementById('resetVoterIdInput').value.trim();
  const otp = document.getElementById('otpCodeInput').value.trim();
  const newPassword = document.getElementById('otpNewPassInput').value.trim();

  const res = await fetch('/api/users/reset-with-otp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voterId, otp, newPassword })
  });

  if (res.ok) {
    showToast('Password reset! Please log in.');
    toggleForgotPassword(false);
  } else {
    const err = await parseJsonSafe(res);
    showError(err.error || 'Reset failed.');
  }
}

async function loginAdmin() {
  const username = document.getElementById('adminIdInput').value.trim();
  const password = document.getElementById('adminPassInput').value;

  const res = await fetch('/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  if (res.ok) {
    const data = await parseJsonSafe(res);
    state.currentAdmin = true;
    state.adminKey = data.apiKey;
    await syncAllData();
    enterApp('admin');
  } else {
    showError('Invalid Admin Credentials');
  }
}

// MODULE: Dashboard Core
function enterApp(role) {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('landing').style.display = 'none';
  document.getElementById('masthead').style.display = 'flex';
  document.getElementById('electionTitle').textContent = state.election.name || 'Civic Ballot';

  if (role === 'voter') {
    document.getElementById('sessionUser').textContent = state.currentVoter.name;
    document.getElementById('voterShell').classList.add('active');
    showVoterView('voterBallot');
  } else {
    document.getElementById('sessionUser').textContent = 'Administrator';
    document.getElementById('adminShell').classList.add('active');
    document.getElementById('electionNameInput').value = state.election.name;
    document.getElementById('electionStatusInput').value = state.election.status;
    showAdminView('adminSchedule');
  }
}

function updateStatusBadge() {
  const b = document.getElementById('electionStatusBadge');
  b.textContent = state.election.resultsAnnounced ? 'Ended' : state.election.status === 'open' ? 'Polls Open' : 'Polls Closed';
  b.className = 'badge ' + (state.election.resultsAnnounced ? 'closed' : state.election.status === 'open' ? 'open' : 'closed');
}

function logout() {
  state.currentVoter = null;
  state.currentAdmin = false;
  state.adminKey = null;
  document.getElementById('voterShell').classList.remove('active');
  document.getElementById('adminShell').classList.remove('active');
  document.getElementById('masthead').style.display = 'none';
  goHome();
}

// MODULE: Voter Views & Logic
function showVoterView(id) {
  document.querySelectorAll('#voterShell .view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('#voterShell .nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === id));

  if (id === 'voterBallot') renderBallot();
  if (id === 'voterReceipt') renderReceipt();
  if (id === 'voterResults') renderResults('voterResultsWrap');
}

function renderBallot() {
  const wrap = document.getElementById('ballotPanelWrap');
  if (state.election.resultsAnnounced) return wrap.innerHTML = `<p class="hint-box">Election has ended. Results are live.</p>`;
  if (state.election.status !== 'open') return wrap.innerHTML = `<p class="hint-box">Polls are closed.</p>`;
  if (state.currentVoter.hasVoted) return wrap.innerHTML = `<p class="hint-box">You have cast your vote.</p><button class="btn btn-ghost" onclick="revokeVote()">Remove vote and recast</button>`;

  const html = state.candidates.map((c, i) => `
    <div class="candidate-row ${state.selectedCandidate === c.id ? 'selected' : ''}" style="--i:${i}" onclick="state.selectedCandidate='${c.id}'; renderBallot()">
      <div class="avatar" style="--i:${i}">${c.name.charAt(0).toUpperCase()}</div>
      <div><strong>${c.name}</strong><div style="color:var(--text-muted); font-size:13px;">${c.party}</div></div>
      <div class="oval"></div>
    </div>
  `).join('');
  wrap.innerHTML = html + `<button class="btn btn-primary" style="margin-top:16px" ${!state.selectedCandidate ? 'disabled' : ''} onclick="submitBallot()">Submit vote</button>`;
}

async function submitBallot() {
  if (!state.selectedCandidate) return;
  const hash = await sha256(state.selectedCandidate + state.currentVoter.id + Date.now());

  const res = await fetch('/api/votes/cast', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voterId: state.currentVoter.id, candidateId: state.selectedCandidate, timestamp: new Date().toISOString(), hash })
  });

  if (res.ok) {
    state.currentVoter.hasVoted = true;
    state.lastReceipt = hash;
    await syncAllData();
    showToast('Vote Submitted Successfully');
    burst();
    showVoterView('voterReceipt');
  }
}

async function revokeVote() {
  const res = await fetch('/api/votes/revoke', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voterId: state.currentVoter.id })
  });
  if (res.ok) {
    state.currentVoter.hasVoted = false;
    showToast('Vote Removed. You may recast.');
    showVoterView('voterBallot');
  }
}

function renderReceipt() {
  const wrap = document.getElementById('receiptPanelWrap');
  if (!state.currentVoter.hasVoted) return wrap.innerHTML = `<p class="hint-box">No active vote found. Cast your ballot to get a receipt.</p>`;
  wrap.innerHTML = `
    <div class="receipt">
      <svg viewBox="0 0 60 60" class="tick" style="fill:none;stroke-linecap:round;stroke-linejoin:round"><circle cx="30" cy="30" r="24" stroke-width="3"/><path d="M19 31l8 8 15-17" stroke="var(--success)" stroke-width="5"/></svg>
      <h3>Vote sealed</h3>
      <p style="color:var(--text-muted);margin:6px 0 0">Receipt hash</p>
      <span class="receipt-hash mono">${state.lastReceipt || 'VERIFIED_IN_LEDGER'}</span>
    </div>
  `;
}

function renderResults(targetId) {
  const wrap = document.getElementById(targetId);
  const total = state.votes.length;
  const counts = state.candidates.map(c => state.votes.filter(v => v.candidateId === c.id).length);
  const top = Math.max(0, ...counts);
  wrap.innerHTML = state.candidates.map((c, i) => {
    const pct = total ? Math.round((counts[i] / total) * 100) : 0;
    return `<div class="result-row" style="--i:${i}">
      <div class="avatar" style="--i:${i}">${c.name.charAt(0).toUpperCase()}</div>
      <div class="result-body">
        <div class="result-top"><strong>${c.name}</strong><span>${counts[i]} votes (${pct}%)</span></div>
        <div class="bar-track"><div class="bar-fill ${counts[i] && counts[i] === top ? 'lead' : ''}" style="--w:${pct}%"></div></div>
      </div>
    </div>`;
  }).join('') || '<p class="hint-box">No data yet.</p>';
}

async function changeVoterPassword() {
  const currentPassword = document.getElementById('voterCurrentPassInput').value;
  const newPassword = document.getElementById('voterNewPassInput').value;
  const res = await fetch('/api/users/change-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voterId: state.currentVoter.id, currentPassword, newPassword })
  });
  if (res.ok) showToast('Password updated.');
  else showToast('Incorrect current password.');
}

// MODULE: Admin Views & Logic
function showAdminView(id) {
  document.querySelectorAll('#adminShell .view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('#adminShell .nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === id));

  if (id === 'adminSchedule') renderCandidateListAdmin();
  if (id === 'adminWhitelist') renderWhitelistTable();
  if (id === 'adminResults') {
    renderResults('adminResultsWrap');
    document.getElementById('adminResultsWrap').innerHTML += `
      <hr style="margin:20px 0; border-top:1px solid var(--border)">
      <div style="display:flex; gap:10px;">
        <button class="btn btn-ghost" onclick="toggleAnnounceResults()">${state.election.resultsAnnounced ? 'Hide Results' : 'Publish Results'}</button>
        <button class="btn btn-primary" style="background:var(--danger)" onclick="resetElection()">Reset All Votes</button>
      </div>
    `;
  }
}

async function saveElectionSettings() {
  const name = document.getElementById('electionNameInput').value;
  const status = document.getElementById('electionStatusInput').value;
  const res = await fetch('/api/admin/election/settings', {
    method: 'POST', headers: adminHeaders(), body: JSON.stringify({ name, status })
  });
  if (res.ok) {
    await syncAllData();
    logAudit(`Updated election to ${status}`);
    showToast('Settings saved.');
  }
}

async function addCandidate() {
  const name = document.getElementById('newCandidateName').value;
  const party = document.getElementById('newCandidateParty').value;
  const res = await fetch('/api/admin/candidates/add', {
    method: 'POST', headers: adminHeaders(), body: JSON.stringify({ name, party })
  });
  if (res.ok) {
    await syncAllData();
    renderCandidateListAdmin();
    showToast('Candidate added.');
  }
}

async function deleteCandidate(id) {
  const res = await fetch(`/api/admin/candidates/${id}`, { method: 'DELETE', headers: adminHeaders() });
  if (res.ok) {
    await syncAllData();
    renderCandidateListAdmin();
    showToast('Candidate removed.');
  }
}

function renderCandidateListAdmin() {
  const wrap = document.getElementById('candidateListAdmin');
  wrap.innerHTML = state.candidates.map(c => `
    <div style="display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border)">
      <span>${c.name} (${c.party})</span>
      <button class="link-btn" style="color:var(--danger)" onclick="deleteCandidate('${c.id}')">Remove</button>
    </div>
  `).join('');
}

// Admin Whitelist Features
function renderWhitelistTable() {
  const tbody = document.getElementById('whitelistTableBody');
  if (state.whitelist.length === 0) {
    tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:var(--text-muted);">No emails whitelisted. System allows none.</td></tr>`;
    return;
  }
  tbody.innerHTML = state.whitelist.map(email => `
    <tr>
      <td>${email}</td>
      <td><button class="btn btn-ghost" style="padding:4px 8px; font-size:12px; color:var(--danger);" onclick="removeEmailFromWhitelist('${email}')">Revoke</button></td>
    </tr>
  `).join('');
}

async function addEmailToWhitelist() {
  const email = document.getElementById('newWhitelistEmail').value.trim();
  if (!email) return;
  const res = await fetch('/api/admin/whitelist', {
    method: 'POST', headers: adminHeaders(), body: JSON.stringify({ email })
  });
  if (res.ok) {
    document.getElementById('newWhitelistEmail').value = '';
    await syncAllData();
    renderWhitelistTable();
    showToast('Email authorized for registration.');
  }
}

async function removeEmailFromWhitelist(email) {
  const res = await fetch(`/api/admin/whitelist/${email}`, { method: 'DELETE', headers: adminHeaders() });
  if (res.ok) {
    await syncAllData();
    renderWhitelistTable();
    showToast('Email permission revoked.');
  }
}

async function toggleAnnounceResults() {
  const announced = !state.election.resultsAnnounced;
  const res = await fetch('/api/admin/election/announce', {
    method: 'POST', headers: adminHeaders(), body: JSON.stringify({ announced })
  });
  if (res.ok) { await syncAllData(); showAdminView('adminResults'); showToast('Toggled visibility'); }
}

async function resetElection() {
  if (!confirm("Clear all votes?")) return;
  const res = await fetch('/api/admin/election/reset', { method: 'POST', headers: adminHeaders() });
  if (res.ok) { await syncAllData(); showAdminView('adminResults'); showToast('Election reset.'); }
}

function renderAuditTrail() {
  document.getElementById('auditTrailWrap').innerHTML = state.auditLog.slice().reverse().map(l => `
    <div style="padding:10px 0; border-bottom:1px solid var(--border)">
      <div style="font-size:12px; color:var(--text-muted)">${new Date(l.time).toLocaleTimeString()}</div>
      <div style="font-size:14px; margin-top:4px">${l.action}</div>
    </div>
  `).join('');
} 