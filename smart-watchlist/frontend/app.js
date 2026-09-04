(() => {
  const API = '';
  let userId = localStorage.getItem('pulse_code');
  let catalog = [];
  let quotesBySymbol = {}; // latest annotated quotes for symbols currently on the watchlist
  let sortMode = 'attention';
  let ws = null;

  const el = (id) => document.getElementById(id);

  // ---------------- session bootstrap ----------------

  async function bootstrap() {
    if (!userId) {
      const res = await fetch('/api/session', { method: 'POST', headers: jsonHeaders(), body: '{}' });
      const data = await res.json();
      userId = data.userId;
      localStorage.setItem('pulse_code', userId);
    } else {
      // Validate the stored code still exists server-side (e.g. fresh install of the demo).
      const res = await fetch(`/api/session`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ code: userId }) });
      if (!res.ok) {
        localStorage.removeItem('pulse_code');
        return bootstrap();
      }
    }
    el('codeDisplay').textContent = userId;
    el('modalCodeDisplay').textContent = userId;
    loadCatalog();
    refreshAll();
    connectWs();
    loadStatus();
    setInterval(loadStatus, 15000);
  }

  async function loadStatus() {
    try {
      const res = await fetch('/api/status');
      const s = await res.json();
      const banner = el('statusBanner');
      if (s.forcedSimulated) {
        banner.textContent = `Running in simulated-only mode (PULSE_MODE=simulated) — all ${s.total} symbols are synthetic demo data.`;
        banner.className = 'status-banner all-simulated';
      } else if (s.real === s.total) {
        banner.textContent = `Live data: all ${s.total} symbols are on real quotes from Yahoo Finance right now.`;
        banner.className = 'status-banner all-real';
      } else if (s.real > 0) {
        banner.textContent = `${s.real} of ${s.total} symbols are on real Yahoo Finance quotes; ${s.simulated} fell back to simulated data (feed unreachable or rate-limited)${s.pending ? `, ${s.pending} still connecting` : ''}.`;
        banner.className = 'status-banner mixed';
      } else if (s.pending > 0) {
        banner.textContent = `Connecting to Yahoo Finance for real quotes… (${s.pending} of ${s.total} still trying)`;
        banner.className = 'status-banner';
      } else {
        banner.textContent = `Couldn't reach Yahoo Finance from this server — all ${s.total} symbols are running on simulated demo data instead.`;
        banner.className = 'status-banner all-simulated';
      }
      if (s.llm && s.llm.provider !== 'none') {
        banner.textContent += ` Devil's-advocate arguments use ${s.llm.provider === 'anthropic' ? `Anthropic (${s.llm.model})` : `Ollama (${s.llm.model}) if running locally, else the built-in templates`}.`;
      }
    } catch (e) { /* status is best-effort */ }
  }

  function jsonHeaders() { return { 'Content-Type': 'application/json' }; }

  // ---------------- data loading ----------------

  async function loadCatalog() {
    const res = await fetch('/api/symbols');
    catalog = await res.json();
  }

  async function refreshAll() {
    await Promise.all([loadWatchlist(), loadDigest()]);
  }

  async function loadWatchlist() {
    const res = await fetch(`/api/watchlist?userId=${encodeURIComponent(userId)}`);
    const data = await res.json();
    quotesBySymbol = {};
    for (const q of data.quotes) quotesBySymbol[q.symbol] = q;
    renderGrid();
    renderInsights(data.insights);
  }

  async function loadDigest() {
    const res = await fetch(`/api/digest?userId=${encodeURIComponent(userId)}`);
    const digest = await res.json();
    renderDigest(digest);
  }

  // ---------------- rendering: digest ----------------

  function renderDigest(digest) {
    const title = el('digestTitle');
    const body = el('digestBody');
    if (digest.isFirstVisit) {
      title.textContent = 'Welcome to your watchlist';
    } else {
      title.textContent = `Since you last checked · ${digest.elapsed}`;
    }
    body.innerHTML = '';
    if (!digest.items.length) {
      const div = document.createElement('div');
      div.className = 'empty-state';
      div.textContent = digest.isFirstVisit
        ? 'Add some symbols below to get started.'
        : 'Nothing crossed the meaningful-change threshold since your last visit. Quiet day.';
      body.appendChild(div);
      return;
    }
    for (const item of digest.items) {
      const row = document.createElement('div');
      row.className = item.kind === 'thesis' ? 'digest-item thesis' : `digest-item ${item.attentionLabel || ''}`;
      const text = document.createElement('span');
      text.textContent = item.headline;
      const chip = document.createElement('span');
      chip.className = 'score-chip';
      chip.textContent = `score ${item.attentionScore}`;
      row.appendChild(text);
      row.appendChild(chip);
      body.appendChild(row);
    }
  }

  function renderInsights(insights) {
    const row = el('insightsRow');
    row.innerHTML = '';
    for (const ins of (insights || [])) {
      const div = document.createElement('div');
      div.className = 'insight-banner';
      div.textContent = `📊 ${ins.headline}`;
      row.appendChild(div);
    }
  }

  // ---------------- rendering: grid ----------------

  function sortedSymbols() {
    const list = Object.values(quotesBySymbol);
    if (sortMode === 'attention') list.sort((a, b) => b.attentionScore - a.attentionScore);
    else if (sortMode === 'change') list.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
    else list.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return list;
  }

  const SORT_LABELS = { attention: 'Attention Score', change: '% Change', name: 'Symbol' };

  function renderGrid() {
    const grid = el('watchlistGrid');
    const empty = el('emptyWatchlist');
    const sortedLine = el('sortedByLine');
    const list = sortedSymbols();
    if (!list.length) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      sortedLine.textContent = '';
      return;
    }
    empty.classList.add('hidden');
    sortedLine.textContent = `Watching ${list.length} symbol${list.length === 1 ? '' : 's'} · sorted by ${SORT_LABELS[sortMode]}${list.length < 2 ? ' (add another symbol to see reordering)' : ''}`;
    grid.innerHTML = '';
    const tpl = el('cardTemplate');
    list.forEach((q, i) => {
      const node = tpl.content.cloneNode(true);
      const card = node.querySelector('.card');
      card.dataset.symbol = q.symbol;
      fillCard(card, q, i + 1);
      card.querySelector('.remove-btn').addEventListener('click', () => removeSymbol(q.symbol));
      card.querySelector('.sensitivity-select').addEventListener('change', (e) => setSensitivity(q.symbol, e.target.value));
      grid.appendChild(node);
    });
  }

  const STATUS_LABEL = { pending: 'Untested', confirmed: 'Confirmed', contradicted: 'Contradicted', stale: 'Gone stale' };
  const STANCE_LABEL = { bullish: 'Bullish', bearish: 'Bearish', neutral: 'Watching' };

  function fillCard(card, q, rank) {
    card.querySelector('.rank-badge').textContent = `#${rank}`;
    card.querySelector('.sym').textContent = q.symbol;
    card.querySelector('.name').textContent = `${q.name} · ${q.sector}`;
    const source = card.querySelector('.badge.source');
    source.textContent = q.source === 'real' ? 'Live · Yahoo' : 'Simulated';
    source.className = `badge source ${q.source}`;
    const quality = card.querySelector('.badge.quality');
    quality.textContent = q.dataQuality;
    quality.className = `badge quality ${q.dataQuality}`;
    card.querySelector('.price').textContent = `$${q.price.toFixed(2)}`;
    const change = card.querySelector('.change');
    change.textContent = `${q.changePct >= 0 ? '+' : ''}${(q.changePct * 100).toFixed(2)}%`;
    change.className = `change ${q.changePct >= 0 ? 'up' : 'down'}`;
    drawSparkline(card.querySelector('.spark'), q.sparkline, q.changePct >= 0);
    card.querySelector('.attention-fill').style.width = `${q.attentionScore}%`;
    card.querySelector('.attention-label').textContent = `${q.attentionLabel} · ${q.attentionScore}`;
    card.querySelector('.explanation').textContent = q.explanation;
    card.querySelector('.sector-tag').textContent = q.sector;
    const sel = card.querySelector('.sensitivity-select');
    sel.value = q.sensitivity || 'normal';

    const thesisSet = card.querySelector('.thesis-set');
    const thesisUnset = card.querySelector('.thesis-unset');
    if (q.thesis) {
      thesisSet.classList.remove('hidden');
      thesisUnset.classList.add('hidden');
      const stanceBadge = card.querySelector('.thesis-stance-badge');
      stanceBadge.textContent = STANCE_LABEL[q.thesis.stance] || q.thesis.stance;
      stanceBadge.className = `thesis-stance-badge ${q.thesis.stance}`;
      const statusBadge = card.querySelector('.thesis-status-badge');
      statusBadge.textContent = STATUS_LABEL[q.thesis.status] || q.thesis.status;
      statusBadge.className = `thesis-status-badge ${q.thesis.status}`;
      card.querySelector('.thesis-text').textContent = `"${q.thesis.text}"`;
      const counter = card.querySelector('.counter-argument');
      if (q.counterArgument) {
        counter.innerHTML = '';
        const label = document.createElement('span');
        label.className = 'ca-label';
        label.textContent = q.counterArgumentSource === 'llm' ? "🧠 Devil's advocate (AI-generated): " : "⚖️ Devil's advocate: ";
        counter.appendChild(label);
        counter.appendChild(document.createTextNode(q.counterArgument));
        counter.style.display = '';
      } else {
        counter.style.display = 'none';
      }
      card.querySelector('.edit-thesis-btn').onclick = () => openThesisModal(q.symbol, 'edit', q.thesis);
    } else {
      thesisSet.classList.add('hidden');
      thesisUnset.classList.remove('hidden');
      card.querySelector('.add-thesis-btn').onclick = () => openThesisModal(q.symbol, 'add', null);
    }
  }

  function drawSparkline(svg, points, up) {
    if (!points || points.length < 2) { svg.innerHTML = ''; return; }
    const min = Math.min(...points), max = Math.max(...points);
    const range = (max - min) || 1;
    const step = 100 / (points.length - 1);
    const d = points.map((p, i) => {
      const x = i * step;
      const y = 28 - ((p - min) / range) * 26 - 1;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    svg.innerHTML = `<path d="${d}" stroke="${up ? '#4fe3a1' : '#ff6b6b'}" />`;
  }

  function flashCard(symbol) {
    const card = document.querySelector(`.card[data-symbol="${symbol}"]`);
    if (!card) return;
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 700);
  }

  // ---------------- actions ----------------

  async function addSymbol(symbol, thesis, stance) {
    const body = { userId, symbol };
    if (thesis && stance) { body.thesis = thesis; body.stance = stance; }
    await fetch('/api/watchlist', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) });
    el('symbolSearch').value = '';
    el('symbolSuggestions').classList.add('hidden');
    await loadWatchlist();
  }

  async function saveThesis(symbol, thesis, stance) {
    await fetch('/api/thesis', {
      method: 'POST', headers: jsonHeaders(),
      body: JSON.stringify({ userId, symbol, thesis, stance }),
    });
    await loadWatchlist();
  }

  async function removeSymbol(symbol) {
    await fetch(`/api/watchlist/${symbol}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
    delete quotesBySymbol[symbol];
    renderGrid();
  }

  async function setSensitivity(symbol, sensitivity) {
    await fetch('/api/settings', {
      method: 'POST', headers: jsonHeaders(),
      body: JSON.stringify({ userId, symbol, sensitivity }),
    });
    await loadWatchlist();
  }

  async function ackDigest() {
    await fetch('/api/digest/ack', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ userId }) });
    await loadDigest();
  }

  // ---------------- websocket live updates ----------------

  function connectWs() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => el('wsDot').classList.add('live');
    ws.onclose = () => { el('wsDot').classList.remove('live'); setTimeout(connectWs, 2000); };
    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'tick' || msg.type === 'snapshot') {
        let changed = false;
        for (const raw of msg.quotes) {
          const existing = quotesBySymbol[raw.symbol];
          if (existing) {
            // Raw ticks come straight from the market engine and carry no
            // thesis/counter-argument data (that's computed server-side only
            // on a full watchlist fetch) - preserve it here rather than
            // silently dropping the thesis block on every price tick. It's
            // refreshed properly on the next periodic loadWatchlist().
            quotesBySymbol[raw.symbol] = {
              ...raw,
              sensitivity: existing.sensitivity,
              thesis: existing.thesis,
              counterArgument: existing.counterArgument,
              counterArgumentSource: existing.counterArgumentSource,
              ...annotateClientSide(raw, existing.sensitivity),
            };
            changed = true;
            flashCard(raw.symbol);
          }
        }
        if (changed) renderGrid();
      }
    };
  }

  // Lightweight mirror of the server's scoring so live ticks feel instant;
  // the server remains the source of truth on every full refresh/digest call.
  const CLIENT_SENSITIVITY_MULT = { low: 0.6, normal: 1.0, high: 1.5 };
  function annotateClientSide(q, sensitivity) {
    const mult = CLIENT_SENSITIVITY_MULT[sensitivity] || 1;
    const zComponent = Math.min(q.zScore, 4) * 15;
    const volComponent = Math.min(q.volSpike, 4) * 7.5;
    const rangeComponent = (q.rangePos > 0.92 || q.rangePos < 0.08) ? 10 : 0;
    const jumpBonus = q.recentJump ? 8 : 0;
    const score = Math.max(0, Math.min(100, Math.round((zComponent + volComponent + rangeComponent + jumpBonus) * mult)));
    const label = score >= 70 ? 'critical' : score >= 40 ? 'notable' : score >= 20 ? 'minor' : 'quiet';
    return {
      attentionScore: score,
      attentionLabel: label,
      explanation: q.changePct !== undefined
        ? `${q.symbol} is ${q.changePct >= 0 ? 'up' : 'down'} ${(q.changePct * 100).toFixed(2)}% right now.`
        : '',
    };
  }

  // ---------------- search / add UI ----------------

  function setupSearch() {
    const input = el('symbolSearch');
    const box = el('symbolSuggestions');
    input.addEventListener('input', () => {
      const term = input.value.trim().toUpperCase();
      if (!term) { box.classList.add('hidden'); return; }
      const matches = catalog.filter(c => c.symbol.includes(term) || c.name.toUpperCase().includes(term)).slice(0, 8);
      box.innerHTML = '';
      if (!matches.length) { box.classList.add('hidden'); return; }
      for (const m of matches) {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.innerHTML = `<span><span class="s-sym">${m.symbol}</span> ${m.name}</span><span class="muted small">${m.sector}</span>`;
        div.addEventListener('click', () => openThesisModal(m.symbol, 'new'));
        box.appendChild(div);
      }
      box.classList.remove('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!box.contains(e.target) && e.target !== input) box.classList.add('hidden');
    });
  }

  function setupModal() {
    el('switchDeviceBtn').addEventListener('click', () => el('switchDeviceModal').classList.remove('hidden'));
    el('closeModalBtn').addEventListener('click', () => el('switchDeviceModal').classList.add('hidden'));
    el('loadCodeBtn').addEventListener('click', async () => {
      const code = el('codeInput').value.trim().toUpperCase();
      if (!code) return;
      const res = await fetch('/api/session', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ code }) });
      if (!res.ok) { alert('Code not found'); return; }
      localStorage.setItem('pulse_code', code);
      location.reload();
    });
  }

  // ---------------- thesis modal ----------------

  let pendingSymbol = null;
  let pendingMode = 'new'; // 'new' | 'add' | 'edit'
  let selectedStance = null;

  function openThesisModal(symbol, mode, existingThesis) {
    pendingSymbol = symbol;
    pendingMode = mode;
    selectedStance = existingThesis ? existingThesis.stance : null;
    el('thesisModalSymbol').textContent = symbol;
    el('thesisText').value = existingThesis ? existingThesis.text : '';
    document.querySelectorAll('.stance-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.stance === selectedStance);
    });
    el('thesisSkipBtn').style.display = mode === 'new' ? '' : 'none';
    el('thesisSkipBtn').textContent = 'Skip — just track the price';
    el('thesisSaveBtn').textContent = mode === 'new' ? 'Add to watchlist' : 'Save';
    el('thesisModal').classList.remove('hidden');
    el('thesisText').focus();
  }

  function closeThesisModal() {
    el('thesisModal').classList.add('hidden');
    pendingSymbol = null;
  }

  function setupThesisModal() {
    document.querySelectorAll('.stance-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedStance = btn.dataset.stance;
        document.querySelectorAll('.stance-btn').forEach(b => b.classList.toggle('selected', b === btn));
      });
    });

    el('thesisSkipBtn').addEventListener('click', async () => {
      if (!pendingSymbol) return;
      const symbol = pendingSymbol;
      closeThesisModal();
      await addSymbol(symbol, null, null);
    });

    el('thesisSaveBtn').addEventListener('click', async () => {
      if (!pendingSymbol) return;
      const symbol = pendingSymbol;
      const mode = pendingMode;
      const text = el('thesisText').value.trim();
      if (text && !selectedStance) {
        alert('Pick a stance — Bullish, Bearish, or Just watching — before saving your thesis.');
        return; // keep the modal open so nothing gets silently mislabeled
      }
      const stance = selectedStance || 'neutral';
      closeThesisModal();
      if (mode === 'new') {
        await addSymbol(symbol, text || null, text ? stance : null);
      } else {
        await saveThesis(symbol, text, stance);
      }
    });
  }

  function setupMisc() {
    el('ackBtn').addEventListener('click', ackDigest);
    el('sortSelect').addEventListener('change', (e) => { sortMode = e.target.value; renderGrid(); });
    // Periodic refresh of digest + full watchlist (websocket ticks alone
    // don't carry thesis/counter-argument data - see the ws.onmessage note).
    setInterval(loadDigest, 30000);
    setInterval(loadWatchlist, 25000);
  }

  setupSearch();
  setupModal();
  setupThesisModal();
  setupMisc();
  bootstrap();
})();
