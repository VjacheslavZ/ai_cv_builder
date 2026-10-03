import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';

export const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_RE = /^[\w-]{1,128}$/;

/** Paths pino replaces with "[redacted]". CV text, answers, and emails must never be logged. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body',
  'body',
  '*.body',
  'email',
  '*.email',
  'password',
  '*.password',
];

export function requestIdFor(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === 'string' && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

const PROBES = new Set(['/health', '/ready']);

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.logLevel,
          genReqId: requestIdFor,
          // Every log line inside a request carries `requestId` (not the whole request).
          quietReqLogger: true,
          customAttributeKeys: { reqId: 'requestId' },
          redact: { paths: REDACT_PATHS, censor: '[redacted]' },
          autoLogging: { ignore: (req) => PROBES.has(req.url ?? '') },
          // Method and path only: query strings and headers are not needed and may carry PII.
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              path: req.url.split('?')[0],
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
        },
      }),
    }),
  ],
})
export class LoggerModule {}
