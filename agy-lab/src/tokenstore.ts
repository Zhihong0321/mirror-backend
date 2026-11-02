// One place where the browser keeps the workspace access key.
//
// It used to live in sessionStorage, which is per-tab and dies with the tab. Every
// report link opened in a new tab was therefore a fresh, empty store, and the page
// prompted for the key again -- the key was never "wrong", it was simply never
// carried across. The rule is: typed once, never asked again.
//
// The durable copy is a first-party cookie, mirrored into localStorage because
// Safari caps script-written cookies at seven days. Reads try cookie, then
// localStorage, then the old sessionStorage copy, which is migrated on first read
// so nobody has to re-type after this deploy.
//
// The server never reads the cookie: /api/* is guarded by the Authorization header
// alone (see authorized() in server.ts), so this is client-side storage only and
// carries no CSRF surface. The key is still sent as a bearer header, never in a URL.
export const TOKEN_STORE_JS = String.raw`var eeKey=(function(){
var NAME='ee_portal_token';
var YEAR=31536000;
function save(value){
  if(!value)return value;
  try{document.cookie=NAME+'='+encodeURIComponent(value)+';Path=/;Max-Age='+YEAR+';SameSite=Lax'+(location.protocol==='https:'?';Secure':'')}catch(err){}
  try{localStorage.setItem(NAME,value)}catch(err){}
  return value;
}
function read(){
  var hit=null;
  try{hit=document.cookie.match(new RegExp('(?:^|; *)'+NAME+'=([^;]*)'))}catch(err){hit=null}
  if(hit){try{return decodeURIComponent(hit[1])}catch(err){return hit[1]}}
  var stored='';
  try{stored=localStorage.getItem(NAME)||''}catch(err){stored=''}
  if(stored)return save(stored);
  try{stored=sessionStorage.getItem(NAME)||''}catch(err){stored=''}
  return stored?save(stored):'';
}
function clear(){
  try{document.cookie=NAME+'=;Path=/;Max-Age=0;SameSite=Lax'+(location.protocol==='https:'?';Secure':'')}catch(err){}
  try{localStorage.removeItem(NAME)}catch(err){}
  try{sessionStorage.removeItem(NAME)}catch(err){}
}
return {read:read,save:save,clear:clear};
}());`;
