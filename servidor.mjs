#!/usr/bin/env node


import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lerConfig, VERSAO, NOME_SERVIDOR, contaSegura } from './nucleo.js';
import { ClienteDiscord } from './api-discord.js';
import { Estado, ArmazemArquivo } from './estado.js';
import { Executor } from './executor.js';
import { Gateway } from './gateway.js';
import { ServidorMcp } from './mcp.js';
import { Rotas } from './rotas.js';
import { NOMES_FERRAMENTAS, MAPA_FERRAMENTAS } from './ferramentas.js';
import { argumentosDeTexto } from './terminal.js';

export const PASTA = path.dirname(fileURLToPath(import.meta.url));
const NIVEIS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const MAX_LINHA_STDIO = 8 * 1024 * 1024;

export const AJUDA = `${NOME_SERVIDOR} ${VERSAO}

uso: node servidor.mjs [--stdio] [--http [N]] [--porta N] [--host H] [--check] [--call <ferramenta> [args]] [--help]

  (sem opcoes)      stdio (padrao): o cliente MCP inicia este processo e conversa por stdin/stdout
  --http [N]        servidor HTTP em http://127.0.0.1:${8787}/mcp (PORTA e HOST no .env, ou --porta/--host)
  --http --stdio    HTTP e stdio ao mesmo tempo
  --check           mostra conta, estado, protocolo e gateway; sai com 0 se tudo estiver pronto
  --call <f> [a]    executa a ferramenta <f> e imprime o resultado (args: chave=valor, chave:=json ou um JSON)
                    ex.: node servidor.mjs --call inbox limit=5 | --call reply_message channelId=1 messageId=2 content="Oi"
  --versao          mostra a versao

Configuracao (.env opcional ao lado deste arquivo ou variaveis de ambiente):
  DISCORD_TOKEN  token da conta secundaria (obrigatorio)   MCP_TOKEN  senha do HTTP (obrigatoria fora de localhost)
  SOMENTE_LEITURA=1 bloqueia toda escrita                  GATEWAY=0  desliga o WebSocket ao vivo
  PROTOCOLO_ARQUIVO=protocolo.md  regras de atendimento    DADOS_DIR=dados  onde fica o estado
  ENVIOS_POR_MINUTO, INTERVALO_ENVIO_MS, TEMPO_LIMITE_MS, TENTATIVAS, INBOX_JANELA_HORAS, MAX_RESULTADO, FUSO, LOG_NIVEL
`;


export function analisarEnv(texto) {
	const out = {};
	for (const linha of String(texto).split(/\r?\n/)) {
		const l = linha.trim();
		if (!l || l.startsWith('#')) continue;
		const m = l.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
		if (!m) continue;
		let v = m[2].trim();
		const aspas = v[0] === '"' || v[0] === "'" ? v[0] : null;
		if (aspas) {

			const fim = v.indexOf(aspas, 1);
			v = fim > 0 ? v.slice(1, fim) : v.slice(1);
			if (aspas === '"') v = v.replace(/\\n/g, '\n');
		} else { const i = v.search(/\s#/); if (i >= 0) v = v.slice(0, i).trim(); }
		out[m[1]] = v;
	}
	return out;
}


export async function carregarEnv(arquivo = path.join(PASTA, '.env'), destino = process.env) {
	let texto;
	try { texto = await fs.readFile(arquivo, 'utf8'); } catch (e) { if (e?.code === 'ENOENT') return false; throw e; }
	for (const [k, v] of Object.entries(analisarEnv(texto))) if (destino[k] == null || destino[k] === '') destino[k] = v;
	return true;
}

export function criarLog(nivelMinimo = 'info', escrever = (s) => process.stderr.write(s)) {
	const minimo = NIVEIS[String(nivelMinimo || 'info').toLowerCase()] ?? NIVEIS.info;
	return (nivel, msg, extra) => {
		if ((NIVEIS[nivel] ?? NIVEIS.info) < minimo) return;
		escrever(`${new Date().toISOString()} ${String(nivel).padEnd(5)} ${msg}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}\n`);
	};
}

const resolver = (p) => (path.isAbsolute(p) ? p : path.join(PASTA, p));


export function leitorProtocolo(cfg, fsImpl = fs) {
	if (cfg.PROTOCOLO) return () => cfg.PROTOCOLO;
	const arquivo = resolver(cfg.PROTOCOLO_ARQUIVO);
	let cache = { mtime: -1, texto: '' };
	return async () => {
		let st;
		try { st = await fsImpl.stat(arquivo); } catch { return ''; }
		if (st.mtimeMs !== cache.mtime) cache = { mtime: st.mtimeMs, texto: await fsImpl.readFile(arquivo, 'utf8') };
		return cache.texto;
	};
}


export function montar({ env = process.env, log, fetch: fetchFn, WebSocketImpl, armazem, agora, dormir } = {}) {
	const cfg = lerConfig(env);
	log = log || criarLog(env.LOG_NIVEL);
	const cliente = new ClienteDiscord({ config: cfg, fetch: fetchFn, agora, dormir, log });
	const estado = new Estado({ armazem: armazem || new ArmazemArquivo(path.join(resolver(cfg.DADOS_DIR), 'estado.json'), fs, path), config: cfg, agora, log });
	const gateway = cfg.GATEWAY ? new Gateway({ config: cfg, WebSocketImpl, agora, log }) : null;
	const executor = new Executor({ config: cfg, cliente, estado, gateway, protocolo: leitorProtocolo(cfg), agora, dormir, log });
	const servidor = new ServidorMcp({ executor, config: cfg, log });
	return { cfg, cliente, estado, gateway, executor, servidor, log };
}


export function iniciarStdio(app, { entrada = process.stdin, saida = process.stdout } = {}) {
	const { servidor, log } = app;
	let buffer = '';
	const escrever = (obj) => { try { saida.write(JSON.stringify(obj) + '\n'); } catch (e) { log('error', `stdio: falha ao escrever: ${e?.message || e}`); } };
	saida.on?.('error', (e) => log('error', `stdout: ${e?.message || e}`));
	entrada.setEncoding?.('utf8');
	entrada.on('data', (pedaco) => {
		buffer += pedaco;
		if (buffer.length > MAX_LINHA_STDIO) { log('error', 'stdio: linha grande demais; descartada'); buffer = ''; escrever({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'mensagem grande demais' } }); return; }
		let i;
		while ((i = buffer.indexOf('\n')) >= 0) {
			const linha = buffer.slice(0, i).trim();
			buffer = buffer.slice(i + 1);
			if (!linha) continue;
			servidor.tratarTexto(linha).then((r) => { if (r !== null) escrever(r); }).catch((e) => log('error', `stdio: ${e?.message || e}`));
		}
	});
	return new Promise((resolve) => { entrada.once('end', resolve); entrada.once('close', resolve); });
}


async function lerCorpoNode(req, max) {
	const partes = [];
	let total = 0;
	for await (const c of req) {
		total += c.length;
		if (total > max) throw Object.assign(new Error(`corpo grande demais (maximo ${max} bytes)`), { status: 413 });
		partes.push(c);
	}
	return Buffer.concat(partes);
}

export async function tratarNode(rotas, req, res) {
	const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() || 'http';
	const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
	const url = new URL(req.url || '/', `${proto}://${host}`);
	const controle = new AbortController();
	res.once('close', () => controle.abort());
	const headers = new Headers();
	for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
	let corpo;
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		try { corpo = await lerCorpoNode(req, rotas.maxCorpo); }
		catch (e) { res.writeHead(e.status || 400, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(`${e.message}\n`); }
	}
	const resposta = await rotas.tratar(new Request(url, { method: req.method, headers, body: corpo, signal: controle.signal }));
	const saida = {};
	resposta.headers.forEach((v, k) => { saida[k] = v; });
	res.writeHead(resposta.status, saida);
	if (!resposta.body || req.method === 'HEAD') return res.end();
	Readable.fromWeb(resposta.body).on('error', () => res.end()).pipe(res);
}

export async function iniciarHttp(app, { host = '127.0.0.1', porta, rotas } = {}) {
	rotas = rotas || new Rotas({ servidor: app.servidor, segredo: app.cfg.MCP_TOKEN, log: app.log });
	const servidorHttp = http.createServer((req, res) => {
		tratarNode(rotas, req, res).catch((e) => {
			app.log('error', `http: ${e?.message || e}`);
			if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end('erro interno\n');
		});
	});
	servidorHttp.keepAliveTimeout = 65000;
	servidorHttp.headersTimeout = 70000;
	await new Promise((resolve, reject) => {
		servidorHttp.once('error', reject);
		servidorHttp.listen(porta ?? app.cfg.PORTA, host, () => { servidorHttp.off('error', reject); resolve(); });
	});
	servidorHttp.rotas = rotas;
	return servidorHttp;
}


export async function verificar(app, escrever = (s) => process.stdout.write(s)) {
	const { cfg, cliente, estado, gateway, executor } = app;
	const linhas = [`${NOME_SERVIDOR} ${VERSAO}`, `pasta: ${PASTA}`, `modo: ${cfg.DISCORD_MODO} | API v${cfg.API_VERSAO} | somente leitura: ${cfg.SOMENTE_LEITURA ? 'sim' : 'nao'}`];
	let ok = true;
	if (!cfg.DISCORD_TOKEN) { ok = false; linhas.push('conta: DISCORD_TOKEN AUSENTE - crie o arquivo .env ao lado de servidor.mjs (modelo em .env.example)'); }
	else {
		try {
			const u = contaSegura(await cliente.eu());
			linhas.push(`conta: @${u.username}${u.globalName ? ` (${u.globalName})` : ''} id=${u.id}${u.bot ? ' [bot]' : ''}${u.mfa === false ? ' | sem 2FA' : ''}${u.verified === false ? ' | e-mail nao verificado' : ''}`);
		} catch (e) { ok = false; linhas.push(`conta: ERRO ${e.code || ''}: ${e.message}${e.hint ? ` | ${e.hint}` : ''}`); }
	}
	await estado.carregar();
	const r = estado.resumo();
	linhas.push(`estado: ${r.persistencia} | ${r.cursores} cursor(es), ${r.vigiados} vigiado(s), ${r.respondidas} resposta(s) lembrada(s)`);
	if (estado.erroPersistencia) ok = false;
	const protocolo = await executor.lerProtocolo();
	const origem = cfg.PROTOCOLO ? 'variavel PROTOCOLO' : resolver(cfg.PROTOCOLO_ARQUIVO);
	linhas.push(protocolo.trim() ? `protocolo: ${protocolo.length} caracteres (${origem})` : `protocolo: VAZIO - escreva ${origem} (modelo em protocolo.exemplo.md); sem ele a IA nao conhece suas regras de atendimento`);
	linhas.push(`gateway: ${gateway ? (gateway.disponivel ? 'disponivel (conecta quando o servidor sobe)' : `indisponivel: ${gateway.motivo}`) : 'desligado (GATEWAY=0)'}`);
	linhas.push(`limites: ${cfg.ENVIOS_POR_MINUTO} envios/min, ${cfg.INTERVALO_ENVIO_MS}ms entre envios, timeout ${cfg.TEMPO_LIMITE_MS}ms, janela do inbox ${cfg.INBOX_JANELA_HORAS}h`);
	linhas.push(`http: porta ${cfg.PORTA}${cfg.MCP_TOKEN ? ' | MCP_TOKEN definido' : ' | sem MCP_TOKEN (so localhost)'}`);
	linhas.push(`ferramentas: ${NOMES_FERRAMENTAS.length} (${NOMES_FERRAMENTAS.join(', ')})`);
	linhas.push(ok ? 'RESULTADO: pronto para uso' : 'RESULTADO: corrija os itens acima');
	escrever(linhas.join('\n') + '\n');
	return ok;
}


export function analisarArgs(argv) {
	const o = { stdio: false, http: false, check: false, help: false, versao: false, porta: null, host: null, call: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--stdio') o.stdio = true;
		else if (a === '--http') { o.http = true; if (/^\d{1,5}$/.test(argv[i + 1] || '')) o.porta = Number(argv[++i]); }
		else if (a === '--check') o.check = true;
		else if (a === '--call') {

			const nome = argv[++i];
			if (!nome || nome.startsWith('--')) throw new Error('--call exige o nome da ferramenta: --call <ferramenta> [chave=valor ...]');
			o.call = { nome, args: argv.slice(i + 1) };
			break;
		}
		else if (a === '--help' || a === '-h') o.help = true;
		else if (a === '--versao' || a === '--version' || a === '-v') o.versao = true;
		else if (a === '--porta' || a === '--port') o.porta = Number(argv[++i]);
		else if (a.startsWith('--porta=') || a.startsWith('--port=')) o.porta = Number(a.split('=')[1]);
		else if (a === '--host') o.host = argv[++i];
		else if (a.startsWith('--host=')) o.host = a.slice(7);
		else throw new Error(`argumento desconhecido: ${a}`);
	}
	if (o.porta !== null && (!Number.isInteger(o.porta) || o.porta < 0 || o.porta > 65535)) throw new Error('--porta deve ser um inteiro entre 0 e 65535');
	if (!o.http && !o.check && !o.help && !o.versao && !o.call) o.stdio = true;
	return o;
}


export async function chamarFerramenta(app, { nome, args }, escrever = (s) => process.stdout.write(s)) {
	if (!MAPA_FERRAMENTAS.has(nome)) {
		escrever(`ERRO UNKNOWN_TOOL: ferramenta desconhecida: ${nome} (nada executado)\nFerramentas: ${NOMES_FERRAMENTAS.join(', ')}\n`);
		return 1;
	}
	let argumentos;
	try { argumentos = argumentosDeTexto(args.join(' ')); }
	catch (e) { escrever(`ERRO VALIDATION: ${e.message} (nada executado)\n`); return 1; }
	const r = await app.servidor.executarFerramenta(nome, argumentos);
	escrever(r.texto.endsWith('\n') ? r.texto : r.texto + '\n');
	try { await app.estado.salvarAgora(); } catch {}
	return r.ok ? 0 : 1;
}

export async function principal(argv = process.argv.slice(2)) {
	let opcoes;
	try { opcoes = analisarArgs(argv); } catch (e) { process.stderr.write(`${e.message}\n\n${AJUDA}`); return 2; }
	if (opcoes.help) { process.stdout.write(AJUDA); return 0; }
	if (opcoes.versao) { process.stdout.write(`${NOME_SERVIDOR} ${VERSAO}\n`); return 0; }

	await carregarEnv(process.env.ENV_ARQUIVO ? resolver(process.env.ENV_ARQUIVO) : undefined);

	if (opcoes.call && !process.env.LOG_NIVEL) process.env.LOG_NIVEL = 'warn';
	const app = montar();
	const { cfg, log, gateway, estado } = app;
	if (opcoes.check) return (await verificar(app)) ? 0 : 1;
	if (opcoes.call) return chamarFerramenta(app, opcoes.call);
	if (!cfg.DISCORD_TOKEN) log('warn', 'DISCORD_TOKEN ausente: as ferramentas vao responder AUTH_MISSING ate o .env ser preenchido (modelo em .env.example)');
	if (cfg.SOMENTE_LEITURA) log('info', 'modo somente leitura: nenhuma ferramenta de escrita executa');
	let servidorHttp = null;
	let encerrando = false;
	const encerrar = async (motivo) => {
		if (encerrando) return;
		encerrando = true;
		log('info', `encerrando (${motivo})`);
		gateway?.parar();
		try { await estado.salvarAgora(); } catch {}
		await new Promise((resolve) => (servidorHttp ? servidorHttp.close(() => resolve()) : resolve()));
		process.exit(0);
	};
	process.on('SIGINT', () => encerrar('SIGINT'));
	process.on('SIGTERM', () => encerrar('SIGTERM'));
	if (opcoes.http) {
		const host = opcoes.host || process.env.HOST || '127.0.0.1';
		if (!LOOPBACK.has(host) && !cfg.MCP_TOKEN) {
			log('error', `recusado: expor o HTTP em ${host} sem MCP_TOKEN deixaria sua conta do Discord aberta a qualquer um na rede. Defina MCP_TOKEN no .env (ex.: openssl rand -hex 24).`);
			return 1;
		}
		try { servidorHttp = await iniciarHttp(app, { host, porta: opcoes.porta ?? cfg.PORTA }); }
		catch (e) { log('error', `nao foi possivel abrir a porta ${opcoes.porta ?? cfg.PORTA} em ${host}: ${e?.message || e}`); return 1; }
		const porta = servidorHttp.address().port;
		log('info', `HTTP em http://${host}:${porta}/mcp${cfg.MCP_TOKEN ? ' (MCP_TOKEN exigido)' : ' (sem MCP_TOKEN: use so em localhost)'}`);
		log('info', `terminal: curl -s http://${host}:${porta}/mcp${cfg.MCP_TOKEN ? '/<MCP_TOKEN>' : ''}`);
	}
	if (gateway) gateway.iniciar();
	if (opcoes.stdio) {
		log('info', `stdio pronto (${NOMES_FERRAMENTAS.length} ferramentas, modo ${cfg.DISCORD_MODO})`);
		await iniciarStdio(app);
		await encerrar('stdin fechado');
	}
	return null;
}

const executadoDiretamente = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executadoDiretamente) {
	principal().then((codigo) => { if (codigo !== null && codigo !== undefined) process.exit(codigo); }).catch((e) => {
		process.stderr.write(`erro fatal: ${e?.stack || e}\n`);
		process.exit(1);
	});
}
