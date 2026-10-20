# Discord MCP

[Read in English](README.md)

O Discord MCP é um servidor MCP que deixa um agente de IA operar uma conta pessoal do Discord. Ele foi feito para uma conta secundária, para o agente acompanhar as conversas por você. Ele lê uma caixa de entrada com as mensagens recentes, lista servidores, canais, DMs e threads, lê e busca mensagens, envia, responde, edita e apaga mensagens, reage, abre DMs, marca conversas como lidas, entra em threads e convites, cria threads, consulta usuários e gerencia amizades.

Ele não tem nenhuma dependência e roda só com o Node.js. Uma conexão ao vivo com o gateway do Discord mantém o estado atualizado, os envios seguem um ritmo controlado para não estourar o rate limit e existe um modo somente leitura que bloqueia qualquer ação que escreva alguma coisa. Também dá para entregar ao agente um arquivo de protocolo com as regras que ele deve seguir ao responder as pessoas.

Vale lembrar que o Discord não permite automatizar contas de usuário, então a conta usada aqui pode ser banida. É por isso que ele foi pensado para uma conta secundária.

## Como usar

Você precisa do Node.js 20 ou mais novo. Crie um arquivo .env ao lado do servidor.mjs com DISCORD_TOKEN contendo o token da conta. Depois rode node servidor.mjs --check para confirmar que a conta, o estado e o gateway estão prontos.

Por padrão o servidor conversa por stdio, então no seu cliente MCP basta cadastrar o comando node com o caminho do servidor.mjs. Para usar por HTTP, rode npm run http e o servidor fica escutando na porta 8787 da sua máquina, no caminho mcp. Fora do localhost o modo HTTP exige uma senha em MCP_TOKEN. Para testar uma ferramenta direto do terminal, use a opção call, por exemplo node servidor.mjs --call inbox limit=5.

As outras configurações também ficam no .env, como SOMENTE_LEITURA=1 para o modo somente leitura, GATEWAY=0 para desligar a conexão ao vivo e os limites de envio. O repositório também tem uma versão para Cloudflare Workers, configurada no wrangler.toml, para quem quiser deixar rodando online.

## Tempo de desenvolvimento

O Discord MCP foi feito em cinquenta minutos.

## Licença

GNU General Public License versão 3. O texto completo está no arquivo LICENSE.
