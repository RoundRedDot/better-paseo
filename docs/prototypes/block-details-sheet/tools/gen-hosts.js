// ---------- tablet / desktop hosts ----------
function tabStatus(t,W){return `<div style="position:absolute;top:0;left:0;right:0;height:24px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;font-size:12px;font-weight:600;color:${t.fg};z-index:60;pointer-events:none"><span>9:41  10月22日 周四</span><span style="display:flex;align-items:center;gap:6px">100%<span style="width:22px;height:11px;border:1.2px solid ${t.fg};border-radius:3px;padding:1px;box-sizing:border-box;display:flex"><span style="flex:1;background:${t.fg};border-radius:1px"></span></span></span></div>`;}
function sidebar(t,top,w){const ag=[['重构 hover 预览','运行中 · 38s',t.ac,1],['任务看板手机端','待输入',t.wa],['修复 Android 返回键','已完成 · 2h',t.ok],['发布 0.2.0','已完成 · 昨天',t.ok],['清理依赖','已完成 · 3 天',t.ok]];
 return `<div style="position:absolute;left:0;top:${top}px;bottom:0;width:${w}px;background:${t.s1};border-right:1px solid ${t.bd};padding:12px 8px;box-sizing:border-box;display:flex;flex-direction:column;gap:2px"><div style="font-size:13px;font-weight:600;color:${t.mu};padding:4px 8px 10px">Agents</div>${ag.map(a=>`<div style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:8px;background:${a[3]?t.s2:'transparent'}"><span style="width:8px;height:8px;border-radius:4px;background:${a[2]};flex-shrink:0"></span><div style="min-width:0"><div style="font-size:13px;color:${t.fg};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a[0]}</div><div style="font-size:11px;color:${t.mu}">${a[1]}</div></div></div>`).join('')}</div>`;}
function bigHost(t,o){
 const sw=o.sb||0,st=o.status||0,top=o.topH||52,ch=o.compH||96,col=o.col||760;
 return `<div style="width:${o.W}px;height:${o.H}px;position:relative;overflow:hidden;background:${t.s0};font-family:${SANS}">
${st?tabStatus(t,o.W):''}${sw?sidebar(t,st,sw):''}
<div style="position:absolute;left:${sw}px;right:0;top:${st}px;bottom:0">
${hostTop(t,0,top,{sidebarIcon:1})}
<div style="position:absolute;top:${top}px;bottom:${ch}px;left:0;right:0;overflow:hidden"><div style="position:absolute;left:0;right:0;bottom:${o.tlb==null?10:o.tlb}px;display:flex;justify-content:center"><div style="width:100%;max-width:${col}px;padding:0 16px;box-sizing:border-box">${timeline(t,o.rows||R1.concat(R2),o.tl||{})}</div></div></div>
${composer(t,ch,{max:col-32})}
</div>
${o.overlay||''}
</div>`;}
function tabFrame(inner,r){return `<div style="padding:14px;background:#111113;border-radius:${r||36}px;flex-shrink:0"><div style="border-radius:${(r||36)-14}px;overflow:hidden">${inner}</div></div>`;}
function deskFrame(inner){return `<div style="border-radius:10px;overflow:hidden;border:1px solid #c8c8cc;box-shadow:0 24px 64px rgba(0,0,0,0.16);flex-shrink:0">${inner}</div>`;}
function note(x,y,s,o){return `<div style="position:absolute;left:${x}px;top:${y}px;z-index:90">${tag(s,o)}</div>`;}
function bracket(x,w,y,label){return `<div style="position:absolute;left:${x}px;width:${w}px;top:${y}px;height:10px;border:1.5px solid ${ANN};border-top:none;z-index:90"></div><div style="position:absolute;left:${x}px;width:${w}px;top:${y+14}px;display:flex;justify-content:center;z-index:90">${tag(label)}</div>`;}

function tablets(t){
 const A=[];
 // iPad mini portrait
 {const W=744,H=1133,w=712,h=Math.round((H-24)*0.5);A.push({id:'2a',label:'iPad mini 竖屏 · 744 × 1133',note:`600 ≤ W < 960 → 浮动底部面板。宽 min(W − 32, 760) = ${w}，初始高 min(内容, 可用高 × 0.5) = ${h}，距底 12 + 安全区 20。无蒙层，上方时间线可滚可点。`,
  html:tabFrame(bigHost(t,{W,H,status:24,tl:{cur:'edit'},tlb:320,overlay:floatSheet(t,pgDiff(t,TS),{x:16,w,h,bottom:32})+note(24,520,'背后可点：点其它行直接切换')}))});}
 {const W=834,H=1194,w=760,h=Math.round((H-24)*0.5);A.push({id:'2b',label:'iPad 11 寸竖屏 · 834 × 1194',note:`同为浮动面板，宽封顶 760（与内容列同宽、居中对齐），初始高 ${h}。上拉把手到全屏档：可用高 − 24。`,
  html:tabFrame(bigHost(t,{W,H,status:24,tl:{cur:'grep'},tlb:300,overlay:floatSheet(t,pgSearch(t,TS),{x:37,w,h,bottom:32})}))});}
 {const W=1194,H=834,P=430;A.push({id:'2c',label:'iPad 11 寸横屏 · 侧栏收起',note:`W ≥ 960 → 右侧面板，宽 P = clamp(0.36W, 420, 640) = ${P}，贴右、高度贴满状态栏以下。时间线列可读宽 547。无蒙层，点其它行直接切换，再点当前行关闭。`,
  html:tabFrame(bigHost(t,{W,H,status:24,tl:{cur:'build'},tlb:-20,overlay:sidePanel(t,pgBuild(t,TS),{w:P,top:24,safe:20})+bracket(233,531,800,'时间线可读区 547')}))});}
 {const W=1194,H=834,P=430;A.push({id:'2d',label:'iPad 11 寸横屏 · 宿主侧栏展开',note:'会话区 S = W − 280 = 914，S − P = 484 ≥ 400，仍用右侧面板。若 S − P < 400（如 1024 宽 + 侧栏），降级为浮动底部面板。',
  html:tabFrame(bigHost(t,{W,H,status:24,sb:280,tl:{cur:'think'},tlb:-110,overlay:sidePanel(t,pgThink(t,TS),{w:P,top:24,safe:20})+bracket(373,391,800,'可读区 391')}))});}
 {const W=1376,H=1032,P=495;A.push({id:'2e',label:'iPad 13 寸横屏 · 1376 × 1032 · 接妙控键盘',note:`P = ${P}。接触控板时支持悬停预览（同桌面）；接键盘时面板底部显示快捷键提示：← → 切换、Esc 关闭、W 换行、⌘C 复制主内容。`,
  html:tabFrame(bigHost(t,{W,H,status:24,tl:{cur:'a0'},tlb:-40,overlay:sidePanel(t,pgAgent(t,TS),{w:P,top:24,safe:20,footer:`<div style="height:32px;border-top:1px solid ${t.bd};display:flex;align-items:center;gap:14px;padding:0 16px;font-size:11px;color:${t.mu};flex-shrink:0">${ic('kbd',14,t.mu)}<span>← → 切换</span><span>Esc 关闭</span><span>W 换行</span><span>⌘C 复制</span></div>`})}))});}
 {const W=840,H=900,w=760,h=232;A.push({id:'2f',label:'安卓折叠屏展开 · 840 × 900 · 短输出',note:'浮动面板。3 行输出只占内容高度（232），不提供全屏档，上拉只有 0.3 阻尼的回弹。Android 返回键关闭。',
  html:tabFrame(bigHost(t,{W,H,status:24,compH:88,tl:{cur:'tc'},tlb:20,overlay:floatSheet(t,pgShort(t,TS),{x:40,w,h,bottom:16})+`<div style="position:absolute;left:419px;top:24px;bottom:0;width:1px;background:${t.bd};opacity:.6;z-index:5"></div>`}),28)});}
 // stage manager
 {const win=bigHost(t,{W:500,H:820,status:0,compH:88,col:500,rows:R2,tl:{cur:'f0'},overlay:drawer(t,pgFetch(t,TS),476,{safe:12})});
  const thumbs=[0,1,2].map(i=>`<div style="position:absolute;left:28px;top:${200+i*150}px;width:150px;height:110px;border-radius:10px;background:${t.s0};opacity:.75;box-shadow:0 4px 16px rgba(0,0,0,.12)"></div>`).join('');
  A.push({id:'2g',label:'台前调度窄窗口 · 500 宽（13 寸屏内）',note:'W < 600 → 与手机相同的底部抽屉（贴窗口边、上圆角 16），初始 0.58 × 窗口高 = 476，底部留 12。窗口拖宽过 600 时原地切换为浮动面板（见断点表）。',
   html:tabFrame(`<div style="width:1376px;height:1032px;position:relative;background:${t===T.L?'#d6d6db':'#2b2b30'};overflow:hidden;font-family:${SANS}">${thumbs}<div style="position:absolute;left:240px;top:110px;border-radius:12px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.25)">${win}</div><div style="position:absolute;left:800px;top:150px;width:520px;height:740px;border-radius:12px;background:${t.s1};opacity:.9;box-shadow:0 20px 60px rgba(0,0,0,.2)"></div>${note(330,944,'窗口 500 × 820 · 抽屉 476')}</div>`)});}
 return A;}

function desktops(t){
 const A=[];
 {const W=1280,H=800,P=461;
  const hp=hoverPrev(t,{icon:'search',name:'Search',body:searchRes(t,SEARCH.slice(0,2),'usePreviewAnchor')},{w:392,h:250,cx:230});
  A.push({id:'3a',label:'桌面 1280 × 800 · 悬停预览 + 单击详情',note:`单击 Edit 行身 → 右侧面板 P = 0.36W = ${P}（贴右，无蒙层，左缘可拖宽 360 – 0.6W）。同时悬停 Search 行 1s → 预览浮层，宽收窄到面板左侧的可见列宽 392，最高 360。`,
   html:deskFrame(bigHost(t,{W,H,sb:260,topH:48,compH:88,tl:{cur:'edit',hover:'grep',extra:{grep:hp}},tlb:250,overlay:sidePanel(t,pgDiff(t,DS,{two:1}),{w:P,sz:DS,grip:1})}))});}
 {const W=1920,H=1080,P=434;
  const hp=hoverPrev(t,{icon:'file',name:'Read',body:pathLine(t,'src/preview/hover-preview.tsx','L1–148','file')+code(t,READ6.slice(0,14))},{w:712,h:330,cx:300});
  A.push({id:'3b',label:'桌面 1920 × 1080 · 面板落在列右侧空白',note:'内容列右侧空白 450 ≥ 420 + 16，面板宽取空白宽 − 16 = 434，完全不遮时间线。悬停预览保持内容列全宽。',
   html:deskFrame(bigHost(t,{W,H,sb:260,topH:48,compH:88,tl:{cur:'read6',hover:'read1',extra:{read1:hp}},tlb:330,overlay:sidePanel(t,pgRead6(t,DS),{w:P,sz:DS,grip:1})}))});}
 {const W=720,H=800,w=688,h=400;
  A.push({id:'3c',label:'桌面浏览器窄窗口 · 720 × 800',note:'600 ≤ W < 960 → 浮动底部面板，鼠标可拖把手切档、滚轮滚正文。悬停预览照常（宽 = 内容列宽）。W < 600 时变为贴边抽屉。',
   html:deskFrame(bigHost(t,{W,H,topH:48,compH:88,tl:{cur:'build'},tlb:20,overlay:floatSheet(t,pgBuild(t,DS),{x:16,w,h,bottom:12,sz:DS})}))});}
 return A;}

// ---------- doc chrome ----------
const DOC={bg:'#ecebe8',fg:'#18181b',mu:'#62626b',bd:'#d6d5d1',card:'#ffffff'};
function artboard(id,title,desc,body){return `<section id="${id}" data-screen-label="${title}" style="padding:72px 80px 40px;border-top:1px solid ${DOC.bd}"><div style="font-size:13px;color:${DOC.mu};margin-bottom:6px">${id}</div><div style="font-size:34px;font-weight:700;color:${DOC.fg};letter-spacing:-0.5px">${title}</div><div style="font-size:15px;line-height:24px;color:${DOC.mu};max-width:1100px;margin:10px 0 40px;text-wrap:pretty">${desc}</div>${body}</section>`;}
function frameCap(s){return `<div style="display:flex;flex-direction:column;gap:14px;flex-shrink:0"><div style="display:flex;flex-direction:column;gap:4px;max-width:${s.capW||410}px"><div style="display:flex;align-items:center;gap:8px"><span style="font-family:${MONO};font-size:12px;font-weight:600;color:#ffffff;background:${DOC.fg};padding:2px 6px;border-radius:4px">${s.id}</span><span style="font-size:15px;font-weight:600;color:${DOC.fg}">${s.label}</span></div><div style="font-size:13px;line-height:20px;color:${DOC.mu};text-wrap:pretty">${s.note}</div></div>${s.html}</div>`;}
function rowOf(items,gap){return `<div style="display:flex;flex-wrap:wrap;gap:${gap||48}px;align-items:flex-start">${items.join('')}</div>`;}
