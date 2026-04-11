import 'dotenv/config';
import puppeteer from 'puppeteer';
import fs from 'fs';
import axios from 'axios';

const URL_PRODUTO = "https://www.kalunga.com.br/prod/microsoft-365-family-com-copilot-1-licenca-para-ate-6-usuarios-assinatura-12-meses-e-kaspersky-antivirus-premium-para-5-dispositivos-licenca-12-meses-digital-para-download-1-un/998955";
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK;

/**
 * Agrupa o histórico bruto em blocos de preços estáveis (Estágios)
 * Transforma uma lista de logs em uma linha do tempo.
 */
function processarEstagios(historico) {
    if (historico.length === 0) return [];
    
    const estagios = [];
    let estagioAtual = {
        preco: historico[0].preco,
        inicio: historico[0].data,
        fim: historico[0].data
    };

    for (let i = 1; i < historico.length; i++) {
        if (historico[i].preco === estagioAtual.preco) {
            estagioAtual.fim = historico[i].data;
        } else {
            estagios.push(estagioAtual);
            estagioAtual = {
                preco: historico[i].preco,
                inicio: historico[i].data,
                fim: historico[i].data
            };
        }
    }
    estagios.push(estagioAtual);
    return estagios;
}

async function enviarAlertaDiscord(msg) {
    try {
        await axios.post(WEBHOOK_URL, { content: msg });
    } catch (e) {
        console.error("Falha ao enviar mensagem ao Discord:", e.message);
    }
}

async function monitorar() {
    let historico = [];
    
    if (fs.existsSync('precos.json')) {
        try {
            historico = JSON.parse(fs.readFileSync('precos.json', 'utf8'));
        } catch (err) {
            await enviarAlertaDiscord("❌ Erro ao processar arquivo JSON.");
            process.exit(1);
        }
    }

    const browser = await puppeteer.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    try {
        console.log("Acessando a Kalunga...");
        await page.goto(URL_PRODUTO, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('#precovenda', { timeout: 30000 });

        const precoTexto = await page.evaluate(() => document.querySelector('#precovenda')?.innerText);
        if (!precoTexto) throw new Error("Preço não encontrado na página.");

        const precoAtual = parseFloat(precoTexto.replace('R$', '').replace('.', '').replace(',', '.').trim());
        const dataBrasilia = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        const ultimoRegistro = historico.length > 0 ? historico[historico.length - 1] : null;

        // --- NOVA LÓGICA DE ALERTA COM MEMÓRIA ---
        if (ultimoRegistro && precoAtual !== ultimoRegistro.preco) {
            const todosEstagios = processarEstagios(historico);
            
            // Identificamos os últimos blocos de preço estáveis
            const penultimoEstagio = todosEstagios.length >= 2 ? todosEstagios[todosEstagios.length - 2] : null;
            const ultimoEstagio = todosEstagios[todosEstagios.length - 1]; // Preço que acabou de mudar

            let msg = `🚨 **MOVIMENTAÇÃO DE PREÇO DETECTADA!**\n\n`;
            msg += `**Linha do Tempo Recente:**\n`;

            if (penultimoEstagio) {
                msg += `1️⃣ **R$ ${penultimoEstagio.preco.toFixed(2)}**: De ${penultimoEstagio.inicio} até ${penultimoEstagio.fim}.\n`;
            }
            msg += `2️⃣ **R$ ${ultimoEstagio.preco.toFixed(2)}**: De ${ultimoEstagio.inicio} até ${ultimoEstagio.fim}.\n\n`;

            msg += `📉 **NOVO PREÇO: R$ ${precoAtual.toFixed(2)}**\n`;
            
            const diferenca = ultimoEstagio.preco - precoAtual;
            const percentual = ((Math.abs(diferenca) / ultimoEstagio.preco) * 100).toFixed(2);
            
            if (diferenca > 0) {
                msg += `✅ Desconto de **R$ ${diferenca.toFixed(2)} (${percentual}%)** em relação ao preço anterior!`;
            } else {
                msg += `📈 O preço subiu **R$ ${Math.abs(diferenca).toFixed(2)}**.`;
            }

            await enviarAlertaDiscord(msg);
        }
        // ------------------------------------------

        historico.push({ data: dataBrasilia, preco: precoAtual });
        fs.writeFileSync('precos.json', JSON.stringify(historico, null, 2));
        
        console.log(`Sucesso! Preço: R$ ${precoAtual} gravado em ${dataBrasilia}`);

    } catch (err) {
        await enviarAlertaDiscord(`⚠️ **Erro no Scraper:** ${err.message}`);
        process.exit(1); 
    } finally {
        await browser.close();
    }
}

monitorar();