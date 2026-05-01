const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--use-fake-ui-for-media-stream', '--no-sandbox']
  });
  const page = await browser.newPage();

  const errors = [];
  page.on('console', msg => {
    const type = msg.type();
    console.log(`PAGE ${type.toUpperCase()}: ${msg.text()}`);
  });
  page.on('pageerror', error => {
    console.log('PAGE ERROR:', error.message);
    errors.push(error.message);
  });
  page.on('requestfailed', req => {
    console.log('FAILED REQUEST:', req.url(), '—', req.failure()?.errorText);
  });

  // --- Test STAGING build ---
  const url = 'https://demoyupi-white.pages.dev/';
  console.log('Navigating to STAGING:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait up to 20s for splash to finish
  console.log('Waiting for boot to complete...');
  await new Promise(r => setTimeout(r, 20000));

  // Read current splash state
  const splashState = await page.evaluate(() => ({
    splashHidden:   document.getElementById('splash')?.classList.contains('screen-hidden'),
    splashHintText: document.getElementById('splash-hint')?.textContent,
    barWidth:       document.getElementById('splash-bar')?.style.width,
    regVisible:     !document.getElementById('registration-screen')?.classList.contains('screen-hidden'),
    pageErrors:     window.__errors || [],
    xr8Loaded:      typeof window.XR8 !== 'undefined',
    appVersion:     typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'NOT DEFINED',
  }));

  console.log('\n=== SPLASH STATE ===');
  console.log(JSON.stringify(splashState, null, 2));

  await browser.close();
  if (errors.length) {
    console.log('\n=== JS ERRORS ===');
    errors.forEach(e => console.log(' -', e));
  }
})();
