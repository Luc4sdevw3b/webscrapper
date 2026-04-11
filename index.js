import 'dotenv/config';
import puppeteer from 'puppeteer';
import fs from 'fs';
import axios from 'axios';

const URL_PRODUTO = "https://www.kalunga.com.br/prod/microsoft-365-family-com-copilot-1-licenca-para-ate-6-usuarios-assinatura-12-meses-e-kaspersky-antivirus-premium-para-5-dispositivos-licenca-12-meses-digital-para-download-1-un/998955";
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK;

async function enviarAlertaDiscord(msg) {
    try {
        await axios.post(WEBHOOK_URL, { content: msg });
    } catch (e) {
        console.error("Falha ao enviar mensagem ao Discord:", e.message);
    }
}

async function monitorar() {
    let historico = [];
    
    // 1. Carregar histórico existente
    if (fs.existsSync('precos.json')) {
        try {
            historico = JSON.parse(fs.readFileSync('precos.json', 'utf8'));
        } catch (err) {
            await enviarAlertaDiscord("❌ Erro ao processar arquivo JSON.");
            process.exit(1);
        }
    }

    // 2. Iniciar Navegador com Disfarce
    const browser = await puppeteer.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    try {
        // 3. Navegação otimizada
        console.log("Acessando a Kalunga...");
        await page.goto(URL_PRODUTO, { 
            waitUntil: 'domcontentloaded', 
            timeout: 60000 
        });

        await page.waitForSelector('#precovenda', { timeout: 30000 });

        const precoTexto = await page.evaluate(() => {
            const el = document.querySelector('#precovenda');
            return el ? el.innerText : null;
        });

        if (!precoTexto) throw new Error("Preço não encontrado na página.");

        const precoAtual = parseFloat(precoTexto.replace('R$', '').replace('.', '').replace(',', '.').trim());
        
        const agora = new Date();
        const dataBrasilia = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        const ultimoRegistro = historico.length > 0 ? historico[historico.length - 1] : null;

        // 4. Lógica de Alerta
        if (ultimoRegistro && precoAtual !== ultimoRegistro.preco) {
            const precoAntigo = ultimoRegistro.preco;
            const diferenca = precoAntigo - precoAtual;
            const percentual = ((Math.abs(diferenca) / precoAntigo) * 100).toFixed(2);
            
            let msg = `🔔 **Mudança de Preço detectada!**\nDe: ~~R$ ${precoAntigo.toFixed(2)}~~ por **R$ ${precoAtual.toFixed(2)}**\n`;
            msg += diferenca > 0 ? `📉 Desconto de R$ ${diferenca.toFixed(2)} (${percentual}%)` : `📈 Aumento de R$ ${Math.abs(diferenca).toFixed(2)}`;
            await enviarAlertaDiscord(msg);
        }

        // 5. Salvar novos dados
        historico.push({ data: dataBrasilia, preco: precoAtual });
        fs.writeFileSync('precos.json', JSON.stringify(historico, null, 2));
        
        console.log(`Sucesso! Preço: R$ ${precoAtual} gravado em ${dataBrasilia}`);

    } catch (err) {
        // Se der erro de navegação ou qualquer outro, ele cai aqui
        await enviarAlertaDiscord(`⚠️ **Erro no Scraper:** ${err.message}`);
        process.exit(1); 
    } finally {
        // Isso SEMPRE executa, garantindo que o navegador feche mesmo se der erro
        await browser.close();
    }
}

monitorar();