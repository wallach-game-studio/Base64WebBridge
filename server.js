const express = require('express');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const mime = require('mime-types');

const readFileAsync = promisify(fs.readFile);
const statAsync = promisify(fs.stat);

// --- Configuration Loading ---
const configPath = path.join(__dirname, 'config.json');
let config = {};
let configLoadedFromFile = false;
try {
  const configContent = fs.readFileSync(configPath, 'utf8');
  config = JSON.parse(configContent);
  configLoadedFromFile = true;
  console.log(`[${new Date().toISOString()}] INFO: Loaded configuration from ${configPath}`);
} catch (error) {
  console.warn(`[${new Date().toISOString()}] WARN: Could not read config.json at ${configPath}: ${error.message}. Using environment variables or default values.`);
}

// Apply defaults and environment variables
config.port = process.env.PORT || config.port || 3000;
config.allowedRoots = (process.env.ALLOWED_ROOTS ? process.env.ALLOWED_ROOTS.split(',') : config.allowedRoots) || [];
config.maxFileSizeMB = parseInt(process.env.MAX_FILE_SIZE_MB || config.maxFileSizeMB || 50, 10);

if (!configLoadedFromFile) {
  console.log(`[${new Date().toISOString()}] INFO: Running with configuration from environment variables or internal defaults.`);
}

const MAX_FILE_SIZE_BYTES = config.maxFileSizeMB * 1024 * 1024;

// Normalize allowed roots and resolve relative paths against executable directory
const execDir = __dirname;
config.allowedRoots = config.allowedRoots.map(root => {
  const resolvedRoot = path.isAbsolute(root) ? root : path.resolve(execDir, root);
  return path.normalize(resolvedRoot).toLowerCase();
});

// --- Express App Setup ---
const app = express();

// --- Logging Middleware ---
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1_000_000; // milliseconds
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration.toFixed(2)}ms`);
  });
  next();
});

// --- Helper Functions ---

function isPathAllowed(filePath, allowedRoots) {
  const normalizedFilePath = path.normalize(filePath).toLowerCase();
  for (const root of allowedRoots) {
    if (normalizedFilePath.startsWith(root)) {
      return true;
    }
  }
  return false;
}

function containsPathTraversal(filePath) {
  // Normalize all separators to '/' for consistent checking regardless of OS
  const normalizedFilePath = filePath.replace(/\\/g, '/');
  const segments = normalizedFilePath.split('/');
  // Check for '..' segments
  return segments.some(segment => segment === '..');
}

// --- API Endpoint: GET /base64 ---
app.get('/base64', async (req, res) => {
  const filePath = req.query.path;

  // 400: Missing or invalid path
  if (!filePath) {
    console.error(`[${new Date().toISOString()}] ERROR: 400 - Missing path query parameter.`);
    return res.status(400).json({ error: 'Missing "path" query parameter.' });
  }

  // Path normalization and security checks
  let absolutePath;
  try {
    // If filePath is an absolute path, path.resolve will handle it.
    // If it's a relative path (e.g., /testFiles/tiff.tif), resolve it against __dirname.
    const isWindowsDrivePath = /^[a-zA-Z]:/.test(filePath);
    if (path.isAbsolute(filePath) && isWindowsDrivePath) {
      absolutePath = path.resolve(filePath);
    } else {
      absolutePath = path.join(__dirname, filePath);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ERROR: 400 - Invalid path format: ${filePath}. Error: ${err.message}`);
    return res.status(400).json({ error: `Invalid path format: ${filePath}` });
  }

  if (containsPathTraversal(filePath)) { // Check original path for traversal attempts
    console.error(`[${new Date().toISOString()}] ERROR: 403 - Path traversal attempt detected: ${filePath}`);
    return res.status(403).json({ error: 'Path traversal attempts are not allowed.' });
  }

  if (!isPathAllowed(absolutePath, config.allowedRoots)) {
    console.error(`[${new Date().toISOString()}] DEBUG: Attempted path: ${absolutePath}`);
    console.error(`[${new Date().toISOString()}] DEBUG: Configured allowedRoots: ${JSON.stringify(config.allowedRoots)}`);
    console.error(`[${new Date().toISOString()}] ERROR: 403 - Path not allowed by configuration: ${absolutePath}`);
    return res.status(403).json({ error: 'Access to the specified path is not allowed.' });
  }

  try {
    const stats = await statAsync(absolutePath);

    if (!stats.isFile()) {
      console.error(`[${new Date().toISOString()}] ERROR: 404 - Path is not a file: ${absolutePath}`);
      return res.status(404).json({ error: 'The specified path is not a file.' });
    }

    if (stats.size > MAX_FILE_SIZE_BYTES) {
      console.error(`[${new Date().toISOString()}] ERROR: 400 - File size (${stats.size} bytes) exceeds maximum allowed (${MAX_FILE_SIZE_BYTES} bytes).`);
      return res.status(400).json({ error: `File size exceeds maximum allowed (${config.maxFileSizeMB}MB).` });
    }

    const fileBuffer = await readFileAsync(absolutePath);
    const base64 = fileBuffer.toString('base64');
    const fileName = path.basename(absolutePath);
    const mimeType = mime.lookup(fileName) || 'application/octet-stream';

    res.json({
      fileName,
      sizeBytes: stats.size,
      mimeType,
      base64,
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`[${new Date().toISOString()}] ERROR: 404 - File not found: ${absolutePath}. Error: ${error.message}`);
      return res.status(404).json({ error: 'File not found.' });
    } else if (error.code === 'EACCES') {
      console.error(`[${new Date().toISOString()}] ERROR: 403 - Permission denied to read file: ${absolutePath}. Error: ${error.message}`);
      return res.status(403).json({ error: 'Permission denied to read the file.' });
    }
    console.error(`[${new Date().toISOString()}] ERROR: 500 - Read or encode failure for ${absolutePath}. Error: ${error.message}`);
    res.status(500).json({ error: 'Failed to read or encode file.' });
  }
});

// --- Server Startup ---
app.listen(config.port, '127.0.0.1', () => {
  console.log(`[${new Date().toISOString()}] Base64 File Bridge Agent starting...`);
  console.log(`[${new Date().toISOString()}] Binding to: 127.0.0.1:${config.port}`);
  console.log(`[${new Date().toISOString()}] Allowed roots:`);
  if (config.allowedRoots.length === 0) {
    console.log(`[${new Date().toISOString()}]   (None specified, all file access will be blocked unless configured)`);
  } else {
    config.allowedRoots.forEach(root => console.log(`[${new Date().toISOString()}]   - ${root}`));
  }
  console.log(`[${new Date().toISOString()}] Max file size: ${config.maxFileSizeMB}MB`);
  console.log(`[${new Date().toISOString()}] Ready to serve requests.`);
});

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (err) => {
  console.error(`[${new Date().toISOString()}] FATAL: Uncaught exception: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${new Date().toISOString()}] FATAL: Unhandled rejection at: ${promise}, reason: ${reason.message || reason}`);
  console.error(reason.stack || 'No stack trace available');
  process.exit(1);
});
