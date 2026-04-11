import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'node:fs/promises';

chromium.use(StealthPlugin());

const FILE_PATH = './precos.json';
const TZ = 'America/Sao_Paulo';
const PRODUCT_URL = process.env.PRODUCT_URL;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

const fmt = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const getTimestamp = () => {
  return new Date().toLocaleString('pt-BR', { 
    timeZone: TZ, 
    dateStyle: 'short', 
    timeStyle: 'short' 
  }).replace(',', ' às');
};

async function reportError(errorMsg) {
  if (!DISCORD_WEBHOOK) return;
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: "❌ Erro na Execução",
          description: `\`\`\`${errorMsg}\`\`\``,
          color: 0xFF0000,
          footer: { text: getTimestamp() }
        }]
      })
    });
  } catch (e) { console.error("Erro ao reportar:", e.message); }
}

function getStages(history) {
  const stages = [];
  history.forEach(entry => {
    const last = stages[stages.length - 1];
    if (last && last.price === entry.price) last.end = entry.date;
    else stages.push({ price: entry.price, start: entry.date, end: entry.date });
  });
  return stages;
}

async function main() {
  let browser;
  try {
    if (!PRODUCT_URL || !DISCORD_WEBHOOK) throw new Error("Variáveis de ambiente ausentes.");

    // FLAGS CRÍTICAS PARA DOCKER/GITHUB ACTIONS
    browser = await chromium.launch({ 
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage' // Resolve o erro de memória no Docker
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();
    await page.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    const priceSelector = '#precovenda';
    await page.waitForSelector(priceSelector, { timeout: 25000 });
    
    const priceRaw = await page.innerText(priceSelector);
    const currentPrice = parseFloat(priceRaw.replace(/[^\d,]/g, '').replace(',', '.'));

    if (isNaN(currentPrice)) throw new Error("Preço inválido capturado.");

    let history = [];
    try {
      history = JSON.parse(await fs.readFile(FILE_PATH, 'utf-8'));
    } catch (e) {}

    const lastPriceRecorded = history.length > 0 ? history[history.length - 1].price : null;
    const now = getTimestamp();
    
    history.push({ date: now, price: currentPrice });
    await fs.writeFile(FILE_PATH, JSON.stringify(history, null, 2));

    if (lastPriceRecorded !== null && currentPrice !== lastPriceRecorded) {
      const stages = getStages(history);
      const previousStages = stages.slice(-3, -1).reverse();
      const diffVal = currentPrice - lastPriceRecorded;
      const diffPerc = ((diffVal / lastPriceRecorded) * 100).toFixed(2);

      const historyFields = previousStages.map((s, i) => {
        const isSameDay = s.start.split(' às ')[0] === s.end.split(' às ')[0];
        const duration = isSameDay 
          ? `No mesmo dia (das ${s.start.split(' às ')[1]} até ${s.end.split(' às ')[1]})`
          : `De ${s.start} até ${s.end}`;
        
        return { name: `Preço Estável Anterior ${i + 1}: ${fmt(s.price)}`, value: `⏱️ ${duration}` };
      });

      await fetch(DISCORD_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: `💰 Alteração: ${fmt(currentPrice)}`,
            description: `Variação: **${diffVal < 0 ? '📉' : '📈'} ${fmt(diffVal)} (${diffPerc}%)**`,
            color: diffVal < 0 ? 0x2ECC71 : 0xE74C3C,
            fields: [...historyFields, { name: '🔗 Link', value: PRODUCT_URL }],
            footer: { text: `Verificado em: ${now}` },
            timestamp: new Date().toISOString()
          }]
        })
      });
    }
  } catch (err) {
    await reportError(err.message);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

main();