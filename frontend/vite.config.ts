import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {defineConfig} from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig(({mode})=>{
 const demo=mode==='demo';
 const site=new URL(process.env.PI_CONTROL_SITE_URL||'https://picontrol.rikolab.com/');
 if(!['https:','http:'].includes(site.protocol)||site.username||site.password)throw new Error('PI_CONTROL_SITE_URL must be a public HTTP(S) URL');
 site.search='';site.hash='';if(!site.pathname.endsWith('/'))site.pathname+='/';
 const htmlAttribute=(value:string)=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
 const socialMeta=demo?`
<link rel="canonical" href="${htmlAttribute(site.href)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Pi Control">
<meta property="og:title" content="Pi Control · 你的树莓派，尽在掌握">
<meta property="og:description" content="灯光、风扇与 OLED 的可视化控制中心。无需硬件，即可体验三维模型与交互演示。">
<meta property="og:url" content="${htmlAttribute(site.href)}">
<meta property="og:image" content="${htmlAttribute(new URL('media/pi-control-og.png',site).href)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="640">
<meta property="og:image:alt" content="Pi Control：蓝色标题与 CUBE Pi 三维机箱，展示风扇、OLED 和接口细节。">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Pi Control · 你的树莓派，尽在掌握">
<meta name="twitter:description" content="灯光、风扇与 OLED，一个控制中心。在线体验，无需硬件。">
<meta name="twitter:image" content="${htmlAttribute(new URL('media/pi-control-og.png',site).href)}">
<meta name="twitter:image:alt" content="Pi Control 与 CUBE Pi 三维机箱">
`:'';
 return {base:demo?'./':'/',define:{'import.meta.env.VITE_DEMO':JSON.stringify(demo?'1':'0')},
  build:{outDir:demo?'dist-demo':'dist'},
  plugins:[tailwindcss(),{name:'local-assets',transformIndexHtml(html){return html.replace('</head>',socialMeta+'</head>')},generateBundle(){
   for(const file of ['swagger-ui-bundle.js','swagger-ui.css','LICENSE','NOTICE','swagger-ui-bundle.js.LICENSE.txt'])this.emitFile({type:'asset',fileName:'assets/api-docs/'+file,source:readFileSync(new URL('./node_modules/swagger-ui-dist/'+file,import.meta.url))});
   this.emitFile({type:'asset',fileName:'assets/favicon.svg',source:readFileSync(new URL('./public/favicon.svg',import.meta.url))});
   for(const file of ['DejaVuSansMono.ttf','NotoSansCJKsc-Regular.otf','DejaVu-LICENSE.txt','Noto-OFL.txt'])this.emitFile({type:'asset',fileName:'assets/fonts/'+file,source:readFileSync(new URL('../assets/'+file,import.meta.url))});
   if(demo){
    this.emitFile({type:'asset',fileName:'openapi.json',source:readFileSync(new URL('./public/openapi.json',import.meta.url))});
    for(const file of ['pi-control-og.png','pi-control-demo.mp4','pi-control-demo-poster.jpg'])this.emitFile({type:'asset',fileName:'media/'+file,source:readFileSync(new URL('../docs/media/'+file,import.meta.url))});
    this.emitFile({type:'asset',fileName:'demo.html',source:readFileSync(new URL('./promo/demo.html',import.meta.url))});
   }
  },writeBundle(options){if(!demo)return;
   const policy="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";
   const privacyMeta=`<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">`;
   const dir=resolve(options.dir!);let html=readFileSync(resolve(dir,'api-docs.html'),'utf8');
   html=html.replaceAll('"/assets/','"./assets/').replaceAll('href="/"','href="./"').replaceAll('href="/api/v1/openapi.json"','href="./openapi.json"');
   html=html.replace('<h1>让你的应用连接设备。</h1>','<h1>API 参考 · 演示版</h1><p>这是静态文档。部署 Docker 完整服务后可使用在线调试与真实认证。</p>');
   writeFileSync(resolve(dir,'api-docs.html'),html.replace('<head>','<head>'+privacyMeta));
   const index=resolve(dir,'index.html');
   writeFileSync(index,readFileSync(index,'utf8').replace('<head>','<head>'+privacyMeta));
   const videoPage=resolve(dir,'demo.html');
   writeFileSync(videoPage,readFileSync(videoPage,'utf8').replace('<head>','<head>'+privacyMeta));
   writeFileSync(resolve(dir,'_headers'),`/*\n  Cache-Control: public, max-age=0, must-revalidate, no-transform\n  Content-Security-Policy: ${policy}; frame-ancestors 'none'\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=(), usb=(), serial=(), bluetooth=()\n`);
   writeFileSync(resolve(dir,'assets/api-docs/docs.js'),`document.getElementById('api-base').textContent='部署后的服务地址 + /api/v1';\ndocument.getElementById('ws-base').textContent='部署后的服务地址 + /api/v1/live';\ndocument.querySelectorAll('[data-origin]').forEach(e=>e.textContent=e.textContent.replaceAll('__ORIGIN__','http://localhost:8080'));\nwindow.ui=SwaggerUIBundle({url:new URL('openapi.json',location.href).href,dom_id:'#swagger-ui',deepLinking:true,docExpansion:'list',filter:true,defaultModelsExpandDepth:-1,supportedSubmitMethods:[],validatorUrl:null,persistAuthorization:false});\n`);
   writeFileSync(resolve(dir,'.nojekyll'),'');
  }}],
  server:demo?{}:{proxy:{'/api':{target:'http://127.0.0.1:18080',ws:true},'/healthz':'http://127.0.0.1:18080'}}};
});
