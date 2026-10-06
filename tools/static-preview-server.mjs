// خادم ملفات ثابت للتجربة اليدوية (Preview) — بلا أي اعتماد خارجي.
// يُشغَّل من جذر المستودع: node tools/static-preview-server.mjs
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const port=Number(process.env.PORT||8080);
const host=process.env.HOST||'0.0.0.0';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.md':'text/markdown; charset=utf-8','.pdf':'application/pdf'};

const server=http.createServer(async(request,response)=>{
  try{
    const url=new URL(request.url,'http://localhost');
    const target=path.join(root,decodeURIComponent(url.pathname));
    if(!target.startsWith(root)){response.writeHead(403).end('forbidden');return}
    const stat=await fs.stat(target).catch(()=>null);
    const file=stat?.isDirectory()?path.join(target,'index.html'):target;
    const body=await fs.readFile(file);
    response.writeHead(200,{
      'content-type':mime[path.extname(file).toLowerCase()]||'application/octet-stream',
      // Service Worker يجب ألا يُخزَّن مؤقتًا بقوة حتى تصل التحديثات فورًا
      'cache-control':path.basename(file)==='sw.js'?'no-cache':'no-store',
      'service-worker-allowed':'/'
    });
    response.end(body);
  }catch{response.writeHead(404,{'content-type':'text/plain; charset=utf-8'}).end('404')}
});
server.listen(port,host,()=>console.log(`static preview server on http://${host}:${port} (root: ${root})`));
