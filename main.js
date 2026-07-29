import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#111318',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function clean(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function absolute(value, base) {
  if (!value) return '';
  try {
    return new URL(value, base).href;
  } catch {
    return '';
  }
}

function firstText($root, selectors) {
  for (const selector of selectors) {
    const value = clean($root.find(selector).first().text());
    if (value) return value;
  }
  return '';
}

function firstAttr($root, selectors, attributes) {
  for (const selector of selectors) {
    const node = $root.find(selector).first();
    if (!node.length) continue;
    for (const attribute of attributes) {
      const value = node.attr(attribute);
      if (value) return value;
    }
  }
  return '';
}

function normalizeNumber(value = '') {
  const match = String(value).match(/\d{1,3}/);
  return match ? match[0] : '';
}

function labelValue($root, labels) {
  const text = clean($root.text());
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stop =
      '(?=\\s+(?:Position|Academic Year|Class|Year|Height|Weight|Hometown|Last School|Previous School|High School|Full Bio|Expand)\\b|$)';
    const match = text.match(new RegExp(`${escaped}\\s*:?\\s*(.*?)${stop}`, 'i'));
    if (match && clean(match[1])) return clean(match[1]);
  }
  return '';
}

function parsePlayerCard($, element, baseUrl) {
  const card = $(element);
  const profile = absolute(firstAttr(card, [
    'a[href*="/sports/football/roster/"]',
    'a[href*="/roster/"]',
    '.sidearm-roster-player-name a'
  ], ['href']), baseUrl);

  let name = firstText(card, [
    '.sidearm-roster-player-name h3',
    '.sidearm-roster-player-name',
    '[class*="roster-player-name"] h3',
    '[class*="roster-player-name"]',
    'h3'
  ]);

  name = name.replace(/^\s*#?\d+\s+/, '').trim();
  if (!name || name.length > 120 || /football roster/i.test(name)) return null;

  const number = normalizeNumber(
    firstText(card, [
      '.sidearm-roster-player-jersey-number',
      '.sidearm-roster-player-jersey',
      '[class*="jersey-number"]',
      '[class*="jersey"]'
    ]) || card.attr('data-number') || ''
  );

  const position =
    firstText(card, [
      '.sidearm-roster-player-position',
      '[class*="roster-player-position"]',
      '[class*="position"]'
    ]) || labelValue(card, ['Position']);

  const playerClass =
    firstText(card, [
      '.sidearm-roster-player-academic-year',
      '.sidearm-roster-player-year',
      '.sidearm-roster-player-class',
      '[class*="academic-year"]',
      '[class*="player-year"]'
    ]) || labelValue(card, ['Academic Year', 'Class', 'Year']);

  const height =
    firstText(card, [
      '.sidearm-roster-player-height',
      '[class*="player-height"]',
      '[class*="height"]'
    ]) || labelValue(card, ['Height']);

  const weight = (
    firstText(card, [
      '.sidearm-roster-player-weight',
      '[class*="player-weight"]',
      '[class*="weight"]'
    ]) || labelValue(card, ['Weight'])
  ).replace(/\s*lbs?\.?$/i, '');

  const hometown =
    firstText(card, [
      '.sidearm-roster-player-hometown',
      '[class*="player-hometown"]',
      '[class*="hometown"]'
    ]) || labelValue(card, ['Hometown']);

  const previousSchool =
    firstText(card, [
      '.sidearm-roster-player-previous-school',
      '.sidearm-roster-player-highschool',
      '.sidearm-roster-player-high-school',
      '[class*="previous-school"]',
      '[class*="last-school"]',
      '[class*="highschool"]'
    ]) || labelValue(card, ['Last School', 'Previous School', 'High School']);

  let imageValue = firstAttr(card, ['img'], [
    'data-src',
    'data-original',
    'data-lazy-src',
    'src'
  ]);
  if (!imageValue) {
    const srcset = firstAttr(card, ['img'], ['data-srcset', 'srcset']);
    if (srcset) imageValue = srcset.split(',')[0].trim().split(/\s+/)[0];
  }

  return {
    number,
    name,
    position,
    height,
    weight,
    class: playerClass,
    hometown,
    previousSchool,
    image: absolute(imageValue, baseUrl),
    profile,
    bio: ''
  };
}

function parseSidearm(html, baseUrl) {
  const $ = cheerio.load(html);
  const selectors = [
    '.sidearm-roster-player',
    'li.sidearm-roster-player',
    'div.sidearm-roster-player',
    'article.sidearm-roster-player',
    '[class*="sidearm-roster-player"]'
  ];

  let nodes = $();
  for (const selector of selectors) {
    const found = $(selector);
    if (found.length > nodes.length) nodes = found;
  }

  const players = [];
  const seen = new Set();

  nodes.each((_, element) => {
    const player = parsePlayerCard($, element, baseUrl);
    if (!player) return;
    const key = `${player.number}|${player.name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    players.push(player);
  });

  return players;
}

function parseTable(html, baseUrl) {
  const $ = cheerio.load(html);
  const players = [];
  const seen = new Set();

  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;

    const text = cells.map((__, cell) => clean($(cell).text())).get();
    const profileNode = $(row).find('a[href*="/roster/"]').first();
    const profile = absolute(profileNode.attr('href'), baseUrl);
    const name = clean(profileNode.text()) || text.find((value) => /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(value)) || '';
    if (!name) return;

    const number = normalizeNumber(text[0]);
    const image = absolute($(row).find('img').first().attr('src') || '', baseUrl);
    const player = {
      number,
      name,
      position: text[2] || '',
      height: text.find((value) => /^\d[-'′]\d{1,2}/.test(value)) || '',
      weight: text.find((value) => /^\d{3}$/.test(value)) || '',
      class: text.find((value) => /^(Fr|So|Jr|Sr|Freshman|Sophomore|Junior|Senior|R-)/i.test(value)) || '',
      hometown: '',
      previousSchool: '',
      image,
      profile,
      bio: ''
    };

    const key = `${player.number}|${player.name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    players.push(player);
  });

  return players;
}

function parseJsonLd(html, baseUrl) {
  const $ = cheerio.load(html);
  const players = [];
  const seen = new Set();

  $('script[type="application/ld+json"]').each((_, script) => {
    try {
      const parsed = JSON.parse($(script).html() || '');
      const roots = Array.isArray(parsed) ? parsed : [parsed];
      for (const root of roots) {
        const entries = [
          ...(Array.isArray(root?.itemListElement) ? root.itemListElement : []),
          ...(Array.isArray(root?.['@graph']) ? root['@graph'] : [])
        ];
        for (const entry of entries) {
          const item = entry?.item || entry;
          const name = clean(item?.name || '');
          if (!name || /football roster/i.test(name)) continue;
          const player = {
            number: '',
            name,
            position: '',
            height: '',
            weight: '',
            class: '',
            hometown: '',
            previousSchool: '',
            image: absolute(Array.isArray(item.image) ? item.image[0] : item.image, baseUrl),
            profile: absolute(item.url, baseUrl),
            bio: clean(item.description || '')
          };
          const key = player.name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          players.push(player);
        }
      }
    } catch {
      // Skip invalid blocks.
    }
  });

  return players;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache'
    }
  });

  if (!response.ok) throw new Error(`Website returned HTTP ${response.status}.`);
  return { html: await response.text(), finalUrl: response.url || url };
}

async function fetchBio(player) {
  if (!player.profile) return player;
  try {
    const { html, finalUrl } = await fetchHtml(player.profile);
    const $ = cheerio.load(html);
    const bio =
      clean($('.sidearm-roster-player-bio').first().text()) ||
      clean($('[class*="roster-player-bio"]').first().text()) ||
      clean($('meta[name="description"]').attr('content') || '') ||
      clean($('meta[property="og:description"]').attr('content') || '');

    const image =
      player.image ||
      absolute($('meta[property="og:image"]').attr('content') || '', finalUrl);

    return { ...player, bio, image };
  } catch {
    return player;
  }
}

async function addBios(players, progress) {
  const output = [...players];
  const concurrency = 4;
  let index = 0;

  async function worker() {
    while (index < output.length) {
      const current = index++;
      progress({ current: current + 1, total: output.length, name: output[current].name });
      output[current] = await fetchBio(output[current]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return output;
}

ipcMain.handle('roster:build', async (event, args) => {
  const url = String(args?.url || '').trim();
  if (!url) throw new Error('Paste an official roster URL.');

  const { html, finalUrl } = await fetchHtml(url);
  let players = parseSidearm(html, finalUrl);
  if (!players.length) players = parseTable(html, finalUrl);
  if (!players.length) players = parseJsonLd(html, finalUrl);

  if (!players.length) {
    throw new Error('The page loaded, but this roster layout was not recognized.');
  }

  if (args?.includeBios) {
    players = await addBios(players, (payload) => {
      event.sender.send('roster:progress', payload);
    });
  }

  return { source: finalUrl, count: players.length, players };
});

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

ipcMain.handle('roster:save', async (_, args) => {
  const players = Array.isArray(args?.players) ? args.players : [];
  const format = args?.format === 'json' ? 'json' : 'csv';
  if (!players.length) throw new Error('There is no roster to save.');

  const defaultName = args?.defaultName || `roster.${format}`;
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: format === 'json'
      ? [{ name: 'JSON roster', extensions: ['json'] }]
      : [{ name: 'CSV roster', extensions: ['csv'] }]
  });

  if (result.canceled || !result.filePath) return { canceled: true };

  let content;
  if (format === 'json') {
    content = JSON.stringify(players, null, 2);
  } else {
    const headers = ['number','name','position','height','weight','class','hometown','previousSchool','image','profile','bio'];
    const lines = [headers.join(',')];
    for (const player of players) {
      lines.push(headers.map((header) => csvEscape(player[header] || '')).join(','));
    }
    content = lines.join('\r\n');
  }

  await fs.writeFile(result.filePath, content, 'utf8');
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('external:open', async (_, url) => {
  await shell.openExternal(url);
});
