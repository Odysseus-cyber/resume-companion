import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('tests/fixtures');
http
  .createServer(async (req, res) => {
    try {
      const name = req.url === '/' ? 'application.html' : req.url?.slice(1);
      if (
        !name ||
        ![
          'application.html',
          'controlled.html',
          'layout.html',
          'profile-fields.html',
          'choices.html',
        ].includes(name)
      ) {
        res.writeHead(404).end();
        return;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(await readFile(resolve(root, name)));
    } catch {
      res.writeHead(500).end();
    }
  })
  .listen(Number(process.env.RC_TEST_PORT || 4178), '127.0.0.1');
