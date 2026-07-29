import dns from 'node:dns/promises';
import net from 'node:net';
import * as cheerio from 'cheerio';

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  let raw = '';

  for await (const chunk of req) {
    raw += chunk;

    if (raw.length > 100_000) {
      throw new Error('Request too large.');
    }
  }

  return raw ? JSON.parse(raw) : {};
}

const clean = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

function absolute(value, base) {
  try {
    return value ? new URL(value, base).href : '';
  } catch {
    return '';
  }
}

function isPrivateIp(ip) {
  if (!net.isIP(ip)) return true;
  if (ip === '::1' || ip === '0.0.0.0') return true;
  if (/^(10|127|169\.254|192\.168)\./.test(ip)) return true;

  const private172 = ip.match(/^172\.(\d+)\./);

  if (private172) {
    const second = Number(private172[1]);

    if (second >= 16 && second <= 31) {
      return true;
    }
  }

  return /^(fc|fd|fe80:)/i.test(ip);
}

async function validateUrl(raw) {
  let url;

  try {
    url = new URL(raw);
  } catch {
    throw new Error('Enter a valid roster URL.');
  }

  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error('That URL is not allowed.');
  }

  const records = await dns.lookup(url.hostname, {
    all: true
  });

  if (
    !records.length ||
    records.some((record) => isPrivateIp(record.address))
  ) {
    throw new Error(
      'That roster host is not publicly reachable.'
    );
  }

  return url;
}

function firstText($card, selectors) {
  for (const selector of selectors) {
    const value = clean(
      $card.find(selector).first().text()
    );

    if (value) {
      return value;
    }
  }

  return '';
}

function firstAttr($card, selectors, attributes) {
  for (const selector of selectors) {
    const node = $card.find(selector).first();

    if (!node.length) continue;

    for (const attribute of attributes) {
      const value = clean(node.attr(attribute));

      if (value) {
        return value;
      }
    }
  }

  return '';
}

function stripLabel(value, labels) {
  let result = clean(value);

  for (const label of labels) {
    result = result.replace(
      new RegExp(`^${label}\\s*:?\\s*`, 'i'),
      ''
    );
  }

  return clean(result);
}

function parsePlayerCard($, element, base) {
  const $card = $(element);

  let number = firstText($card, [
    '.sidearm-roster-player-jersey-number',
    '.sidearm-roster-player-jersey',
    '[class*="jersey-number"]',
    '[class*="jersey"]'
  ]);

  number =
    stripLabel(number, [
      'Jersey Number',
      'No\\.',
      '#'
    ]).match(/\d{1,3}/)?.[0] || '';

  let name = firstText($card, [
    '.sidearm-roster-player-name',
    '.sidearm-roster-player-name a',
    '[class*="player-name"]',
    'h3 a',
    'h3',
    'h2 a',
    'h2'
  ]);

  name = name
    .replace(/^Full Bio for\s+/i, '')
    .replace(/^Expand for more info about\s+/i, '')
    .trim();

  let position = firstText($card, [
    '.sidearm-roster-player-position',
    '[class*="position"]'
  ]);

  position = stripLabel(position, [
    'Position',
    'Pos\\.'
  ]);

  let playerClass = firstText($card, [
    '.sidearm-roster-player-academic-year',
    '.sidearm-roster-player-class',
    '[class*="academic-year"]',
    '[class*="class"]'
  ]);

  playerClass = stripLabel(playerClass, [
    'Academic Year',
    'Class',
    'Year'
  ]);

  let height = firstText($card, [
    '.sidearm-roster-player-height',
    '[class*="height"]'
  ]);

  height = stripLabel(height, [
    'Height',
    'Ht\\.'
  ]);

  let weight = firstText($card, [
    '.sidearm-roster-player-weight',
    '[class*="weight"]'
  ]);

  weight = stripLabel(weight, [
    'Weight',
    'Wt\\.'
  ]).replace(/\s*lbs?\.?$/i, '');

  let hometown = firstText($card, [
    '.sidearm-roster-player-hometown',
    '[class*="hometown"]'
  ]);

  hometown = stripLabel(hometown, [
    'Hometown'
  ]);

  let previousSchool = firstText($card, [
    '.sidearm-roster-player-previous-school',
    '.sidearm-roster-player-highschool',
    '.sidearm-roster-player-last-school',
    '[class*="previous-school"]',
    '[class*="last-school"]',
    '[class*="highschool"]'
  ]);

  previousSchool = stripLabel(previousSchool, [
    'Previous School',
    'Last School',
    'High School'
  ]);

  let profile = firstAttr(
    $card,
    [
      '.sidearm-roster-player-name a',
      'a[href*="/sports/football/roster/"]',
      'a[href*="/roster/"]'
    ],
    ['href']
  );

  profile = absolute(profile, base);

  let image = firstAttr(
    $card,
    ['img'],
    [
      'data-src',
      'data-original',
      'data-lazy-src',
      'src'
    ]
  );

  image = absolute(image, base);

  if (!name) {
    return null;
  }

  return {
    number,
    name,
    position,
    class: playerClass,
    height,
    weight,
    hometown,
    previousSchool,
    image,
    profile,
    bio: ''
  };
}

function parseRoster(html, base) {
  const $ = cheerio.load(html);

  const selectors = [
    '.sidearm-roster-player',
    'li.sidearm-roster-player',
    '[class*="sidearm-roster-player"]'
  ];

  let cards = $();

  for (const selector of selectors) {
    const found = $(selector);

    if (found.length > cards.length) {
      cards = found;
    }
  }

  const players = [];
  const seen = new Set();

  cards.each((_, element) => {
    const player = parsePlayerCard(
      $,
      element,
      base
    );

    if (!player) return;

    const key =
      `${player.number}|${player.name.toLowerCase()}`;

    if (seen.has(key)) return;

    seen.add(key);
    players.push(player);
  });

  return players;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      service: 'ncaa-roster-builder',
      version: '1.5'
    });
  }

  if (req.method !== 'POST') {
    return send(res, 405, {
      error: 'Method not allowed.'
    });
  }

  try {
    const body = await readBody(req);
    const rosterUrl = await validateUrl(body.url);

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 15_000);

    let response;

    try {
      response = await fetch(rosterUrl, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
          accept:
            'text/html,application/xhtml+xml',
          'accept-language':
            'en-US,en;q=0.9'
        }
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return send(res, 502, {
        error:
          `Roster website returned HTTP ${response.status}.`
      });
    }

    const html = await response.text();
    const base =
      response.url || rosterUrl.href;

    const players = parseRoster(
      html,
      base
    );

    if (!players.length) {
      return send(res, 422, {
        error:
          'The page loaded, but no football roster player cards were recognized.'
      });
    }

    return send(res, 200, {
      source: base,
      count: players.length,
      players
    });
  } catch (error) {
    return send(res, 400, {
      error:
        error?.name === 'AbortError'
          ? 'The roster website took too long to respond.'
          : error?.message ||
            'Roster build failed.'
    });
  }
}
