window.addEventListener('error', (event) => {
  const box = document.getElementById('status');
  if (box) {
    box.textContent = 'Application error: ' + (event.message || 'Unknown error');
    box.style.color = '#ff9a9a';
  }
});

if (!window.rosterAPI) {
  const box = document.getElementById('status');
  if (box) {
    box.textContent = 'Desktop bridge did not load. Close the app and run INSTALL_WINDOWS.bat again.';
    box.style.color = '#ff9a9a';
  }
}

let roster = [];

const $ = (id) => document.getElementById(id);
const status = $('status');
const progressBar = $('progressBar');

function setStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? '#ff9a9a' : '#b9c3d7';
}

function updateCounts() {
  $('playerCount').textContent = roster.length;
  $('photoCount').textContent = roster.filter((p) => p.image).length;
  $('bioCount').textContent = roster.filter((p) => p.bio).length;
  $('saveCsvBtn').disabled = roster.length === 0;
  $('saveJsonBtn').disabled = roster.length === 0;
}

function render() {
  const query = $('search').value.trim().toLowerCase();
  const filtered = roster.filter((player) =>
    Object.values(player).some((value) => String(value || '').toLowerCase().includes(query))
  );

  $('rosterBody').innerHTML = filtered.length
    ? filtered.map((player) => `
      <tr>
        <td>${escapeHtml(player.number)}</td>
        <td>${player.profile ? `<a href="#" data-url="${escapeAttr(player.profile)}">${escapeHtml(player.name)}</a>` : escapeHtml(player.name)}</td>
        <td>${escapeHtml(player.position)}</td>
        <td>${escapeHtml(player.class)}</td>
        <td>${escapeHtml(player.height)}</td>
        <td>${escapeHtml(player.weight)}</td>
        <td>${escapeHtml(player.hometown)}</td>
        <td>${escapeHtml(player.previousSchool)}</td>
        <td class="${player.image ? 'yes' : 'no'}">${player.image ? 'Yes' : 'No'}</td>
        <td class="${player.bio ? 'yes' : 'no'}">${player.bio ? 'Yes' : 'No'}</td>
      </tr>`).join('')
    : '<tr><td colspan="10" class="empty">No matching players.</td></tr>';

  document.querySelectorAll('[data-url]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      window.rosterAPI.openExternal(link.dataset.url);
    });
  });

  updateCounts();
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function escapeAttr(value = '') {
  return escapeHtml(value);
}

window.rosterAPI.onProgress((payload) => {
  const pct = payload.total ? Math.round((payload.current / payload.total) * 100) : 0;
  progressBar.style.width = `${pct}%`;
  setStatus(`Fetching bios ${payload.current} of ${payload.total}: ${payload.name}`);
});

$('buildBtn').addEventListener('click', async () => {
  const url = $('rosterUrl').value.trim();
  if (!url) {
    setStatus('Paste a roster URL first.', true);
    return;
  }

  $('buildBtn').disabled = true;
  roster = [];
  render();
  progressBar.style.width = '5%';
  setStatus('Downloading and reading the roster page...');

  try {
    const result = await window.rosterAPI.build({
      url,
      includeBios: $('biosCheck').checked
    });
    roster = result.players;
    progressBar.style.width = '100%';
    setStatus(`Roster built successfully: ${result.count} players.`);
    render();
  } catch (error) {
    progressBar.style.width = '0';
    setStatus(error.message || 'Roster build failed.', true);
  } finally {
    $('buildBtn').disabled = false;
  }
});

$('saveCsvBtn').addEventListener('click', async () => {
  const result = await window.rosterAPI.save({
    players: roster,
    format: 'csv',
    defaultName: 'football-roster.csv'
  });
  if (!result.canceled) setStatus(`CSV saved: ${result.filePath}`);
});

$('saveJsonBtn').addEventListener('click', async () => {
  const result = await window.rosterAPI.save({
    players: roster,
    format: 'json',
    defaultName: 'football-roster.json'
  });
  if (!result.canceled) setStatus(`JSON saved: ${result.filePath}`);
});

$('search').addEventListener('input', render);
render();
