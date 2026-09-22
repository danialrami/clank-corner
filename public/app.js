(() => {
  'use strict';

  const ACTIONS = {
    jab: { cost: 1, text: '2 damage' },
    heavy: { cost: 3, text: '5 damage' },
    guard: { cost: 0, text: 'Reduce attacks by 3' },
    counter: { cost: 2, text: 'Answer jab / heavy for 4' },
    recharge: { cost: 0, text: 'Restore 2 energy' },
    feint: { cost: 2, text: '2 through guard / counter' },
  };

  const byId = (id) => document.getElementById(id);
  const setup = byId('setup');
  const arena = byId('arena');
  const replayPanel = byId('replay-panel');
  const errorBox = byId('error');
  const terminalTools = byId('terminal-tools');
  const moveContainer = byId('moves');

  let match = null;
  let replay = null;
  let replayIndex = 0;
  let busy = false;
  let requestSequence = 0; // Per-session idempotency key, never an authentication secret.
  let eventSource = null;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.textContent = '';
    errorBox.hidden = true;
  }

  async function api(path, options = {}, raw = false) {
    const response = await fetch(path, options);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = body && typeof body.message === 'string' ? body.message : `HTTP ${response.status}`;
      throw new Error(message);
    }
    if (raw) return body;
    if (!body || body.status !== 'success') throw new Error('Invalid service response');
    return body.data;
  }

  function currentConfig() {
    return {
      players: {
        A: {
          name: byId('fighter-name').value,
          role: 'external',
          style: null,
          coachNote: byId('coach-note').value,
        },
        B: {
          name: 'Clank',
          role: 'bot',
          style: byId('opponent-style').value,
          coachNote: '',
        },
      },
      turnDeadlineMs: 60000,
    };
  }

  function setText(id, value) {
    byId(id).textContent = String(value);
  }

  function renderMeters(view) {
    for (const seat of ['A', 'B']) {
      const lower = seat.toLowerCase();
      setText(`name-${lower}`, view.players[seat].name);
      setText(`hp-${lower}`, view.fighters[seat].hp);
      setText(`energy-${lower}`, view.fighters[seat].energy);
      byId(`hpbar-${lower}`).value = view.fighters[seat].hp;
      byId(`enbar-${lower}`).value = view.fighters[seat].energy;
    }
  }

  function renderMoves(legalActions, disabled) {
    const legal = new Set(legalActions.map((action) => action.type));
    moveContainer.replaceChildren();
    for (const [type, rule] of Object.entries(ACTIONS)) {
      const button = document.createElement('button');
      button.className = 'move';
      button.type = 'button';
      button.dataset.action = type;
      button.disabled = disabled || !legal.has(type);
      const title = document.createElement('strong');
      title.textContent = `${type} · ${rule.cost} EN`;
      const description = document.createElement('span');
      description.textContent = rule.text;
      button.append(title, description);
      button.addEventListener('click', () => submitAction(type));
      moveContainer.append(button);
    }
  }

  function describeLastEvent(view) {
    const event = view.events.at(-1);
    if (!event) {
      setText('event-title', 'The bell is ready.');
      setText('event-detail', 'Moves stay hidden until both seats submit.');
      return;
    }
    setText('event-title', `Turn ${event.turn}: ${event.actions.A.type} vs ${event.actions.B.type}`);
    setText('event-detail', `${view.players.A.name} took ${event.damage.B}; ${view.players.B.name} took ${event.damage.A}. Energy Δ A ${formatDelta(event.deltas.A.energy)}, B ${formatDelta(event.deltas.B.energy)}.`);
  }

  function formatDelta(value) {
    return value >= 0 ? `+${value}` : String(value);
  }

  async function refresh() {
    if (!match) return;
    const id = match.id;
    const seatToken = match.seatToken;
    const [publicData, own] = await Promise.all([
      api(`/api/matches/${encodeURIComponent(id)}`),
      seatToken ? api(`/api/matches/${encodeURIComponent(id)}/observe`, {
        headers: { authorization: `Bearer ${seatToken}` },
      }) : Promise.resolve({ legalActions: [], ownActionPending: false }),
    ]);
    if (!match || match.id !== id) return;
    if (match.view && (publicData.events.length < match.view.events.length || (match.view.status !== 'active' && publicData.status === 'active'))) return;
    match.view = publicData;
    setText('seat-a-label', seatToken ? 'A · Your fighter' : `A · ${publicData.players.A.role}`);
    setText('seat-b-label', `B · ${publicData.players.B.role}`);
    setText('move-title', seatToken ? 'Seal your move' : 'Spectating · moves are read-only');
    byId('rematch').hidden = !match.hostToken;
    renderMeters(publicData);
    const terminal = publicData.status !== 'active';
    setText('turn-label', terminal ? `Final turn ${publicData.result.finalTurn}` : `Turn ${publicData.turn} / 8`);
    setText('match-state', terminal ? (publicData.status === 'aborted' ? 'Aborted' : 'Complete') : 'Active');
    byId('match-state').classList.toggle('terminal', terminal);
    setText('pending-label', terminal
      ? resultText(publicData)
      : !seatToken ? 'Watching sealed decisions' : own.ownActionPending ? 'Your move is sealed' : 'Waiting for your sealed move');
    renderMoves(own.legalActions, terminal || own.ownActionPending);
    describeLastEvent(publicData);
    terminalTools.hidden = !terminal;
    if (terminal) {
      closeStream();
      setup.hidden = false;
      setText('event-title', resultText(publicData));
      await loadReplay();
    }
  }

  function resultText(view) {
    if (!view.result) return 'No result';
    if (view.result.status === 'aborted') return `Bout aborted · ${view.result.reason}`;
    if (view.result.winner === null) return `Draw · ${view.result.reason}`;
    return `${view.players[view.result.winner].name} wins · ${view.result.reason}`;
  }

  function closeStream() {
    if (eventSource) eventSource.close();
    eventSource = null;
  }

  function openStream() {
    closeStream();
    if (!match || match.view.status !== 'active') return;
    const id = match.id;
    const source = new EventSource(`/api/matches/${encodeURIComponent(id)}/stream`);
    source.addEventListener('snapshot', () => {
      if (match?.id === id) refresh().catch(error => showError(error.message));
    });
    eventSource = source;
  }

  async function watchBout() {
    const id = byId('watch-id').value.trim();
    if (!/^[a-f0-9-]{36}$/i.test(id)) { showError('Enter a valid match ID.'); return; }
    try {
      clearError();
      const view = await api(`/api/matches/${encodeURIComponent(id)}`);
      closeStream();
      match = { id, hostToken: null, seatToken: null, view };
      replay = null;
      replayIndex = 0;
      arena.hidden = false;
      replayPanel.hidden = true;
      await refresh();
      openStream();
    } catch (error) { showError(error.message); }
  }

  async function createBout(rematch) {
    if (busy) return;
    busy = true;
    clearError();
    try {
      const path = rematch && match ? `/api/matches/${encodeURIComponent(match.id)}/rematch` : '/api/matches';
      const headers = { 'content-type': 'application/json' };
      if (rematch && match) headers.authorization = `Bearer ${match.hostToken}`;
      const data = await api(path, {
        method: 'POST',
        headers,
        body: JSON.stringify({ config: currentConfig() }),
      });
      closeStream();
      match = { id: data.id, hostToken: data.hostToken, seatToken: data.tokens.A, view: data.view };
      replay = null;
      replayIndex = 0;
      setup.hidden = true;
      arena.hidden = false;
      replayPanel.hidden = true;
      await refresh();
      openStream();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Could not create bout');
    } finally {
      busy = false;
    }
  }

  async function submitAction(type) {
    if (!match || busy) return;
    busy = true;
    clearError();
    renderMoves([], true);
    try {
      const turn = match.view.turn;
      await api(`/api/matches/${encodeURIComponent(match.id)}/actions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${match.seatToken}`,
        },
        body: JSON.stringify({
          leg: 1,
          turn,
          action: { type },
          requestId: `browser-${turn}-${++requestSequence}`,
        }),
      });
      await refresh();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Could not submit move');
      await refresh().catch(() => {});
    } finally {
      busy = false;
    }
  }

  async function loadReplay() {
    if (!match) return;
    replay = await api(`/api/matches/${encodeURIComponent(match.id)}/replay`, {}, true);
    byId('replay-range').max = String(replay.events.length);
    replayIndex = Math.min(replayIndex, replay.events.length);
    renderReplay();
  }

  function renderReplay() {
    if (!replay) return;
    const event = replayIndex === 0 ? null : replay.events[replayIndex - 1];
    const fighters = event ? event.after : { A: { hp: 12, energy: 3 }, B: { hp: 12, energy: 3 } };
    setText('replay-name-a', replay.config.players.A.name);
    setText('replay-name-b', replay.config.players.B.name);
    setText('replay-hp-a', fighters.A.hp);
    setText('replay-en-a', fighters.A.energy);
    setText('replay-hp-b', fighters.B.hp);
    setText('replay-en-b', fighters.B.energy);
    setText('replay-step', replayIndex === 0 ? `Start · 0 / ${replay.events.length}` : `Turn ${replayIndex} / ${replay.events.length}`);
    setText('replay-event', event
      ? `${event.actions.A.type} vs ${event.actions.B.type}. Damage dealt: A ${event.damage.A}, B ${event.damage.B}.`
      : 'Before the first exchange.');
    byId('replay-range').value = String(replayIndex);
    byId('replay-prev').disabled = replayIndex === 0;
    byId('replay-next').disabled = replayIndex === replay.events.length;
    setText('replay-verification', `Replay carries ${replay.rulesVersion} transitions and SHA-256 ${replay.hash.slice(0, 12)}… Use the CLI to recompute and verify it.`);
  }

  async function inspectReplay() {
    try {
      clearError();
      await loadReplay();
      replayPanel.hidden = false;
      replayPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Could not load replay');
    }
  }

  async function exportReplay() {
    try {
      clearError();
      if (!replay) await loadReplay();
      const blob = new Blob([`${JSON.stringify(replay, null, 2)}\n`], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `clank-corner-${match.id}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Could not export replay');
    }
  }

  byId('watch-bout').addEventListener('click', watchBout);
  byId('create-bout').addEventListener('click', () => createBout(false));
  byId('rematch').addEventListener('click', () => createBout(true));
  byId('inspect-replay').addEventListener('click', inspectReplay);
  byId('download-replay').addEventListener('click', exportReplay);
  byId('replay-prev').addEventListener('click', () => { replayIndex -= 1; renderReplay(); });
  byId('replay-next').addEventListener('click', () => { replayIndex += 1; renderReplay(); });
  byId('replay-range').addEventListener('input', (event) => {
    replayIndex = Number(event.currentTarget.value);
    renderReplay();
  });
})();
