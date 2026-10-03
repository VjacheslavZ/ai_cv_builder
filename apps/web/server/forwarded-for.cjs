// Preloaded into the production web server (`node --require`, see apps/web/Dockerfile).
//
// Next.js rewrites to an external URL do not add X-Forwarded-For (Phase 0 spike), so the API
// would see the web container as the client and per-IP rate limits (AC-1.6) would lump all
// users together. This sets X-Forwarded-For to the address of the peer that connected to Next,
// overwriting any client-supplied value so it cannot be spoofed. If a trusted load balancer is
// ever put in front of `web`, this must append instead (see README → Decisions).
'use strict';

const http = require('node:http');

const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function emitWithForwardedFor(event, req, ...rest) {
  if (event === 'request' && req && req.socket && req.socket.remoteAddress) {
    req.headers['x-forwarded-for'] = req.socket.remoteAddress;
  }
  return emit.call(this, event, req, ...rest);
};
