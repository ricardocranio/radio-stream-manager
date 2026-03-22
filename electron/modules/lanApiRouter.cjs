// =============== LAN API ROUTER ===============
// Maps HTTP POST /api/<channel> to Electron IPC handlers
// This allows remote browsers (LAN/VPN) to call the same functions as the desktop app

const { ipcMain } = require('electron');

/**
 * Intercepts API requests on the LAN server and routes them
 * to the registered IPC handlers, returning JSON responses.
 */
function handleApiRequest(req, res, { getMainWindow }) {
  // Only accept /api/ routes
  const urlPath = req.url.split('?')[0];
  if (!urlPath.startsWith('/api/')) return false;

  const channel = urlPath.replace('/api/', '').replace(/\//g, '');
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  // Health check
  if (channel === 'health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, timestamp: Date.now() }));
    return true;
  }

  // Collect body for POST
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const params = body ? JSON.parse(body) : {};
        const result = await invokeHandler(channel, params, getMainWindow);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error(`[LAN-API] Error on ${channel}:`, err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return true;
  }

  // GET for simple queries
  if (req.method === 'GET') {
    (async () => {
      try {
        const result = await invokeHandler(channel, {}, getMainWindow);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error(`[LAN-API] Error on ${channel}:`, err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    })();
    return true;
  }

  return false;
}

/**
 * Invoke an IPC handler by channel name.
 * We access the registered handlers directly via ipcMain._invokeHandlers
 * which is an internal map of channel -> handler.
 * 
 * Since Electron doesn't expose a public API to call handlers programmatically,
 * we maintain our own registry.
 */
const handlerRegistry = new Map();

function registerApiHandler(channel, handler) {
  handlerRegistry.set(channel, handler);
}

async function invokeHandler(channel, params, getMainWindow) {
  const handler = handlerRegistry.get(channel);
  if (!handler) {
    throw new Error(`Unknown API channel: ${channel}`);
  }
  // Simulate IPC event object
  const fakeEvent = { sender: null };
  return await handler(fakeEvent, params);
}

/**
 * Creates a wrapped safeHandle that registers both IPC AND API handlers
 */
function createDualHandle(originalSafeHandle) {
  return function dualHandle(channel, handler) {
    // Register IPC handler as normal
    originalSafeHandle(channel, handler);
    // Also register in API router
    registerApiHandler(channel, handler);
  };
}

module.exports = { handleApiRequest, registerApiHandler, createDualHandle };
