/** Current-style feature prototypes. No production API or database. */
import {createServer} from '../../web/node_modules/vite/dist/node/index.js';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const photos=['cl-nzxt-specs-in-pics-750/a.jpg','cl-latitude7420-295/p1.jpg','cl-iphone15-250-cambridge/a.jpg'];
const server=await createServer({root:root+'web',configFile:root+'web/vite.config.ts',server:{host:'127.0.0.1',port:3194,strictPort:true},plugins:[{name:'example-photos',configureServer(s){s.middlewares.use(async(req,res,next)=>{
  if(req.url==='/'){req.url='/feature-preview.html';return next();}
  if(!req.url.startsWith('/feature-assets/'))return next();
  const photo=photos[Number(req.url.split('/').pop())];if(!photo){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type','image/jpeg');res.end(await readFile(root+'docs/testset/'+photo));
});}}]});
await server.listen();console.log('Current-style feature preview: http://127.0.0.1:3194/');
