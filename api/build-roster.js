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
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string') {
    return JSON.parse(req.body || '{}');
  }

  let raw = '';

  for await (const chunk of req) {
    raw += chunk;

    if (raw.length > 100000) {
      throw new Error('Request too large.');
    }
  }

  return raw ? JSON.parse(raw) : {};
}

function clean(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function absolute(value, base) {
  try {
    return value ? new URL(value, base).href : '';
  } catch {
    return '';
  }
}

function isPrivateIp(ip) {
  if (!net.isIP(ip)) return true;

  if (
    ip === '::1' ||
    ip === '0.0.0.0' ||
    /^(10|127|169\.254|192\.168)\./.test(ip)
  ) {
    return true;
  }

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

function textBetween(text, startLabel, endLabels) {
  const start = text.indexOf(startLabel);

  if (start === -1) {
    return '';
  }

  const contentStart = start + startLabel.length;
  let contentEnd = text.length;

  for (const endLabel of endLabels) {
    const index = text.indexOf(endLabel, contentStart);

    if (index !== -1 && index < contentEnd) {
      contentEnd = index;
    }
  }

  return clean(text.slice(contentStart, contentEnd));
}

function buildProfileMap($, base) {
  const profiles = new Map();

  $('a[href*="/sports/football/roster/"]').each(
    (_, element) => {
      const link = $(element);
      const href = absolute(link.attr('href'), base);

      let text = clean(link.text());

      text = text
        .replace(/^Full Bio for\s+/i, '')
        .replace(/^Jersey Number\s+\d+\s*/i, '')
        .replace(
          /^Expand for more info about\s+/i,
          ''
        )
        .trim();

      if (
        href &&
        text &&
        !/^Jersey Number$/i.test(text) &&
        text.length < 100
      ) {
        profiles.set(text.toLowerCase(), href);
      }
    }
  );

  return profiles;
}

function buildImageMap($, base) {
  const images = new Map();

  $('img').each((_, element) => {
    const image = $(element);

    const alt = clean(image.attr('alt'))
      .replace(/^Photo of\s+/i, '')
      .replace(/^Headshot of\s+/i, '')
      .trim();

    const source =
      image.attr('data-src') ||
      image.attr('data-original') ||
      image.attr('data-lazy-src') ||
      image.attr('src') ||
      '';

    if (
      alt &&
      source &&
      alt.length < 100
    ) {
      images.set(
        alt.toLowerCase(),
        absolute(source, base)
      );
    }
  });

  return images;
}

function parseRoster(html, base) {
  const $ = cheerio.load(html);

  const profiles = buildProfileMap($, base);
  const images = buildImageMap($, base);

  let text = clean($('body').text());

  const labels = [
    'Jersey Number',
    'Position',
    'Academic Year',
    'Height',
    'Weight',
    'Custom Field 1',
    'Hometown',
    'Last School',
    'Previous School',
    'Full Bio for',
    'Expand for more info about'
  ];

  for (const label of labels) {
    text = text.replace(
      new RegExp(label, 'gi'),
      ` ${label} `
    );
  }

  text = clean(text);

  const blocks = text.split(/\s+Jersey Number\s+/i);
  const players = [];
  const seen = new Set();

  for (let index = 1; index < blocks.length; index += 1) {
    const block = clean(blocks[index]);

    const numberMatch = block.match(/^(\d{1,3})\s+/);

    if (!numberMatch) {
      continue;
    }

    const number = numberMatch[1];
    const afterNumber = clean(
      block.slice(numberMatch[0].length)
    );

    const positionIndex =
      afterNumber.indexOf('Position');

    if (positionIndex === -1) {
      continue;
    }

    const name = clean(
      afterNumber.slice(0, positionIndex)
    );

    const position = textBetween(
      afterNumber,
      'Position',
      ['Academic Year']
    );

    const playerClass = textBetween(
      afterNumber,
      'Academic Year',
      ['Height']
    );

    const height = textBetween(
      afterNumber,
      'Height',
      ['Weight']
    );

    let weight = textBetween(
      afterNumber,
      'Weight',
      ['Custom Field 1', 'Hometown']
    );

    weight = weight.replace(/\s*lbs?\.?$/i, '');

    const hometown = textBetween(
      afterNumber,
      'Hometown',
      ['Last School', 'Previous School']
    );

    let previousSchool = textBetween(
      afterNumber,
      'Last School',
      ['Full Bio for']
    );

    if (!previousSchool) {
      previousSchool = textBetween(
        afterNumber,
        'Previous School',
        ['Full Bio for']
      );
    }

    if (
      !name ||
      !position ||
      name.length > 100
    ) {
      continue;
    }

    const key =
      `${number}|${name.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

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
      image:
        images.get(name.toLowerCase()) || '',
      profile:
        profiles.get(name.toLowerCase()) || '',
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
      version: '1.6'
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
    }, 15000);

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

    const players = parseRoster(html, base);

    if (!players.length) {
      return send(res, 422, {
        error:
          'The page loaded, but no roster player blocks were recognized.'
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
