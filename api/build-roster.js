import dns from 'node:dns/promises';
import net from 'node:net';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

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

function isPrivateIp(ip) {
  if (!net.isIP(ip)) {
    return true;
  }

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

async function launchBrowser() {
  chromium.setGraphicsMode = false;

  const executablePath =
    await chromium.executablePath();

  return puppeteer.launch({
    args: [
      ...chromium.args,
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run'
    ],
    defaultViewport: {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1
    },
    executablePath,
    headless: 'shell'
  });
}

async function renderRosterPage(url) {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/149.0.0.0 Safari/537.36'
    );

    await page.setExtraHTTPHeaders({
      'accept-language': 'en-US,en;q=0.9'
    });

    await page.setRequestInterception(true);

    page.on('request', (request) => {
      const type = request.resourceType();

      if (
        type === 'font' ||
        type === 'media' ||
        type === 'stylesheet'
      ) {
        request.abort();
        return;
      }

      request.continue();
    });

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForFunction(
      () => {
        const text =
          document.body?.innerText || '';

        return (
          text.includes('Jersey Number') ||
          document.querySelectorAll(
            'a[href*="/sports/football/roster/"]'
          ).length > 20
        );
      },
      {
        timeout: 20000
      }
    );

    await new Promise((resolve) =>
      setTimeout(resolve, 1500)
    );

    const result = await page.evaluate(() => {
      function clean(value) {
        return String(value || '')
          .replace(/\u00a0/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }

      function absolute(value) {
        try {
          return value
            ? new URL(value, window.location.href).href
            : '';
        } catch {
          return '';
        }
      }

      function textBetween(
        text,
        startLabel,
        endLabels
      ) {
        const start =
          text.indexOf(startLabel);

        if (start === -1) {
          return '';
        }

        const contentStart =
          start + startLabel.length;

        let contentEnd = text.length;

        for (const label of endLabels) {
          const index =
            text.indexOf(label, contentStart);

          if (
            index !== -1 &&
            index < contentEnd
          ) {
            contentEnd = index;
          }
        }

        return clean(
          text.slice(contentStart, contentEnd)
        );
      }

      function createProfileMap() {
        const map = new Map();

        document
          .querySelectorAll(
            'a[href*="/sports/football/roster/"],' +
            'a[href*="/roster/"]'
          )
          .forEach((link) => {
            const href =
              absolute(link.getAttribute('href'));

            let name = clean(
              link.textContent
            )
              .replace(
                /^Full Bio for\s+/i,
                ''
              )
              .replace(
                /^Expand for more info about\s+/i,
                ''
              )
              .replace(
                /^Jersey Number\s+\d+\s*/i,
                ''
              )
              .trim();

            if (
              href &&
              name &&
              name.length < 100 &&
              !/^Roster$/i.test(name) &&
              !/^Football$/i.test(name)
            ) {
              map.set(
                name.toLowerCase(),
                href
              );
            }
          });

        return map;
      }

      function createImageMap() {
        const map = new Map();

        document
          .querySelectorAll('img')
          .forEach((image) => {
            let name = clean(
              image.getAttribute('alt')
            )
              .replace(
                /^Photo of\s+/i,
                ''
              )
              .replace(
                /^Headshot of\s+/i,
                ''
              )
              .replace(
                /^Portrait of\s+/i,
                ''
              )
              .trim();

            const source =
              image.getAttribute('data-src') ||
              image.getAttribute(
                'data-original'
              ) ||
              image.getAttribute(
                'data-lazy-src'
              ) ||
              image.getAttribute('src') ||
              '';

            if (
              name &&
              source &&
              name.length < 100
            ) {
              map.set(
                name.toLowerCase(),
                absolute(source)
              );
            }
          });

        return map;
      }

      function parseCard(card) {
        const text = clean(
          card.innerText ||
          card.textContent
        );

        const number =
          clean(
            card.querySelector(
              '.sidearm-roster-player-jersey-number,' +
              '[class*="jersey-number"]'
            )?.textContent
          ).match(/\d{1,3}/)?.[0] || '';

        let name = clean(
          card.querySelector(
            '.sidearm-roster-player-name,' +
            '[class*="player-name"],' +
            'h3, h2'
          )?.textContent
        );

        name = name
          .replace(/^Full Bio for\s+/i, '')
          .trim();

        const position = clean(
          card.querySelector(
            '.sidearm-roster-player-position,' +
            '[class*="player-position"]'
          )?.textContent
        ).replace(/^Position\s*:?\s*/i, '');

        if (!name || !number) {
          return null;
        }

        const playerClass = clean(
          card.querySelector(
            '.sidearm-roster-player-academic-year,' +
            '.sidearm-roster-player-class,' +
            '[class*="academic-year"]'
          )?.textContent
        ).replace(
          /^(Academic Year|Class)\s*:?\s*/i,
          ''
        );

        const height = clean(
          card.querySelector(
            '.sidearm-roster-player-height,' +
            '[class*="player-height"]'
          )?.textContent
        ).replace(/^Height\s*:?\s*/i, '');

        const weight = clean(
          card.querySelector(
            '.sidearm-roster-player-weight,' +
            '[class*="player-weight"]'
          )?.textContent
        )
          .replace(/^Weight\s*:?\s*/i, '')
          .replace(/\s*lbs?\.?$/i, '');

        const hometown = clean(
          card.querySelector(
            '.sidearm-roster-player-hometown,' +
            '[class*="player-hometown"]'
          )?.textContent
        ).replace(/^Hometown\s*:?\s*/i, '');

        const previousSchool = clean(
          card.querySelector(
            '.sidearm-roster-player-previous-school,' +
            '.sidearm-roster-player-last-school,' +
            '.sidearm-roster-player-highschool,' +
            '[class*="previous-school"],' +
            '[class*="last-school"]'
          )?.textContent
        ).replace(
          /^(Previous School|Last School|High School)\s*:?\s*/i,
          ''
        );

        const link = card.querySelector(
          'a[href*="/sports/football/roster/"],' +
          'a[href*="/roster/"]'
        );

        const imageNode =
          card.querySelector('img');

        const image =
          imageNode?.getAttribute('data-src') ||
          imageNode?.getAttribute(
            'data-original'
          ) ||
          imageNode?.getAttribute(
            'data-lazy-src'
          ) ||
          imageNode?.getAttribute('src') ||
          '';

        return {
          number,
          name,
          position,
          class: playerClass,
          height,
          weight,
          hometown,
          previousSchool,
          image: absolute(image),
          profile: absolute(
            link?.getAttribute('href')
          ),
          bio: ''
        };
      }

      const profiles = createProfileMap();
      const images = createImageMap();
      const players = [];
      const seen = new Set();

      const possibleCards =
        Array.from(
          document.querySelectorAll(
            '.sidearm-roster-player,' +
            'li.sidearm-roster-player,' +
            '[data-player-id]'
          )
        );

      for (const card of possibleCards) {
        const player = parseCard(card);

        if (!player) {
          continue;
        }

        const key =
          `${player.number}|` +
          player.name.toLowerCase();

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        players.push(player);
      }

      if (players.length < 20) {
        let text = clean(
          document.body.innerText
        );

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

        const blocks = text.split(
          /\s+Jersey Number\s+/i
        );

        for (
          let index = 1;
          index < blocks.length;
          index += 1
        ) {
          const block = clean(blocks[index]);

          const numberMatch =
            block.match(/^(\d{1,3})\s+/);

          if (!numberMatch) {
            continue;
          }

          const number = numberMatch[1];

          const remainder = clean(
            block.slice(
              numberMatch[0].length
            )
          );

          const positionIndex =
            remainder.indexOf('Position');

          if (positionIndex === -1) {
            continue;
          }

          const name = clean(
            remainder.slice(
              0,
              positionIndex
            )
          );

          if (
            !name ||
            name.length > 100
          ) {
            continue;
          }

          const position = textBetween(
            remainder,
            'Position',
            ['Academic Year', 'Class']
          );

          let playerClass = textBetween(
            remainder,
            'Academic Year',
            ['Height']
          );

          if (!playerClass) {
            playerClass = textBetween(
              remainder,
              'Class',
              ['Height']
            );
          }

          const height = textBetween(
            remainder,
            'Height',
            ['Weight']
          );

          const weight = textBetween(
            remainder,
            'Weight',
            [
              'Custom Field 1',
              'Hometown'
            ]
          ).replace(/\s*lbs?\.?$/i, '');

          const hometown = textBetween(
            remainder,
            'Hometown',
            [
              'Last School',
              'Previous School'
            ]
          );

          let previousSchool = textBetween(
            remainder,
            'Last School',
            ['Full Bio for']
          );

          if (!previousSchool) {
            previousSchool = textBetween(
              remainder,
              'Previous School',
              ['Full Bio for']
            );
          }

          const key =
            `${number}|` +
            name.toLowerCase();

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
              images.get(
                name.toLowerCase()
              ) || '',
            profile:
              profiles.get(
                name.toLowerCase()
              ) || '',
            bio: ''
          });
        }
      }

      return {
        source: window.location.href,
        pageTitle: document.title,
        hasJerseyText:
          document.body.innerText.includes(
            'Jersey Number'
          ),
        profileLinkCount:
          document.querySelectorAll(
            'a[href*="/sports/football/roster/"]'
          ).length,
        players
      };
    });

    return result;
  } finally {
    await browser.close();
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      service: 'ncaa-roster-builder',
      version: '2.0-browser'
    });
  }

  if (req.method !== 'POST') {
    return send(res, 405, {
      error: 'Method not allowed.'
    });
  }

  try {
    const body = await readBody(req);
    const rosterUrl = await validateUrl(
      body.url
    );

    const result =
      await renderRosterPage(
        rosterUrl.href
      );

    if (!result.players.length) {
      return send(res, 422, {
        error:
          'The rendered page loaded, but no roster players were recognized.',
        debug: {
          pageTitle: result.pageTitle,
          hasJerseyText:
            result.hasJerseyText,
          profileLinkCount:
            result.profileLinkCount,
          finalUrl: result.source
        }
      });
    }

    return send(res, 200, {
      source: result.source,
      count: result.players.length,
      players: result.players
    });
  } catch (error) {
    console.error(
      'Roster builder failed:',
      error
    );

    return send(res, 500, {
      error:
        error?.message ||
        'Roster build failed.'
    });
  }
}
