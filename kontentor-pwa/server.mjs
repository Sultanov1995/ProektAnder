import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const port=Number(process.env.PORT||3000), root=path.resolve("public");
const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".webmanifest":"application/manifest+json",".svg":"image/svg+xml"};
http.createServer((req,res)=>{
  const u=new URL(req.url||"/","http://localhost");
  if(u.pathname==="/api/health"){res.writeHead(200,{"content-type":"application/json"});return res.end(JSON.stringify({ok:true,app:"KONTENTOR",version:"0.9-pwa"}));}
  let p=u.pathname==="/"?"index.html":u.pathname.replace(/^\//,"");
  p=path.normalize(p).replace(/^(\.\.(\/|\\|$))+/,"");
  const f=path.join(root,p);
  fs.readFile(f,(e,b)=>{if(e){fs.readFile(path.join(root,"index.html"),(_,x)=>{res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end(x);});return;}
    res.writeHead(200,{"content-type":types[path.extname(f)]||"application/octet-stream","cache-control":p==="sw.js"?"no-cache":"public, max-age=300"});res.end(b);
  });
}).listen(port,"0.0.0.0",()=>console.log("KONTENTOR PWA on",port));
