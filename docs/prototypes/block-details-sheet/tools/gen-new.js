// ===== round 2: toolbar parity =====
Object.assign(P,{
 squareTerm:'<rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="m7 11 2-2-2-2"></path><path d="M11 13h4"></path>',
 fileOut:'<path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M4 7V4a2 2 0 0 1 2-2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2"></path><path d="m5 11-3 3"></path><path d="m5 17-3-3h10"></path>',
 clipCopy:'<rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"></path><path d="M16 4h2a2 2 0 0 1 2 2v4"></path><path d="M21 14H11"></path><path d="m15 10-4 4 4 4"></path>',
 link:'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>',
 fileDiff:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M9 10h6"></path><path d="M12 13V7"></path><path d="M9 17h6"></path>',
 msgText:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path><path d="M13 8H7"></path><path d="M17 12H7"></path>',
 list:'<path d="M3 12h.01"></path><path d="M3 18h.01"></path><path d="M3 6h.01"></path><path d="M8 12h13"></path><path d="M8 18h13"></path><path d="M8 6h13"></path>',
 braces:'<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"></path><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"></path>',
 fileText:P.file,
 scroll:'<path d="M15 12h-5"></path><path d="M15 8h-5"></path><path d="M19 17V5a2 2 0 0 0-2-2H4"></path><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"></path>',
 fileJson:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"></path><path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1"></path>',
 msgSq:'<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"></path><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"></path>'
});
const CP={sq:['squareTerm','复制命令'],out:['fileOut','复制输出'],both:['clipCopy','复制命令和输出'],path:['link','复制路径'],content:['copy','复制文件内容'],patch:['fileDiff','复制 patch'],newc:['copy','复制新内容'],query:['search','复制查询'],summary:['msgText','复制摘要'],files:['list','复制文件列表'],url:['link','复制 URL'],result:['copy','复制结果'],params:['braces','复制参数'],prompt:['fileText','复制 prompt'],desc:['msgText','复制描述'],log:['scroll','复制日志'],plain:['copy','复制'],code:['code','复制代码']};
function copyBtns(t,sz,keys,vis,o){o=o||{};if(vis==null)vis=keys.length;let s='';
 keys.slice(0,vis).forEach((k,i)=>{let b=o.done===i?`<div style="width:${sz.b}px;height:${sz.b}px;border-radius:${sz.b/2}px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:${t.s2}">${ic('check',sz.i,t.ok)}</div>`:iconBtn(t,sz,CP[k][0],false);
  if(o.tip===i)b=`<div style="position:relative;flex-shrink:0">${b}<div style="position:absolute;top:${sz.b+6}px;left:50%;transform:translateX(-50%);background:${t.fg};color:${t.s0};font-size:11px;line-height:16px;padding:3px 8px;border-radius:5px;white-space:nowrap;z-index:5">${CP[k][1]}</div></div>`;
  s+=b;});
 if(vis<keys.length)s+=iconBtn(t,sz,'more',!!o.menuOpen);return s;}
function upTo(rows,k){return rows.slice(0,rows.findIndex(r=>r.k===k)+1);}
(()=>{const a=R1.find(r=>r.k==='a0');a.title='Finished · tasks B';a.tone='ok';
 R1.splice(R1.indexOf(a),0,{k:'a2',icon:'bot',title:'Failed · tasks A',tone:'er',st:'err',dur:'12s'});
 R1.splice(R1.indexOf(a)+1,0,{k:'a1',icon:'bot',title:'Running · tasks C',tone:'ac',st:'run',dur:''},{k:'img',icon:'image',title:'Read docs/preview-window.png',st:'ok',dur:'22ms'});
 R1.push({type:'code',lines:['const initial = Math.min(fitHeight, avail * 0.58);','const full = avail - 8;','drawer.snapTo(initial);']});
 R2.find(r=>r.k==='todo').title='Tasks 3/5';})();
function mdCodeInline(t,r){const s={b:28,i:14};return `<div style="margin:4px 16px 8px;background:${t.s1};border-radius:8px;overflow:hidden"><div style="height:32px;display:flex;align-items:center;gap:2px;padding:0 4px 0 12px;border-bottom:1px solid ${t.bd}"><span style="flex:1;font-family:${MONO};font-size:11px;color:${t.mu}">tsx</span>${iconBtn(t,s,'code',false)}${iconBtn(t,s,'max',false)}</div><div style="padding:8px 12px">${r.lines.map(l=>`<div style="font-family:${MONO};font-size:12px;line-height:18px;color:${t.fg};white-space:pre">${hl(t,l)}</div>`).join('')}</div></div>`;}
function timeline(t,rows,o){
 return rows.map(r=>{
  if(r.type==='user')return `<div style="display:flex;justify-content:flex-end;padding:10px 16px 6px"><div style="max-width:78%;background:${t.s1};border:1px solid ${t.bd};border-radius:14px;padding:8px 12px;font-size:14px;line-height:21px;color:${t.fg};text-wrap:pretty">${esc(r.text)}</div></div>`;
  if(r.type==='text')return `<div style="padding:6px 16px 8px;font-size:14px;line-height:21px;color:${t.fg};text-wrap:pretty">${esc(r.text)}</div>`;
  if(r.type==='code')return mdCodeInline(t,r);
  return row(t,r,o)+(o.exp===r.k?inlineTc(t):'');
 }).join('');}
function pane(t,sz,p,o){o=o||{};
 return `<div style="display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;position:relative">
<div style="height:${sz.hh}px;display:flex;align-items:center;gap:10px;padding:0 ${sz.t?8:10}px 0 16px;flex-shrink:0">
<div style="width:28px;height:28px;border-radius:7px;background:${t.s1};border:1px solid ${t.bd};box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex-shrink:0">${ic(p.icon,16,p.tone?t[p.tone]:t.fg)}</div>
<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><div style="font-family:${p.mono?MONO:SANS};font-size:${p.mono?13:14}px;font-weight:600;color:${t.fg};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.title)}</div><div style="display:flex;align-items:center;gap:5px;font-size:12px;color:${t.mu};white-space:nowrap;overflow:hidden">${p.sub}</div></div>
<div style="display:flex;align-items:center;gap:${sz.t?0:2}px;flex-shrink:0">${p.nonav?'':iconBtn(t,sz,'chevL',false,{dis:p.first})+iconBtn(t,sz,'chevR',false,{dis:p.last})+`<div style="width:${sz.t?4:6}px"></div>`}${iconBtn(t,sz,'x',false,{fill:true})}</div>
</div>
${p.toolbar}
<div style="flex:1;min-height:0;position:relative;overflow:hidden">${p.body}${o.overlay||''}</div>
${o.footer||''}
</div>`;}
function qToggle(t,sz,raw){return iconBtn(t,sz,raw?'msgSq':'fileJson',!!raw);}
function qBody(t){const opt=(l,d,s)=>`<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;border:${s?1.5:1}px solid ${s?t.ac:t.bd};background:${s?t.s2:t.s0}"><div style="width:18px;height:18px;border-radius:9px;border:1.5px solid ${s?t.ac:t.bd};box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px">${s?`<div style="width:8px;height:8px;border-radius:4px;background:${t.ac}"></div>`:''}</div><div style="flex:1;min-width:0"><div style="font-size:14px;line-height:21px;color:${t.fg}">${l}</div><div style="font-size:12px;line-height:18px;color:${t.mu};text-wrap:pretty">${d}</div></div></div>`;
 return `<div style="padding:14px 16px 16px;display:flex;flex-direction:column;gap:10px"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:11px;font-weight:600;color:${t.mu}">档位</span><span style="font-size:11px;color:${t.mu};border:1px solid ${t.bd};border-radius:4px;padding:0 5px;line-height:16px">单选</span></div><div style="font-size:15px;line-height:22px;font-weight:600;color:${t.fg};text-wrap:pretty">短输出撑不满半屏时，抽屉高度怎么定？</div>${opt('固定半屏','与任务 sheet 一致，短输出下方留白',0)}${opt('按内容适配','初始高 = min(内容高, 0.58 × 可用高)，超过半屏再给全屏档',1)}${opt('总是全屏','阅读空间最大，但完全挡住时间线',0)}<div style="margin-top:4px;border-top:1px solid ${t.bd};padding-top:10px"><div style="font-size:11px;font-weight:600;color:${t.mu};margin-bottom:4px">回答</div><div style="font-size:14px;line-height:21px;color:${t.fg}">按内容适配</div></div></div>`;}
const QRAW=['{','  "questions": [','    {','      "header": "档位",','      "multiSelect": false,','      "question": "短输出撑不满半屏时，抽屉高度怎么定？",','      "options": [','        { "label": "固定半屏" },','        { "label": "按内容适配" },','        { "label": "总是全屏" }','      ]','    },','    { "header": "手势", "question": "正文能否下拉关闭？" },','    { "header": "平板", "question": "宽屏用什么形态？" }','  ],','  "answers": { "档位": "按内容适配" }','}'];
function pgQuestion(t,sz,o){o=o||{};return {icon:'help',title:'提问 · 抽屉档位',sub:sub(t,[stOk(t,'已回答'),'3 个问题','8 / 17']),
 toolbar:tb(t,sz,[qToggle(t,sz,o.raw),o.raw?'':pager(t,sz,'1 / 3'),iconBtn(t,sz,'wrap',false,{dis:1})],[copyBtns(t,sz,['result','params'],o.vis),iconBtn(t,sz,'max',false)]),
 body:o.raw?code(t,QRAW):qBody(t)};}
function pgTodo(t,sz){const items=[[2,'读取时间线行组件'],[2,'确定抽屉档位规则'],[2,'画手势分区图'],[1,'补画提问、Todo、代码块预览'],[0,'更新移植规格表']];
 const mk=s=>s===2?`<div style="width:18px;height:18px;border-radius:9px;background:${t.s2};display:flex;align-items:center;justify-content:center;flex-shrink:0">${ic('check',12,t.ok)}</div>`:s===1?`<div style="width:18px;height:18px;border-radius:9px;border:1.5px solid ${t.ac};box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex-shrink:0"><div style="width:8px;height:8px;border-radius:4px;background:${t.ac}"></div></div>`:`<div style="width:18px;height:18px;border-radius:9px;border:1.5px solid ${t.bd};box-sizing:border-box;flex-shrink:0"></div>`;
 return {icon:'todo',title:'Tasks 3/5',sub:sub(t,['3 完成 · 1 进行中 · 1 待办','14 / 15']),toolbar:tb(t,sz,[iconBtn(t,sz,'wrap',false,{dis:1})],[copyBtns(t,sz,['plain'])]),
 body:`<div style="padding:8px 0">${items.map(i=>`<div style="min-height:40px;display:flex;align-items:center;gap:12px;padding:0 16px">${mk(i[0])}<span style="font-size:14px;line-height:20px;color:${i[0]===2?t.mu:t.fg};text-decoration:${i[0]===2?'line-through':'none'};font-weight:${i[0]===1?600:400}">${i[1]}</span></div>`).join('')}</div>`};}
function pgMdCode(t,sz,o){o=o||{};return {icon:'code',title:'代码块 · tsx',nonav:1,sub:sub(t,['22 行','来自助手回复']),
 toolbar:tb(t,sz,[iconBtn(t,sz,'wrap',true)],[copyBtns(t,sz,['code']),o.panel?iconBtn(t,sz,'max',false):iconBtn(t,sz,'min',true)]),
 body:code(t,READ6)+vbar(t,2,60)};}
function pgAgent(t,sz){return {icon:'bot',tone:'ok',title:'Finished · tasks B',sub:sub(t,[stOk(t,'完成'),'48s · 2 次调用','6 / 17']),
 toolbar:tb(t,sz,[iconBtn(t,sz,'wrap',true)],[copyBtns(t,sz,['desc','prompt','log']),iconBtn(t,sz,'max',false)]),
 body:`<div style="padding:12px 16px 4px"><div style="font-size:11px;color:${t.mu};margin-bottom:4px">任务</div><div style="background:${t.s1};border:1px solid ${t.bd};border-radius:10px;padding:8px 12px;font-size:14px;line-height:21px;color:${t.fg}">列出抽屉在手机上会和哪些手势冲突，给出处理规则。</div></div>
<div style="padding:10px 16px 4px;font-size:14px;line-height:21px;color:${t.fg}">先看宿主列表和侧滑的手势注册方式。</div>
<div style="padding:2px 0">${row(t,{k:'x1',icon:'file',title:'Read host/session/timeline-list.tsx',st:'ok',dur:'40ms'},{})}${row(t,{k:'x2',icon:'search',title:'Search "onStartShouldSetPanResponder"',st:'ok',dur:'31ms'},{})}</div>
${md(t,[['p','有三处会抢手势：'],['li','宿主时间线的纵向滚动：Modal 打开后被蒙层隔开，不再冲突。'],['li','宿主右滑打开 agent 列表：只在屏幕左缘 20 内触发，抽屉头部横滑需要让出这 20。'],['li','正文横向滚动：只有正文可横滚，切换 Block 只认头部。']])}`};}
function pgAgentRun(t,sz){return {icon:'bot',tone:'ac',title:'Running · tasks C',sub:sub(t,[stRun(t,'运行中'),'1m 12s · 3 次调用','7 / 17']),
 toolbar:tb(t,sz,[iconBtn(t,sz,'wrap',true)],[copyBtns(t,sz,['desc','prompt','log']),iconBtn(t,sz,'max',false)]),
 body:`<div style="padding:12px 16px 4px"><div style="font-size:11px;color:${t.mu};margin-bottom:4px">任务</div><div style="background:${t.s1};border:1px solid ${t.bd};border-radius:10px;padding:8px 12px;font-size:14px;line-height:21px;color:${t.fg}">为断点判定补上 16 的回差，并补测试。</div></div><div style="padding:10px 16px 4px;font-size:14px;line-height:21px;color:${t.fg}">先找现有的断点判定。</div><div>${row(t,{k:'y1',icon:'search',title:'Search "resolveForm"',st:'ok',dur:'40ms'},{})}${row(t,{k:'y2',icon:'file',title:'Read src/drawer/breakpoints.ts',st:'ok',dur:'22ms'},{})}${row(t,{k:'y3',icon:'term',title:'npx vitest run breakpoints',st:'run'},{})}</div><div style="padding:8px 16px 0;font-size:14px;line-height:21px;color:${t.fg};text-wrap:pretty">判定在 resolveForm 里，退出阈值写成了 960，缺少回差，正在补</div><div style="padding:8px 16px">${dots(t)}</div>`};}
function menuItem(t,n,s){return `<div style="height:44px;display:flex;align-items:center;gap:12px;padding:0 14px;font-size:15px;color:${t.fg}">${ic(n,18,t.mu)}${s}</div>`;}
function ctxMenu(t){return `<div style="position:absolute;right:16px;top:34px;width:240px;z-index:40;background:${t.s0};border:1px solid ${t.bd};border-radius:12px;box-shadow:${t.sh};overflow:hidden"><div style="padding:8px 14px 6px;font-family:${MONO};font-size:11px;color:${t.mu};border-bottom:1px solid ${t.bd}">npm run build · 2.1s</div>${menuItem(t,'panelB','打开详情')}${menuItem(t,'updown','在时间线中展开')}<div style="height:1px;background:${t.bd}"></div>${menuItem(t,'squareTerm','复制命令')}${menuItem(t,'fileOut','复制输出')}${menuItem(t,'clipCopy','复制命令和输出')}</div>`;}
function imgMenu(t){return `<div style="position:absolute;right:16px;top:34px;width:260px;z-index:40;background:${t.s0};border:1px solid ${t.bd};border-radius:12px;box-shadow:${t.sh};overflow:hidden"><div style="padding:10px 14px 8px;border-bottom:1px solid ${t.bd}"><div style="font-family:${MONO};font-size:12px;color:${t.fg}">docs/preview-window.png</div><div style="font-family:${MONO};font-size:11px;color:${t.mu};margin-top:2px">1440 × 900 · PNG · 214 kB</div></div>${menuItem(t,'image','查看图片')}${menuItem(t,'updown','在时间线中展开')}<div style="height:1px;background:${t.bd}"></div>${menuItem(t,'link','复制路径')}</div>`;}
function viewer(t){return `<div style="position:absolute;inset:0;z-index:50;background:${t.s0};display:flex;flex-direction:column"><div style="height:47px;flex-shrink:0"></div><div style="height:56px;display:flex;align-items:center;gap:8px;padding:0 8px;border-bottom:1px solid ${t.bd};flex-shrink:0">${iconBtn(t,TS,'x',false,{fill:1})}<div style="flex:1;min-width:0;text-align:center"><div style="font-size:15px;font-weight:600;color:${t.fg}">preview-window.png</div><div style="font-family:${MONO};font-size:12px;color:${t.mu}">1440 × 900 · PNG · 214 kB</div></div>${iconBtn(t,TS,'link',false)}</div><div style="flex:1;display:flex;align-items:center;justify-content:center;padding:16px"><div style="width:358px;height:224px;border-radius:8px;background:${t.s1};border:1px dashed ${t.bd};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:${t.mu};font-size:12px">${ic('image',24,t.mu)}图片（宿主查看器，支持缩放）</div></div><div style="height:34px;flex-shrink:0"></div></div>`;}
const RP=R1.slice(1).concat(R2);
function phoneExtra(t){return [
 {id:'1j',label:'提问 · 问题视图',note:'工具栏左：原文切换（file-json）、问题分页 ‹ 1 / 3 ›、换行（置灰，提问总是换行）。右：复制结果（答案）、复制参数（问题）、全屏。只有一个问题时没有分页器。',
  html:phone(t,{rows:upTo(R1,'q0'),tlb:370,tl:{cur:'q0'},scrim:1,overlay:drawer(t,pgQuestion(t,TS),HALF)})},
 {id:'1k',label:'提问 · 原文视图',note:'原文切换按下后有 surface2 底色，图标换成 messages-square（再点回到问题）。原文时分页器隐藏，正文显示完整 JSON。',
  html:phone(t,{rows:upTo(R1,'q0'),tlb:370,tl:{cur:'q0'},scrim:1,overlay:drawer(t,pgQuestion(t,TS,{raw:1}),HALF)})},
 {id:'1l',label:'Todo · Tasks 3/5',note:'头部图标 list-checks，标题「Tasks 3/5」。内容不足半屏，按内容高 374，没有全屏档，所以没有全屏按钮。完成项 muted 加删除线，进行中项 accent 圆点并加粗。',
  html:phone(t,{rows:upTo(RP,'todo'),tlb:282,tl:{cur:'todo'},scrim:1,overlay:drawer(t,pgTodo(t,TS),374)})},
 {id:'1m',label:'Markdown 代码块 · 直接全屏档',note:'点助手回复里代码块右上的最大化按钮（视觉 28，热区 44）→ 抽屉直接打开在全屏档。代码块不是 Block：头部没有 ‹ ›，不参与切换。工具栏：换行、复制代码、退出全屏；语言为 markdown 时左侧多一个渲染 / 原文。',
  html:phone(t,{rows:R1,tlb:10,scrim:1,overlay:drawer(t,pgMdCode(t,TS),FULL)})},
 {id:'1n',label:'运行中的子 agent',note:'标题用状态描述（Running / Finished / Failed · 任务名），图标按状态着色：运行 accent、完成 success、警告 warning、失败 danger，时间线行与头部一致。正文是子 agent 对话，跟随规则同 1d。',
  html:phone(t,{rows:upTo(R1,'a1'),tlb:370,tl:{cur:'a1'},scrim:1,overlay:drawer(t,pgAgentRun(t,TS),HALF)})},
 {id:'1o',label:'读图片 · 长按菜单',note:'图片不进抽屉。长按菜单头部放路径和「尺寸 · 格式 · 体积」，原来在悬停工具栏中间的信息移到这里。',
  html:phone(t,{rows:upTo(R1,'img'),tlb:260,tl:{press:'img',extra:{img:imgMenu(t)}},scrim:1})},
 {id:'1p',label:'读图片 · 单击 → 查看器',note:'单击图片行直接打开宿主的图片查看器。顶栏标题下方显示「1440 × 900 · PNG · 214 kB」，右侧复制路径（link）。',
  html:phone(t,{rows:upTo(R1,'img'),tlb:260,overlay:viewer(t)})}
];}
function tabletsExtra(t){const W=1194,H=834,P=430;return [{id:'2h',label:'iPad 11 寸横屏 · 提问在右侧面板',note:'面板宽 430，两个复制按钮都放得下。问题分页 ‹ 1 / 3 ›，外接键盘用 [ / ] 翻页，← → 切换 Block。',
 html:tabFrame(bigHost(t,{W,H,status:24,rows:upTo(R1,'q0'),tlb:220,tl:{cur:'q0'},overlay:sidePanel(t,pgQuestion(t,TS),{w:P,top:24,safe:20})}))}];}
const HCP={Search:['query','summary','files'],Read:['path','content'],Bash:['sq','out','both']};
function hoverPrev(t,p,o){const x=o.x==null?8:o.x,y=o.y==null?32:o.y,keys=p.copies||HCP[p.name]||['result','params'];
 const hs=o.handles?[[0,0],[50,0],[100,0],[0,50],[100,50],[0,100],[50,100],[100,100]].map(a=>`<div style="position:absolute;left:${a[0]}%;top:${a[1]}%;width:8px;height:8px;margin:-4px 0 0 -4px;background:#ffffff;border:1.5px solid ${ANN};box-sizing:border-box;z-index:3"></div>`).join(''):'';
 return `<div style="position:absolute;left:${x}px;top:${y}px;width:${o.w}px;height:${o.h}px;z-index:40"><div style="position:absolute;top:0;left:0;right:0;bottom:0;background:${t.s0};border:1px solid ${t.bd};border-radius:10px;box-shadow:${t.sh};display:flex;flex-direction:column;overflow:hidden">
<div style="height:36px;display:flex;align-items:center;gap:8px;padding:0 4px 0 6px;background:${t.s1};border-bottom:1px solid ${t.bd};flex-shrink:0">
<div style="flex:1;display:flex;gap:4px;align-items:center;min-width:0">${p.left||iconBtn(t,DS,'wrap',true)}</div>
<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:${t.mu};white-space:nowrap">${ic(p.icon,14,t.mu)}${p.name}</div>
<div style="flex:1;display:flex;justify-content:flex-end;align-items:center;gap:2px">${copyBtns(t,DS,keys,null,{tip:o.tip})}<div style="width:1px;height:16px;background:${t.bd};margin:0 2px"></div>${iconBtn(t,DS,'panelR',false)}${iconBtn(t,DS,o.max?'x':'max',false)}${o.pop&&!o.max?iconBtn(t,DS,'x',false):''}</div></div>
<div style="flex:1;min-height:0;overflow:hidden;position:relative">${p.body}</div>${o.footer||''}</div>${hs}</div>${o.cx===null?'':`<div style="position:absolute;left:${(o.cx||220)}px;top:10px;z-index:41">${cursor()}</div>`}`;}
function desktopsExtra(t){const W=1280,H=800,P=461;
 const pop=hoverPrev(t,{icon:'term',name:'Bash',body:cmdStrip(t,'npm run build',{m:'10px 12px 8px'})+outLines(t,BUILD_OUT.slice(0,10),{px:12})},{x:300,y:150,w:500,h:300,pop:1,handles:1,cx:null});
 const kb=`<div style="height:30px;border-top:1px solid ${t.bd};display:flex;align-items:center;gap:16px;padding:0 12px;font-size:11px;color:${t.mu};flex-shrink:0;background:${t.s1}">${ic('kbd',14,t.mu)}<span>← → 切换 Block</span><span>[ / ] 翻页</span><span>W 换行</span><span>Esc 关闭</span></div>`;
 const mx=hoverPrev(t,{icon:'file',name:'Read',left:pager(t,DS,'2 / 6')+iconBtn(t,DS,'wrap',true),body:pathLine(t,'src/preview/use-preview-anchor.ts','L1–64','file')+code(t,READ6)},{x:276,y:16,w:988,h:768,max:1,pop:1,cx:null,footer:kb});
 return [
 {id:'3d',label:'桌面 1280 · 代码块在右侧面板 + pop 窗口',note:'点代码块的最大化按钮 → 右侧面板（无 ‹ ›，不参与 Block 切换）。左边是 pop 状态的悬停窗口：点外部、滚轮都不关闭，工具栏最右 × 关闭；拖工具栏移动，拖 8 个边角缩放（橙色方块），最小 240 × 120。',
  html:deskFrame(bigHost(t,{W,H,sb:260,topH:48,compH:88,rows:R1,tlb:20,tl:{},overlay:sidePanel(t,pgMdCode(t,DS,{panel:1}),{w:P,sz:DS,grip:1})+pop}))},
 {id:'3e',label:'桌面 1280 · 悬停窗口最大化',note:'点最大化或双击工具栏后，撑满窗口内容区，上下各留 16，最大化按钮变成 ×。键位和右侧面板一致：← → 切换 Block，[ / ] 给合并行翻页。',
  html:deskFrame(bigHost(t,{W,H,sb:260,topH:48,compH:88,tl:{cur:'read6'},tlb:250,overlay:mx}))}];}
function board4f(){const t=T.L;
 const box=(lab,inner,w,h)=>`<div style="display:flex;flex-direction:column;gap:8px"><div style="font-size:13px;font-weight:600;color:${DOC.fg};max-width:${w||390}px">${lab}</div><div style="width:${w||390}px;height:${h||45}px;background:${t.s0};border:1px solid ${t.bd};border-radius:10px;position:relative">${inner}</div></div>`;
 const bashR=o=>[copyBtns(t,TS,['sq','out','both'],null,o||{}),iconBtn(t,TS,'max',false)];
 const qMenu=`<div style="position:absolute;right:46px;top:46px;width:200px;background:${t.s0};border:1px solid ${t.bd};border-radius:12px;box-shadow:${t.sh};z-index:5;overflow:hidden">${menuItem(t,'braces','复制参数')}</div>`;
 return `<div style="font-size:20px;font-weight:700;color:${DOC.fg};margin:72px 0 20px">4f 工具栏状态</div><div style="display:flex;flex-wrap:wrap;gap:40px 48px;align-items:flex-start">
${box('换行 · 开（按下态 surface2 底）',tb(t,TS,[iconBtn(t,TS,'wrap',true)],bashR()))}
${box('换行 · 关（代码可横向滚动）',tb(t,TS,[iconBtn(t,TS,'wrap',false)],bashR()))}
${box('换行 · 置灰（所有行放得下 / Markdown 渲染态 / 提问）',tb(t,TS,[iconBtn(t,TS,'wrap',false,{dis:1})],bashR()))}
${box('复制成功 · 图标 1.2s 变为 check',tb(t,TS,[iconBtn(t,TS,'wrap',true)],bashR({done:1})))}
${box('360 宽安卓 · 放不下时从末尾收进 ⋯，第一个始终可见',tb(t,TS,[qToggle(t,TS,0),pager(t,TS,'1 / 3'),iconBtn(t,TS,'wrap',false,{dis:1})],[copyBtns(t,TS,['result','params'],1,{menuOpen:1}),iconBtn(t,TS,'max',false)])+qMenu,360,110)}
${box('桌面 · 28 按钮，悬停显示名称',tb(t,DS,[iconBtn(t,DS,'wrap',true)],[copyBtns(t,DS,['sq','out','both'],null,{tip:1}),iconBtn(t,DS,'panelR',false),iconBtn(t,DS,'max',false)]),360,80)}
</div><div style="max-width:960px;font-size:13px;line-height:21px;color:${DOC.mu};margin-top:24px;text-wrap:pretty">置灰：图标 35% 不透明，不响应点击，没有按压态，但仍然占位，工具栏不会跳动。换行在三种情况下置灰：所有行都放得下（按正文宽度测量，原生和 Web 都适用）、Markdown 渲染态、提问。复制按钮去重：内容相同的两项只留前一个；值为空的项不显示。收进 ⋯ 时按表中顺序从后往前收；全屏按钮和 ⋯ 不参与收纳。</div>`;}
function extraSpec(){
 const h3=s=>`<div style="font-size:18px;font-weight:700;color:${DOC.fg};margin:40px 0 12px">${s}</div>`;
 const b=(n,s)=>`<span style="display:inline-flex;align-items:center;gap:5px;margin-right:12px;white-space:nowrap">${ic(n,15,DOC.fg)}${s}</span>`;
 const rows=[
  ['换行','工具栏左首，36 按钮。开 = surface2 底，关 = 透明，置灰 = 35%','同左','同左（桌面 28）','工具栏左首 28，状态同左'],
  ['合并行分页','工具栏左「‹ 2 / 6 ›」胶囊，高 32','同左','同左（桌面高 24），键盘 [ / ]','工具栏左，高 24；键盘从 ← → 改为 [ / ]'],
  ['渲染 / 原文','工具栏左分段控件（思考、Fetch、markdown 代码块）','同左','同左','工具栏左，不变'],
  ['提问：原文切换 + 分页','工具栏左 file-json 按钮，原文态 surface2 底并换成 messages-square；分页 ‹ 1 / 3 ›，单问题不显示，原文态隐藏；换行置灰','同左','同左','同左（28）'],
  ['流式圆点','头部副标题「··· 运行中」（accent）；时间线行右侧的圆点保留','同左','同左','工具栏中部名称右侧，不变'],
  ['工具图标和名字','头部 28 图标块（按状态着色）+ 完整标题（命令、路径、agent 状态描述）','同左','同左','工具栏中部，不变'],
  ['图片尺寸','图片不进抽屉：放在长按菜单头部和查看器顶栏副标题「1440 × 900 · PNG · 214 kB」','同左','同左','工具栏中部，不变'],
  ['每一种复制','工具栏右，并排 36 图标按钮，顺序见 5.9；放不下从末尾收进 ⋯；长按菜单用同一组','同左','同左（桌面 28，悬停显示名称）','工具栏右，28，悬停显示名称'],
  ['最大化','同一个 maximize-2 按钮 → 全屏档（可用高 − 8），全屏后变成 minimize-2；内容不足半屏时隐藏','→ 全屏档（可用高 − 24）','→ 加宽到 0.6W，再点还原','保留：撑满窗口内容区，上下各留 16；最大化后按钮变成 ×'],
  ['双击最大化','去掉：会和单击把手切档冲突，由单击把手代替','同左','双击头部空白处 = 加宽 / 还原','保留：双击工具栏'],
  ['pop 关闭','头部 × 常驻，不区分 pop','同左','同左','保留：pop 时工具栏最右 ×，点外部和滚轮不关闭'],
  ['在面板中打开','—','—','—','新增 panel-right，放在最大化左边，点后转到右侧面板'],
  ['拖动和缩放','去掉：由档位代替，只有把手和头部能竖拖切档','去掉：由档位代替，宽度跟随窗口','只保留左缘拖宽（360 – 0.6W），不可移动','保留：拖工具栏移动，拖 8 个边角缩放，最小 240 × 120'],
  ['文件路径行','正文顶部，12 等宽 muted，左侧文件 / 目录图标，右侧行范围或体积','同左','同左','正文顶部，不变'],
  ['错误信息','正文末尾分节：上边框 + danger 图标和标题 + 等宽正文；退出码同时进头部副标题','同左','同左','正文末尾，同样式']];
 const cp=[
  ['Bash / shell / git',b('squareTerm','复制命令')+b('fileOut','复制输出')+b('clipCopy','复制命令和输出')],
  ['Read / Write',b('link','复制路径')+b('copy','复制文件内容')],
  ['Edit',b('link','复制路径')+b('fileDiff','复制 patch')+b('copy','复制新内容')],
  ['Search',b('search','复制查询')+b('msgText','复制摘要')+b('list','复制文件列表')],
  ['Fetch',b('link','复制 URL')+b('copy','复制结果')],
  ['MCP、hub、github、未知工具',b('copy','复制结果')+b('braces','复制参数')],
  ['Paseo · 给 agent 发消息',b('fileText','复制 prompt')+b('copy','复制结果')+b('braces','复制参数')],
  ['Paseo · 创建 agent',b('fileText','复制 prompt')],
  ['Paseo · agent 操作 / 目录查询 / agent 状态',b('copy','复制结果')+b('braces','复制参数')],
  ['提问',b('copy','复制结果（答案）')+b('braces','复制参数（问题）')],
  ['worktree 设置',b('link','复制路径')+b('scroll','复制日志')],
  ['子 agent',b('msgText','复制描述')+b('fileText','复制 prompt')+b('scroll','复制日志')],
  ['思考 / plan / 纯文本 / activity / todo',b('copy','复制')],
  ['Markdown 代码块',b('code','复制代码')],
  ['文件路径、图片头部（仅桌面悬停）',b('link','复制路径')]];
 return `${h3('5.8 现有操作对照表')}${tbl(['现有控件','手机抽屉','浮动底部面板','右侧面板','桌面悬停浮层'],rows,['170px','minmax(0,1.3fr)','minmax(0,0.8fr)','minmax(0,0.9fr)','minmax(0,1.1fr)'])}
${h3('5.9 复制按钮（顺序即优先级，第一个为主操作且始终可见）')}${tbl(['工具','按钮（lucide 图标）'],cp,['300px','minmax(0,1fr)'])}
<div style="font-size:13px;line-height:21px;color:${DOC.mu};margin-top:10px;max-width:1100px">内容相同的两项只保留前一个，值为空的项不显示。一次点击即复制，图标 1.2s 变为 check（success）。长按菜单的复制项与本表一致。</div>`;}
