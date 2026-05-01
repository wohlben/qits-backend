const WebSocket = require('./node_modules/ws');

const port = process.argv[2];
if (!port) {
    console.error('Usage: node ws-generate-migration.js <port>');
    process.exit(1);
}

const url = `ws://localhost:${port}/q/dev-ui/json-rpc-ws`;
const ws = new WebSocket(url);

ws.on('open', () => {
    ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'quarkus-flyway_update',
        params: { ds: '<default>' }
    }));
});

ws.on('message', (data) => {
    console.log(data.toString());
    ws.close();
});

ws.on('error', (err) => {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
});

ws.on('close', () => {
    process.exit(0);
});
