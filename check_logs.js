const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: "new", args: ['--use-fake-ui-for-media-stream'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));

  console.log('Navigating...');
  await page.goto('https://demoyupi-white.gmaramis14.workers.dev/', { waitUntil: 'networkidle2' });
  
  console.log('Clicking START...');
  try {
    await page.waitForSelector('#reg-name');
    await page.type('#reg-name', 'Test');
    await page.click('#btn-submit-reg');
    
    await page.waitForSelector('#btn-start', {visible: true});
    await page.click('#btn-start');
    
    console.log('Waiting 8 seconds...');
    await new Promise(r => setTimeout(r, 8000));
  } catch (err) {
    console.log('Error during click:', err.message);
  }
  
  await browser.close();
})();
