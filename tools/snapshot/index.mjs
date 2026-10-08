if (process.argv.includes('--watch')) {
  await import('./watch.mjs');
} else {
  await import('./run.mjs');
}
