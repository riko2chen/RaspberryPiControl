document.getElementById('api-base').textContent=location.origin+'/api/v1';
document.getElementById('ws-base').textContent=location.origin.replace(/^http/,'ws')+'/api/v1/live';
document.querySelectorAll('[data-origin]').forEach(code=>{code.textContent=code.textContent.replaceAll('__ORIGIN__',location.origin)});
window.ui=SwaggerUIBundle({
 url:'/api/v1/openapi.json',dom_id:'#swagger-ui',deepLinking:true,
 docExpansion:'list',filter:true,defaultModelsExpandDepth:-1,
 displayRequestDuration:true,showCommonExtensions:true,
 persistAuthorization:false,validatorUrl:null,withCredentials:true,
 requestInterceptor:request=>{
  // Same-origin cookie requests need the service's CSRF verification header.
  request.headers['X-Pi-Control']='1';
  return request;
 },
});
