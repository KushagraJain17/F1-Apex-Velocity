(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════
     STATE
  ══════════════════════════════════════════════════════════ */
  let yearsData     = [];
  let currentDrivers = [];    // List from /drivers endpoint
  let sel           = null;    // primary driver telemetry data
  let tel           = null;    // sel.Telemetry

  // Playback
  let frameIdx      = 0;
  let N             = 0;
  let lapSec        = 90;
  let playing       = false;
  let playSpeed     = 1.0;
  let lastTs        = null;
  let rafId         = null;

  let chartInfos    = [];

  // Track map
  let validXs = [], validYs = [];
  let minX, maxX, minY, maxY, rangeX, rangeY;
  const VW = 500, VH = 500, PAD = 28;

  /* ══════════════════════════════════════════════════════════
     BOOT
  ══════════════════════════════════════════════════════════ */
  try {
    yearsData = JSON.parse(document.getElementById('years-data').textContent) || [];
  } catch (_) {}

  function tplClone(templateId) {
    const t = document.getElementById(templateId);
    return t ? t.content.cloneNode(true) : null;
  }
  function replaceSelectOptions(selectEl, templateId) {
    selectEl.innerHTML = '';
    const frag = tplClone(templateId);
    if (frag) selectEl.appendChild(frag);
  }

  const yearEl    = document.getElementById('yearSelect');
  const roundEl   = document.getElementById('roundSelect');
  const driverEl  = document.getElementById('driverSelect');

  yearEl.addEventListener('change', () => fetchSchedule(yearEl.value));
  roundEl.addEventListener('change', () => fetchDrivers());
  driverEl.addEventListener('change', () => loadTelemetry());

  // Initial load
  fetchSchedule(yearEl.value);

  /* ── Playback controls ─────────────────────────────────── */
  document.getElementById('btnPlay').addEventListener('click', togglePlay);
  document.getElementById('btnRewind').addEventListener('click', () => {
    seekTo(0); if (playing) { stopPlay(); startPlay(); }
  });
  document.getElementById('btnFF').addEventListener('click', () => {
    playSpeed = Math.min(playSpeed * 2, 32);
    document.getElementById('speedSel').value = playSpeed;
  });
  document.getElementById('speedSel').addEventListener('change', function () {
    playSpeed = parseFloat(this.value);
  });
  const scrubTrack = document.getElementById('scrubTrack');
  if (scrubTrack) {
    scrubTrack.addEventListener('mousedown', onScrubStart);
    scrubTrack.addEventListener('touchstart', onScrubStartTouch, { passive: false });
  }

  /* ══════════════════════════════════════════════════════════
     API FETCHERS
  ══════════════════════════════════════════════════════════ */
  function fetchSchedule(year) {
    setLoading(true);
    resetView();
    replaceSelectOptions(roundEl, 'tl-tmpl-opt-loading');
    fetch(`/api/schedule/${year}`)
      .then(r => r.json())
      .then(res => {
        setLoading(false);
        replaceSelectOptions(roundEl, 'tl-tmpl-opt-select');
        if (res.status === 'success' && res.events) {
          const now = Date.now();
          res.events.forEach(e => {
            const t = new Date(e.EventDateTimeIso).getTime();
            if (!isNaN(t) && t < now && e.RoundNumber > 0) {
              const o = document.createElement('option');
              o.value = e.RoundNumber;
              o.textContent = `R${String(e.RoundNumber).padStart(2,'0')} · ${e.EventName}`;
              roundEl.appendChild(o);
            }
          });
        }
      });
  }

  function fetchDrivers() {
    const y = yearEl.value;
    const r = roundEl.value;
    if (!r) return;
    setLoading(true);
    resetView();
    replaceSelectOptions(driverEl, 'tl-tmpl-opt-loading');
    fetch(`/api/telemetry/${y}/${r}/drivers`)
      .then(r => r.json())
      .then(res => {
        setLoading(false);
        if (res.status === 'success') {
          currentDrivers = res.data;
          document.getElementById('eventLabel').textContent = (res.event || '').toUpperCase();
          replaceSelectOptions(driverEl, 'tl-tmpl-opt-select');
          driverEl.disabled = false;
          res.data.forEach(d => {
            const o1 = document.createElement('option');
            o1.value = d.Abbreviation; o1.textContent = `${d.Abbreviation} · ${d.Driver}`;
            driverEl.appendChild(o1);
          });
          renderDriverList(res.data);
        }
      });
  }

  function loadTelemetry() {
    const y = yearEl.value;
    const r = roundEl.value;
    const d = driverEl.value;
    if (!d) return;

    setLoading(true);
    stopPlay();
    fetch(`/api/telemetry/${y}/${r}/qualifying?driver=${d}`)
      .then(r => r.json())
      .then(res => {
        setLoading(false);
        if (res.status === 'success') {
          sel = res.data;
          tel = sel.Telemetry;
          window._currentCorners = res.corners || []; // Store corners
          
          if (!tel) {
            showChartsEmpty(`No telemetry available for ${sel.Driver}.`);
            return;
          }

          N = tel.Speed.length;
          lapSec = sel.LapTimeSec || 90;
          
          if (res.weather) renderWeather(res.weather);

          document.getElementById('statsCol').style.display = 'flex';
          renderDriverList(currentDrivers); // Update highlights
          renderDriverCard();
          buildCharts();
          buildTrackMap();
          document.getElementById('playbackBar').style.display = 'flex';
          seekTo(0);
          startPlay();
        }
      });
  }

  function renderWeather(w) {
    document.getElementById('wAir').textContent = (w.AirTemp || 0).toFixed(1) + '°C';
    document.getElementById('wTrack').textContent = (w.TrackTemp || 0).toFixed(1) + '°C';
    document.getElementById('wHum').textContent = (w.Humidity || 0).toFixed(0) + '%';
    document.getElementById('wWind').textContent = (w.WindSpeed || 0).toFixed(1) + ' km/h';
  }

  /* ══════════════════════════════════════════════════════════
     UI RENDERING
  ══════════════════════════════════════════════════════════ */
  function renderDriverList(drivers) {
    const list = document.getElementById('driverList');
    if (!list) return;
    list.innerHTML = '';
    drivers.forEach(d => {
      const dfrag = tplClone('tl-tmpl-driver-row');
      const row = dfrag && dfrag.firstElementChild;
      if (!row) return;
      if (sel && d.Abbreviation === sel.Abbreviation) row.classList.add('active');
      const posEl = row.querySelector('.tl-drow-pos');
      const abbrEl = row.querySelector('.tl-drow-abbr');
      const teamEl = row.querySelector('.tl-drow-t');
      posEl.style.color = d.Position <= 3 ? d.Color : 'rgba(255,255,255,0.35)';
      posEl.textContent = d.Position;
      abbrEl.style.color = d.Color;
      abbrEl.textContent = d.Abbreviation;
      teamEl.textContent = d.Team;
      row.addEventListener('click', () => {
        driverEl.value = d.Abbreviation;
        loadTelemetry();
      });
      list.appendChild(row);
    });
  }

  function renderDriverCard() {
    const card = document.getElementById('driverCard');
    if (!card) return;
    const frag = tplClone('tl-tmpl-driver-card');
    const root = frag && frag.firstElementChild;
    if (!root) return;
    const nameEl = root.querySelector('.tl-dcard-name');
    nameEl.textContent = sel.Driver;
    nameEl.style.color = sel.Color;
    nameEl.style.borderColor = sel.Color;
    root.querySelector('.tl-dcard-time').textContent = sel.BestTime;
    root.querySelector('.tl-dcard-team').textContent = sel.Team;
    card.innerHTML = '';
    card.appendChild(root);
  }

  function buildCharts() {
    chartInfos = [];
    const scroll = document.getElementById('chartsScroll');
    if (!scroll) return;
    scroll.innerHTML = '';

    const defs = [
      {
        id: 'chartSpeed', label: 'Speed (km/h)', h: 140,
        draw(ctx, W, H) {
          const sMax = Math.max(...(tel.Speed||[]), 1);
          const tDist = tel.Distance || [];
          const maxD = tDist[tDist.length-1] || 1;
          drawGrid(ctx, W, H, 4);
          
          // Outer Glow for visibility if team color is dark
          ctx.shadowBlur = 4;
          ctx.shadowColor = 'rgba(255,255,255,0.3)';
          
          ctx.beginPath(); ctx.strokeStyle = sel.Color; ctx.lineWidth = 2.5;
          tel.Speed.forEach((v,i) => {
            const x = (tDist[i] / maxD) * W;
            const y = H - (v / sMax) * H;
            i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
          });
          ctx.stroke();
          
          // Reset shadow
          ctx.shadowBlur = 0;
        }
      },
      {
        id: 'chartThrottle', label: 'Throttle %', h: 80,
        draw(ctx, W, H) {
          const tDist = tel.Distance || [];
          const maxD = tDist[tDist.length-1] || 1;
          drawGrid(ctx, W, H, 2);
          ctx.beginPath(); ctx.strokeStyle = '#2ef550'; ctx.lineWidth = 2;
          tel.Throttle.forEach((v,i) => {
            const x = (tDist[i] / maxD) * W;
            const y = H - (v / 100) * H;
            i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
          });
          ctx.stroke();
        }
      },
      {
        id: 'chartBrake', label: 'Brake Status', h: 40,
        draw(ctx, W, H) {
          const tDist = tel.Distance || [];
          const maxD = tDist[tDist.length-1] || 1;
          ctx.fillStyle = 'rgba(225,6,0,0.4)'; // Increased opacity
          tel.Brake.forEach((v,i) => {
            if (v) {
              const x = (tDist[i] / maxD) * W;
              ctx.fillRect(x, H * 0.1, 2, H * 0.9);
            }
          });
          ctx.beginPath(); ctx.strokeStyle = '#E10600'; ctx.lineWidth = 2;
          tel.Brake.forEach((v,i) => {
            const x = (tDist[i] / maxD) * W;
            // Lift the baseline up by 2px so it's not clipped by the bottom border
            const y = H - (v ? H*0.8 : 2);
            i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
          });
          ctx.stroke();
        }
      },
      {
        id: 'chartGear', label: 'Gear', h: 60,
        draw(ctx, W, H) {
          const tDist = tel.Distance || [];
          const maxD = tDist[tDist.length-1] || 1;
          drawGrid(ctx, W, H, 2);
          ctx.lineWidth = 2.5;
          for(let i=0; i < tel.Gear.length - 1; i++) {
            const g = tel.Gear[i];
            const x1 = (tDist[i] / maxD) * W;
            const x2 = (tDist[i+1] / maxD) * W;
            const y = H - (g / 8) * (H * 0.8) - (H * 0.1);
            ctx.beginPath(); ctx.strokeStyle = gearColor(g);
            ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
          }
        }
      }
    ];

    defs.forEach(cfg => {
      const block = document.createElement('div');
      block.className = 'tl-chart-block';
      const lbl = document.createElement('div');
      lbl.className = 'tl-chart-label';
      lbl.textContent = cfg.label;
      block.appendChild(lbl);
      const wrap = document.createElement('div');
      wrap.className = 'tl-chart-wrapper';
      const canvas = document.createElement('canvas');
      canvas.className = 'tl-canvas';
      canvas.style.height = cfg.h + 'px';
      const ph = document.createElement('div');
      ph.className = 'tl-playhead'; ph.style.left = '0px';

      wrap.appendChild(canvas); wrap.appendChild(ph);
      block.appendChild(wrap); scroll.appendChild(block);

      wrap.addEventListener('mousedown', onChartScrubStart);

      requestAnimationFrame(() => {
        const W = wrap.offsetWidth;
        if (W <= 0) return;
        const PR = window.devicePixelRatio || 1;
        canvas.width = W * PR; canvas.height = cfg.h * PR;
        const ctx = canvas.getContext('2d');
        ctx.scale(PR, PR);
        cfg.draw(ctx, W, cfg.h);
        chartInfos.push({ W, ph });
      });
    });
  }

  function showChartsEmpty(msg) {
     const scroll = document.getElementById('chartsScroll');
     if (!scroll) return;
     scroll.innerHTML = '';
     const frag = tplClone('tl-tmpl-charts-empty-error');
     if (frag) {
       const span = frag.querySelector('.tl-empty-msg');
       if (span) span.textContent = msg;
       scroll.appendChild(frag);
     }
  }

  function buildTrackMap() {
    const xs = tel.X || [], ys = tel.Y || [], spds = tel.Speed || [];
    validXs = []; validYs = [];
    const validSpds = [];
    xs.forEach((x,i) => { if (x!=null && ys[i]!=null) { validXs.push(x); validYs.push(ys[i]); validSpds.push(spds[i]||100); } });
    if (!validXs.length) return;

    minX = Math.min(...validXs); maxX = Math.max(...validXs);
    minY = Math.min(...validYs); maxY = Math.max(...validYs);
    rangeX = maxX-minX || 1; rangeY = maxY-minY || 1;

    const trkW = VW - 2*PAD, trkH = VH - 2*PAD;
    const dataAspect = rangeX / rangeY;
    const svgAspect  = trkW / trkH;
    let scaleX = trkW / rangeX, scaleY = trkH / rangeY;
    if (dataAspect > svgAspect) scaleY = scaleX; else scaleX = scaleY;
    const offsetX = PAD + (trkW - rangeX*scaleX)/2;
    const offsetY = PAD + (trkH - rangeY*scaleY)/2;

    window._toSvg = (xi, yi) => [
      offsetX + (xi - minX) * scaleX,
      VH - offsetY - (yi - minY) * scaleY
    ];

    // Background base track
    const pts = validXs.map((x,i) => window._toSvg(x, validYs[i]).join(',')).join(' ');
    document.getElementById('trackLine').setAttribute('points', pts);

    // Heatmap
    const heat = document.getElementById('trackHeatmap');
    heat.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for(let i=0; i<validXs.length-1; i++) {
        const [x1, y1] = window._toSvg(validXs[i], validYs[i]);
        const [x2, y2] = window._toSvg(validXs[i+1], validYs[i+1]);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute('x1', x1); line.setAttribute('y1', y1);
        line.setAttribute('x2', x2); line.setAttribute('y2', y2);
        line.setAttribute('stroke', speedColorRamp(validSpds[i]/340));
        line.setAttribute('stroke-width', '6');
        line.setAttribute('stroke-linecap', 'round');
        fragment.appendChild(line);
    }
    heat.appendChild(fragment);

    // Corners
    const cnrs = document.getElementById('trackCorners');
    cnrs.innerHTML = '';
    const cFrag = document.createDocumentFragment();
    (window._currentCorners || []).forEach(c => {
        if (c.X == null || c.Y == null) return;
        const [cx, cy] = window._toSvg(c.X, c.Y);
        
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circ.setAttribute('cx', cx); circ.setAttribute('cy', cy); circ.setAttribute('r', '7');
        circ.setAttribute('fill', 'rgba(0,0,0,0.85)'); circ.setAttribute('stroke', 'rgba(255,255,255,0.5)'); circ.setAttribute('stroke-width', '0.5');
        
        const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
        txt.setAttribute('x', cx); txt.setAttribute('y', cy); txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('dominant-baseline', 'middle'); txt.setAttribute('fill', '#fff');
        txt.setAttribute('font-size', '5'); txt.setAttribute('font-family', 'Formula1-Bold, Space Grotesk, sans-serif');
        txt.setAttribute('font-weight', '900'); txt.textContent = c.Number;
        
        g.appendChild(circ); g.appendChild(txt);
        cFrag.appendChild(g);
    });
    cnrs.appendChild(cFrag);

    const dot = document.getElementById('driverDot');
    const lbl = document.getElementById('driverDotLbl');
    dot.setAttribute('fill', sel.Color);
    lbl.textContent = sel.Abbreviation;
  }

  /* ══════════════════════════════════════════════════════════
     PLAYBACK ENGINE
  ══════════════════════════════════════════════════════════ */
  function startPlay() { playing = true; document.getElementById('playIcon').textContent = 'pause'; document.getElementById('playText').textContent = 'PAUSE'; lastTs = null; rafId = requestAnimationFrame(tick); }
  function stopPlay() { playing = false; document.getElementById('playIcon').textContent = 'play_arrow'; document.getElementById('playText').textContent = 'PLAY'; if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
  function togglePlay() { if (!sel) return; playing ? stopPlay() : startPlay(); }

  function tick(ts) {
    if (!playing) return;
    if (lastTs === null) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    frameIdx += dt * playSpeed * (N / lapSec);
    if (frameIdx >= N) { frameIdx = N - 1; stopPlay(); }
    updateFrame(frameIdx);
    if (playing) rafId = requestAnimationFrame(tick);
  }

  function seekTo(idx) { frameIdx = Math.max(0, Math.min(idx, N-1)); updateFrame(frameIdx); }

  function updateFrame(fi) {
    const i = Math.floor(fi);
    const pct = N > 1 ? fi / (N - 1) : 0;
    chartInfos.forEach(c => { c.ph.style.left = (pct * c.W) + 'px'; });
    const pctStr = (pct*100).toFixed(2) + '%';
    document.getElementById('scrubFill').style.width = pctStr;
    document.getElementById('scrubThumb').style.left = pctStr;
    document.getElementById('timeDisplay').textContent = fmtTime((fi / N) * lapSec);

    const spd = getSample(tel.Speed, i);
    const gear = getSample(tel.Gear, i);
    const thr = getSample(tel.Throttle, i);
    const brk = getSample(tel.Brake, i);

    document.getElementById('liveSpeed').textContent = spd != null ? Math.round(spd) : '—';
    document.getElementById('liveSpeed').style.color = spd != null ? speedColorRamp(spd/340) : '#fff';
    document.getElementById('liveGear').textContent = gear != null ? Math.round(gear) : '—';
    document.getElementById('liveGear').style.color = gear != null ? gearColor(gear) : '#fff';
    document.getElementById('liveThrottle').textContent = thr != null ? Math.round(thr) : '—';
    document.getElementById('liveThrottle').style.color = thr != null && thr > 50 ? '#2ef550' : '#ff9900';
    document.getElementById('liveBrake').textContent = brk ? 'ON' : 'OFF';
    document.getElementById('liveBrake').style.color = brk ? '#E10600' : 'rgba(255,255,255,0.35)';
    
    const drs = getSample(tel.DRS, i);
    const drsEl = document.getElementById('liveDrs');
    // FastF1: 10, 12, 14 means DRS is Open/Active. 1 is just enabled/eligible.
    if (drs >= 10) { 
      drsEl.textContent = 'OPEN'; 
      drsEl.className = 'badge badge-live'; 
    } else { 
      drsEl.textContent = 'OFF'; 
      drsEl.className = 'badge badge-dim'; 
    }

    if (validXs.length && window._toSvg) {
      const mapIdx = Math.floor(fi / N * validXs.length);
      const [cx, cy] = window._toSvg(validXs[mapIdx], validYs[mapIdx]);
      const dot = document.getElementById('driverDot');
      const lbl = document.getElementById('driverDotLbl');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
      lbl.setAttribute('x', cx);  lbl.setAttribute('y', cy);
    }
  }

  /* ══════════════════════════════════════════════════════════
     HELPERS
  ══════════════════════════════════════════════════════════ */
  function onScrubStart(e) {
    e.preventDefault();
    const scrub = ev => scrubToPct(pctFromEvent(ev.touches ? ev.touches[0] : ev, scrubTrack));
    scrub(e);
    const up = () => { document.removeEventListener('mousemove', scrub); document.removeEventListener('mouseup', up); document.removeEventListener('touchmove', scrub); document.removeEventListener('touchend', up); };
    document.addEventListener('mousemove', scrub); document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', scrub, { passive: false }); document.addEventListener('touchend', up);
  }
  function onScrubStartTouch(e) { onScrubStart(e); }
  function onChartScrubStart(e) {
    if (!N) return;
    const wrap = e.currentTarget;
    const scrub = ev => {
      const r = wrap.getBoundingClientRect();
      scrubToPct(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)));
    };
    scrub(e);
    const up = () => { document.removeEventListener('mousemove', scrub); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', scrub); document.addEventListener('mouseup', up);
  }
  function pctFromEvent(e, el) { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); }
  function scrubToPct(p) { stopPlay(); seekTo(p * (N-1)); }

  function resetView() {
    stopPlay(); sel = null; tel = null; N = 0; chartInfos = [];
    const scroll = document.getElementById('chartsScroll');
    if (scroll) {
      scroll.innerHTML = '';
      const frag = tplClone('tl-tmpl-charts-empty-prompt');
      if (frag) scroll.appendChild(frag);
    }
    document.getElementById('playbackBar').style.display = 'none';
    document.getElementById('statsCol').style.display = 'none';
  }
  function setLoading(on) { 
    const spinner = document.getElementById('topSpinner');
    if (spinner) spinner.style.display = on ? 'flex' : 'none'; 
  }
  function getSample(arr, i) { if (!arr || !arr.length) return null; return arr[Math.min(i, arr.length-1)]; }
  function fmtTime(sec) { const m = Math.floor(sec/60), s = Math.floor(sec%60), ms = Math.floor((sec%1)*1000); return `${m}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`; }
  function hexAlpha(hex, a) { if (!hex || hex.length < 7) return `rgba(255,255,255,${a})`; const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16); return `rgba(${r},${g},${b},${a})`; }
  function gearColor(g) {
    // Neon palette for high contrast on dark backgrounds
    const p = ['#00ffff','#0fbafc','#2ef550','#60ff40',
               '#e0ff00','#ffaa00','#ff5500','#ff0000'];
    return p[Math.min(Math.max(Math.round(g)-1,0),7)];
  }

  function speedColorRamp(t) {
    t = Math.max(0, Math.min(1, t));
    const stops = [
      [0,   [60, 80, 255]],
      [0.3, [0, 200, 255]],
      [0.6, [0, 240, 100]],
      [0.8, [255, 220, 0]],
      [1.0, [255, 30, 0]],
    ];
    for (let j = 1; j < stops.length; j++) {
      const [t0, c0] = stops[j-1];
      const [t1, c1] = stops[j];
      if (t <= t1) {
        const f = (t - t0) / (t1 - t0);
        const r = Math.round(c0[0] + f*(c1[0]-c0[0]));
        const g = Math.round(c0[1] + f*(c1[1]-c0[1]));
        const b = Math.round(c0[2] + f*(c1[2]-c0[2]));
        return `rgb(${r},${g},${b})`;
      }
    }
    return 'rgb(255,30,0)';
  }
  function drawGrid(ctx, W, H, lines) { ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.lineWidth=1; for(let i=1;i<lines;i++){ const y=i/lines*H; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); } }

})();
