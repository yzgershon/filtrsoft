// Static, loopback-only concept studio. No API imports, accounts or databases.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
const directory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const repo = resolve(directory, '../..');
const photos = {
  pc: 'cl-nzxt-specs-in-pics-750/a.jpg', laptop: 'cl-latitude7420-295/p1.jpg',
  phone: 'cl-iphone15-250-cambridge/a.jpg', tower: 'cl-gaming-pc-650/00J0J_15C3WlVk7Fk.jpg',
  flip: 'cl-zflip6-350/p1.jpg', specs: 'cl-nzxt-specs-in-pics-750/c.jpg',
};
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (req.method !== 'GET') { res.writeHead(405); return res.end('Static design prototype'); }
  let file;
  if (pathname.startsWith('/photos/') && photos[pathname.slice(8)]) file = resolve(repo, 'docs/testset', photos[pathname.slice(8)]);
  else {
    file = resolve(directory, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(directory + sep)) { res.writeHead(403); return res.end(); }
    if (!['.html', '.css', '.js'].includes(extname(file))) { res.writeHead(404); return res.end(); }
  }
  try { const content = await readFile(file); res.writeHead(200, { 'content-type': ({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg'})[extname(file)], 'cache-control': 'no-store' }); res.end(content); }
  catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(3192, '127.0.0.1', () => console.log('Filtrsoft design studio: http://127.0.0.1:3192'));
