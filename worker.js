import { lerConfig, VERSAO, NOME_SERVIDOR } from './nucleo.js';
import { ClienteDiscord } from './api-discord.js';
import { Estado, ArmazemDurable } from './estado.js';
import { Executor } from './executor.js';
import { ServidorMcp } from './mcp.js';
import { Rotas, respostaJson, respostaTexto } from './rotas.js';

const NOME_CONTA = 'conta-principal';

export default {
	async fetch(req, env) {
		try {
			const url = new URL(req.url);
			if (url.pathname === '/' || url.pathname === '/health') {
				return respostaJson({ ok: true, servidor: NOME_SERVIDOR, versao: VERSAO, mcp: `${url.origin}/mcp/<MCP_TOKEN>`, configurado: { DISCORD_TOKEN: !!String(env.DISCORD_TOKEN || '').trim(), MCP_TOKEN: !!String(env.MCP_TOKEN || '').trim() } });
			}
			if (!/^\/mcp(\/|$)/.test(url.pathname)) return respostaTexto(`nao encontrado. O MCP esta em ${url.origin}/mcp/<MCP_TOKEN>\n`, 404);
			if (!String(env.MCP_TOKEN || '').trim()) return respostaTexto('MCP_TOKEN nao configurado. Rode: npx wrangler secret put MCP_TOKEN  (sem essa senha qualquer pessoa usaria sua conta)\n', 503);
			if (!String(env.DISCORD_TOKEN || '').trim()) return respostaTexto('DISCORD_TOKEN nao configurado. Rode: npx wrangler secret put DISCORD_TOKEN\n', 503);
			if (!env.CONTA) return respostaTexto('binding CONTA ausente: confira [[durable_objects.bindings]] no wrangler.toml\n', 500);
			return await env.CONTA.get(env.CONTA.idFromName(NOME_CONTA)).fetch(req);
		} catch (e) {
			return respostaJson({ error: { code: 'INTERNAL', message: String(e?.message || e), nothingExecuted: false, executionUnknown: true } }, 500);
		}
	},
};

export class ContaDiscord {
	constructor(state, env) {
		this.state = state;
		this.env = env;
		this.app = null;
	}

	montar() {
		if (this.app) return this.app;
		const cfg = lerConfig(this.env);
		const log = (nivel, msg, extra) => { if (nivel !== 'debug') console.log(`${nivel} ${msg}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`); };
		const cliente = new ClienteDiscord({ config: cfg, log });
		const estado = new Estado({ armazem: new ArmazemDurable(this.state.storage), config: cfg, log });
		const executor = new Executor({ config: cfg, cliente, estado, gateway: null, protocolo: cfg.PROTOCOLO, log });
		const servidor = new ServidorMcp({ executor, config: cfg, log });
		const rotas = new Rotas({ servidor, segredo: cfg.MCP_TOKEN, prefixo: '/mcp', log });
		this.app = { cfg, estado, rotas };
		return this.app;
	}


	async fetch(req) {
		const app = this.montar();
		try { return await app.rotas.tratar(req); }
		finally { await app.estado.salvarAgora().catch(() => {}); }
	}
}
