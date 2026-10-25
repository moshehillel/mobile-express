'use strict';
/**
 * Builds a fully-static ivr-diagram.html from twilio.json — no fetch, no client JS.
 * The org-chart boxes are baked straight into the markup so the page can never
 * render blank. Re-run after changing the flow:  node scripts/build-diagram.js
 */
const fs = require('fs');
const path = require('path');
const FLOW = path.join(__dirname, '..', 'twilio.json');
const OUT  = path.join(__dirname, '..', 'ivr-diagram.html');

const flow = JSON.parse(fs.readFileSync(FLOW, 'utf8'));

const STOP = new Set(['calculate']); // converge point — don't expand past it
const TYPE = {
  'trigger':{t:'Start',c:'trigger'},'gather-input-on-call':{t:'Menu',c:'gather'},
  'say-play':{t:'Message',c:'say'},'split-based-on':{t:'Router',c:'split'},
  'run-function':{t:'Function',c:'func'},'make-http-request':{t:'Web request',c:'func'},
  'set-variables':{t:'Save value',c:'set'},'record-voicemail':{t:'Record',c:'record'},
  'capture-payments':{t:'Payment',c:'pay'},'connect-call-to':{t:'Connect',c:'connect'},
};
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function keyLabel(v){
  if(v==='*')return 'Press ✱ (star)';
  if(v==='#')return 'Press #';
  if(/^\d+$/.test(v))return 'Press '+v;
  if(v==='true')return 'If yes';
  if(v==='false')return 'If no';
  return 'If '+v;
}
const cls = s => (TYPE[s.type]||{c:'split'}).c;
function snippet(s){
  const p=s.properties||{};
  if(typeof p.play==='string'&&p.play.trim())return {c:'audio',h:'🔊 audio'};
  if(typeof p.say==='string'&&p.say.trim()){let t=p.say.replace(/\s+/g,' ').trim();if(t.length>72)t=t.slice(0,71)+'…';return {c:'',h:'“'+esc(t)+'”'};}
  if('say'in p||'play'in p)return {c:'empty',h:'(no message)'};
  return null;
}
function boxInner(s,mini){
  const ti=TYPE[s.type]||{t:s.type};
  let extra='';
  if(!mini){
    const sn=snippet(s);
    if(sn)extra='<div class="says '+sn.c+'">'+sn.h+'</div>';
    else if(s.type==='run-function'||s.type==='make-http-request'){const u=s.properties&&s.properties.url;if(u)extra='<div class="rnote">'+esc(u.replace(/^https?:\/\/[^/]+\//,''))+'</div>';}
    else if(s.type==='set-variables'){const v=(s.properties&&s.properties.variables)||[];extra='<div class="rnote">sets '+esc(v.map(x=>x.key).join(', '))+'</div>';}
    else if(s.type==='connect-call-to')extra='<div class="rnote">→ '+esc((s.properties&&s.properties.to)||'')+'</div>';
    else if(s.type==='capture-payments')extra='<div class="rnote">charge card</div>';
    else if(s.type==='record-voicemail')extra='<div class="rnote">records caller</div>';
  }
  return '<span class="tag">'+esc(ti.t)+'</span><b>'+esc(s.name)+'</b>'+extra;
}

const byName = {}; flow.states.forEach(s => byName[s.name] = s);
const gatherSplit = {};
flow.states.forEach(s=>{
  if(s.type!=='gather-input-on-call')return;
  const kp=(s.transitions||[]).find(t=>t.event==='keypress');
  if(kp&&byName[kp.next]&&byName[kp.next].type==='split-based-on'){
    const sp=byName[kp.next],inp=(sp.properties&&sp.properties.input)||'';
    if(inp.indexOf('widgets.'+s.name+'.')>=0)gatherSplit[s.name]=sp;
  }
});
function outEdges(s){
  const out=[];
  if(s.type==='gather-input-on-call' && gatherSplit[s.name]){
    (gatherSplit[s.name].transitions||[]).forEach(t=>{
      if(!t.next)return;
      if(t.event==='noMatch')out.push({label:'Enter a number',to:t.next});
      else if(t.conditions&&t.conditions[0])out.push({label:keyLabel(t.conditions[0].value),to:t.next});
    });
    return out;
  }
  if(s.type==='split-based-on'){
    (s.transitions||[]).forEach(t=>{if(!t.next)return;
      if(t.event==='noMatch')out.push({label:'Anything else',to:t.next});
      else if(t.conditions&&t.conditions[0])out.push({label:keyLabel(t.conditions[0].value),to:t.next});
      else out.push({label:t.event,to:t.next});});
    return out;
  }
  (s.transitions||[]).forEach(t=>{if(!t.next)return;
    let lab=t.event;
    if(t.event==='incomingCall')lab='Incoming call';
    else if(t.event==='next')lab='Then';
    else if(t.event==='audioComplete')lab='After message';
    out.push({label:lab,to:t.next});});
  return out;
}

const expanded = new Set();
function li(name,label){
  const s=byName[name];
  const back = label && (name==='gather_walcome' || /star/i.test(label));
  const lab = label ? '<div class="lab'+(back?' back':'')+'">'+esc(label)+'</div>' : '';
  if(!s) return '<li>'+lab+'<div class="box t-split">'+esc(name)+' (missing)</div></li>';
  if(expanded.has(name)){
    const note = name==='gather_walcome' ? '↩ back to main menu' : '↩ shown elsewhere';
    return '<li>'+lab+'<div class="box ref t-'+cls(s)+'"><a href="#n-'+esc(name)+'">'+boxInner(s,true)+'</a><div class="rnote">'+note+'</div></div></li>';
  }
  expanded.add(name);
  let stopNote='', childrenHtml='';
  if(STOP.has(name)){
    stopNote='<div class="rnote">⏹ all orders continue here → checkout, address &amp; payment</div>';
  }else{
    const kids=outEdges(s).filter(e=>e.to!==name);
    if(kids.length) childrenHtml='<ul>'+kids.map(e=>li(e.to,e.label)).join('')+'</ul>';
  }
  return '<li>'+lab+'<div class="box t-'+cls(s)+(STOP.has(name)?' stop':'')+'" id="n-'+esc(name)+'">'+boxInner(s)+stopNote+'</div>'+childrenHtml+'</li>';
}

const treeHtml = '<div class="tree"><ul>'+li(flow.initial_state,'')+'</ul></div>';

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IVR Flow — Mobile Express NY</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff;margin:0;padding:16px;line-height:1.4}
  h1{font-size:21px;margin:0 0 4px}
  .note{color:#555;font-size:14px;margin:0 0 6px;max-width:1000px}
  .links a{margin-right:14px;font-size:14px}
  .chartwrap{overflow:auto;border:1px solid #e3e8ea;border-radius:8px;background:#fafcfc;margin-top:12px}
  .tree{display:inline-block;padding:6px 12px 14px}
  .tree ul{position:relative;padding-top:12px;display:flex;justify-content:flex-start;margin:0}
  .tree li{list-style:none;position:relative;padding:12px 2px 0 2px;display:flex;flex-direction:column;align-items:center}
  .tree li::before,.tree li::after{content:'';position:absolute;top:0;right:50%;border-top:2px solid #c4ccd4;width:50%;height:12px}
  .tree li::after{right:auto;left:50%;border-left:2px solid #c4ccd4}
  .tree li:only-child::before,.tree li:only-child::after{display:none}
  .tree li:only-child{padding-top:0}
  .tree li:first-child::before,.tree li:last-child::after{border:0 none}
  .tree li:last-child::before{border-right:2px solid #c4ccd4;border-radius:0 6px 0 0}
  .tree li:first-child::after{border-radius:6px 0 0 0}
  .tree ul ul::before{content:'';position:absolute;top:0;left:50%;border-left:2px solid #c4ccd4;height:12px}
  .lab{font-size:11px;font-weight:bold;color:#2b3a42;background:#eef2f4;border:1px solid #cfd8dd;border-radius:10px;padding:0 8px;margin-bottom:4px;white-space:nowrap}
  .lab.back{background:#fbeaea;border-color:#e8c3c3;color:#9b3030;font-weight:normal}
  .box{display:inline-block;border:1px solid #b9c2c8;border-top-width:4px;border-radius:6px;padding:6px 9px;background:#fff;text-align:left;min-width:150px;max-width:240px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
  .box .tag{font-size:9px;font-weight:bold;text-transform:uppercase;color:#fff;background:#666;padding:1px 5px;border-radius:3px;margin-right:5px;vertical-align:middle}
  .box b{font-size:13px;word-break:break-word}
  .says{margin-top:4px;font-size:12px;color:#333;background:#f1f5f9;border-left:3px solid #99a;padding:3px 6px;border-radius:0 4px 4px 0}
  .says.audio{background:#fff7ed;border-color:#d97706}
  .says.empty{background:#fef2f2;border-color:#dc2626;color:#b91c1c;font-style:italic}
  .rnote{margin-top:4px;font-size:11px;color:#666;font-style:italic}
  .box.ref{border-style:dashed;background:#f7fafc}
  .box.ref a{color:#1155cc;text-decoration:none}
  .box.stop{border-top-color:#0d5c4b;background:#eefaf5}
  .t-trigger{border-top-color:#16a34a}.t-trigger .tag{background:#16a34a}
  .t-gather{border-top-color:#2563eb}.t-gather .tag{background:#2563eb}
  .t-say{border-top-color:#d97706}.t-say .tag{background:#d97706}
  .t-split{border-top-color:#6b7280}.t-split .tag{background:#6b7280}
  .t-func{border-top-color:#7c3aed}.t-func .tag{background:#7c3aed}
  .t-set{border-top-color:#0891b2}.t-set .tag{background:#0891b2}
  .t-record{border-top-color:#db2777}.t-record .tag{background:#db2777}
  .t-pay{border-top-color:#0d5c4b}.t-pay .tag{background:#0d5c4b}
  .t-connect{border-top-color:#ea580c}.t-connect .tag{background:#ea580c}
  .box:target{outline:3px solid #f15e2c;outline-offset:2px}
</style>
</head>
<body>
  <h1>IVR Flow Diagram</h1>
  <div class="note">Top-down map of the phone flow. The call starts at the top; under each step its options branch left-to-right. The tree <b>stops at &ldquo;calculate&rdquo;</b> &mdash; every order path joins there and continues the same way (checkout &rarr; address &rarr; payment). Loops back show as dashed links. Read-only; edit messages in <b>Edit IVR</b>. <i>(Static snapshot &mdash; regenerate with: node scripts/build-diagram.js)</i></div>
  <div class="links"><a href="admin-home.html">&larr; Admin Home</a><a href="admin-ivr.html">Edit IVR</a></div>
  <div class="chartwrap">${treeHtml}</div>
</body>
</html>
`;

fs.writeFileSync(OUT, page, 'utf8');
const boxes = (page.match(/class="box/g)||[]).length;
console.log(`✓ Wrote ivr-diagram.html — ${boxes} boxes, ${expanded.size} steps expanded.`);
