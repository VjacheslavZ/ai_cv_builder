import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { extractText, getDocumentProxy } from 'unpdf';

/**
 * The PDF as bytes (supertest buffers only text bodies by default): the download, or with
 * `preview` the live preview (AC-11.7).
 */
export function getPdf(
  app: NestExpressApplication,
  cvId: string,
  cookie: string,
  { preview = false } = {},
) {
  return request(app.getHttpServer())
    .get(`/api/cvs/${cvId}/pdf${preview ? '/preview' : ''}`)
    .set('Cookie', cookie)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
}

export interface ParsedPdf {
  pages: { width: number; height: number; text: string }[];
  text: string;
}

export async function parsePdf(bytes: Buffer): Promise<ParsedPdf> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = await Promise.all(
    text.map(async (pageText, i) => {
      const { width, height } = (await pdf.getPage(i + 1)).getViewport({ scale: 1 });
      return { width, height, text: pageText };
    }),
  );
  await pdf.loadingTask.destroy();
  return { pages, text: text.join('\n') };
}
