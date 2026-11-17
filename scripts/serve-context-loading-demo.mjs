import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const demo=new URL('../docs/demo/context-loading/',import.meta.url);
const fonts=new URL('../docs/demo/layout-review/fonts/',import.meta.url);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2'};
const allowed=new Map(['index.html','style.css','app.js','data.js','flow.html','flow.css','flow.js','flow-layouts.js','assembly.html','assembly.css','assembly.js','constellation.html','constellation.css','constellation.js','native.html','native.css','native.js','circuit.html'].map(name=>['/'+name,new URL(name,demo)]));
allowed.set('/matrix.html',new URL('../.dsh/context-loading-matrix/index.html',import.meta.url));
for(const name of ['matrix','reader','overview','zoom'])allowed.set('/light/'+name+'.html',new URL('../.dsh/context-light-demos/'+name+'.html',import.meta.url));
allowed.set('/native-data.js',new URL('../.dsh/context-loading-native/native-data.js',import.meta.url));
for(const name of ['Geist-Variable.woff2','GeistMono-Variable.woff2'])allowed.set('/layout-review/fonts/'+name,new URL(name,fonts));
const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/'||pathname==='/light/'){res.writeHead(302,{'Location':'/light/zoom.html'});res.end();return;}
  const file=allowed.get(pathname);
  if(!file){res.writeHead(404);res.end('Not found');return;}
  try{const body=await readFile(file);const extension='.'+fileURLToPath(file).split('.').at(-1);res.writeHead(200,{'Content-Type':mime[extension]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);}
  catch{res.writeHead(500);res.end('Demo resource unavailable');}
});
server.listen(Number(process.argv[2]??3196),'127.0.0.1',()=>console.log('Eval context demos: http://127.0.0.1:'+server.address().port+'/light/zoom.html'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
