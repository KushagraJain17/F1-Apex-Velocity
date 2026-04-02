(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════
     STATE
  ══════════════════════════════════════════════════════════ */
  let yearsData = [];
  let currentDrivers = [];    // List from /drivers endpoint
  let sel = null;    // primary driver telemetry data
  let tel = null;    // sel.Telemetry

  // Playback
  let frameIdx = 0;
  let N = 0;
  let lapSec = 90;
  let playing = false;
  let playSpeed = 1.0;
  let lastTs = null;
  let rafId = null;

  let chartInfos = [];

  // Track map
  let validXs = [], validYs = [];
  let minX, maxX, minY, maxY, rangeX, rangeY;
  const VW = 500, VH = 500, PAD = 28;

  /* ══════════════════════════════════════════════════════════
     BOOT
  ══════════════════════════════════════════════════════════ */
  try {
    yearsData = JSON.parse(document.getElementById('years-data').textContent) || [];
  } catch (_) { }

  function tplClone(templateId) {
    const t = document.getElementById(templateId);
    return t ? t.content.cloneNode(true) : null;
  }
  function replaceSelectOptions(selectEl, templateId) {
    selectEl.innerHTML = '';
    const frag = tplClone(templateId);
    if (frag) selectEl.appendChild(frag);
  }

  const yearEl = document.getElementById('yearSelect');
  const roundEl = document.getElementById('roundSelect');
  yearEl.addEventListener('change', () => fetchSchedule(yearEl.value));
  roundEl.addEventListener('change', () => fetchDrivers());

  // Initial load
  fetchSchedule(yearEl.value);

  /* ── Playback controls ─────────────────────────────────── */
  document.getElementById('btnPlay').addEventListener('click', togglePlay);
  document.getElementById('btnRewind').addEventListener('click', () => {
    seekTo(0); if (playing) { stopPlay(); startPlay(); }
  });
  document.getElementById('btnFF').addEventListener('click', () => {
    playSpeed = Math.min(playSpeed * 2, 8);
    document.getElementById('speedSel').value = playSpeed;
  });

  // Resize Handling
  const resizeObs = new ResizeObserver(() => {
    if (tel && tel.Distance && tel.Distance.length) {
      buildCharts();
    }
  });
  const primaryArea = document.querySelector('.tl-primary-area');
  if (primaryArea) resizeObs.observe(primaryArea);

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
              o.textContent = `R${String(e.RoundNumber).padStart(2, '0')} · ${e.EventName}`;
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
    fetch(`/api/telemetry/${y}/${r}/drivers`)
      .then(resp => resp.json())
      .then(res => {
        setLoading(false);
        if (res.status === 'success' && res.data) {
          currentDrivers = res.data;
          document.getElementById('eventLabel').textContent = (res.event || '').toUpperCase();
          renderDriverList(res.data);
        } else {
          showChartsEmpty(res.message || 'Error loading driver list.');
        }
      })
      .catch(err => {
        setLoading(false);
        showChartsEmpty('Connection error while fetching drivers.');
      });
  }

  function loadTelemetry(driverAbbr) {
    if (!driverAbbr) return;
    const y = yearEl.value;
    const r = roundEl.value;
    setLoading(true);
    stopPlay();
    fetch(`/api/telemetry/${y}/${r}/qualifying?driver=${driverAbbr}`)
      .then(resp => resp.json())
      .then(res => {
        setLoading(false);
        if (res.status === 'success' && res.data) {
          sel = res.data;
          tel = sel.Telemetry;
          window._currentCorners = res.corners || [];

          if (!tel || !tel.Speed || !tel.Speed.length) {
            showChartsEmpty(`No telemetry available for ${sel.Driver}.`);
            return;
          }

          N = tel.Speed.length;
          lapSec = sel.LapTimeSec || 90;

          if (res.weather) renderWeather(res.weather);

          const statsCol = document.getElementById('statsCol');
          const intelCol = document.getElementById('intelCol');
          if (statsCol) statsCol.style.display = 'block';
          if (intelCol) intelCol.style.display = 'block';

          renderDriverList(currentDrivers);
          renderDriverCard();
          buildCharts();
          buildTrackMap();
          document.getElementById('playbackBar').style.display = 'block';
          seekTo(0);
          startPlay();
        } else {
          showChartsEmpty(res.message || 'Could not load telemetry.');
        }
      })
      .catch(err => {
        setLoading(false);
        showChartsEmpty('Connection error while loading telemetry.');
      });
  }

  function showChartsEmpty(msg) {
    const scroll = document.getElementById('chartsScroll');
    if (!scroll) return;
    scroll.innerHTML = '';
    const frag = tplClone('tl-tmpl-charts-empty-error');
    const root = frag && frag.firstElementChild;
    if (root) {
      const msgEl = root.querySelector('.tl-empty-msg');
      if (msgEl) msgEl.textContent = msg;
      scroll.appendChild(root);
    }
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
      posEl.style.color = d.Position <= 3 ? d.Color : 'rgba(255,255,255,0.35)'; // Highlighting top 3
      posEl.textContent = d.Position;
      abbrEl.style.color = d.Color;
      abbrEl.textContent = d.Abbreviation;
      teamEl.textContent = d.Team;
      row.addEventListener('click', () => {
        document.querySelectorAll('.tl-drow').forEach(r => r.classList.remove('active'));
        row.classList.add('active');
        loadTelemetry(d.Abbreviation);
      });
      list.appendChild(row);
    });
  }

  function renderDriverCard() {
    const card = document.getElementById('driverCard');
    if (!card || !sel) return;
    const frag = tplClone('tl-tmpl-driver-card');
    const root = frag && frag.firstElementChild;
    if (!root) return;
    const nameEl = root.querySelector('.tl-dcard-name');
    if (nameEl) {
      nameEl.textContent = sel.Driver || 'Unknown';
      nameEl.style.color = sel.Color || '#ffffff';
      nameEl.style.borderColor = sel.Color || '#ffffff';
    }
    const timeEl = root.querySelector('.tl-dcard-time');
    if (timeEl) timeEl.textContent = sel.BestTime || '–';
    const teamEl = root.querySelector('.tl-dcard-team');
    if (teamEl) teamEl.textContent = sel.Team || 'Formula 1';
    card.innerHTML = '';
    card.appendChild(root);
  }

  function buildCharts() {
    chartInfos = [];
    const scroll = document.getElementById('chartsScroll');
    if (!scroll || !tel) return;
    scroll.innerHTML = '';

    const defs = [
      {
        id: 'chartSpeed', label: 'VELOCITY (km/h)', h: 180,
        draw(ctx, W, H) {
          const tDist = tel.Distance || [], spds = tel.Speed || [];
          const validSpds = spds.filter(v => v != null);
          const sMax = validSpds.length ? Math.max(...validSpds) : 340;
          const maxD = tDist[tDist.length - 1] || 1;
          drawGrid(ctx, W, H, 5);

          // Velocity Gradient
          const grad = ctx.createLinearGradient(0, H, 0, 0);
          grad.addColorStop(0, '#6080ff'); grad.addColorStop(0.5, '#2ef550'); grad.addColorStop(1, '#ff3000');
          
          ctx.shadowBlur = 10;
          ctx.shadowColor = hexAlpha(sel.Color, 0.4);
          ctx.strokeStyle = sel.Color; 
          ctx.lineWidth = 3.5; 
          ctx.beginPath();

          let started = false;
          spds.forEach((v, i) => {
            if (v == null || tDist[i] == null) { started = false; return; }
            const x = (tDist[i] / maxD) * W;
            const y = H - (v / sMax) * H;
            if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
          });
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Area Fill
          ctx.lineTo(W, H); ctx.lineTo(0, H); 
          const areaGrad = ctx.createLinearGradient(0, 0, 0, H);
          areaGrad.addColorStop(0, hexAlpha(sel.Color, 0.1));
          areaGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = areaGrad; 
          ctx.fill();
        }
      },
      {
        id: 'chartThrottle', label: 'THROTTLE INTENSITY %', h: 100,
        draw(ctx, W, H) {
          const tDist = tel.Distance || [], thrs = tel.Throttle || [];
          const maxD = tDist[tDist.length - 1] || 1;
          drawGrid(ctx, W, H, 3);
          
          const grad = ctx.createLinearGradient(0, H, 0, 0);
          grad.addColorStop(0, 'rgba(46, 245, 80, 0.05)');
          grad.addColorStop(1, 'rgba(46, 245, 80, 0.3)');
          
          ctx.beginPath();
          ctx.moveTo(0, H);
          thrs.forEach((v, i) => {
            const x = (tDist[i] / maxD) * W;
            const y = H - (v / 100) * H;
            ctx.lineTo(x,y);
          });
          ctx.lineTo(W, H);
          ctx.fillStyle = grad;
          ctx.fill();

          ctx.strokeStyle = '#2ef550'; ctx.lineWidth = 2.5; ctx.beginPath();
          let started = false;
          thrs.forEach((v, i) => {
            if (v == null || tDist[i] == null) { started = false; return; }
            const x = (tDist[i] / maxD) * W;
            const y = H - (v / 100) * H;
            if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
          });
          ctx.stroke();
        }
      },
      {
        id: 'chartBrake', label: 'BRAKING FORCE', h: 60,
        draw(ctx, W, H) {
          const tDist = tel.Distance || [], brks = tel.Brake || [];
          const maxD = tDist[tDist.length - 1] || 1;
          ctx.fillStyle = 'rgba(225, 6, 0, 0.2)';
          let inBrake = false, startX = 0;
          for (let i = 0; i < N; i++) {
            const v = brks[i], x = (tDist[i] / maxD) * W;
            if (v && !inBrake) { inBrake = true; startX = x; }
            else if (!v && inBrake) {
              inBrake = false; const width = x - startX;
              if (width > 0) {
                ctx.fillRect(startX, 0, width, H);
                ctx.fillStyle = '#E10600'; ctx.fillRect(startX, 0, width, 2);
                ctx.fillStyle = 'rgba(225, 6, 0, 0.2)';
              }
            }
          }
        }
      },
      {
        id: 'chartGear', label: 'GEAR ENGAGEMENT', h: 80,
        draw(ctx, W, H) {
          const tDist = tel.Distance || [], gears = tel.Gear || [];
          const maxD = tDist[tDist.length - 1] || 1;
          drawGrid(ctx, W, H, 2); ctx.lineWidth = 5;
          for (let i = 0; i < N - 1; i++) {
            const g = gears[i], x1 = (tDist[i] / maxD) * W, x2 = (tDist[i + 1] / maxD) * W;
            if (g == null) continue;
            const y = H - (g / 8) * (H * 0.8) - (H * 0.1);
            ctx.beginPath(); ctx.strokeStyle = gearColor(g); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
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
    // N is already tel.Speed.length which matches xs.length from backend

    // Calculate bounds using all available points
    const numericXs = xs.filter(x => x !== null);
    const numericYs = ys.filter(y => y !== null);
    if (!numericXs.length) return;

    minX = Math.min(...numericXs); maxX = Math.max(...numericXs);
    minY = Math.min(...numericYs); maxY = Math.max(...numericYs);
    rangeX = maxX - minX || 1; rangeY = maxY - minY || 1;

    const trkW = VW - 2 * PAD, trkH = VH - 2 * PAD;
    const dataAspect = rangeX / rangeY;
    const svgAspect = trkW / trkH;
    let scaleX = trkW / rangeX, scaleY = trkH / rangeY;
    if (dataAspect > svgAspect) scaleY = scaleX; else scaleX = scaleY;
    const offsetX = PAD + (trkW - rangeX * scaleX) / 2;
    const offsetY = PAD + (trkH - rangeY * scaleY) / 2;

    window._toSvg = (xi, yi) => {
      if (xi == null || yi == null) return null;
      return [
        offsetX + (xi - minX) * scaleX,
        VH - offsetY - (yi - minY) * scaleY
      ];
    };

    // Background base track - only draw numeric segments
    const trackLine = document.getElementById('trackLine');
    let pts = "";
    xs.forEach((x, i) => {
      const coord = window._toSvg(x, ys[i]);
      if (coord) pts += (pts ? " " : "") + coord.join(',');
    });
    trackLine.setAttribute('points', pts);

    // Heatmap - skip segments with null coordinates
    const heat = document.getElementById('trackHeatmap');
    heat.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < N - 1; i++) {
      const p1 = window._toSvg(xs[i], ys[i]);
      const p2 = window._toSvg(xs[i + 1], ys[i + 1]);
      if (!p1 || !p2) continue;

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute('x1', p1[0]); line.setAttribute('y1', p1[1]);
      line.setAttribute('x2', p2[0]); line.setAttribute('y2', p2[1]);
      line.setAttribute('stroke', speedColorRamp(spds[i] / 340));
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
      const coord = window._toSvg(c.X, c.Y);
      if (!coord) return;

      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circ.setAttribute('cx', coord[0]); circ.setAttribute('cy', coord[1]); circ.setAttribute('r', '7');
      circ.setAttribute('fill', 'rgba(0,0,0,0.85)'); circ.setAttribute('stroke', 'rgba(255,255,255,0.5)'); circ.setAttribute('stroke-width', '0.5');

      const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
      txt.setAttribute('x', coord[0]); txt.setAttribute('y', coord[1]); txt.setAttribute('text-anchor', 'middle');
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

  function seekTo(idx) { frameIdx = Math.max(0, Math.min(idx, N - 1)); updateFrame(frameIdx); }

  function updateFrame(fi) {
    const i = Math.floor(fi);
    const dist = getSample(tel.Distance, i) || 0;
    const maxD = tel.Distance[N - 1] || 1;
    const pct = dist / maxD;

    chartInfos.forEach(c => { c.ph.style.left = (pct * c.W) + 'px'; });
    const pctScrub = N > 1 ? fi / (N - 1) : 0;
    const pctStr = (pctScrub * 100).toFixed(2) + '%';
    document.getElementById('scrubFill').style.width = pctStr;
    document.getElementById('scrubThumb').style.left = pctStr;
    document.getElementById('timeDisplay').textContent = fmtTime((fi / N) * lapSec);

    const spd = getSample(tel.Speed, i);
    const gear = getSample(tel.Gear, i);
    const thr = getSample(tel.Throttle, i);
    const brk = getSample(tel.Brake, i);

    document.getElementById('liveSpeed').textContent = spd != null ? Math.round(spd) : '—';
    document.getElementById('liveSpeed').style.color = spd != null ? speedColorRamp(spd / 340) : '#fff';
    document.getElementById('liveGear').textContent = gear != null ? Math.round(gear) : '—';
    document.getElementById('liveGear').style.color = gear != null ? gearColor(gear) : '#fff';
    document.getElementById('liveThrottle').textContent = thr != null ? Math.round(thr) : '—';
    document.getElementById('liveThrottle').style.color = thr != null && thr > 50 ? '#2ef550' : '#ff9900';
    document.getElementById('liveBrake').textContent = brk ? 'ON' : 'OFF';
    document.getElementById('liveBrake').style.color = brk ? '#E10600' : 'rgba(255,255,255,0.35)';

    const drs = getSample(tel.DRS, i);
    const drsEl = document.getElementById('liveDrs');
    if (drs >= 10) {
      drsEl.textContent = 'OPEN';
      drsEl.className = 'badge badge-live';
    } else {
      drsEl.textContent = 'OFF';
      drsEl.className = 'badge badge-dim';
    }

    if (window._toSvg) {
      const coord = window._toSvg(tel.X[i], tel.Y[i]);
      if (coord) {
        const dot = document.getElementById('driverDot');
        const lbl = document.getElementById('driverDotLbl');
        dot.setAttribute('cx', coord[0]); dot.setAttribute('cy', coord[1]);
        lbl.setAttribute('x', coord[0]); lbl.setAttribute('y', coord[1]);
      }
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
  function scrubToPct(p) { stopPlay(); seekTo(p * (N - 1)); }

  function resetView() {
    stopPlay(); sel = null; tel = null; N = 0; chartInfos = [];
    const scroll = document.getElementById('chartsScroll');
    if (scroll) {
      scroll.innerHTML = '';
      const frag = tplClone('tl-tmpl-charts-empty-prompt');
      if (frag) scroll.appendChild(frag);
    }
    document.getElementById('playbackBar').style.display = 'none';
    const statsCol = document.getElementById('statsCol');
    const intelCol = document.getElementById('intelCol');
    if (statsCol) statsCol.style.display = 'none';
    if (intelCol) intelCol.style.display = 'none';
  }
  function setLoading(on) {
    const spinner = document.getElementById('topSpinner');
    if (spinner) spinner.style.display = on ? 'flex' : 'none';
  }
  function getSample(arr, i) { if (!arr || !arr.length) return null; return arr[Math.min(i, arr.length - 1)]; }
  function fmtTime(sec) { const m = Math.floor(sec / 60), s = Math.floor(sec % 60), ms = Math.floor((sec % 1) * 1000); return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`; }
  function hexAlpha(hex, a) { if (!hex || hex.length < 7) return `rgba(255,255,255,${a})`; const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return `rgba(${r},${g},${b},${a})`; }
  function gearColor(g) {
    // Neon palette for high contrast on dark backgrounds
    const p = ['#00ffff', '#0fbafc', '#2ef550', '#60ff40',
      '#e0ff00', '#ffaa00', '#ff5500', '#ff0000'];
    return p[Math.min(Math.max(Math.round(g) - 1, 0), 7)];
  }

  function speedColorRamp(t) {
    t = Math.max(0, Math.min(1, t));
    const stops = [
      [0, [60, 80, 255]],
      [0.3, [0, 200, 255]],
      [0.6, [0, 240, 100]],
      [0.8, [255, 220, 0]],
      [1.0, [255, 30, 0]],
    ];
    for (let j = 1; j < stops.length; j++) {
      const [t0, c0] = stops[j - 1];
      const [t1, c1] = stops[j];
      if (t <= t1) {
        const f = (t - t0) / (t1 - t0);
        const r = Math.round(c0[0] + f * (c1[0] - c0[0]));
        const g = Math.round(c0[1] + f * (c1[1] - c0[1]));
        const b = Math.round(c0[2] + f * (c1[2] - c0[2]));
        return `rgb(${r},${g},${b})`;
      }
    }
    return 'rgb(255,30,0)';
  }
  function drawGrid(ctx, W, H, lines) { ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; for (let i = 1; i < lines; i++) { const y = i / lines * H; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); } }

})();
