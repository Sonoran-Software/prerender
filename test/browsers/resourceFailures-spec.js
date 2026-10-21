const assert = require('assert');
const chrome = require('../../lib/browsers/chrome');
describe('bounded resource failure diagnostics', function () {
  it('captures failure layer evidence without URLs, cookies or credentials', function () {
    const tab={prerender:{pageLoadInfo:{entries:{a:{requestParams:{type:'XHR',request:{url:'https://u:secret@example.com/private?token=secret'}}}}}}};
    const result=chrome.resourceFailureDiagnostic(tab,{requestId:'a',type:'XHR',response:{url:'https://u:secret@example.com/private?token=secret',status:429,headers:{'Retry-After':'10','Set-Cookie':'secret'}}});
    assert.deepStrictEqual(result,{type:'XHR',origin:'https://example.com',status:429,error:undefined,headers:{'Retry-After':'10'}});
    assert(!JSON.stringify(result).includes('secret'));
    assert.equal(chrome.resourceFailureDiagnostic(tab,{requestId:'a',errorText:'net::ERR_CONNECTION_RESET'},true).error,'net::ERR_CONNECTION_RESET');
  });
  it('ignores normal/media/cancelled requests and caps failures at eight per render', function () {
    const tab={prerender:{pageLoadInfo:{entries:{}}}};
    assert.equal(chrome.resourceFailureDiagnostic(tab,{type:'Script',response:{status:200}}),undefined);
    assert.equal(chrome.resourceFailureDiagnostic(tab,{type:'Image',response:{status:503}}),undefined);
    assert.equal(chrome.resourceFailureDiagnostic(tab,{type:'Script',canceled:true},true),undefined);
    for(let i=0;i<8;i++) assert(chrome.resourceFailureDiagnostic(tab,{type:'Stylesheet',response:{status:503,url:'https://example.com/a.css'}}));
    assert.equal(chrome.resourceFailureDiagnostic(tab,{type:'Script',response:{status:429}}),undefined);
  });
});
