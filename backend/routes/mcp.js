const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpServer } = require('../services/mcpServer');
const { findUserByToken } = require('../services/mcpTokens');
const router = express.Router();

/**
 * MCP endpoint (Streamable HTTP, stateless): https://app.eniv.fr/api/mcp
 *
 * The MCP token (Settings > AI assistant) goes in the "Authorization: Bearer
 * <token>" header or, for clients that do not allow headers (claude.ai and
 * ChatGPT connectors), in the URL: /api/mcp/<token>.
 *
 * Stateless mode: no SSE stream (GET) nor session to close (DELETE), so every
 * other method gets a 405.
 * @module
 */

function jsonRpcError(res, status, message) {
  res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });
}

async function handleMcp(req, res) {
  const authHeader = req.headers.authorization;
  const token = req.params.token
    || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null);

  const user = token ? await findUserByToken(token) : null;
  if (!user) {
    return jsonRpcError(res, 401, 'Jeton MCP absent ou invalide : en générer un dans les paramètres d\'ENIV.');
  }

  const server = createMcpServer(user);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP error:', error);
    if (!res.headersSent) jsonRpcError(res, 500, 'Erreur interne du serveur');
  }
}

router.post(['/', '/:token'], handleMcp);

router.all(['/', '/:token'], (req, res) => {
  res.set('Allow', 'POST');
  jsonRpcError(res, 405, 'Méthode non autorisée');
});

module.exports = router;
