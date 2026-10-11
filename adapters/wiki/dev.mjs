// Serves the wiki's sources to a window: each edit mounts it again, in the window already open.
import { createServer, isRunnableDevEnvironment } from 'vite';
import { blinc } from 'blinc_ts/vite';

const root = new URL('../', import.meta.url).pathname;
const server = await createServer({
  root,
  configFile: false,
  plugins: [blinc()],
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const environment = server.environments.blinc;
if (!isRunnableDevEnvironment(environment)) {
  throw new Error('Missing Blinc environment');
}
const app = await environment.runner.import('/wiki/app.ts');

let closing = false;
async function close() {
  if (closing) {
    return;
  }
  closing = true;
  try {
    app.session.dispose();
  } finally {
    await server.close();
  }
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
void app.session.host.window.closed.then(close);
console.log('Edit anything under adapters/wiki or adapters/base-ui; the window stays open.');
