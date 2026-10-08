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
let app;
try {
  app = await environment.runner.import('/examples/native/app.ts');
} catch (error) {
  await server.close();
  throw error;
}

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
const timer = setInterval(() => {
  if (!app.session.host.disposed) {
    return;
  }
  clearInterval(timer);
  void close();
}, 100);
console.log('Edit examples/native/app.ts; the native window and GPU device survive accepted HMR.');
