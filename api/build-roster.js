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
    if (raw.length > 100_000) throw new Error('Request too large.');
  }
  return raw ? JSON.parse(raw) : {};
}

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

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
  if (
    private172 &&
    Number(private172[1]) >= 16 &&
    Number(private172[1]) <= 31
  ) {
    return true;
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

  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error('That URL is not allowed.');
  }

  const records = await dns.lookup(url.hostname, { all: true });

  if (
    !records.length ||
    records.some((record) => isPrivateIp(record.address))
  ) {
    throw new Error('That roster host is not publicly reachable.');
  }

  return url;
}

function addLabelSpacing(text) {
  return clean(
    text.replace(
      /(Jersey Number|Position|Academic Year|Class|Height|Weight|Custom Field 1|Hometown|Last School|Previous School|Full Bio for|Expand for more info about)/gi,
      ' $1 '
    )
  );
}

function buildProfileMaps($, base) {
  const profileByName = new Map();
  const imageByProfile = new Map();

  $('a[href*="/sports/football/roster/"], a[href*="/roster/"]').each(
    (_, node) => {
      const link = $(node);
      const text = clean(link.text());
      const href = absolute(link.attr('href') || '', base);

      if (!href || !text) return;

      const name = text
        .replace(/^Full Bio for\s+/i, '')
        .replace(/^Jersey Number\s+\d+\s*/i, '')
        .trim();

      if (
        name &&
        !/^Jersey Number\b/i.test(text) &&
        !/^Expand\b/i.test(text) &&
        name.length <= 120
      ) {
        profileByName.set(name.toLowerCase(), href);
      }

      let current = link;

      for (let level = 0; level < 7 && current.length; level += 1) {
        const image = current.find('img').first();

        if (image.length) {
          const source =
            image.attr('data-src') ||
            image.attr('data-original') ||
            image.attr('data-lazy-src') ||
            image.attr('src') ||
            '';

          if (source) {
            imageByProfile.set(href, absolute(source, base));
            break;
          }
        }

        current = current.parent();
      }
    }
  );

  return {
    profileByName,
    imageByProfile
  };
}

function parseSidearmRoster(html, base) {
  const $ = cheerio.load(html);
  const { profileByName, imageByProfile } = buildProfileMaps($, base);
  const pageText = addLabelSpacing($('body').text());

  const pattern =
    /Jersey Number\s+(\d{1,3})\s+(.+?)\s+Position\s+(.+?)\s+Academic Year\s+(.+?)\s+Height\s+(.+?)\s+Weight\s+(.+?)\s+(?:Custom Field 1\s+.*?\s+)?Hometown\s+(.+?)\s+Last School\s+(.+?)\s+Full Bio for\s+(.+?)(?=\s+Expand for more info about|\s+Jersey Number\s+\d+|$)/gi;

  const players = [];
  const seen = new Set();
  let match;

  while ((match = pattern.exec(pageText))) {
    const number = clean(match[1]);
    const name = clean(match[2]);
    const position = clean(match[3]);
    const playerClass = clean(match[4]);
    const height = clean(match[5]);
    const weight = clean(match[6]).replace(/\s*lbs?\.?$/i, '');
    const hometown = clean(match[7]);
    const previousSchool = clean(match[8]);
    const bioName = clean(match[9]);

    if (
      !name ||
      name.length > 120 ||
      name.toLowerCase() !== bioName.toLowerCase()
    ) {
      continue;
    }

    const profile = profileByName.get(name.toLowerCase()) || '';
    const image = profile ? imageByProfile.get(profile) || '' : '';
    const key = `${number}|${name.toLowerCase()}`;

    if (seen.has(key)) continue;

    seen.add(key);

    players.push({
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
    });
  }

  return players;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      service: 'ncaa-roster-builder',
      version: '1.4'
    });
  }

  if (req.method !== 'POST') {
    return send(res, 405, {
      error: 'Method not allowed.'
    });
  }

  try {
    const requestBody = await readBody(req);
    const rosterUrl = await validateUrl(requestBody.url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);

    let response;

    try {
      response = await fetch(rosterUrl, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en-US,en;q=0.9'
        }
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      return send(res, 502, {
        error: `Roster website returned HTTP ${response.status}.`
      });
    }

    const html = await response.text();
    const base = response.url || rosterUrl.href;
    const players = parseSidearmRoster(html, base);

    if (!players.length) {
      return send(res, 422, {
        error:
          'The page loaded, but no football roster players were recognized.'
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
          : error?.message || 'Roster build failed.'
    });
  }
}
