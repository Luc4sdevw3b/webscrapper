import puppeteer from 'puppeteer';
import fs from 'fs';
import axios from 'axios';

const URL_PRODUTO = "https://www.kalunga.com.br/prod/microsoft-365-family-com-copilot-1-licenca-para-ate-6-usuarios-assinatura-12-meses-e-kaspersky-antivirus-premium-para-5-dispositivos-licenca-12-meses-digital-para-download-1-un/998955";
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK;

async function enviarAlertaDiscord(msg) {
    try {
        await axios.post(WEBHOOK_URL, { content: msg });
    } catch (e) {
        console.error("Falha no Discord:", e.message);
    }
}

async function monitorar() {
    let historico = [];
    
    // Verificação de existência do arquivo para evitar erro de primeira execução
    if (fs.existsSync('precos.json')) {
        try {
            historico = JSON.parse(fs.readFileSync('precos.json', 'utf8'));
        } catch (err) {
            await enviarAlertaDiscord("❌ Erro ao processar banco de dados JSON.");
            process.exit(1);
        }
    }

    // Launch atualizado para o padrão 2026
    const browser = await puppeteer.launch({ 
        headless: true, // "true" agora é o padrão moderno, não precisa mais do "new"
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const page = await browser.newPage();

    try {
        await page.goto(URL_PRODUTO, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForSelector('#precovenda', { timeout: 15000 });

        const precoTexto = await page.evaluate(() => document.querySelector('#precovenda').innerText);
        const precoAtual = parseFloat(precoTexto.replace('R$', '').replace('.', '').replace(',', '.').trim());
        
        const agora = new Date();
        const dataBrasilia = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        const ultimoRegistro = historico.length > 0 ? historico[historico.length - 1] : null;

        if (ultimoRegistro && precoAtual !== ultimoRegistro.preco) {
            const precoAntigo = ultimoRegistro.preco;
            const diferenca = precoAntigo - precoAtual;
            const percentual = ((Math.abs(diferenca) / precoAntigo) * 100).toFixed(2);
            
            let msg = `🔔 **Mudança de Preço!**\nDe: ~~R$ ${precoAntigo.toFixed(2)}~~ por **R$ ${precoAtual.toFixed(2)}**\n`;
            msg += diferenca > 0 ? `📉 Desconto de R$ ${diferenca.toFixed(2)} (${percentual}%)` : `📈 Aumento de R$ ${Math.abs(diferenca).toFixed(2)}`;
            await enviarAlertaDiscord(msg);
        }

        historico.push({ data: dataBrasilia, preco: precoAtual });
        fs.writeFileSync('precos.json', JSON.stringify(historico, null, 2));

        console.log(`Log: R$ ${precoAtual} em ${dataBrasilia}`);

    } catch (err) {
        await enviarAlertaDiscord(`⚠️ **Erro no Scraper:** ${err.message}`);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

monitorar();