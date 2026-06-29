const { spawn } = require('child_process');

console.log('\x1b[35m[P2P Sender]\x1b[0m Starting local development servers...');

// Start the signaling server
const server = spawn('node', ['server/index.js'], {
  stdio: 'inherit',
  shell: true
});

// Start the Next.js client
const client = spawn('npx.cmd', ['next', 'dev'], {
  stdio: 'inherit',
  shell: true
});

// Coordinate process termination
process.on('SIGINT', () => {
  console.log('\n\x1b[35m[P2P Sender]\x1b[0m Stopping dev servers...');
  server.kill('SIGINT');
  client.kill('SIGINT');
  process.exit();
});

server.on('exit', (code) => {
  console.log(`Signaling server exited with code ${code}`);
  client.kill('SIGINT');
  process.exit(code);
});

client.on('exit', (code) => {
  console.log(`Next.js client exited with code ${code}`);
  server.kill('SIGINT');
  process.exit(code);
});
