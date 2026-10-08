import { createServer, isRunnableDevEnvironment } from 'vite';
import { blinc } from '../../dist/vite.js';

const server = await createServer({
  configFile: false,
  plugins: [blinc()],
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const environment = server.environments.blinc;
if (!isRunnableDevEnvironment(environment)) {
  throw new Error('Missing Blinc environment');
}
const app = await environment.runner.import('/examples/hmr/app.ts');

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
process.once('SIGINT', () => {
  void close();
});
process.once('SIGTERM', () => {
  void close();
});
console.log('Edit examples/hmr/app.ts; the host should survive each UI reload.');
