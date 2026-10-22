const SANS="-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Helvetica Neue', system-ui, sans-serif";
const MONO="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";
const ANN='#d4380d';
const T={
 L:{n:'浅色',s0:'#ffffff',s1:'#f6f6f7',s2:'#ededef',bd:'#e2e2e6',fg:'#18181b',mu:'#62626b',ac:'#2563eb',ok:'#1f8a5b',wa:'#a36a00',er:'#d92d20',acS:'#e9effd',add:'#e0efe8',del:'#fae6e4',scrim:'rgba(0,0,0,0.20)',grab:'rgba(98,98,107,0.35)',sh:'0 8px 32px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06)',shL:'-8px 0 32px rgba(0,0,0,0.10)'},
 D:{n:'深色',s0:'#0f0f11',s1:'#17171a',s2:'#1f1f23',bd:'#2a2a30',fg:'#f2f3f5',mu:'#a3a6ad',ac:'#7aa2f7',ok:'#4cb782',wa:'#e0a84a',er:'#f2555a',acS:'#1a1e28',add:'#182721',del:'#2a171a',scrim:'rgba(0,0,0,0.50)',grab:'rgba(163,166,173,0.35)',sh:'0 8px 32px rgba(0,0,0,0.50)',shL:'-8px 0 32px rgba(0,0,0,0.45)'}
};
const P={
 chevR:'<path d="m9 18 6-6-6-6"></path>',chevL:'<path d="m15 18-6-6 6-6"></path>',chevD:'<path d="m6 9 6 6 6-6"></path>',chevU:'<path d="m18 15-6-6-6 6"></path>',
 x:'<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
 copy:'<rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>',
 term:'<polyline points="4 17 10 11 4 5"></polyline><line x1="12" x2="20" y1="19" y2="19"></line>',
 file:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path>',
 pencil:'<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"></path><path d="m15 5 4 4"></path>',
 search:'<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>',
 globe:'<circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path>',
 bot:'<path d="M12 8V4H8"></path><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M2 14h2"></path><path d="M20 14h2"></path><path d="M15 13v2"></path><path d="M9 13v2"></path>',
 bulb:'<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path>',
 todo:'<path d="m3 17 2 2 4-4"></path><path d="m3 7 2 2 4-4"></path><path d="M13 6h8"></path><path d="M13 12h8"></path><path d="M13 18h8"></path>',
 help:'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><path d="M12 17h.01"></path>',
 wrap:'<line x1="3" x2="21" y1="6" y2="6"></line><path d="M3 12h15a3 3 0 1 1 0 6h-4"></path><polyline points="16 16 14 18 16 20"></polyline><line x1="3" x2="10" y1="18" y2="18"></line>',
 max:'<polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" x2="14" y1="3" y2="10"></line><line x1="3" x2="10" y1="21" y2="14"></line>',
 min:'<polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" x2="21" y1="10" y2="3"></line><line x1="3" x2="10" y1="21" y2="14"></line>',
 down:'<path d="M12 5v14"></path><path d="m19 12-7 7-7-7"></path>',
 up:'<path d="m5 12 7-7 7 7"></path><path d="M12 19V5"></path>',
 check:'<path d="M20 6 9 17l-5-5"></path>',
 alert:'<circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line><line x1="12" x2="12.01" y1="16" y2="16"></line>',
 folder:'<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path>',
 panelR:'<rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M15 3v18"></path>',
 panelL:'<rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M9 3v18"></path>',
 panelB:'<rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M3 15h18"></path>',
 updown:'<path d="m7 15 5 5 5-5"></path><path d="m7 9 5-5 5 5"></path>',
 more:'<circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle>',
 image:'<rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path>',
 lr:'<path d="m18 8 4 4-4 4"></path><path d="M2 12h20"></path><path d="m6 8-4 4 4 4"></path>',
 ud:'<path d="M12 2v20"></path><path d="m8 18 4 4 4-4"></path><path d="m8 6 4-4 4 4"></path>',
 back:'<path d="M9 14 4 9l5-5"></path><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"></path>',
 kbd:'<path d="M10 8h.01"></path><path d="M12 12h.01"></path><path d="M14 8h.01"></path><path d="M16 12h.01"></path><path d="M18 8h.01"></path><path d="M6 8h.01"></path><path d="M7 16h10"></path><path d="M8 12h.01"></path><rect width="20" height="16" x="2" y="4" rx="2"></rect>',
 code:'<path d="m16 18 6-6-6-6"></path><path d="m8 6-6 6 6 6"></path>',
 eye:'<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path><circle cx="12" cy="12" r="3"></circle>'
};
function ic(n,s,c,sw){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="${sw||1.5}" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;display:block">${P[n]}</svg>`;}
function cursor(){return `<svg width="18" height="18" viewBox="0 0 24 24" style="display:block"><path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" fill="#18181b" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"></path></svg>`;}
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/=/g,'\u2060=');
const deq=s=>s.replace(/=/g,'&#61;');
const deq0=s=>s.replace(/=/g,'\u2060=\u2060');
const KW=/("[^"]*"|'[^']*'|\/\/.*$|\b(?:const|let|return|import|from|export|function|if|else|await|async|type|interface|null|true|false|new|void)\b|\b\d+(?:\.\d+)?\b)/g;
function hl(t,s){return esc(s).replace(KW,m=>{let c=t.ac;if(m[0]=='"'||m[0]=="'")c=t.ok;else if(m.startsWith('//'))c=t.mu;else if(/^\d/.test(m))c=t.wa;return `<span style="color:${c}">${m}</span>`;});}
const TS={t:1,b:36,hh:52,th:44,i:18};
const DS={t:0,b:28,hh:44,th:36,i:16};
function tag(s,o){o=o||{};return `<span style="display:inline-flex;align-items:center;gap:4px;background:${o.bg||ANN};color:#ffffff;font-family:${SANS};font-size:11px;font-weight:600;line-height:16px;padding:2px 6px;border-radius:4px;white-space:nowrap">${s}</span>`;}
function dots(t){return `<span style="display:inline-flex;gap:3px;align-items:center">${[1,.55,.25].map(o=>`<span style="width:4px;height:4px;border-radius:2px;background:${t.ac};opacity:${o}"></span>`).join('')}</span>`;}

// ---------- timeline ----------
const R1=[
 {type:'user',text:'先读一下时间线的行组件，列出 Block 的工具类型，再查一下 RN Modal 的手势限制。'},
 {type:'text',text:'行组件按 kind 分发到 9 类正文渲染器。下面是读取和查找的过程。'},
 {k:'r0',icon:'file',title:'Read src/timeline/tool-row.tsx',st:'ok',dur:'96ms'},
 {k:'s0',icon:'search',title:'Search "kind ===" in src/timeline',st:'ok',dur:'64ms'},
 {k:'f0',icon:'globe',title:'Fetch reactnative.dev/docs/modal',st:'ok',dur:'1.2s'},
 {k:'a0',icon:'bot',title:'Agent · 梳理手势冲突',st:'ok',dur:'48s'},
 {k:'q0',icon:'help',title:'提问 · 抽屉档位',st:'none',dur:'已回答'},
 {type:'text',text:'透明 Modal 设 pointerEvents="box-none" 时，背后的列表仍能接收触摸。'}
];
const R2=[
 {type:'user',text:'把手机上长按弹出的预览改成单击打开底部抽屉，桌面的悬停预览先保留。'},
 {type:'text',text:'先跑一次构建看看当前状态，再读预览浮层的实现。'},
 {k:'build',icon:'term',title:'npm run build',st:'err',dur:'2.1s'},
 {k:'read1',icon:'file',title:'Read src/preview/hover-preview.tsx',st:'ok',dur:'120ms'},
 {k:'read6',icon:'file',title:'Read 6 files',st:'ok',dur:'340ms'},
 {k:'grep',icon:'search',title:'Search "usePreviewAnchor"',st:'ok',dur:'88ms'},
 {k:'think',icon:'bulb',title:'思考',st:'none',dur:'6.2s'},
 {k:'edit',icon:'pencil',title:'Edit hover-preview.tsx',add:12,del:3,st:'none'},
 {k:'tc',icon:'term',title:'npm run typecheck',st:'ok',dur:'4.3s'},
 {k:'kill',icon:'term',title:'kill 48211',st:'ok',dur:'9ms',nobody:true},
 {k:'commit',icon:'term',title:'commit · feat: block drawer',st:'ok',dur:'812ms'},
 {type:'text',text:'类型检查通过，已提交。接着跑一遍单测。'},
 {k:'todo',icon:'todo',title:'Todo · 3 / 5 完成',st:'none',dur:''},
 {k:'test',icon:'term',title:'npm test -- --watch=false',st:'run',dur:''}
];
function statusHtml(t,r){
 if(r.st==='ok')return `${ic('check',12,t.mu)}<span>${r.dur}</span>`;
 if(r.st==='run')return dots(t);
 if(r.st==='err')return `${ic('x',12,t.er)}<span style="color:${t.er}">${r.dur}</span>`;
 if(r.add!=null)return `<span style="color:${t.ok}">+${r.add}</span><span style="color:${t.er}">−${r.del}</span>`;
 return `<span>${r.dur}</span>`;
}
function row(t,r,o){
 const h=o.compact?26:28,cur=o.cur===r.k,gh=o.ghost===r.k,pr=o.press===r.k,hv=o.hover===r.k;
 const bg=cur?t.acS:pr?t.s2:hv?t.s1:'transparent';
 let extra='';
 if(o.annot&&o.annot[r.k]){
  const a=o.annot[r.k];
  extra+=`<div style="position:absolute;left:2px;top:0;width:42px;height:${h}px;border:1.5px dashed ${a==='nobody'?t.mu:ANN};border-radius:4px;box-sizing:border-box;pointer-events:none"></div>`;
  if(a!=='nobody')extra+=`<div style="position:absolute;left:46px;right:2px;top:0;height:${h}px;border:1.5px dashed ${t.ac};border-radius:4px;box-sizing:border-box;pointer-events:none"></div>`;
 }
 if(o.extra&&o.extra[r.k])extra+=o.extra[r.k];
 return `<div style="padding:0 8px;position:relative;z-index:${o.extra&&o.extra[r.k]?30:1}"><div style="height:${h}px;display:flex;align-items:center;gap:8px;padding:0 8px;border-radius:6px;background:${gh?t.acS:bg};opacity:1;position:relative">
${cur?`<div style="position:absolute;left:0;top:5px;bottom:5px;width:2px;border-radius:1px;background:${t.ac}"></div>`:''}${gh?`<div style="position:absolute;left:0;top:5px;bottom:5px;width:2px;border-radius:1px;background:${t.ac};opacity:.35"></div>`:''}
${r.nobody?'<div style="width:16px;flex-shrink:0"></div>':ic(o.exp===r.k?'chevD':'chevR',16,t.mu)}${ic(r.icon,14,r.tone?t[r.tone]:t.mu)}
<div style="flex:1;min-width:0;font-family:${MONO};font-size:12.5px;color:${t.fg};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.title)}</div>
<div style="display:flex;align-items:center;gap:4px;font-family:${MONO};font-size:12px;color:${t.mu};flex-shrink:0">${statusHtml(t,r)}</div>
</div>${extra}</div>`;
}
function inlineTc(t){
 return `<div style="margin:2px 16px 8px 16px;background:${t.s1};border-radius:8px;padding:8px 0 10px">${cmdStrip(t,'npm run typecheck',{m:'0 8px 8px'})}${outLines(t,['> better-paseo@0.1.0 typecheck','> tsc --noEmit','','Checked 34 files in 4.2s'],{px:12})}</div>`;
}
function timeline(t,rows,o){
 return rows.map(r=>{
  if(r.type==='user')return `<div style="display:flex;justify-content:flex-end;padding:10px 16px 6px"><div style="max-width:78%;background:${t.s1};border:1px solid ${t.bd};border-radius:14px;padding:8px 12px;font-size:14px;line-height:21px;color:${t.fg};text-wrap:pretty">${esc(r.text)}</div></div>`;
  if(r.type==='text')return `<div style="padding:6px 16px 8px;font-size:14px;line-height:21px;color:${t.fg};text-wrap:pretty">${esc(r.text)}</div>`;
  return row(t,r,o)+(o.exp===r.k?inlineTc(t):'');
 }).join('');
}

// ---------- body primitives ----------
function cmdStrip(t,cmd,o){o=o||{};return `<div style="margin:${o.m||'12px 16px 8px'};background:${t.s2};border-left:2px solid ${t.mu};border-radius:4px;padding:5px 10px;font-family:${MONO};font-size:12px;line-height:18px;color:${t.fg};white-space:pre-wrap;word-break:break-all"><span style="color:${t.mu}">$ </span>${esc(cmd)}</div>`;}
function outLines(t,lines,o){o=o||{};return `<div style="padding:0 ${o.px||16}px;font-family:${MONO};font-size:12px;line-height:18px;color:${t.fg}">${lines.map(l=>{
 let c=t.fg;if(l.startsWith('>'))c=t.mu;let s=esc(l);
 if(l.startsWith(' ✓')||l.startsWith('✓'))s=s.replace('✓',`<span style="color:${t.ok}">✓</span>`);
 if(l.startsWith(' ×')||l.startsWith('×'))s=s.replace('×',`<span style="color:${t.er}">×</span>`);
 s=s.replace(/\b(\d+(?:\.\d+)?)(ms|s|kB)?\b/g,`<span style="color:${t.ac}">$1$2</span>`);
 return `<div style="min-height:18px;white-space:pre-wrap;word-break:break-all;color:${c}">${s||'&nbsp;'}</div>`;}).join('')}</div>`;}
function errBox(t,title,lines){return `<div style="margin:12px 0 0;border-top:1px solid ${t.bd};padding:10px 16px 12px"><div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:${t.er};margin-bottom:6px">${ic('alert',14,t.er)}${title}</div><div style="font-family:${MONO};font-size:12px;line-height:18px;color:${t.fg}">${lines.map(l=>`<div style="white-space:pre-wrap;word-break:break-all">${esc(l)||'&nbsp;'}</div>`).join('')}</div></div>`;}
function pathLine(t,path,right,icn){return `<div style="display:flex;align-items:center;gap:6px;padding:10px 16px 8px;min-width:0">${ic(icn||'folder',13,t.mu)}<div style="flex:1;min-width:0;font-family:${MONO};font-size:12px;color:${t.mu};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:ltr">${esc(path)}</div>${right?`<span style="font-family:${MONO};font-size:11px;color:${t.mu};flex-shrink:0">${right}</span>`:''}</div>`;}
function code(t,lines,o){o=o||{};const st=o.start||1,gw=o.gw||40,wrap=o.wrap!==false,sh=o.shift||0;
 return `<div>${lines.map((l,i)=>{const z=i%2===1;const bg=z?t.s1:t.s0;return `<div style="display:flex;background:${bg};min-height:18px"><div style="width:${gw}px;flex-shrink:0;text-align:right;padding-right:10px;box-sizing:border-box;font-family:${MONO};font-size:11px;line-height:18px;color:${t.mu};background:${bg};position:relative;z-index:1">${st+i}</div><div style="flex:1;min-width:0;overflow:hidden;padding-right:12px"><div style="font-family:${MONO};font-size:12px;line-height:18px;color:${t.fg};white-space:${wrap?'pre-wrap':'pre'};word-break:${wrap?'break-all':'normal'};transform:translateX(-${sh}px)">${hl(t,l)||'&nbsp;'}</div></div></div>`;}).join('')}</div>`;}
function diff(t,rows,o){o=o||{};const two=o.two;
 return `<div>${rows.map(r=>{
  if(r[0]==='@')return `<div style="display:flex;background:${t.s1};font-family:${MONO};font-size:11px;line-height:22px;color:${t.mu};padding-left:${two?84:52}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r[1])}</div>`;
  const k=r[0],bg=k==='+'?t.add:k==='-'?t.del:'transparent',sc=k==='+'?t.ok:k==='-'?t.er:t.mu;
  const g=n=>`<div style="width:36px;flex-shrink:0;text-align:right;padding-right:8px;box-sizing:border-box;font-family:${MONO};font-size:11px;line-height:18px;color:${t.mu}">${n||''}</div>`;
  return `<div style="display:flex;background:${bg};min-height:18px">${two?g(r[1])+g(r[2]):g(k==='-'?r[1]:r[2])}<div style="width:16px;flex-shrink:0;font-family:${MONO};font-size:12px;line-height:18px;color:${sc}">${k===' '?'':k==='-'?'−':'+'}</div><div style="flex:1;min-width:0;font-family:${MONO};font-size:12px;line-height:18px;color:${t.fg};white-space:pre-wrap;word-break:break-all;padding-right:12px">${hl(t,r[3])||'&nbsp;'}</div></div>`;}).join('')}</div>`;}
function md(t,blocks){return `<div style="padding:4px 16px 16px;display:flex;flex-direction:column;gap:8px">${blocks.map(b=>{
 const inl=s=>esc(s).replace(/`([^`]+)`/g,`<span style="font-family:${MONO};font-size:12.5px;background:${t.s1};border:1px solid ${t.bd};border-radius:4px;padding:0 4px">$1</span>`);
 if(b[0]==='h')return `<div style="font-size:16px;font-weight:600;color:${t.fg};margin-top:6px">${inl(b[1])}</div>`;
 if(b[0]==='p')return `<div style="font-size:14px;line-height:22px;color:${t.fg};text-wrap:pretty">${inl(b[1])}</div>`;
 if(b[0]==='li')return `<div style="display:flex;gap:8px;font-size:14px;line-height:22px;color:${t.fg}"><span style="color:${t.mu}">•</span><span style="flex:1;text-wrap:pretty">${inl(b[1])}</span></div>`;
 if(b[0]==='code')return `<div style="background:${t.s1};border-radius:6px;padding:8px 10px;font-family:${MONO};font-size:12px;line-height:18px;color:${t.fg};white-space:pre-wrap">${hl(t,b[1])}</div>`;
 if(b[0]==='q')return `<div style="border-left:2px solid ${t.bd};padding-left:10px;font-size:14px;line-height:22px;color:${t.mu}">${inl(b[1])}</div>`;
 return '';}).join('')}</div>`;}
function searchRes(t,groups,term){return `<div style="padding:4px 0 12px">${groups.map(g=>`<div style="padding:8px 16px 4px;display:flex;align-items:center;gap:6px">${ic('file',13,t.mu)}<span style="font-family:${MONO};font-size:12px;font-weight:600;color:${t.fg};flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g[0])}</span><span style="font-size:11px;color:${t.mu}">${g[1].length} 处</span></div>${g[1].map((l,i)=>`<div style="display:flex;background:${i%2?t.s1:t.s0}"><div style="width:52px;flex-shrink:0;text-align:right;padding-right:10px;box-sizing:border-box;font-family:${MONO};font-size:11px;line-height:20px;color:${t.mu}">${l[0]}</div><div style="flex:1;min-width:0;font-family:${MONO};font-size:12px;line-height:20px;color:${t.fg};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:12px">${esc(l[1]).split(term).join(`<span style="background:${t.acS};color:${t.ac};border-radius:3px">${term}</span>`)}</div></div>`).join('')}`).join('')}</div>`;}
function vbar(t,top,h){return `<div style="position:absolute;right:3px;top:${top}%;height:${h}%;width:3px;border-radius:2px;background:${t.grab}"></div>`;}

// ---------- controls ----------
function iconBtn(t,sz,n,act,o){o=o||{};const b=sz.b;return `<div style="width:${b}px;height:${b}px;border-radius:${b/2}px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:${act?t.s2:(o.fill?t.s1:'transparent')};opacity:${o.dis?0.35:1}">${ic(n,sz.i,act||o.fill?t.fg:t.mu)}</div>`;}
function seg(t,sz,opts,idx){const h=sz.t?32:24;return `<div style="height:${h}px;display:flex;align-items:center;flex-shrink:0;white-space:nowrap;padding:2px;box-sizing:border-box;border-radius:8px;background:${t.s1};border:1px solid ${t.bd}">${opts.map((x,i)=>`<div style="height:100%;padding:0 ${sz.t?12:8}px;display:flex;align-items:center;border-radius:6px;font-size:12px;color:${i===idx?t.fg:t.mu};font-weight:${i===idx?600:400};background:${i===idx?t.s0:'transparent'};box-shadow:${i===idx?'0 1px 2px rgba(0,0,0,0.08)':'none'}">${x}</div>`).join('')}</div>`;}
function pager(t,sz,txt){const b=sz.t?32:24;return `<div style="height:${b}px;display:flex;align-items:center;border:1px solid ${t.bd};border-radius:${b/2}px;flex-shrink:0">${`<div style="width:${b+4}px;height:${b}px;display:flex;align-items:center;justify-content:center">${ic('chevL',16,t.fg)}</div>`}<span style="font-family:${MONO};font-size:12px;color:${t.fg};min-width:36px;text-align:center">${txt}</span><div style="width:${b+4}px;height:${b}px;display:flex;align-items:center;justify-content:center">${ic('chevR',16,t.fg)}</div></div>`;}
function copyBtn(t,sz,label){const b=sz.t?32:24;return `<div style="height:${b}px;padding:0 ${sz.t?10:8}px;border-radius:${b/2}px;border:1px solid ${t.bd};display:flex;align-items:center;gap:6px;font-size:12px;color:${t.fg};flex-shrink:0;white-space:nowrap">${ic('copy',14,t.mu)}${label}${ic('chevD',12,t.mu)}</div>`;}
function tb(t,sz,L,R){return `<div style="height:${sz.th}px;display:flex;align-items:center;gap:6px;padding:0 ${sz.t?10:10}px;border-bottom:1px solid ${t.bd};flex-shrink:0"><div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0">${L.join('')}</div><div style="display:flex;align-items:center;gap:4px">${R.join('')}</div></div>`;}
function sub(t,items){return items.map((x,i)=>(i?`<span style="opacity:.6">·</span>`:'')+x).join('');}
function stOk(t,s){return `<span style="display:inline-flex;align-items:center;gap:3px">${ic('check',12,t.ok)}${s||'完成'}</span>`;}
function stErr(t,s){return `<span style="display:inline-flex;align-items:center;gap:3px;color:${t.er}">${ic('x',12,t.er)}${s}</span>`;}
function stRun(t,s){return `<span style="display:inline-flex;align-items:center;gap:6px;color:${t.ac}">${dots(t)}${s}</span>`;}

// ---------- shells ----------
function pane(t,sz,p,o){o=o||{};const b=sz.b;
 return `<div style="display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;position:relative">
<div style="height:${sz.hh}px;display:flex;align-items:center;gap:10px;padding:0 ${sz.t?8:10}px 0 16px;flex-shrink:0">
<div style="width:28px;height:28px;border-radius:7px;background:${t.s1};border:1px solid ${t.bd};box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex-shrink:0">${ic(p.icon,16,t.fg)}</div>
<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><div style="font-family:${p.mono?MONO:SANS};font-size:${p.mono?13:14}px;font-weight:600;color:${t.fg};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.title)}</div><div style="display:flex;align-items:center;gap:5px;font-size:12px;color:${t.mu};white-space:nowrap;overflow:hidden">${p.sub}</div></div>
<div style="display:flex;align-items:center;gap:${sz.t?0:2}px;flex-shrink:0">${iconBtn(t,sz,'chevL',false,{dis:p.first})}${iconBtn(t,sz,'chevR',false,{dis:p.last})}<div style="width:${sz.t?4:6}px"></div>${iconBtn(t,sz,'x',false,{fill:true})}</div>
</div>
${p.toolbar}
<div style="flex:1;min-height:0;position:relative;overflow:hidden">${p.body}${o.overlay||''}</div>
${o.footer||''}
</div>`;}
function handle(t){return `<div style="height:28px;display:flex;justify-content:center;padding-top:8px;box-sizing:border-box;flex-shrink:0"><div style="width:36px;height:5px;border-radius:3px;background:${t.grab}"></div></div>`;}
function drawer(t,p,h,o){o=o||{};return `<div style="position:absolute;left:0;right:0;bottom:0;height:${h}px;z-index:20;background:${t.s0};border-radius:16px 16px 0 0;border:1px solid ${t.bd};border-bottom:none;box-shadow:${t.sh};display:flex;flex-direction:column;overflow:hidden">${handle(t)}${pane(t,o.sz||TS,p,o)}<div style="height:${o.safe==null?34:o.safe}px;flex-shrink:0"></div></div>`;}
function floatSheet(t,p,o){return `<div style="position:absolute;left:${o.x}px;width:${o.w}px;bottom:${o.bottom}px;height:${o.h}px;z-index:20;background:${t.s0};border-radius:16px;border:1px solid ${t.bd};box-shadow:${t.sh};display:flex;flex-direction:column;overflow:hidden">${handle(t)}${pane(t,o.sz||TS,p,o)}</div>`;}
function sidePanel(t,p,o){return `<div style="position:absolute;right:0;top:${o.top||0}px;bottom:0;width:${o.w}px;z-index:20;background:${t.s0};border-left:1px solid ${t.bd};box-shadow:${t.shL};display:flex;flex-direction:column;overflow:hidden">${o.grip?`<div style="position:absolute;left:0;top:50%;width:4px;height:40px;margin-top:-20px;border-radius:2px;background:${t.grab};z-index:3"></div>`:''}${o.padTop?`<div style="height:${o.padTop}px;flex-shrink:0"></div>`:''}${pane(t,o.sz||TS,p,o)}${o.safe?`<div style="height:${o.safe}px;flex-shrink:0"></div>`:''}</div>`;}
function hoverPrev(t,p,o){return `<div style="position:absolute;left:8px;top:32px;width:${o.w}px;height:${o.h}px;z-index:40;background:${t.s0};border:1px solid ${t.bd};border-radius:10px;box-shadow:${t.sh};display:flex;flex-direction:column;overflow:hidden">
<div style="height:36px;display:flex;align-items:center;padding:0 6px;background:${t.s1};border-bottom:1px solid ${t.bd};flex-shrink:0">
<div style="flex:1;display:flex;gap:4px;align-items:center">${iconBtn(t,DS,'wrap',true)}${p.hl||''}</div>
<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:${t.mu}">${ic(p.icon,14,t.mu)}${p.name}</div>
<div style="flex:1;display:flex;justify-content:flex-end;gap:2px">${iconBtn(t,DS,'copy',false)}${iconBtn(t,DS,'panelR',false)}</div></div>
<div style="flex:1;min-height:0;overflow:hidden;position:relative">${p.body}</div></div>
<div style="position:absolute;left:${o.cx||220}px;top:10px;z-index:41">${cursor()}</div>`;}
