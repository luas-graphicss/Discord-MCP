import { FERRAMENTAS, MAPA_FERRAMENTAS, NOMES_FERRAMENTAS } from './ferramentas.js';

const tipo = (s) => {
	if (!s || typeof s !== 'object') return 'any';
	if (s.enum) return 'enum(' + s.enum.join('|') + ')';
	if (s.type === 'array') return `array<${tipo(s.items)}>`;
	return Array.isArray(s.type) ? s.type.join('|') : (s.type || 'any');
};

export function listarFerramentas() {
	const linhas = [];
	for (const f of FERRAMENTAS) {
		const req = f.inputSchema.required || [];
		const opt = Object.keys(f.inputSchema.properties || {}).filter((n) => !req.includes(n) && n !== 'format');
		const desc = (f.description || '').split('\n')[0].replace(/\s+/g, ' ');
		linhas.push(`${f.name}${req.length ? ' ' + req.map((n) => n + '=').join(' ') : ''}${opt.length ? '  [' + opt.join(' ') + ']' : ''}`);
		linhas.push(`    ${desc.length > 150 ? desc.slice(0, 147) + '...' : desc}`);
	}
	return linhas.join('\n');
}

export function descreverFerramenta(nome) {
	const f = MAPA_FERRAMENTAS.get(nome);
	if (!f) return null;
	const props = f.inputSchema.properties || {}, req = new Set(f.inputSchema.required || []);
	const linhas = [`## ${f.name} - ${f.title || ''}`, (f.description || '').trim(), ''];
	for (const [n, s] of Object.entries(props)) {
		const desc = (s.description || '').replace(/\s+/g, ' ').trim();
		linhas.push(` ${req.has(n) ? '*' : ' '} ${n}: ${tipo(s)}`);
		if (desc) linhas.push(`      ${desc}`);
	}
	linhas.push('', '(* = obrigatorio)');
	return linhas.join('\n');
}


export function coagir(v) {
	if (typeof v !== 'string') return v;
	if (v === '') return '';
	if ('[{"'.includes(v[0])) { try { return JSON.parse(v); } catch { return v; } }
	const low = v.toLowerCase();
	if (low === 'true' || low === 'false') return low === 'true';
	if (low === 'null' || low === 'none') return null;
	if (/^-?\d{1,14}$/.test(v)) return Number(v);
	if (/^-?\d*\.\d+([eE][-+]?\d+)?$/.test(v)) return Number(v);
	return v;
}


export function argumentosDeTexto(texto) {
	const out = {};
	const t = (texto || '').trim();
	if (!t) return out;
	if (t[0] === '{') return JSON.parse(t);
	const tokens = t.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
	for (const tok of tokens) {
		const m = tok.match(/^([A-Za-z_][\w.-]*)(:=|=)([\s\S]*)$/);
		if (!m) throw new Error(`argumento invalido '${tok}': use chave=valor, chave:=json ou um unico JSON`);
		let [, key, op, val] = m;
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
		out[key] = op === ':=' ? JSON.parse(val) : coagir(val);
	}
	return out;
}

export function ajudaTerminal(base) {
	return `Discord MCP (conta pessoal) - acesso por terminal
URL: ${base}

OPCAO 1 - CLI pronto (so precisa de python3):
  curl -fsSL ${base}/cli -o dc && chmod +x dc
  ./dc status                              conta conectada, gateway, limites
  ./dc tools                               lista de ferramentas com parametros
  ./dc schema reply_message                parametros detalhados de uma ferramenta
  ./dc inbox                               o que chegou e ainda nao foi tratado
  ./dc call read_messages channelId=123 limit=20
  ./dc call reply_message channelId=123 messageId=456 content="Oi! Ja vou verificar seu pedido."
  ./dc call mark_read channelId=123
  (sem python: curl -fsSL ${base}/cli.sh -o dc && chmod +x dc - mesmos comandos)

OPCAO 2 - curl direto:
  curl -s ${base}/tools
  curl -s ${base}/tools/inbox
  curl -s -X POST ${base}/call/inbox
  curl -s -d 'channelId=123 limit=20' ${base}/call/read_messages
  curl -s -H 'Content-Type: application/json' -d '{"channelId":"123","messageId":"456","content":"Oi!"}' ${base}/call/reply_message
  Corpo: JSON ou "chave=valor chave2=valor2" (numeros/booleanos/JSON sao convertidos; ids ficam como texto).
  Resposta: texto compacto; HTTP 200 = ok, 4xx/5xx = erro (texto comeca com "ERRO CODIGO:").
  Acrescente ?format=json para receber o objeto bruto.

OPCAO 3 - cliente MCP padrao (Streamable HTTP): POST ${base} com JSON-RPC 2.0.

Fluxo de atendimento: discord_status -> read_protocol -> inbox -> read_messages (contexto) -> reply_message -> (mark_read no que nao vai responder).
Ferramentas: ${NOMES_FERRAMENTAS.join(', ')}
`;
}

export function cliPython(base) {
	return `#!/usr/bin/env python3
import json, sys, urllib.request, urllib.error
BASE = ${JSON.stringify(base)}

def http(method, path, body=None, ctype="text/plain"):
    req = urllib.request.Request(BASE + path, data=body.encode() if body is not None else None, method=method)
    req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def call(tool, args):
    fmt = ""
    if "--json" in args:
        args = [a for a in args if a != "--json"]; fmt = "?format=json"
    body = " ".join(args) if args else ""
    ctype = "application/json" if body.startswith("{") else "text/plain"
    return http("POST", "/call/" + tool + fmt, body, ctype)

def main(argv):
    if not argv or argv[0] in ("help", "-h", "--help"):
        print("dc status | tools | schema <tool> | inbox [k=v...] | call <tool> [k=v | k:=json | '{json}'] [--json]")
        print("Valores com espacos entre aspas: content=\\"Oi, tudo bem?\\"  |  listas/objetos com :=  |  ids sao texto"); return 0
    cmd, rest = argv[0], argv[1:]
    if cmd == "status": code, out = call("discord_status", rest)
    elif cmd == "tools": code, out = http("GET", "/tools")
    elif cmd == "schema": code, out = http("GET", "/tools/" + (rest[0] if rest else ""))
    elif cmd == "inbox": code, out = call("inbox", rest)
    elif cmd == "call":
        if not rest: print("uso: dc call <tool> [args]", file=sys.stderr); return 2
        code, out = call(rest[0], rest[1:])
    else: code, out = call(cmd, rest)
    print(out.rstrip("\\n"))
    return 0 if 200 <= code < 300 else 1

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
`;
}

export function cliBash(base) {
	return `#!/usr/bin/env bash
set -u
BASE=${JSON.stringify(base)}
cmd="\${1:-help}"; shift || true
fmt=""; args=()
for a in "$@"; do if [ "$a" = "--json" ]; then fmt="?format=json"; else args+=("$a"); fi; done
chamar() { # chamar <tool> [args...]
  local tool="$1"; shift
  local body="$*"; local ctype="text/plain"
  case "$body" in "{"*) ctype="application/json";; esac
  curl -sS -w '\\n%{http_code}' -X POST -H "Content-Type: $ctype" --data-binary "$body" "$BASE/call/$tool$fmt"
}
imprimir() { local out; out="$(cat)"; local code="\${out##*$'\\n'}"; printf '%s\\n' "\${out%$'\\n'*}"; [ "$code" -ge 200 ] && [ "$code" -lt 300 ]; }
case "$cmd" in
  help|-h|--help) echo "dc status | tools | schema <tool> | inbox [k=v...] | call <tool> [k=v | k:=json | '{json}'] [--json]";;
  status) chamar discord_status "\${args[@]}" | imprimir;;
  tools) curl -sS "$BASE/tools";;
  schema) curl -sS "$BASE/tools/\${args[0]:-}";;
  inbox) chamar inbox "\${args[@]}" | imprimir;;
  call) t="\${args[0]:-}"; [ -z "$t" ] && { echo "uso: dc call <tool> [args]" >&2; exit 2; }; chamar "$t" "\${args[@]:1}" | imprimir;;
  *) chamar "$cmd" "\${args[@]}" | imprimir;;
esac
`;
}
