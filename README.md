# Discord MCP

[Leia em português](README.pt-BR.md)

Discord MCP is an MCP server that lets an AI agent operate a personal Discord account. It was made for a secondary account, so the agent can keep up with conversations for you. It reads an inbox with the recent messages, lists servers, channels, DMs and threads, reads and searches messages, sends, replies to, edits and deletes messages, reacts, opens DMs, marks conversations as read, joins threads and invites, creates threads, looks up users and manages friends.

It has no dependencies at all and runs on plain Node.js. A live connection to the Discord gateway keeps the state up to date, sending is paced so it does not hit the rate limits, and there is a read only mode that blocks any action that writes something. You can also give the agent a protocol file with the rules it should follow when answering people.

Keep in mind that Discord does not allow automating user accounts, so the account used here can be banned. That is why it was designed around a secondary account.

## How to use

You need Node.js 20 or newer. Create a .env file next to servidor.mjs with DISCORD_TOKEN holding the token of the account. Then run node servidor.mjs --check to confirm that the account, the state and the gateway are ready.

By default the server talks over stdio, so in your MCP client you only need to register the node command with the path to servidor.mjs. To use it over HTTP, run npm run http and the server listens on port 8787 of your machine, under the mcp path. Outside of localhost the HTTP mode requires a password in MCP_TOKEN. To try a single tool from the terminal, use the call option, for example node servidor.mjs --call inbox limit=5.

Other settings also go in the .env file, like SOMENTE_LEITURA=1 for read only mode, GATEWAY=0 to turn off the live connection and the sending limits. The repository also has a Cloudflare Workers version, configured in wrangler.toml, for anyone who wants to keep it running online.

## Development time

Discord MCP was built in fifty minutes.

## License

GNU General Public License version 3. The full text is in the LICENSE file.
