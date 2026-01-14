let fetch;
// Dynamically import node-fetch as it's an ESM module
async function loadNodeFetch() {
  const nodeFetch = await import('node-fetch');
  fetch = nodeFetch.default;
}

// Call this at the beginning of main()
// await loadNodeFetch();
const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

const TEMP_DIR = process.env.TEMP_DIR || path.join(__dirname, 'temp_for_tests'); // Using a relative path for cross-platform compatibility
const ALLOWED_ROOT = TEMP_DIR; // Use TEMP_DIR as an allowed root for testing
const TEST_FILE_NAME = 'test_file.txt';
const TEST_FILE_PATH = path.join(ALLOWED_ROOT, TEST_FILE_NAME);
const TEST_FILE_CONTENT = 'Hello, Base64!';
const TEST_FILE_BASE64 = Buffer.from(TEST_FILE_CONTENT).toString('base64');

// A slightly larger file content for size limit testing (if needed, simplified for now)
const LARGE_FILE_NAME = 'large_test_file.txt';
const LARGE_FILE_PATH = path.join(ALLOWED_ROOT, LARGE_FILE_NAME);
const LARGE_FILE_CONTENT_TEMPLATE = 'a'.repeat(1024 * 1024); // 1MB of 'a'

let serverProcess;

async function setup() {
  console.log('Setting up test environment...');
  await fs.mkdir(TEMP_DIR, { recursive: true });
  await fs.writeFile(TEST_FILE_PATH, TEST_FILE_CONTENT);
  console.log(`Test file created: ${TEST_FILE_PATH}`);

  // Modify config.json to include TEMP_DIR as an allowed root
  const configPath = path.join(__dirname, 'config.json');
  let config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  if (!config.allowedRoots.includes(ALLOWED_ROOT) && !config.allowedRoots.includes(ALLOWED_ROOT.replace(/\\/g, '/'))) {
    config.allowedRoots.push(ALLOWED_ROOT.replace(/\\/g, '/')); // Ensure forward slashes for config consistency
  }
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  console.log(`Updated config.json with allowed root: ${ALLOWED_ROOT}`);

  // Start the server
  serverProcess = exec('node server.js', { env: { ...process.env, PORT: PORT, ALLOWED_ROOTS: ALLOWED_ROOT.replace(/\\/g, '/') } });

  let serverReady = false;
  serverProcess.stdout.on('data', (data) => {
    // console.log(`SERVER: ${data}`);
    if (data.includes('Ready to serve requests.')) {
      console.log('Server started.');
      serverReady = true;
    }
  });
  serverProcess.stderr.on('data', (data) => {
    console.error(`SERVER ERROR: ${data}`);
  });

  // Wait for server to be ready
  await new Promise(resolve => {
    const checkInterval = setInterval(() => {
      if (serverReady) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 100); // Check every 100ms
  });
}

async function teardown() {
  console.log('Tearing down test environment...');
  if (serverProcess) {
    if (process.platform === 'win32') {
      // For Windows, use taskkill to forcefully terminate the process tree
      try {
        console.log(`Attempting to forcefully kill server process with PID: ${serverProcess.pid}`);
        // The /T option kills the process and any child processes started by it.
        // The /F option forcefully terminates processes.
        await new Promise((resolve, reject) => {
          exec(`taskkill /F /PID ${serverProcess.pid} /T`, (error, stdout, stderr) => {
            if (error) {
              console.error(`taskkill error: ${error.message}`);
              // Don't reject, as the process might already be gone, or it's a minor error.
            }
            if (stderr) {
              console.error(`taskkill stderr: ${stderr}`);
            }
            console.log(`taskkill stdout: ${stdout}`);
            resolve();
          });
        });
      } catch (e) {
        console.error(`Error during taskkill: ${e.message}`);
      }
    } else {
      // For non-Windows, use the default kill method
      serverProcess.kill();
    }
    console.log('Server stopped.');
  }
  await fs.rm(TEMP_DIR, { recursive: true, force: true });
  console.log(`Cleaned up ${TEMP_DIR}`);

  // Revert config.json changes (simple approach for this test)
  const configPath = path.join(__dirname, 'config.json');
  let config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.allowedRoots = config.allowedRoots.filter(root => root !== ALLOWED_ROOT.replace(/\\/g, '/'));
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  console.log('Reverted config.json');
}

async function runTest(name, testFunction) {
  process.stdout.write(`Running test: ${name}...`);
  try {
    await testFunction();
    console.log('PASSED');
  } catch (error) {
    console.error('FAILED');
    console.error(error);
    process.exit(1);
  }
}

async function main() {
  await loadNodeFetch(); // Initialize fetch
  await setup();

  await runTest('Valid file path returns Base64', async () => {
    const res = await fetch(`${BASE_URL}/base64?path=${encodeURIComponent(TEST_FILE_PATH)}`);
    const json = await res.json();

    assert.strictEqual(res.status, 200, `Expected 200 but got ${res.status}`);
    assert.strictEqual(json.fileName, TEST_FILE_NAME);
    assert.strictEqual(json.sizeBytes, TEST_FILE_CONTENT.length);
    assert.strictEqual(json.mimeType, 'text/plain');
    assert.strictEqual(json.base64, TEST_FILE_BASE64);
  });

  await runTest('Non-existing file returns 404', async () => {
    const nonExistentPath = path.join(ALLOWED_ROOT, 'non_existent.txt');
    const res = await fetch(`${BASE_URL}/base64?path=${encodeURIComponent(nonExistentPath)}`);
    const json = await res.json();

    assert.strictEqual(res.status, 404, `Expected 404 but got ${res.status}`);
    assert.strictEqual(json.error, 'File not found.');
  });

  await runTest('Path outside allow-list returns 403', async () => {
    const outsidePath = path.join(__dirname, 'package.json'); // package.json is outside TEMP_DIR
    const res = await fetch(`${BASE_URL}/base64?path=${encodeURIComponent(outsidePath)}`);
    const json = await res.json();

    assert.strictEqual(res.status, 403, `Expected 403 but got ${res.status}`);
    assert.strictEqual(json.error, 'Access to the specified path is not allowed.');
  });

  await runTest('Missing path parameter returns 400', async () => {
    const res = await fetch(`${BASE_URL}/base64`);
    const json = await res.json();

    assert.strictEqual(res.status, 400, `Expected 400 but got ${res.status}`);
    assert.strictEqual(json.error, 'Missing "path" query parameter.');
  });

  await runTest('Path traversal attempt returns 403', async () => {
    const traversalPath = path.join(ALLOWED_ROOT, '..\\', 'package.json');
    const res = await fetch(`${BASE_URL}/base64?path=${encodeURIComponent(traversalPath)}`);
    const json = await res.json();

    assert.strictEqual(res.status, 403, `Expected 403 but got ${res.status}`);
    assert.strictEqual(json.error, 'Path traversal attempts are not allowed.');
  });

  await runTest('File exceeding max size returns 400', async () => {
    const largeFileContent = LARGE_FILE_CONTENT_TEMPLATE.repeat(config.maxFileSizeMB + 1); // Exceeds limit
    await fs.writeFile(LARGE_FILE_PATH, largeFileContent);
    console.log(`Large test file created: ${LARGE_FILE_PATH}`);

    const res = await fetch(`${BASE_URL}/base64?path=${encodeURIComponent(LARGE_FILE_PATH)}`);
    const json = await res.json();

    assert.strictEqual(res.status, 400, `Expected 400 but got ${res.status}`);
    assert.ok(json.error.includes('File size exceeds maximum allowed'), `Unexpected error message: ${json.error}`);

    await fs.unlink(LARGE_FILE_PATH);
  });

  await teardown();
}

main().catch(async (err) => {
  console.error('An error occurred during testing:', err);
  await teardown();
  process.exit(1);
});
