import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

let app;
let vite;
let exit = false;

async function waitForUrl(url, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export const config = {
  host: '127.0.0.1',
  port: 4445,
  path: '/',
  specs: ['./test/specs/**/*.js'],
  maxInstances: 1,
  capabilities: [{}],
  reporters: ['spec'],
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  onPrepare: async () => {
    vite = spawn('npm', ['run', 'dev'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: [null, process.stdout, process.stderr],
      shell: true,
    });

    vite.on('error', (error) => {
      console.error('vite error:', error);
      process.exit(1);
    });
    vite.on('exit', (code) => {
      if (!exit) {
        console.error('vite exited with code:', code);
        process.exit(1);
      }
    });

    await waitForUrl('http://localhost:1420');

    spawnSync('cargo', ['build', '--manifest-path', 'src-tauri/Cargo.toml'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      shell: true,
    });
  },

  beforeSession: async () => {
    app = spawn(
      path.resolve(
        __dirname,
        '..',
        'src-tauri',
        'target',
        'debug',
        'deep-search-app'
      ),
      [],
      { stdio: [null, process.stdout, process.stderr] }
    );

    app.on('error', (error) => {
      console.error('app error:', error);
      process.exit(1);
    });
    app.on('exit', (code) => {
      if (!exit) {
        console.error('app exited with code:', code);
        process.exit(1);
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 3000));
  },

  afterSession: () => {
    closeAll();
  },
};

function closeAll() {
  exit = true;
  app?.kill();
  vite?.kill();
}

function onShutdown(fn) {
  const cleanup = () => {
    try {
      fn();
    } finally {
      process.exit();
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGHUP', cleanup);
  process.on('SIGBREAK', cleanup);
}

onShutdown(() => {
  closeAll();
});
