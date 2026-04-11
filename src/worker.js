const COOKIE_NAME = 'ideas_session';
const SALT = 'ideas-tracker-v1';

async function hashToken(password) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(password + SALT));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function isAuthed(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/ideas_session=([^;]+)/);
  if (!match) return false;
  return match[1] === await hashToken(env.AUTH_PASSWORD);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function redirect(url) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

async function handleLogin(request, env) {
  const body = await request.formData();
  const robotCheck = body.get('robot_check') || '';
  const awesome    = parseInt(body.get('awesome') || '0', 10);

  const robotOk   = robotCheck === 'confirmed';
  const awesomeOk = awesome > 100;

  if (robotOk && awesomeOk) {
    const token = await hashToken(env.AUTH_PASSWORD);
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/',
        'Set-Cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${60 * 60 * 24 * 30}`,
      },
    });
  }

  let error;
  if (robotOk && !awesomeOk)    error = "Verification: ✓  |  Slider: ✗ — the scale doesn't end at 100. Think bigger. Way bigger.";
  else if (!robotOk && awesomeOk) error = "Slider: ✓  |  Verification: ✗ — you can't just click past the existential questions.";
  else                             error = "Both wrong. Bold strategy. Philosophy and physics both disagree.";

  return new Response(loginHTML(error), { status: 401, headers: { 'Content-Type': 'text/html' } });
}

function handleLogout() {
  return new Response(null, {
    status: 302,
    headers: { Location: '/login', 'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0` },
  });
}

async function handleAPI(request, env, url) {
  const method = request.method;
  const parts = url.pathname.split('/').filter(Boolean);

  if (method === 'GET' && parts.length === 2) {
    const { results } = await env.DB.prepare('SELECT * FROM ideas ORDER BY created_at DESC').all();
    return json(results || []);
  }

  if (method === 'POST' && parts.length === 2) {
    const body = await request.json();
    const { title, category, notes, link, stage } = body;
    if (!title?.trim()) return json({ error: 'Title is required. Even "untitled idea #47" counts.' }, 400);
    const { results } = await env.DB.prepare(
      'INSERT INTO ideas (title, category, notes, link, stage) VALUES (?, ?, ?, ?, ?) RETURNING *'
    ).bind(title.trim(), category || 'New Project', notes || '', link || '', stage || 'eureka').all();
    return json(results[0], 201);
  }

  const id = parts[2];
  if (!id) return json({ error: 'Not found' }, 404);

  if (method === 'PATCH') {
    const body = await request.json();
    const fields = [], values = [];
    if (body.title !== undefined) { fields.push('title = ?'); values.push(body.title); }
    if (body.category !== undefined) { fields.push('category = ?'); values.push(body.category); }
    if (body.notes !== undefined) { fields.push('notes = ?'); values.push(body.notes); }
    if (body.link !== undefined) { fields.push('link = ?'); values.push(body.link); }
    if (body.stage !== undefined) { fields.push('stage = ?'); values.push(body.stage); }
    if (!fields.length) return json({ error: 'Nothing to update. Bold request though.' }, 400);
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    const { results } = await env.DB.prepare(
      `UPDATE ideas SET ${fields.join(', ')} WHERE id = ? RETURNING *`
    ).bind(...values).all();
    if (!results?.length) return json({ error: 'Not found' }, 404);
    return json(results[0]);
  }

  if (method === 'DELETE') {
    await env.DB.prepare('DELETE FROM ideas WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}

function loginHTML(error = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Lab — Who Goes There?</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', sans-serif;
      background: #080c14;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background-image: radial-gradient(ellipse at 20% 50%, rgba(59,130,246,0.06) 0%, transparent 60%),
                        radial-gradient(ellipse at 80% 20%, rgba(139,92,246,0.06) 0%, transparent 60%);
    }
    .box {
      background: rgba(15,20,35,0.95);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 40px 36px;
      width: 100%;
      max-width: 440px;
      backdrop-filter: blur(12px);
      box-shadow: 0 25px 50px rgba(0,0,0,0.5);
    }
    .logo { font-size: 2.8rem; margin-bottom: 16px; display: block; }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 6px; letter-spacing: -0.5px; }
    .sub { color: #64748b; font-size: 0.82rem; margin-bottom: 32px; line-height: 1.6; font-style: italic; }

    .q { margin-bottom: 26px; }
    .q-label {
      display: block;
      font-size: 0.73rem;
      color: #94a3b8;
      margin-bottom: 6px;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
      letter-spacing: 0.2px;
    }
    .q-sub { font-size: 0.68rem; color: #475569; font-style: italic; margin-bottom: 10px; display: block; font-family: 'JetBrains Mono', monospace; }

    input[type=text] {
      width: 100%;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      color: #e2e8f0;
      font-size: 0.9rem;
      padding: 11px 14px;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
      font-family: 'JetBrains Mono', monospace;
    }
    input[type=text]:focus { border-color: rgba(99,102,241,0.6); box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }

    /* ── Slider ── */
    .slider-wrap { position: relative; padding-bottom: 22px; }
    .slider-value-display {
      text-align: center;
      font-family: 'JetBrains Mono', monospace;
      font-size: 1.4rem;
      font-weight: 700;
      margin-bottom: 10px;
      height: 2rem;
      transition: color 0.3s;
      color: #e2e8f0;
    }
    .slider-value-display.at-max   { color: #f59e0b; }
    .slider-value-display.unlocked { color: #10b981; text-shadow: 0 0 20px rgba(16,185,129,0.4); }

    input[type=range] {
      -webkit-appearance: none;
      width: 100%;
      height: 6px;
      border-radius: 3px;
      outline: none;
      cursor: pointer;
      background: linear-gradient(to right, #4f46e5 0%, #4f46e5 50%, #1e2a3a 50%, #1e2a3a 100%);
      transition: background 0.1s;
    }
    input[type=range]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 20px; height: 20px;
      border-radius: 50%;
      background: #e2e8f0;
      border: 3px solid #4f46e5;
      cursor: grab;
      transition: border-color 0.3s, transform 0.2s, box-shadow 0.3s;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }
    input[type=range].at-max::-webkit-slider-thumb {
      border-color: #f59e0b;
      box-shadow: 0 0 10px rgba(245,158,11,0.5);
      opacity: 0;
    }
    input[type=range].unlocked::-webkit-slider-thumb {
      border-color: #10b981;
      box-shadow: 0 0 14px rgba(16,185,129,0.7);
      transform: scale(1.25);
    }
    input[type=range]::-moz-range-thumb {
      width: 20px; height: 20px;
      border-radius: 50%;
      background: #e2e8f0;
      border: 3px solid #4f46e5;
      cursor: grab;
    }
    input[type=range].at-max::-moz-range-thumb { opacity: 0; }

    #fake-thumb {
      position: fixed;
      width: 20px; height: 20px;
      border-radius: 50%;
      background: #e2e8f0;
      border: 3px solid #f59e0b;
      box-shadow: 0 0 12px rgba(245,158,11,0.6);
      pointer-events: none;
      display: none;
      transform: translate(-50%, -50%);
      z-index: 9999;
    }
    #fake-thumb.drifting {
      border-color: #fb923c;
      box-shadow: 0 0 20px rgba(251,146,60,0.8), 0 4px 16px rgba(0,0,0,0.4);
    }
    #fake-thumb.snapping {
      animation: snap-bounce 0.45s cubic-bezier(0.34,1.56,0.64,1) forwards;
    }

    #track-wire {
      position: fixed;
      top: 0; left: 0;
      width: 100vw; height: 100vh;
      pointer-events: none;
      z-index: 9998;
      display: none;
    }

    #break-flash {
      position: fixed;
      width: 24px; height: 24px;
      border-radius: 50%;
      background: #fff;
      pointer-events: none;
      display: none;
      transform: translate(-50%, -50%);
      z-index: 10000;
    }
    #break-flash.firing {
      animation: break-flash 0.4s ease-out forwards;
    }

    @keyframes break-flash {
      0%   { transform: translate(-50%,-50%) scale(1);   opacity: 1; }
      100% { transform: translate(-50%,-50%) scale(5);   opacity: 0; }
    }
    @keyframes snap-bounce {
      0%   { transform: translate(-50%,-50%) scale(1); }
      40%  { transform: translate(-50%,-60%) scale(1.15); }
      70%  { transform: translate(-50%,-45%) scale(0.95); }
      100% { transform: translate(-50%,-50%) scale(1); }
    }
    @keyframes overdrive-shake {
      0%,100% { transform: translateX(0); }
      20%  { transform: translateX(-2px) skewX(-1deg); }
      60%  { transform: translateX(2px)  skewX(1deg); }
    }
    .slider-value-display.overheating {
      animation: overdrive-shake 0.11s infinite;
    }

    .ticks {
      display: flex;
      justify-content: space-between;
      margin-top: 6px;
    }
    .tick { font-size: 0.62rem; color: #334155; font-family: 'JetBrains Mono', monospace; }
    .slider-hint {
      text-align: center;
      font-size: 0.68rem;
      color: #1e2d3d;
      font-style: italic;
      margin-top: 8px;
      font-family: 'JetBrains Mono', monospace;
      transition: color 0.3s;
      min-height: 1rem;
    }
    .slider-hint.at-max   { color: #92400e; }
    .slider-hint.unlocked { color: #059669; }

    button {
      width: 100%;
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      color: white;
      border: none;
      border-radius: 8px;
      padding: 12px;
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
      margin-top: 8px;
      font-family: inherit;
      transition: opacity 0.15s, transform 0.1s;
      letter-spacing: 0.3px;
    }
    button:hover { opacity: 0.9; transform: translateY(-1px); }
    button:active { transform: translateY(0); }

    .error {
      color: #f87171;
      font-size: 0.75rem;
      margin-bottom: 20px;
      background: rgba(239,68,68,0.08);
      border: 1px solid rgba(239,68,68,0.2);
      border-radius: 8px;
      padding: 10px 14px;
      line-height: 1.6;
      font-family: 'JetBrains Mono', monospace;
    }
    .footer { text-align: center; margin-top: 24px; color: #1e2d3d; font-size: 0.68rem; line-height: 1.7; font-family: 'JetBrains Mono', monospace; }

    /* ── Robot checkbox ── */
    .robot-wrap {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px 16px;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 8px;
    }
    .robot-row {
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      user-select: none;
    }
    #robot-check {
      flex-shrink: 0;
      width: 18px; height: 18px;
      border-radius: 4px;
      border: 2px solid #334155;
      background: transparent;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
    }
    #robot-check.checked {
      background: #4f46e5;
      border-color: #4f46e5;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 6l3 3 5-5' stroke='white' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: center;
      background-size: 12px;
    }
    #robot-check.disabled { opacity: 0.7; cursor: default; }
    #robot-label-text {
      font-size: 0.8rem;
      font-family: 'JetBrains Mono', monospace;
      color: #94a3b8;
      transition: opacity 0.15s;
    }
    #robot-label-text.glitching {
      animation: glitch-text 0.35s infinite;
    }
    #robot-final-msg {
      font-size: 0.7rem;
      font-family: 'JetBrains Mono', monospace;
      color: #475569;
      font-style: italic;
      line-height: 1.6;
      display: none;
      opacity: 0;
      transition: opacity 0.5s;
    }
    @keyframes glitch-text {
      0%,100% { transform: translateX(0);   color: #94a3b8; }
      25%      { transform: translateX(-3px); color: #f87171; }
      50%      { transform: translateX(3px);  color: #818cf8; }
      75%      { transform: translateX(-2px); color: #94a3b8; }
    }

    /* ── Below-slider pct readout ── */
    .slider-footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-top: 8px;
      min-height: 1.2rem;
    }
    .slider-hint { margin-top: 0; }
    #pct-live {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.5px;
      line-height: 1;
      opacity: 0;
      transition: opacity 0.15s, font-size 0.1s;
    }
    #pct-live.active { opacity: 1; }
  </style>
</head>
<body>
  <div class="box">
    <span class="logo">⚛️</span>
    <h1>Akshay's Idea Reactor</h1>
    ${error ? `<div class="error">⚠ ${error}</div>` : ''}

    <form method="POST" action="/login" id="login-form">

      <div class="q">
        <div class="robot-wrap">
          <div class="robot-row" id="robot-row">
            <div id="robot-check"></div>
            <span id="robot-label-text">I am not a robot</span>
          </div>
          <div id="robot-final-msg"></div>
        </div>
        <input type="hidden" name="robot_check" id="robot-check-value" value="" />
      </div>

      <div class="q">
        <div class="q-label" style="text-align:center;margin-bottom:6px;">How awesome is Akshay? (be honest)</div>
        <div class="slider-value-display" id="val-display">50%</div>
        <div class="slider-wrap">
          <input type="range" id="awesome-slider" min="1" max="100" value="50" />
          <input type="hidden" name="awesome" id="awesome-hidden" value="50" />
          <div class="ticks">
            <span class="tick">1</span>
            <span class="tick">25</span>
            <span class="tick">50</span>
            <span class="tick">75</span>
            <span class="tick">100</span>
          </div>
          <div class="slider-footer">
            <div class="slider-hint" id="slider-hint"></div>
            <div id="pct-live"></div>
          </div>
        </div>
      </div>

      <button type="submit">Initiate Sequence →</button>
    </form>

  </div>

  <script>
    // ── Robot checkbox state machine ────────────────────────────────
    const ROBOT_STATES = [
      "I am not a robot",
      "I am probably not a robot",
      "I'm... not a robot?",
      "identity crisis detected.",
    ];
    const robotCheck  = document.getElementById('robot-check');
    const robotLabel  = document.getElementById('robot-label-text');
    const robotFinal  = document.getElementById('robot-final-msg');
    const robotHidden = document.getElementById('robot-check-value');

    let robotState   = 0;   // which prompt we're on
    let robotLocked  = false; // true while checked, waiting to advance

    document.getElementById('robot-row').addEventListener('click', () => {
      if (robotLocked) return; // already checked — wait for advance
      robotLocked = true;
      robotCheck.classList.add('checked');

      const isFinal = robotState === ROBOT_STATES.length - 1;

      if (isFinal) {
        // done — stay checked, disable, show message
        robotCheck.classList.add('disabled');
        robotLabel.className = '';
        robotFinal.textContent = "Fine. You seem human enough. And even if you're not — it's just a kanban board.";
        robotFinal.style.display = 'block';
        setTimeout(() => { robotFinal.style.opacity = '1'; }, 10);
        robotHidden.value = 'confirmed';
      } else {
        // after a short pause, advance to next prompt (unchecked)
        setTimeout(() => {
          robotState++;
          robotCheck.classList.remove('checked');
          robotLabel.style.opacity = '0';
          setTimeout(() => {
            robotLabel.textContent = ROBOT_STATES[robotState];
            robotLabel.className   = robotState === ROBOT_STATES.length - 1 ? 'glitching' : '';
            robotLabel.style.opacity = '1';
          }, 160);
          robotLocked = false;
        }, 550);
      }
    });

    // ── Slider ──────────────────────────────────────────────────────
    const slider  = document.getElementById('awesome-slider');
    const hidden  = document.getElementById('awesome-hidden');
    const display = document.getElementById('val-display');
    const hint    = document.getElementById('slider-hint');
    const pctLive = document.getElementById('pct-live');

    // fake detachable thumb
    const fakeThumb = document.createElement('div');
    fakeThumb.id = 'fake-thumb';
    document.body.appendChild(fakeThumb);

    // SVG wire overlay
    const wireSVG = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wireSVG.id = 'track-wire';
    const wireLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    wireLine.id = 'wire-line';
    wireLine.setAttribute('stroke-linecap', 'round');
    wireSVG.appendChild(wireLine);
    document.body.appendChild(wireSVG);

    // break flash
    const breakFlash = document.createElement('div');
    breakFlash.id = 'break-flash';
    document.body.appendChild(breakFlash);

    let dragging      = false;
    let unlocked      = false;
    let detached      = false;
    let snappingToMax = false;
    let snapTimer     = null;
    let currentPct    = 100;

    // ── geometry helpers ────────────────────────────────────────────
    function trackAnchor() {
      const r = slider.getBoundingClientRect();
      return { x: r.right, y: r.top + r.height / 2 };
    }

    // total pixels available between track-right and screen edge
    function maxCursorOff() {
      return Math.max(60, window.innerWidth - slider.getBoundingClientRect().right - 14);
    }

    // cursor offset that corresponds to 200% (the snap-to-max threshold)
    // placed at 28% of available space so it takes a deliberate pull
    function breakThreshold() { return maxCursorOff() * 0.28; }

    // linear: 0 px → 100%, breakThreshold px → 200%
    function cursorOffToPct(off) {
      return 100 + Math.min(100, (off / breakThreshold()) * 100);
    }

    // rubber-band: thumb moves sub-linearly vs cursor (feels like stretching)
    function cursorOffToThumbOff(off) {
      const bt = breakThreshold();
      const t  = Math.min(1, off / bt);
      return bt * Math.pow(t, 0.5); // square-root resistance
    }

    // amber (100%) → deep red (200%)
    function overdriveColor(pct) {
      const t = Math.min(1, (pct - 100) / 100);
      return \`hsl(\${Math.round(43 * (1 - t))}, 96%, \${Math.round(56 - 20 * t)}%)\`;
    }

    // ── wire ────────────────────────────────────────────────────────
    function showWire() {
      const a = trackAnchor();
      wireLine.setAttribute('x1', a.x); wireLine.setAttribute('y1', a.y);
      wireLine.setAttribute('x2', a.x); wireLine.setAttribute('y2', a.y);
      wireLine.setAttribute('stroke-width', 6);
      wireLine.style.stroke = '#4f46e5';
      wireSVG.style.display = 'block';
    }

    function updateWire(thumbX, thumbY, pct) {
      const a = trackAnchor();
      const t = Math.min(1, (pct - 100) / 100);
      wireLine.setAttribute('x1', a.x); wireLine.setAttribute('y1', a.y);
      wireLine.setAttribute('x2', thumbX); wireLine.setAttribute('y2', thumbY);
      wireLine.setAttribute('stroke-width', Math.max(1.2, 6 - t * 4.8));
      wireLine.style.stroke = overdriveColor(pct);
    }

    function hideWire() { wireSVG.style.display = 'none'; }

    // ── fake thumb ──────────────────────────────────────────────────
    function placeFakeThumb(x, y, tr) {
      fakeThumb.style.transition = tr || 'none';
      fakeThumb.style.left = x + 'px';
      fakeThumb.style.top  = y + 'px';
    }

    function showFakeThumb() {
      const a = trackAnchor();
      placeFakeThumb(a.x, a.y, 'none');
      fakeThumb.style.borderColor = '#f59e0b';
      fakeThumb.style.boxShadow   = '0 0 12px rgba(245,158,11,0.6)';
      fakeThumb.style.display = 'block';
      fakeThumb.className = '';
      detached   = false;
      currentPct = 100;
      showWire();
    }

    function hideFakeThumb() {
      fakeThumb.style.display = 'none';
      fakeThumb.className = '';
      detached   = false;
      currentPct = 100;
      hideWire();
      clearPctLive();
    }

    // ── overdrive display (below slider) ────────────────────────────
    function setOverdriveDisplay(pct) {
      const col = overdriveColor(pct);
      const t   = Math.min(1, (pct - 100) / 100);
      const fs  = (0.72 + t * 1.48).toFixed(2);
      pctLive.textContent      = Math.round(pct) + '%';
      pctLive.style.color      = col;
      pctLive.style.fontSize   = fs + 'rem';
      pctLive.style.textShadow = pct > 160 ? \`0 0 10px \${col}\` : 'none';
      pctLive.className        = 'active';
    }

    function clearPctLive() {
      pctLive.className        = '';
      pctLive.textContent      = '';
      pctLive.style.color      = '';
      pctLive.style.fontSize   = '';
      pctLive.style.textShadow = '';
    }

    // ── drift (while dragging past 100) ─────────────────────────────
    function driftFakeThumb(clientX) {
      if (snappingToMax) return currentPct;
      const r        = slider.getBoundingClientRect();
      const centerY  = r.top + r.height / 2;
      const curOff   = Math.max(0, clientX - r.right);

      currentPct    = cursorOffToPct(curOff);
      const thumbX  = r.right + cursorOffToThumbOff(curOff);

      placeFakeThumb(thumbX, centerY, 'none');
      updateWire(thumbX, centerY, currentPct);
      setOverdriveDisplay(currentPct);

      const col = overdriveColor(currentPct);
      fakeThumb.style.borderColor = col;
      fakeThumb.style.boxShadow   = \`0 0 \${8 + (currentPct - 100) * 0.25}px \${col}\`;

      if (curOff > 6) detached = true;

      hint.className = 'slider-hint at-max';
      if (currentPct > 175)      hint.textContent = '...structural integrity failing.';
      else if (currentPct > 135) hint.textContent = 'wait — it\\'s moving??';
      else                       hint.textContent = 'keep going.';

      return currentPct;
    }

    // ── magnetic snap to 1000% ──────────────────────────────────────
    function snapToMax() {
      if (snappingToMax || unlocked) return;
      snappingToMax = true;
      dragging = false;

      // flash at current thumb position
      const tx = parseFloat(fakeThumb.style.left);
      const ty = parseFloat(fakeThumb.style.top);
      function flash(x, y) {
        breakFlash.style.left = x + 'px';
        breakFlash.style.top  = y + 'px';
        breakFlash.style.display = 'block';
        breakFlash.className = '';
        void breakFlash.offsetWidth;
        breakFlash.classList.add('firing');
        setTimeout(() => { breakFlash.style.display = 'none'; breakFlash.className = ''; }, 430);
      }
      flash(tx, ty);

      // pct readout jumps to 1000% instantly
      pctLive.textContent      = '1000%';
      pctLive.style.color      = 'hsl(0, 96%, 28%)';
      pctLive.style.fontSize   = '2.2rem';
      pctLive.style.textShadow = '0 0 14px rgba(239,68,68,0.95)';
      pctLive.className        = 'active';
      hint.textContent         = '';

      // wire vanishes, thumb flies to screen right
      hideWire();
      const a       = trackAnchor();
      const targetX = window.innerWidth - 12;
      requestAnimationFrame(() => {
        placeFakeThumb(tx, ty, 'none');
        requestAnimationFrame(() => {
          placeFakeThumb(targetX, a.y, 'left 0.21s ease-in');
        });
      });

      // second flash at screen edge + unlock
      setTimeout(() => {
        flash(targetX, a.y);
        fakeThumb.style.display = 'none';
        snappingToMax = false;
        setUnlocked(true);
      }, 230);
    }

    // ── release without reaching threshold ─────────────────────────
    function releaseFakeThumb() {
      if (!detached) { hideFakeThumb(); return; }
      const a = trackAnchor();
      placeFakeThumb(a.x, a.y,
        'left 0.45s cubic-bezier(0.34,1.56,0.64,1), top 0.45s cubic-bezier(0.34,1.56,0.64,1)');
      hint.textContent = 'keep going.';
      hint.className   = 'slider-hint at-max';
      snapTimer = setTimeout(() => {
        hideFakeThumb();
        currentPct = 100;
      }, 460);
    }

    // ── unlock ──────────────────────────────────────────────────────
    function setUnlocked(state) {
      unlocked = state;
      hidden.value = state ? '150' : slider.value;
      if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; }
      if (state) {
        pctLive.textContent      = '1000%';
        pctLive.style.color      = 'hsl(0, 96%, 28%)';
        pctLive.style.fontSize   = '2.2rem';
        pctLive.style.textShadow = '0 0 14px rgba(239,68,68,0.95)';
        pctLive.className        = 'active';
        display.textContent = '🎯 now we\\'re talking.';
        display.className   = 'slider-value-display unlocked';
        slider.className    = 'unlocked';
        hint.textContent    = 'yes. exactly. you get it.';
        hint.className      = 'slider-hint unlocked';
      } else {
        clearPctLive();
        hideFakeThumb();
        render();
      }
    }

    // ── normal render ───────────────────────────────────────────────
    function render() {
      if (unlocked) return;
      const v   = parseInt(slider.value);
      hidden.value = v;
      const pct = ((v - 1) / 99) * 100;
      slider.style.background =
        \`linear-gradient(to right,#4f46e5 0%,#4f46e5 \${pct}%,#1e2a3a \${pct}%,#1e2a3a 100%)\`;
      if (v === 100) {
        display.textContent = '100%... are you sure?';
        display.className   = 'slider-value-display at-max';
        slider.className    = 'at-max';
        hint.textContent    = 'keep going.';
        hint.className      = 'slider-hint at-max';
        if (!dragging) showFakeThumb();
      } else {
        display.textContent = v + '%';
        display.className   = 'slider-value-display';
        slider.className    = '';
        hint.textContent    = '';
        hint.className      = 'slider-hint';
        hideFakeThumb();
      }
    }

    // ── event wiring ────────────────────────────────────────────────
    function handleMove(clientX) {
      if (!dragging || unlocked || snappingToMax) return;
      if (parseInt(slider.value) < 100) return;
      if (driftFakeThumb(clientX) >= 200) snapToMax();
    }

    function handleRelease() {
      if (dragging && !unlocked && !snappingToMax && parseInt(slider.value) === 100) {
        releaseFakeThumb();
      }
      dragging = false;
    }

    slider.addEventListener('mousedown', () => {
      dragging = true;
      if (parseInt(slider.value) === 100) showFakeThumb();
    });
    document.addEventListener('mouseup',   handleRelease);
    document.addEventListener('mousemove', e => handleMove(e.clientX));

    slider.addEventListener('touchstart', () => {
      dragging = true;
      if (parseInt(slider.value) === 100) showFakeThumb();
    }, { passive: true });
    document.addEventListener('touchend',  handleRelease);
    document.addEventListener('touchmove', e => handleMove(e.touches[0].clientX), { passive: true });

    slider.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' && parseInt(slider.value) === 100) snapToMax();
    });

    slider.addEventListener('input', () => {
      if (unlocked && parseInt(slider.value) < 100) setUnlocked(false);
      render();
    });

    render();
  </script>
</body>
</html>`;
}

function appHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>⚛️ The Idea Reactor</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #080c14;
      --surface: #0f1623;
      --surface2: #161d2e;
      --surface3: #1c2540;
      --border: rgba(255,255,255,0.07);
      --border2: rgba(255,255,255,0.12);
      --text: #e2e8f0;
      --muted: #64748b;
      --muted2: #94a3b8;
      --eureka: #f59e0b;
      --eureka-glow: rgba(245,158,11,0.15);
      --tinker: #6366f1;
      --tinker-glow: rgba(99,102,241,0.15);
      --alive: #10b981;
      --alive-glow: rgba(16,185,129,0.15);
      --danger: #ef4444;
      --mono: 'JetBrains Mono', monospace;
      --sans: 'Inter', sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--sans);
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      background-image:
        radial-gradient(ellipse at 10% 0%, rgba(99,102,241,0.08) 0%, transparent 50%),
        radial-gradient(ellipse at 90% 100%, rgba(16,185,129,0.05) 0%, transparent 50%);
    }

    /* ── Nav ── */
    nav {
      background: rgba(15,22,35,0.9);
      border-bottom: 1px solid var(--border);
      padding: 0 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 100;
      height: 56px;
      backdrop-filter: blur(12px);
      gap: 12px;
    }
    .nav-brand { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
    .nav-logo { font-size: 1.2rem; }
    .nav-title { font-size: 0.95rem; font-weight: 700; letter-spacing: -0.3px; white-space: nowrap; }
    .nav-sub {
      color: var(--muted);
      font-size: 0.7rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-family: var(--mono);
      display: none;
    }
    @media(min-width:540px) { .nav-sub { display: block; } }
    .nav-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .idea-count { font-family: var(--mono); font-size: 0.7rem; color: var(--muted); background: var(--surface2); border: 1px solid var(--border); border-radius: 20px; padding: 3px 10px; display: none; }
    @media(min-width:600px) { .idea-count { display: block; } }

    /* ── Buttons ── */
    button { cursor: pointer; border: none; font-family: var(--sans); transition: all 0.15s; border-radius: 8px; }
    .btn-spark {
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      color: white;
      padding: 8px 16px;
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.2px;
      box-shadow: 0 2px 12px rgba(99,102,241,0.3);
    }
    .btn-spark:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(99,102,241,0.4); }
    .btn-spark:active { transform: translateY(0); }
    .btn-ghost {
      background: transparent;
      color: var(--muted);
      padding: 7px 12px;
      font-size: 0.8rem;
      border: 1px solid var(--border);
    }
    .btn-ghost:hover { color: var(--text); border-color: var(--border2); }
    .btn-save-changes {
      background: rgba(245,158,11,0.12);
      color: #fbbf24;
      border: 1px solid rgba(245,158,11,0.3);
      border-radius: 8px;
      padding: 7px 14px;
      font-size: 0.78rem;
      font-weight: 600;
      font-family: var(--mono);
      display: none;
    }
    .btn-save-changes:hover { background: rgba(245,158,11,0.22); }

    /* ── Board ── */
    .board {
      display: flex;
      gap: 16px;
      padding: 20px 16px;
      align-items: flex-start;
      min-height: calc(100vh - 56px - 48px);
    }
    @media(max-width:767px) { .board { flex-direction: column; } }

    /* ── Column ── */
    .column {
      flex: 1 1 0;
      min-width: 0;
      background: var(--surface);
      border-radius: 14px;
      border: 1px solid var(--border);
      overflow: hidden;
      transition: border-color 0.2s;
    }
    @media(max-width:767px) { .column { flex: none; width: 100%; } }
    .col-head {
      padding: 14px 16px 12px;
      border-bottom: 1px solid var(--border);
      position: relative;
    }
    .col-head::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      border-radius: 14px 14px 0 0;
    }
    .col-eureka .col-head::before { background: linear-gradient(90deg, var(--eureka), #fbbf24); }
    .col-tinker .col-head::before { background: linear-gradient(90deg, var(--tinker), #818cf8); }
    .col-alive  .col-head::before { background: linear-gradient(90deg, var(--alive),  #34d399); }
    .col-head-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .col-title { font-size: 0.88rem; font-weight: 700; display: flex; align-items: center; gap: 7px; }
    .col-count {
      font-family: var(--mono);
      font-size: 0.68rem;
      font-weight: 600;
      background: var(--surface2);
      color: var(--muted2);
      padding: 2px 8px;
      border-radius: 20px;
      border: 1px solid var(--border);
    }
    .col-desc { font-size: 0.7rem; color: var(--muted); line-height: 1.5; font-style: italic; }

    /* ── Cards ── */
    .cards { padding: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 60px; }

    .card {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 13px;
      transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
      position: relative;
      cursor: grab;
    }
    .card:active { cursor: grabbing; }
    .card:hover { border-color: var(--border2); box-shadow: 0 4px 20px rgba(0,0,0,0.3); transform: translateY(-1px); }
    .column.drop-target {
      border-color: rgba(99,102,241,0.55);
      background: rgba(99,102,241,0.04);
      box-shadow: inset 0 0 0 2px rgba(99,102,241,0.2);
    }
    .card-head { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 7px; }
    .card-title { font-size: 0.87rem; font-weight: 600; line-height: 1.4; flex: 1; }
    .badge {
      font-size: 0.65rem;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 20px;
      white-space: nowrap;
      flex-shrink: 0;
      font-family: var(--mono);
      letter-spacing: 0.3px;
      text-transform: uppercase;
    }
    .badge-research  { background: rgba(139,92,246,0.15); color: #a78bfa; border: 1px solid rgba(139,92,246,0.2); }
    .badge-project   { background: rgba(16,185,129,0.12); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.2); }
    .badge-upgrade   { background: rgba(245,158,11,0.12); color: #fcd34d; border: 1px solid rgba(245,158,11,0.2); }
    .card-notes {
      font-size: 0.78rem;
      color: var(--muted2);
      line-height: 1.55;
      margin-bottom: 8px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .card-link a {
      font-size: 0.72rem;
      color: var(--tinker);
      text-decoration: none;
      font-family: var(--mono);
      opacity: 0.8;
    }
    .card-link a:hover { opacity: 1; text-decoration: underline; }
    .card-foot {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 10px;
      padding-top: 9px;
      border-top: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .card-age { font-size: 0.67rem; color: var(--muted); font-family: var(--mono); margin-right: auto; }
    .btn-card {
      padding: 3px 9px;
      font-size: 0.7rem;
      background: var(--surface3);
      color: var(--muted2);
      border: 1px solid var(--border);
      border-radius: 5px;
    }
    .btn-card:hover { color: var(--text); border-color: var(--border2); }
    .btn-nuke {
      padding: 3px 7px;
      font-size: 0.7rem;
      background: transparent;
      color: var(--muted);
      border: 1px solid transparent;
      border-radius: 5px;
    }
    .btn-nuke:hover { color: var(--danger); border-color: rgba(239,68,68,0.3); }

    /* ── Empty states ── */
    .empty { text-align: center; padding: 32px 16px; }
    .empty-icon { font-size: 2rem; margin-bottom: 10px; opacity: 0.5; }
    .empty-txt { font-size: 0.78rem; color: var(--muted); line-height: 1.7; }
    .empty-txt em { display: block; font-size: 0.68rem; margin-top: 6px; color: #334155; font-style: normal; font-family: var(--mono); }

    /* ── Modal ── */
    .overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.75);
      z-index: 200;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
      backdrop-filter: blur(4px);
    }
    .overlay.open { display: flex; }
    .modal {
      background: var(--surface);
      border: 1px solid var(--border2);
      border-radius: 16px;
      width: 100%;
      max-width: 480px;
      padding: 28px;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 30px 60px rgba(0,0,0,0.6);
    }
    .modal-title { font-size: 1rem; font-weight: 700; margin-bottom: 20px; display: flex; align-items: center; gap: 8px; }
    .form-group { margin-bottom: 16px; }
    label {
      display: block;
      font-size: 0.73rem;
      color: var(--muted2);
      margin-bottom: 6px;
      font-weight: 600;
      font-family: var(--mono);
      letter-spacing: 0.2px;
    }
    input[type=text], input[type=url], textarea, select {
      width: 100%;
      background: var(--surface2);
      border: 1px solid var(--border2);
      border-radius: 8px;
      color: var(--text);
      font-size: 0.88rem;
      font-family: var(--sans);
      padding: 9px 12px;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    input:focus, textarea:focus, select:focus {
      border-color: rgba(99,102,241,0.5);
      box-shadow: 0 0 0 3px rgba(99,102,241,0.12);
    }
    textarea { resize: vertical; min-height: 90px; line-height: 1.6; }
    select option { background: #1c2540; }
    .modal-foot { display: flex; gap: 8px; justify-content: flex-end; margin-top: 22px; flex-wrap: wrap; }
    .btn-cancel { background: transparent; color: var(--muted); padding: 9px 16px; font-size: 0.83rem; border: 1px solid var(--border2); }
    .btn-cancel:hover { color: var(--text); }
    .btn-save { background: linear-gradient(135deg, #4f46e5, #7c3aed); color: white; padding: 9px 22px; font-size: 0.83rem; font-weight: 700; box-shadow: 0 2px 12px rgba(99,102,241,0.3); }
    .btn-save:hover { opacity: 0.9; }
    .btn-del-modal { background: transparent; color: var(--danger); padding: 9px 14px; font-size: 0.83rem; border: 1px solid rgba(239,68,68,0.25); margin-right: auto; }
    .btn-del-modal:hover { background: rgba(239,68,68,0.08); }

    /* ── Toast ── */
    .toasts { position: fixed; bottom: 24px; right: 20px; z-index: 400; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
    .toast {
      background: var(--surface2);
      border: 1px solid var(--border2);
      border-radius: 10px;
      padding: 11px 18px;
      font-size: 0.82rem;
      color: var(--text);
      max-width: 300px;
      line-height: 1.5;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      animation: toastIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @keyframes toastIn { from { transform: translateY(12px) scale(0.95); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }

    /* ── Confetti ── */
    .confetti-piece {
      position: fixed;
      width: 8px; height: 8px;
      border-radius: 2px;
      pointer-events: none;
      z-index: 500;
      animation: confettiFall linear forwards;
    }
    @keyframes confettiFall {
      0%   { transform: translateY(-10px) rotate(0deg); opacity: 1; }
      100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
    }

    /* ── Footer ── */
    footer {
      text-align: center;
      padding: 14px;
      color: #1e2d45;
      font-size: 0.68rem;
      border-top: 1px solid var(--border);
      font-family: var(--mono);
    }
    footer span { color: #2d3f5a; }
  </style>
</head>
<body>

<nav>
  <div class="nav-brand">
    <span class="nav-logo">⚛️</span>
    <span class="nav-title">The Idea Reactor</span>
    <span class="nav-sub">// ideas.akshaydhenge.uk</span>
  </div>
  <div class="nav-right">
    <span class="idea-count" id="total-count">0 ideas in the reactor</span>
    <button class="btn-save-changes" id="btn-save-changes" onclick="triggerSave()">💾 Save</button>
    <button class="btn-spark" onclick="openModal()">⚡ Spark</button>
    <button class="btn-ghost" onclick="location.href='/logout'" title="Log out">↩</button>
  </div>
</nav>

<div class="board">
  <div class="column col-eureka" id="col-eureka">
    <div class="col-head">
      <div class="col-head-top">
        <div class="col-title">💡 Eureka</div>
        <div class="col-count" id="count-eureka">0</div>
      </div>
      <div class="col-desc">The spark. The 3am thought. The "nobody has ever thought of this" moment — they have, but still.</div>
    </div>
    <div class="cards" id="cards-eureka"></div>
  </div>
  <div class="column col-tinker" id="col-tinker">
    <div class="col-head">
      <div class="col-head-top">
        <div class="col-title">🧪 Tinkering</div>
        <div class="col-count" id="count-tinker">0</div>
      </div>
      <div class="col-desc">Currently being overengineered. Feature creep is likely. Scope: expanding.</div>
    </div>
    <div class="cards" id="cards-tinker"></div>
  </div>
  <div class="column col-alive" id="col-alive">
    <div class="col-head">
      <div class="col-head-top">
        <div class="col-title">🚀 It's Alive!</div>
        <div class="col-count" id="count-alive">0</div>
      </div>
      <div class="col-desc">Escaped the lab. Probably still has bugs. Ships and ladders.</div>
    </div>
    <div class="cards" id="cards-alive"></div>
  </div>
</div>

<footer>
  <span>No ideas were harmed in the making of this tracker. A few were mildly inconvenienced.</span>
  &nbsp;·&nbsp; built on cloudflare workers + d1 &nbsp;·&nbsp; <span>powered by procrastination</span>
</footer>

<!-- Modal -->
<div class="overlay" id="overlay" onclick="closeBg(event)">
  <div class="modal" onclick="event.stopPropagation()">
    <div class="modal-title" id="modal-title">⚡ New Idea</div>
    <div class="form-group">
      <label>TITLE *</label>
      <input type="text" id="f-title" placeholder="What's the big brain moment?" />
    </div>
    <div class="form-group">
      <label>CATEGORY</label>
      <select id="f-category">
        <option value="New Project">✨ New Project</option>
        <option value="Research">🔬 Research / Rabbit Hole</option>
        <option value="Upgrade">🔧 Upgrade / Overengineering</option>
      </select>
    </div>
    <div class="form-group">
      <label>STAGE</label>
      <select id="f-stage">
        <option value="eureka">💡 Eureka — just born</option>
        <option value="tinker">🧪 Tinkering — in progress</option>
        <option value="alive">🚀 It's Alive! — shipped</option>
      </select>
    </div>
    <div class="form-group">
      <label>NOTES &nbsp;<span style="font-weight:400;color:#334155">// brain dump, no judgment</span></label>
      <textarea id="f-notes" placeholder="Stream of consciousness welcome. Typos too."></textarea>
    </div>
    <div class="form-group">
      <label>LINK &nbsp;<span style="font-weight:400;color:#334155">// optional</span></label>
      <input type="url" id="f-link" placeholder="https://..." />
    </div>
    <div class="modal-foot">
      <button class="btn-del-modal" id="btn-del" style="display:none" onclick="deleteIdea()">🗑 Erase</button>
      <button class="btn-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-save" onclick="saveIdea()">Save →</button>
    </div>
  </div>
</div>

<!-- Passcode modal -->
<div id="passcode-overlay" onclick="closePasscodeModal()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1100;align-items:center;justify-content:center;backdrop-filter:blur(4px)">
  <div onclick="event.stopPropagation()" style="background:#0f1623;border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:28px 24px;width:300px;display:flex;flex-direction:column;gap:14px;box-shadow:0 30px 60px rgba(0,0,0,0.6)">
    <div style="font-weight:700;font-size:0.95rem;color:#e2e8f0">🔒 Passcode to save</div>
    <input type="password" inputmode="numeric" id="passcode-input" maxlength="6" placeholder="······" autocomplete="off"
      style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#e2e8f0;font-size:1.3rem;padding:10px 14px;outline:none;letter-spacing:8px;font-family:'JetBrains Mono',monospace;width:100%;text-align:center"
      onkeydown="if(event.key==='Enter')submitPasscode()" />
    <div id="passcode-error" style="color:#f87171;font-size:0.72rem;min-height:1rem;font-family:'JetBrains Mono',monospace;text-align:center"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="closePasscodeModal()" style="background:transparent;color:#64748b;padding:8px 16px;font-size:0.82rem;border:1px solid rgba(255,255,255,0.08);border-radius:8px;cursor:pointer;font-family:inherit">Cancel</button>
      <button onclick="submitPasscode()" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;padding:8px 20px;font-size:0.82rem;font-weight:700;border:none;border-radius:8px;cursor:pointer;font-family:inherit">Confirm →</button>
    </div>
  </div>
</div>

<div class="toasts" id="toasts"></div>

<script>
const STAGES = ['eureka', 'tinker', 'alive'];
const STAGE_LABEL = { eureka: '💡 Eureka', tinker: '🧪 Tinkering', alive: "🚀 It's Alive!" };
const BADGE = { Research: 'badge-research', 'New Project': 'badge-project', Upgrade: 'badge-upgrade' };
const BADGE_SHORT = { Research: 'research', 'New Project': 'project', Upgrade: 'upgrade' };
const PASSCODE = '210492';

const EMPTY = {
  eureka: {
    icon: '🌌',
    msg: "No sparks yet. Try a shower — 78% of great ideas happen in the shower.",
    sub: "// the other 22% happen at 3am"
  },
  tinker: {
    icon: '🦗',
    msg: "Nothing tinkering. Either you're very efficient or very avoidant.",
    sub: "// probably avoidant"
  },
  alive: {
    icon: '💀',
    msg: "The 'It's Alive!' column is... dead. Ironic.",
    sub: "// ship something, coward (affectionate)"
  }
};

const SAVE_TOASTS = [
  "Idea captured! Survival rate: ~40%. Good luck.",
  "Logged. The universe has been notified.",
  "Idea secured. Your future self will forget about this.",
  "📌 Pinned to the idea board. It's real now.",
  "Committed to the idea database. No going back.",
];

const MOVE_FWD_TOASTS = [
  "Moving on up! Look at you go. 🚀",
  "Progress! Actual, measurable progress!",
  "Advancing through the pipeline like a pro.",
];

const DELETE_TOASTS = [
  "Gone. It's in a better place. (the void)",
  "Deleted. Poured one out. 🫗",
  "Idea terminated. Ctrl+Z won't save you now.",
  "RIP this idea. It had so much potential.",
];

let ideas      = [];
let serverIdeas = [];
let editId     = null;
let dirty      = false;
let nextTmpId  = -1;
let sessionUnlocked = false;

function markDirty() {
  dirty = true;
  document.getElementById('btn-save-changes').style.display = 'inline-block';
}
function clearDirty() {
  dirty = false;
  document.getElementById('btn-save-changes').style.display = 'none';
}

async function load() {
  try {
    const r = await fetch('/api/ideas');
    if (!r.ok) throw new Error('fetch failed: ' + r.status);
    ideas = await r.json();
    if (!Array.isArray(ideas)) ideas = [];
  } catch(e) {
    ideas = [];
    toast('⚠ Could not load ideas: ' + e.message);
  }
  serverIdeas = JSON.parse(JSON.stringify(ideas));
  clearDirty();
  render();
}

function relTime(ts) {
  const diff = (Date.now() - new Date(ts + 'Z').getTime()) / 1000;
  if (diff < 120) return 'just now';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  if (diff < 86400*7) return Math.floor(diff/86400) + 'd ago';
  if (diff < 86400*30) return Math.floor(diff/86400/7) + 'w ago';
  if (diff < 86400*365) return Math.floor(diff/86400/30) + 'mo ago';
  return 'ages ago';
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function shortUrl(url) {
  try { const u = new URL(url); return u.hostname; } catch { return url.slice(0,28); }
}

function cardHTML(idea) {
  const si = STAGES.indexOf(idea.stage);
  const badgeCls = BADGE[idea.category] || 'badge-project';
  const badgeShort = BADGE_SHORT[idea.category] || 'project';
  return '<div class="card" data-id="' + idea.id + '">' +
    '<div class="card-head">' +
      '<div class="card-title">' + esc(idea.title) + '</div>' +
      '<span class="badge ' + badgeCls + '">' + badgeShort + '</span>' +
    '</div>' +
    (idea.notes ? '<div class="card-notes">' + esc(idea.notes) + '</div>' : '') +
    (idea.link ? '<div class="card-link"><a href="' + esc(idea.link) + '" target="_blank" rel="noopener">↗ ' + esc(shortUrl(idea.link)) + '</a></div>' : '') +
    '<div class="card-foot">' +
      '<span class="card-age">' + relTime(idea.created_at) + '</span>' +
      (si > 0 ? '<button class="btn-card" onclick="move(' + idea.id + ',-1)">← back</button>' : '') +
      (si < STAGES.length-1 ? '<button class="btn-card" onclick="move(' + idea.id + ',1)">next →</button>' : '') +
      '<button class="btn-card" onclick="editIdea(' + idea.id + ')">edit</button>' +
      '<button class="btn-nuke" onclick="nuke(' + idea.id + ')" title="Delete">✕</button>' +
    '</div>' +
  '</div>';
}

function render() {
  const total = ideas.length;
  document.getElementById('total-count').textContent = total + ' idea' + (total === 1 ? '' : 's') + ' in the reactor';

  for (const stage of STAGES) {
    const mine = ideas.filter(i => i.stage === stage);
    const colId = stage === 'tinkering' ? 'tinker' : stage;
    document.getElementById('count-' + colId).textContent = mine.length;
    const el = document.getElementById('cards-' + colId);
    if (!mine.length) {
      const e = EMPTY[colId] || EMPTY.eureka;
      el.innerHTML = '<div class="empty"><div class="empty-icon">' + e.icon + '</div><div class="empty-txt">' + e.msg + '<em>' + e.sub + '</em></div></div>';
    } else {
      el.innerHTML = mine.map(cardHTML).join('');
    }
  }
}

function moveTo(id, stage) {
  const idea = ideas.find(i => i.id === id);
  if (!idea || idea.stage === stage) return;
  const prevIdx = STAGES.indexOf(idea.stage);
  idea.stage = stage;
  markDirty();
  if (stage === 'alive') { confetti(); toast("🎉 IT'S ALIVE! Dr. Frankenstein would be proud."); }
  else toast(STAGES.indexOf(stage) > prevIdx ? pick(MOVE_FWD_TOASTS) : 'Moved back. No shame in regrouping. 💭');
  render();
}

function move(id, dir) {
  const idea = ideas.find(i => i.id === id);
  if (!idea) return;
  const newStage = STAGES[STAGES.indexOf(idea.stage) + dir];
  if (newStage) moveTo(id, newStage);
}

function nuke(id) {
  if (!confirm('Delete this idea? It will be yeet-ed into the void. Permanently.')) return;
  ideas = ideas.filter(i => i.id !== id);
  markDirty();
  toast(pick(DELETE_TOASTS));
  render();
}

function openModal(stage) {
  editId = null;
  document.getElementById('modal-title').textContent = '⚡ New Idea';
  document.getElementById('f-title').value = '';
  document.getElementById('f-category').value = 'New Project';
  document.getElementById('f-stage').value = stage || 'eureka';
  document.getElementById('f-notes').value = '';
  document.getElementById('f-link').value = '';
  document.getElementById('btn-del').style.display = 'none';
  document.getElementById('overlay').classList.add('open');
  setTimeout(() => document.getElementById('f-title').focus(), 50);
}

function editIdea(id) {
  const idea = ideas.find(i => i.id === id);
  if (!idea) return;
  editId = id;
  document.getElementById('modal-title').textContent = '✏️ Edit Idea';
  document.getElementById('f-title').value = idea.title;
  document.getElementById('f-category').value = idea.category;
  document.getElementById('f-stage').value = idea.stage;
  document.getElementById('f-notes').value = idea.notes || '';
  document.getElementById('f-link').value = idea.link || '';
  document.getElementById('btn-del').style.display = 'inline-block';
  document.getElementById('overlay').classList.add('open');
}

function closeModal() { document.getElementById('overlay').classList.remove('open'); }
function closeBg(e) { if (e.target.id === 'overlay') closeModal(); }

function saveIdea() {
  const title = document.getElementById('f-title').value.trim();
  if (!title) { document.getElementById('f-title').focus(); toast('⚠ Needs a title. Even "untitled idea" works.'); return; }
  const body = {
    title,
    category: document.getElementById('f-category').value,
    stage:    document.getElementById('f-stage').value,
    notes:    document.getElementById('f-notes').value.trim(),
    link:     document.getElementById('f-link').value.trim(),
  };
  if (editId) {
    Object.assign(ideas.find(i => i.id === editId), body);
    toast('Updated. Much improved. Probably. ✓');
  } else {
    ideas.push({ id: nextTmpId--, created_at: new Date().toISOString().replace('T',' ').slice(0,19), ...body });
    toast(pick(SAVE_TOASTS));
  }
  markDirty();
  closeModal();
  render();
}

function deleteIdea() {
  if (!editId) return;
  if (!confirm('Delete this idea? It will be yeet-ed into the void. Permanently.')) return;
  ideas = ideas.filter(i => i.id !== editId);
  markDirty();
  toast(pick(DELETE_TOASTS));
  closeModal();
  render();
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function toast(msg) {
  const wrap = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 3500);
}

function confetti() {
  const colors = ['#f59e0b','#10b981','#6366f1','#ec4899','#3b82f6','#a78bfa'];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.cssText = [
      'left:' + (10 + Math.random()*80) + '%',
      'top:-10px',
      'background:' + colors[Math.floor(Math.random()*colors.length)],
      'animation-duration:' + (1.2 + Math.random()*1.5) + 's',
      'animation-delay:' + (Math.random()*0.4) + 's',
      'width:' + (6 + Math.random()*6) + 'px',
      'height:' + (6 + Math.random()*6) + 'px',
      'border-radius:' + (Math.random() > 0.5 ? '50%' : '2px'),
    ].join(';');
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 3000);
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('passcode-overlay').style.display === 'flex') { closePasscodeModal(); return; }
    closeModal();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openModal(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); triggerSave(); }
});

// ── Passcode ──────────────────────────────────────────────────────────
function triggerSave() {
  if (!dirty) return;
  if (sessionUnlocked) { commitChanges(); return; }
  const el = document.getElementById('passcode-overlay');
  el.style.display = 'flex';
  document.getElementById('passcode-error').textContent = '';
  document.getElementById('passcode-input').value = '';
  setTimeout(() => document.getElementById('passcode-input').focus(), 50);
}
function closePasscodeModal() {
  document.getElementById('passcode-overlay').style.display = 'none';
}
function submitPasscode() {
  if (document.getElementById('passcode-input').value === PASSCODE) {
    sessionUnlocked = true;
    closePasscodeModal();
    commitChanges();
  } else {
    document.getElementById('passcode-error').textContent = 'Wrong passcode. Nice try.';
    document.getElementById('passcode-input').value = '';
    document.getElementById('passcode-input').focus();
  }
}

// ── Commit local changes to server ────────────────────────────────────
async function commitChanges() {
  const btn = document.getElementById('btn-save-changes');
  btn.textContent = '⏳ Saving...';
  btn.style.opacity = '0.6';
  try {
    for (const s of serverIdeas) {
      if (!ideas.find(i => i.id === s.id))
        await fetch('/api/ideas/' + s.id, { method: 'DELETE' });
    }
    for (const idea of ideas.filter(i => i.id < 0)) {
      const r = await fetch('/api/ideas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: idea.title, category: idea.category, notes: idea.notes, link: idea.link, stage: idea.stage })
      });
      if (r.ok) idea.id = (await r.json()).id;
    }
    for (const idea of ideas.filter(i => i.id > 0)) {
      const s = serverIdeas.find(x => x.id === idea.id);
      if (s && ['stage','title','category','notes','link'].some(k => idea[k] !== s[k]))
        await fetch('/api/ideas/' + idea.id, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: idea.title, category: idea.category, notes: idea.notes, link: idea.link, stage: idea.stage })
        });
    }
    serverIdeas = JSON.parse(JSON.stringify(ideas));
    clearDirty();
    toast('✓ Saved to the reactor. 💾');
    render();
  } catch(e) {
    toast('⚠ Save failed: ' + e.message);
    btn.textContent = '💾 Save';
    btn.style.opacity = '';
  }
}

window.addEventListener('beforeunload', e => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ── Drag and drop ─────────────────────────────────────────────────────
let dragId = null, dragCard = null, dragGhost = null, dragActive = false;
let dragStartX = 0, dragStartY = 0;

function onDragStart(e) {
  const card = e.target.closest('.card');
  if (!card || e.target.closest('.btn-card') || e.target.closest('.btn-nuke')) return;
  dragId = parseInt(card.dataset.id);
  dragCard = card;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragActive = false;
}

function onDragMove(e) {
  if (!dragId) return;
  if (!dragActive && Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > 8) {
    dragActive = true;
    dragGhost = dragCard.cloneNode(true);
    Object.assign(dragGhost.style, {
      position: 'fixed', pointerEvents: 'none', opacity: '0.85', zIndex: '9000',
      width: dragCard.offsetWidth + 'px', transform: 'rotate(2deg)',
      boxShadow: '0 8px 30px rgba(0,0,0,0.5)', transition: 'none', margin: '0'
    });
    document.body.appendChild(dragGhost);
    dragCard.style.opacity = '0.25';
    document.body.style.userSelect = 'none';
  }
  if (!dragActive || !dragGhost) return;
  dragGhost.style.left = (e.clientX - dragGhost.offsetWidth / 2) + 'px';
  dragGhost.style.top  = (e.clientY - 24) + 'px';
  document.querySelectorAll('.column').forEach(c => c.classList.remove('drop-target'));
  dragGhost.style.visibility = 'hidden';
  const under = document.elementFromPoint(e.clientX, e.clientY);
  dragGhost.style.visibility = '';
  const col = under && under.closest('.column');
  if (col) col.classList.add('drop-target');
}

function onDragEnd(e) {
  if (!dragId) return;
  document.querySelectorAll('.column').forEach(c => c.classList.remove('drop-target'));
  if (dragActive) {
    if (dragGhost) { dragGhost.remove(); dragGhost = null; }
    if (dragCard)  dragCard.style.opacity = '';
    document.body.style.userSelect = '';
    const ghost2 = document.createElement('div'); // temp for point detection
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const col = under && under.closest('.column');
    if (col) moveTo(dragId, col.id.replace('col-', ''));
  }
  dragId = null; dragCard = null; dragActive = false;
}

document.querySelector('.board').addEventListener('pointerdown', onDragStart);
document.addEventListener('pointermove', onDragMove);
document.addEventListener('pointerup',   onDragEnd);
document.addEventListener('pointercancel', onDragEnd);

load();
</script>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path === '/login') {
      if (method === 'POST') return handleLogin(request, env);
      return new Response(loginHTML(), { headers: { 'Content-Type': 'text/html' } });
    }
    if (path === '/logout') return handleLogout();
    if (path.startsWith('/api/ideas')) return handleAPI(request, env, url);

    return new Response(appHTML(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
};
