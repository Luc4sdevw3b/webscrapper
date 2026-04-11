import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'node:fs/promises';

chromium.use(StealthPlugin());

const FILE_PATH = './precos.json';
const TZ = 'America/Sao_Paulo';

// Formatação
const fmt = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

/**
 * Retorna Data e Hora formatadas separadamente para facilitar o uso
 * Ex: { date: '11/04/2026', time: '12:55', full: '11/04/2026 12:55' }
 */
const getDateTime = () => {
  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR', { timeZone: TZ });
  const timeStr = now.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  return { date: dateStr, time: timeStr, full: `${dateStr} às ${timeStr}` };
};

function getStages(history) {
  const stages = [];
  if (!history.length) return stages;

  history.forEach(entry => {
    const last = stages[stages.length - 1];
    // entry.date agora é o campo "full" que salvaremos no JSON
    if (last && last.price === entry.price) {
      last.end = entry.date;
    } else {
      stages.push({ price: entry.price, start: entry.date, end: entry.date });
    }
  });
  return stages;
}

async function sendDiscordAlert(currentPrice, stages, productUrl) {
  const webhookUrl = process.env.DISCORD_WEBHOOK;
  if (!webhookUrl) return;

  const allStages = stages;
  const previousStages = allStages.slice(-3, -1).reverse();
  const lastPrice = previousStages.length > 0 ? previousStages[0].price : currentPrice;
  
  const diffVal = currentPrice - lastPrice;
  const diffPerc = lastPrice !== 0 ? ((diffVal / lastPrice) * 100).toFixed(2) : 0;
  const indicator = diffVal < 0 ? '📉 **DESCONTO!**' : '📈 **AUMENTO!**';

  const historyFields = previousStages.map((s, i) => {
    // Verifica se o início e fim são no mesmo dia para simplificar a leitura
    const isSameDay = s.start.split(' às ')[0] === s.end.split(' às ')[0];
    const durationText = isSameDay 
      ? `Variação intra-dia (Das ${s.start.split(' às ')[1]} até ${s.end.split(' às ')[1]})`
      : `De ${s.start} até ${s.end}`;

    return {
      name: `Preço Anterior ${i + 1}: ${fmt(s.price)}`,
      value: `⏱️ ${durationText}`,
      inline: false
    };
  });

  const embed = {
    title: `💰 Alteração de Preço: ${fmt(currentPrice)}`,
    description: `Diferença de **${fmt(diffVal)} (${diffPerc}%)**\n\n${indicator}`,
    color: diffVal < 0 ? 0x2ECC71 : 0xE74C3C,
    fields: [
      ...historyFields,
      { name: '🔗 Link do Produto', value: productUrl }
    ],
    footer: { text: `Verificado em: ${getDateTime().full}` },
    timestamp: new Date().toISOString()
  };

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] })
  });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  try {
    const page = await context.newPage();
    const url = process.env.PRODUCT_URL;
    const stamp = getDateTime();
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const selector = '#precovenda';
    await page.waitForSelector(selector, { timeout: 20000 });
    
    const priceRaw = await page.innerText(selector);
    const currentPrice = parseFloat(priceRaw.replace(/[^\d,]/g, '').replace(',', '.'));

    let history = [];
    try {
      history = JSON.parse(await fs.readFile(FILE_PATH, 'utf-8'));
    } catch (e) {}

    const lastPriceRecorded = history.length > 0 ? history[history.length - 1].price : null;
    
    // Salva com data e hora completas
    history.push({ date: stamp.full, price: currentPrice });
    await fs.writeFile(FILE_PATH, JSON.stringify(history, null, 2));

    if (lastPriceRecorded !== null && currentPrice !== lastPriceRecorded) {
      const stages = getStages(history);
      await sendDiscordAlert(currentPrice, stages, url);
      console.log(`[${stamp.full}] Mudança enviada ao Discord.`);
    } else {
      console.log(`[${stamp.full}] Preço estável em ${fmt(currentPrice)}.`);
    }

  } catch (err) {
    console.error(err);
    if (process.env.DISCORD_WEBHOOK) {
      await fetch(process.env.DISCORD_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `❌ **Erro:** ${err.message}` })
      });
    }
  } finally {
    await browser.close();
  }
}

run();