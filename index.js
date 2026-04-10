import puppeteer from 'puppeteer';
import fs from 'fs';
import axios from 'axios';

const URL_PRODUTO = "https://www.kalunga.com.br/prod/microsoft-365-family-com-copilot-1-licenca-para-ate-6-usuarios-assinatura-12-meses-e-kaspersky-antivirus-premium-para-5-dispositivos-licenca-12-meses-digital-para-download-1-un/998955";
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK;

async function enviarAlertaDiscord(msg) {
    try {
        await axios.post(WEBHOOK_URL, { content: msg });
    } catch (e) {
        console.error("Falha ao enviar mensagem ao Discord");
    }
}

async function monitorar() {
    let historico = [];
    
    // 1. Verificação de Leitura
    try {
        if (fs.existsSync('precos.json')) {
            const data = fs.readFileSync('precos.json', 'utf8');
            historico = JSON.parse(data);
        }
    } catch (err) {
        await enviarAlertaDiscord(`❌ **Erro Crítico (Leitura):** Falha no arquivo JSON.`);
        process.exit(1);
    }

    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();

    try {
        // 2. Acesso ao Site
        await page.goto(URL_PRODUTO, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForSelector('#precovenda', { timeout: 15000 });

        const precoTexto = await page.evaluate(() => document.querySelector('#precovenda').innerText);
        const precoAtual = parseFloat(precoTexto.replace('R$', '').replace('.', '').replace(',', '.').trim());
        
        if (isNaN(precoAtual)) throw new Error("Preço capturado inválido.");

        const agora = new Date();
        const ultimoRegistro = historico.length > 0 ? historico[historico.length - 1] : null;

        // 3. Lógica de Comparação
        if (ultimoRegistro && precoAtual !== ultimoRegistro.preco) {
            const precoAntigo = ultimoRegistro.preco;
            const diferenca = precoAntigo - precoAtual;
            const percentual = ((Math.abs(diferenca) / precoAntigo) * 100).toFixed(2);
            const dataInicio = new Date(ultimoRegistro.data);
            const horasDuracao = ((agora - dataInicio) / (1000 * 60 * 60)).toFixed(1);

            let msg = `🔔 **Mudança de Preço!**\nDe: ~~R$ ${precoAntigo.toFixed(2)}~~ por **R$ ${precoAtual.toFixed(2)}**\n`;
            msg += diferenca > 0 ? `📉 Desconto de R$ ${diferenca.toFixed(2)} (${percentual}%)` : `📈 Aumento de R$ ${Math.abs(diferenca).toFixed(2)}`;
            msg += `\n⏳ Preço anterior durou ${horasDuracao} horas.`;
            await enviarAlertaDiscord(msg);
        }

        // 4. Gravação e Integridade
        const novoItem = { data: agora.toISOString(), preco: precoAtual };
        historico.push(novoItem);
        
        fs.writeFileSync('precos.json', JSON.stringify(historico, null, 2));

        const verificacao = JSON.parse(fs.readFileSync('precos.json', 'utf8'));
        const ultimoGravado = verificacao[verificacao.length - 1];

        if (ultimoGravado.data !== novoItem.data) throw new Error("Falha na integridade dos dados.");

        console.log(`Sucesso: R$ ${precoAtual}`);

    } catch (err) {
        await enviarAlertaDiscord(`⚠️ **Erro no Scraper:** ${err.message}`);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

monitorar();