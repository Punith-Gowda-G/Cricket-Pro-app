let runData = [0];
let overLabels = ['0.0'];
let perOverData = []; // for bar chart
let chartInstance = null;
let barChartInstance = null;
let lastWkt = '—';
let currentLineup = Array.from({length: 11}, (_, i) => `Player ${i + 1}`);

// ─── Lineup ───────────────────────────────────────────
function buildLineupInputs() {
  const container = document.getElementById('player-inputs');
  container.innerHTML = currentLineup.map((name, i) => `
    <div style="display:flex; align-items:center; gap:6px;">
      <span style="color:var(--muted); font-size:.7rem; font-family:'Roboto Mono',monospace; min-width:18px;">${i + 1}.</span>
      <input
        id="p-name-${i}"
        class="toss-input"
        style="padding:8px 10px; font-size:.82rem;"
        placeholder="Player ${i + 1}"
        value="${name}"
        maxlength="25"
      >
    </div>
  `).join('');
}

function toggleLineup() {
  const body = document.getElementById('lineup-body');
  const icon = document.getElementById('lineup-toggle-icon');
  const open = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  icon.textContent = open ? '▲ Hide' : '▼ Show';
  if (open) buildLineupInputs();
}

function setLineup() {
  const names = Array.from({length: 11}, (_, i) => {
    const el = document.getElementById(`p-name-${i}`);
    return (el && el.value.trim()) ? el.value.trim() : `Player ${i + 1}`;
  });
  currentLineup = names;

  fetch('/set_players', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player_names: names })
  })
    .then(r => r.json())
    .then(data => {
      const st = document.getElementById('lineup-status');
      st.textContent = '✅ Lineup set! Players will appear in batting order.';
      setTimeout(() => st.textContent = '', 3000);
      updateUI(data);
    });
}

// ─── Helpers ──────────────────────────────────────────
function srClass(sr) {
  if (sr >= 150) return 'high';
  if (sr >= 100) return 'med';
  return 'low';
}

function calcSR(runs, balls) {
  if (balls === 0) return '0.0';
  return (runs / balls * 100).toFixed(1);
}

function showTab(id) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  
  document.getElementById(`tab-${id}`).classList.add('active');
  document.querySelector(`.tab-btn[onclick="showTab('${id}')"]`).classList.add('active');
  
  if (id === 'graphs') {
    setTimeout(() => { drawChart(); drawBarChart(); }, 100);
  }
}

// ─── API Actions ──────────────────────────────────────
async function sendAction(action, value = 0) {
  const res = await fetch('/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, value })
  });
  const data = await res.json();
  if (action === 'wicket') {
    const prevStriker = data.striker === 'batsman1' ? 'batsman2' : 'batsman1';
    lastWkt = data[prevStriker] ? data[prevStriker].name : '—';
  }
  updateUI(data);
}

function addRun(run)  { sendAction('run', run); }
function addWicket()  { sendAction('wicket'); }
function addExtra(type) { sendAction('extra', type); }

function switchStriker() {
  fetch('/switch_striker', { method: 'POST' })
    .then(r => r.json())
    .then(updateUI);
}

function saveMatch() {
  fetch('/save', { method: 'POST' })
    .then(r => r.json())
    .then(() => {
      const btn = document.querySelector('.btn.save');
      const orig = btn.innerHTML;
      btn.innerHTML = '✅ Saved!';
      setTimeout(() => btn.innerHTML = orig, 1500);
    });
}

function resetMatch() {
  if (!confirm('Reset all match data?')) return;
  const t1 = document.getElementById('team1-in').value || 'Team Alpha';
  const t2 = document.getElementById('team2-in').value || 'Team Beta';
  fetch('/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ team1: t1, team2: t2, player_names: currentLineup })
  })
    .then(r => r.json())
    .then(data => {
      runData = [0]; overLabels = ['0.0']; perOverData = []; lastWkt = '—';
      updateUI(data);
      if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
      if (barChartInstance) { barChartInstance.destroy(); barChartInstance = null; }
      drawChart(); drawBarChart();
      document.getElementById('history-wrap').style.display = 'none';
    });
}

function startSecondInnings() {
  fetch('/start_2nd_innings', { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      runData = [0]; overLabels = ['0.0']; perOverData = [];
      updateUI(data);
      if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
      if (barChartInstance) { barChartInstance.destroy(); barChartInstance = null; }
      drawChart(); drawBarChart();
    });
}

function loadHistory() {
  fetch('/history')
    .then(r => r.json())
    .then(data => {
      const wrap = document.getElementById('history-wrap');
      const list = document.getElementById('history-list');
      if (!data.length) {
        list.innerHTML = '<div style="color:var(--muted);font-size:.85rem;">No matches saved yet.</div>';
      } else {
        list.innerHTML = data.map(m => `
          <div class="history-item">
            <span class="history-score">${m[1]}</span>
            <span class="history-meta">Overs: ${m[2]} &nbsp;|&nbsp; RR: ${m[3]}</span>
          </div>`).join('');
      }
      wrap.style.display = 'block';
      wrap.scrollIntoView({ behavior: 'smooth' });
    });
}

function setOvers(num) {
  fetch('/set_overs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_overs: num })
  })
    .then(r => r.json())
    .then(data => {
      updateUI(data);
    });
}

// ─── Toss ─────────────────────────────────────────────
function doToss() {
  const t1 = document.getElementById('team1-in').value || 'Team Alpha';
  const t2 = document.getElementById('team2-in').value || 'Team Beta';
  const el = document.getElementById('toss-result');
  el.textContent = 'Flipping coin…';
  setTimeout(() => {
    const winner = Math.random() > 0.5 ? t1 : t2;
    el.textContent = `🏆 ${winner} won the toss and elected to bat!`;
    document.getElementById('team1-label').textContent = t1;
    document.getElementById('team2-label').textContent = t2;
  }, 900);
}

// ─── Update UI ────────────────────────────────────────
function updateUI(data) {
  const balls = data.balls;
  const overs = Math.floor(balls / 6) + '.' + (balls % 6);
  const crrVal = balls === 0 ? '0.00' : (data.score / (balls / 6)).toFixed(2);

  // Match header
  document.getElementById('score').textContent      = `${data.score}/${data.wickets}`;
  document.getElementById('overs-text').textContent = `${overs} Overs`;
  document.getElementById('crr').textContent        = crrVal;

  // Partnership
  const p = data.partnership || { runs: 0, balls: 0 };
  document.getElementById('partnership-runs').textContent = `${p.runs}(${p.balls})`;
  document.getElementById('last-wkt').textContent = lastWkt;

  // Teams
  if (data.team1) document.getElementById('team1-label').textContent = data.team1;
  if (data.team2) document.getElementById('team2-label').textContent = data.team2;

  // Batter 1
  const b1 = data.batsman1;
  const b1sr = calcSR(b1.runs, b1.balls);
  document.getElementById('b1-name').textContent = b1.name;
  document.getElementById('b1-runs').textContent = b1.runs;
  document.getElementById('b1-balls').textContent = b1.balls;
  const b1Badge = document.getElementById('b1-sr');
  b1Badge.textContent = b1sr;
  b1Badge.className = `sr-badge ${srClass(parseFloat(b1sr))}`;

  // Batter 2
  const b2 = data.batsman2;
  const b2sr = calcSR(b2.runs, b2.balls);
  document.getElementById('b2-name').textContent = b2.name;
  document.getElementById('b2-runs').textContent = b2.runs;
  document.getElementById('b2-balls').textContent = b2.balls;
  const b2Badge = document.getElementById('b2-sr');
  b2Badge.textContent = b2sr;
  b2Badge.className = `sr-badge ${srClass(parseFloat(b2sr))}`;

  // Striker highlight
  const r1 = document.getElementById('b1-row');
  const r2 = document.getElementById('b2-row');
  r1.classList.toggle('striker', data.striker === 'batsman1');
  r2.classList.toggle('striker', data.striker === 'batsman2');
  document.getElementById('b1-role').textContent = data.striker === 'batsman1' ? 'Striker ▶' : 'Non-Striker';
  document.getElementById('b2-role').textContent = data.striker === 'batsman2' ? 'Striker ▶' : 'Non-Striker';

  // Ticker
  renderTicker(data.last_balls || []);

  // Overs Progress & Limit
  const maxOvers = data.max_overs || 20;
  const pct = Math.min(100, (balls / (maxOvers * 6)) * 100);
  document.getElementById('overs-bar').style.width = pct + '%';
  document.getElementById('overs-done').textContent = overs + ' ov';
  document.getElementById('overs-limit-label').textContent = maxOvers.toFixed(1) + ' ov';

  // Highlight active overs button
  document.querySelectorAll('.over-opt').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.getAttribute('data-val')) === maxOvers);
  });

  // Innings Complete Check
  const banner = document.getElementById('innings-banner');
  const btn2nd = document.getElementById('btn-start-2nd');
  const resultDisp = document.getElementById('match-result-display');

  if (data.innings_complete) {
    banner.style.display = 'block';
    if (data.innings === 1) {
      document.getElementById('innings-summary').textContent = `1st Innings finished at ${data.score}/${data.wickets} in ${overs} overs.`;
      btn2nd.style.display = 'inline-block';
      resultDisp.style.display = 'none';
    } else {
      document.getElementById('innings-summary').textContent = `2nd Innings finished at ${data.score}/${data.wickets} in ${overs} overs.`;
      btn2nd.style.display = 'none';
      resultDisp.style.display = 'block';
      resultDisp.textContent = data.match_result || 'Match Over';
    }
  } else {
    banner.style.display = 'none';
    btn2nd.style.display = 'none';
    resultDisp.style.display = 'none';
  }

  // Target & RRR
  const targetBox = document.getElementById('target-box');
  const rrrBox = document.getElementById('rrr-box');
  if (data.innings === 2 && data.target) {
    targetBox.style.display = 'flex';
    rrrBox.style.display = 'flex';
    document.getElementById('target-score').textContent = data.target;
    
    const runsNeeded = data.target - data.score;
    const ballsLeft = (maxOvers * 6) - balls;
    const rrrVal = ballsLeft <= 0 ? '∞' : (runsNeeded / (ballsLeft / 6)).toFixed(2);
    document.getElementById('rrr').textContent = rrrVal;
  } else {
    targetBox.style.display = 'none';
    rrrBox.style.display = 'none';
  }

  // Projected Score & Boundaries
  const rr = balls === 0 ? 0 : (data.score / (balls / 6));
  const proj = Math.round(rr * maxOvers);
  document.getElementById('projected-score').textContent = proj;

  // Boundary counting
  document.getElementById('count-4s').textContent = data.fours || 0;
  document.getElementById('count-6s').textContent = data.sixes || 0;
  document.getElementById('count-dots').textContent = data.dots || 0;
  
  // Chart logic
  const oversDecimal = (balls / 6).toFixed(1);
  if (balls > 0 && overLabels[overLabels.length - 1] !== oversDecimal) {
    runData.push(data.score);
    overLabels.push(oversDecimal);
    
    // Per over logic (check if over just finished)
    if (balls % 6 === 0) {
      const prevTotal = runData[runData.length - 7] || 0;
      perOverData.push(data.score - prevTotal);
    }
    
    drawChart();
    drawBarChart();
  }
}

// ─── Ticker ───────────────────────────────────────────
function renderTicker(balls) {
  const el = document.getElementById('ticker');
  // Pad to always show 12 slots
  const padded = [...Array(Math.max(0, 12 - balls.length)).fill(null), ...balls];
  el.innerHTML = padded.map(b => {
    if (b === null) return `<div class="ball-chip empty">·</div>`;
    if (b === 'W') return `<div class="ball-chip wicket">W</div>`;
    if (b === 'WD') return `<div class="ball-chip extra">WD</div>`;
    if (b === 'NB') return `<div class="ball-chip extra">NB</div>`;
    if (b === 4)   return `<div class="ball-chip four">4</div>`;
    if (b === 6)   return `<div class="ball-chip six">6</div>`;
    if (b === 0)   return `<div class="ball-chip dot">·</div>`;
    return `<div class="ball-chip">${b}</div>`;
  }).join('');
  el.scrollLeft = el.scrollWidth;
}

// ─── Chart ────────────────────────────────────────────
function drawChart() {
  const ctx = document.getElementById('chart').getContext('2d');

  if (chartInstance) {
    chartInstance.data.labels = overLabels;
    chartInstance.data.datasets[0].data = runData;
    chartInstance.update('none');
    return;
  }

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: overLabels,
      datasets: [{
        label: 'Runs',
        data: runData,
        borderColor: '#e8b84b',
        backgroundColor: 'rgba(232,184,75,0.08)',
        borderWidth: 2.5,
        tension: 0.4,
        pointBackgroundColor: '#e8b84b',
        pointRadius: 4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#8b949e', font: { size: 11 } }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#8b949e', font: { size: 11 } }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2230',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#e8b84b',
          bodyColor: '#e6edf3'
        }
      }
    }
  });
}

function drawBarChart() {
  const canvas = document.getElementById('bar-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const labels = perOverData.map((_, i) => `Ov ${i + 1}`);

  if (barChartInstance) {
    barChartInstance.data.labels = labels;
    barChartInstance.data.datasets[0].data = perOverData;
    barChartInstance.update('none');
    return;
  }

  barChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Runs',
        data: perOverData,
        backgroundColor: 'rgba(232,184,75,0.4)',
        borderColor: '#e8b84b',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8b949e' } },
        x: { grid: { display: false }, ticks: { color: '#8b949e' } }
      },
      plugins: { legend: { display: false } }
    }
  });
}

// ─── Init ─────────────────────────────────────────────
window.onload = () => {
  fetch('/get')
    .then(r => r.json())
    .then(data => {
      updateUI(data);
      drawChart();
      drawBarChart();
    });
};