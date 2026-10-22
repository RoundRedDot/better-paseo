// ---------- artboard 4 ----------
function zoneBoard(){const t=T.L;
 const zones=[[0,28,'1','把手 28'],[28,80,'2','头部 52'],[80,124,'3','工具栏 44'],[124,606,'4','正文'],[606,640,'5','安全区 34']];
 const box=`<div style="width:390px;height:640px;position:relative;flex-shrink:0;background:${t.s2};border-radius:16px">${drawer(t,pgBuild(t,TS),640)}${zones.map(z=>`<div style="position:absolute;left:4px;right:4px;top:${z[0]+2}px;height:${z[1]-z[0]-4}px;border:1.5px dashed ${ANN};border-radius:6px;z-index:50;box-sizing:border-box"></div><div style="position:absolute;right:-14px;top:${z[0]+(z[1]-z[0])/2-11}px;width:22px;height:22px;border-radius:11px;background:${ANN};color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;z-index:51">${z[2]}</div>`).join('')}</div>`;
 const it=[['1','把手','竖拖：跟手移动抽屉，松手按阈值切档或关闭。单击：在两档间切换（自适应档时无效）。横滑：不响应。'],['2','头部','竖拖：同把手。横滑：切换上一个 / 下一个 Block，页面跟手。‹ › 单击切换，× 关闭。标题单击展开为完整多行（最多 4 行）。'],['3','工具栏','只响应单击，不参与任何拖动。按钮 36 视觉 / 44 热区。'],['4','正文','竖滑：滚动正文。滚到顶（scrollTop ≤ 0）后继续下拉，手势移交抽屉，按把手阈值切档 / 关闭。横滑：仅在关闭换行且内容超宽时滚动代码，永不切换 Block。长按：系统文本选择。'],['5','安全区','不响应手势，底部内容在其上方结束。']];
 return `<div style="display:flex;gap:56px;align-items:flex-start">${box}<div style="display:flex;flex-direction:column;gap:18px;max-width:520px;padding-top:6px">${it.map(i=>`<div style="display:flex;gap:12px"><span style="width:22px;height:22px;border-radius:11px;background:${ANN};color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i[0]}</span><div><div style="font-size:15px;font-weight:600;color:${DOC.fg}">${i[1]}</div><div style="font-size:13px;line-height:21px;color:${DOC.mu};margin-top:2px">${i[2]}</div></div></div>`).join('')}<div style="font-size:13px;line-height:21px;color:${DOC.fg};background:${DOC.card};border:1px solid ${DOC.bd};border-radius:10px;padding:12px 14px">轴锁定：手指先移动 10px 再判定方向，|dx| > 1.2 × |dy| 判为横向，之后整次手势不再改判。宿主右滑开侧栏只认屏幕左缘 20，头部横滑起点在这 20 以内时让给宿主。</div></div></div>`;}
function markerBoard(){
 const S=[['默认',{}],['悬停（指针）',{hover:'read1'}],['按压（触屏 120ms）',{press:'read1'}],['当前 · 详情打开中',{cur:'read1'}],['切换中的旧行 · 160ms 淡出',{ghost:'read1'}]];
 const r={k:'read1',icon:'file',title:'Read src/preview/hover-preview.tsx',st:'ok',dur:'120ms'};
 const nb={k:'kill',icon:'term',title:'kill 48211',st:'ok',dur:'9ms',nobody:true};
 const col=t=>`<div style="width:420px;background:${t.s0};border-radius:12px;border:1px solid ${t.bd};padding:12px 0;display:flex;flex-direction:column;gap:14px">${S.map(s=>`<div><div style="font-size:11px;color:${t.mu};padding:0 16px 4px">${s[0]}</div>${row(t,r,s[1])}</div>`).join('')}<div><div style="font-size:11px;color:${t.mu};padding:0 16px 4px">无正文 · 无 chevron，无当前态</div>${row(t,nb,{})}</div></div>`;
 return `<div style="display:flex;gap:32px;flex-wrap:wrap">${col(T.L)}${col(T.D)}<div style="max-width:380px;font-size:13px;line-height:21px;color:${DOC.mu}"><div style="font-size:15px;font-weight:600;color:${DOC.fg};margin-bottom:6px">当前行标记</div>底色 accentSoft，左侧 2 × (行高 − 10) 的 accent 竖条，圆角 6，行内水平内边距 8。只要面板打开就一直显示；面板关闭后保留 1.2s 再 200ms 淡出，帮用户找回刚才看的位置。合并行整行标记，分页不影响标记。</div></div>`;}
function miniPhone(dh,label,sub,lines,full){const t=T.L,s=0.42,W=390*s,H=844*s,h=dh*s;
 return `<div style="display:flex;flex-direction:column;gap:10px;align-items:center"><div style="width:${W+8}px;height:${H+8}px;border-radius:30px;background:#111113;padding:4px;box-sizing:border-box"><div style="width:${W}px;height:${H}px;border-radius:26px;background:${t.s0};position:relative;overflow:hidden">${[...Array(16)].map((_,i)=>`<div style="position:absolute;left:14px;right:${30+(i*37)%60}px;top:${50+i*16}px;height:5px;border-radius:3px;background:${t.s2}"></div>`).join('')}<div style="position:absolute;inset:0;background:${t.scrim}"></div><div style="position:absolute;left:0;right:0;bottom:0;height:${h}px;background:${t.s0};border-radius:${full?12:12}px ${full?12:12}px 0 0;box-shadow:${t.sh}"><div style="width:16px;height:3px;border-radius:2px;background:${t.grab};margin:4px auto 0"></div><div style="margin:8px 10px 0;height:8px;width:60%;border-radius:3px;background:${t.s2}"></div><div style="margin:10px 0 0;height:1px;background:${t.bd}"></div>${[...Array(lines)].map((_,i)=>`<div style="margin:5px 10px 0;height:4px;width:${50+(i*29)%45}%;border-radius:2px;background:${t.s2}"></div>`).join('')}</div></div></div><div style="text-align:center"><div style="font-size:14px;font-weight:600;color:${DOC.fg}">${label}</div><div style="font-size:12px;line-height:18px;color:${DOC.mu};max-width:210px">${sub}</div></div></div>`;}
function arrow(s){return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding-top:150px;width:150px"><div style="font-size:12px;line-height:18px;color:${DOC.fg};text-align:center">${s}</div><div style="width:120px;height:1.5px;background:${ANN};position:relative"><div style="position:absolute;right:-1px;top:-4px;width:8px;height:8px;border-top:1.5px solid ${ANN};border-right:1.5px solid ${ANN};transform:rotate(45deg)"></div></div></div>`;}
function detentBoard(){return `<div style="display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap">${miniPhone(266,'自适应档 · 3 行输出','高 = 内容高 266（含把手、头部、工具栏、安全区）。只有一档，上拉 0.3 阻尼回弹。',3)}<div style="width:40px"></div>${miniPhone(462,'半屏档 · 2000 行输出','内容高 > 0.58 × 可用高时，初始取 462。',14)}${arrow('上拖 > 64 或 v > 0.5px/ms<br>或点把手 / 「全屏」<br>240ms')}${miniPhone(789,'全屏档','可用高 − 8 = 789。下拖 > 64 回半屏；下甩 v > 1.2px/ms 直接关闭。',26,1)}<div style="max-width:300px;padding-top:40px;font-size:13px;line-height:21px;color:${DOC.mu};margin-left:24px"><div style="font-size:15px;font-weight:600;color:${DOC.fg};margin-bottom:6px">规则</div>可用高 = 屏高 − 顶部安全区（iPhone 47）。初始档 = min(内容高, 0.58 × 可用高)。半屏或自适应档下拖 > 64 或 v > 0.5 → 关闭（200ms）。切换 Block 时保持当前档；若新内容更短，自适应高度用 240ms 过渡；全屏档不随内容变矮。运行中的 Block 内容增长时，自适应档跟着长高，到 0.58 封顶。</div></div>`;}
function closeBoard(){const c=[['x','× 按钮','所有形态。头部最右，触屏 36、桌面 28，surface1 底。'],['down','下拖把手或头部','抽屉 / 浮动面板。半屏或自适应档下拖 > 64 或 v > 0.5px/ms；全屏下甩 v > 1.2。'],['panelB','点蒙层','仅手机抽屉（有蒙层）。浮动面板和右侧面板无蒙层，点背后的行是切换。'],['back','Android 返回键','全屏档也直接关闭，与任务 sheet 一致。正文有文字选择时先清除选择。'],['kbd','Esc','有键盘时（iPad、桌面）。悬停预览同样用 Esc。'],['panelR','再点当前行','浮动面板、右侧面板：单击已标记为当前的行 → 关闭。']];
 return `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,320px));gap:16px">${c.map(x=>`<div style="background:${DOC.card};border:1px solid ${DOC.bd};border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px">${ic(x[0],20,DOC.fg)}<div style="font-size:15px;font-weight:600;color:${DOC.fg}">${x[1]}</div><div style="font-size:13px;line-height:20px;color:${DOC.mu}">${x[2]}</div></div>`).join('')}</div>`;}
function syncBoard(){const t=T.L;
 const rs=R2.filter(r=>['build','read1','read6','grep','think','edit','tc'].includes(r.k));
 const hdr=(title,ctr,op,dx)=>`<div style="position:absolute;left:0;right:0;top:${28}px;height:52px;display:flex;align-items:center;gap:10px;padding:0 16px;opacity:${op};transform:translateX(${dx}px)"><div style="width:28px;height:28px;border-radius:7px;background:${t.s1};border:1px solid ${t.bd};box-sizing:border-box;display:flex;align-items:center;justify-content:center">${ic(title.startsWith('Read')?'file':'search',16,t.fg)}</div><div style="flex:1;min-width:0"><div style="font-family:${MONO};font-size:13px;font-weight:600;color:${t.fg};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</div><div style="font-size:12px;color:${t.mu}">${ctr}</div></div></div>`;
 const st=(lab,o,shift,h)=>`<div style="display:flex;flex-direction:column;gap:10px"><div style="font-size:14px;font-weight:600;color:${DOC.fg}">${lab}</div><div style="width:390px;height:400px;background:${t.s0};border:1px solid ${t.bd};border-radius:14px;position:relative;overflow:hidden"><div style="position:absolute;left:0;right:0;top:${12-shift}px">${timeline(t,rs,o)}</div><div style="position:absolute;left:0;right:0;top:250px;height:150px;background:${t.s0};border-top:1px solid ${t.bd};border-radius:16px 16px 0 0;box-shadow:${t.sh};overflow:hidden">${handle(t)}${h}</div></div></div>`;
 return `<div style="display:flex;gap:28px;flex-wrap:wrap">${st('t = 0 · 头部横滑提交',{cur:'read6'},0,hdr('Read 6 files','8 / 15',1,0))}${st('t = 120ms · 内容交叉，时间线开始滚动',{ghost:'read6',cur:'grep'},14,hdr('Read 6 files','8 / 15',.25,-60)+hdr('Search "usePreviewAnchor"','9 / 15',.75,12))}${st('t = 240ms · 完成',{cur:'grep'},28,hdr('Search "usePreviewAnchor"','9 / 15',1,0))}<div style="max-width:300px;padding-top:30px;font-size:13px;line-height:21px;color:${DOC.mu}">时间线滚动与内容切换同时开始：滚动 240ms，使新当前行落在可见区内（距可见区顶 ≥ 24、距面板顶 ≥ 12）；已可见则不滚。旧标记 160ms 淡出，新标记 160ms 淡入。若当前行在列表末尾、宿主列表已到底无法上移，就不强制，头部标题即是上下文。范围：整个会话的可预览 Block（合并行算 1 个，无正文行跳过），跨轮时副标题前加「第 2 轮」。</div></div>`;}

// ---------- artboard 5 ----------
function tbl(head,rows,widths){const gc=widths.join(' ');return `<div style="background:${DOC.card};border:1px solid ${DOC.bd};border-radius:12px;overflow:hidden"><div style="display:grid;grid-template-columns:${gc};background:#f6f6f7;border-bottom:1px solid ${DOC.bd}">${head.map(h=>`<div style="padding:10px 14px;font-size:12px;font-weight:600;color:${DOC.mu}">${h}</div>`).join('')}</div>${rows.map((r,i)=>`<div style="display:grid;grid-template-columns:${gc};border-top:${i?`1px solid ${DOC.bd}`:'none'}">${r.map((c,j)=>`<div style="padding:10px 14px;font-size:13px;line-height:20px;color:${DOC.fg};${j===0?'font-weight:600;':''}text-wrap:pretty">${c}</div>`).join('')}</div>`).join('')}</div>`;}
function mono(s){return `<span style="font-family:${MONO};font-size:12px">${s}</span>`;}
function sw(c){return `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:16px;height:16px;border-radius:4px;background:${c};border:1px solid rgba(0,0,0,0.12);flex-shrink:0"></span>${mono(c)}</span>`;}
function specBoard(){
 const h3=s=>`<div style="font-size:18px;font-weight:700;color:${DOC.fg};margin:40px 0 12px">${s}</div>`;
 return `<div style="max-width:1500px">
${h3('5.1 断点总表（W = 窗口 / Modal 宽，S = W − 宿主侧栏宽，P = 右侧面板宽）')}
${tbl(['窗口','触屏','指针（鼠标 / 触控板）','进入 / 退出（回差 16）'],[
 ['W < 600','底部抽屉：贴边，上圆角 16，有蒙层','底部抽屉 + 悬停预览','—'],
 ['600 ≤ W < 960','浮动底部面板：居中，宽 min(W − 32, 760)，全圆角 16，无蒙层','浮动底部面板 + 悬停预览','≥ 600 进入 / < 584 退出'],
 ['W ≥ 960 且 S − P ≥ 400','右侧面板：贴右，高度贴满，无蒙层，背后可点','右侧面板 + 悬停预览','≥ 960 进入 / < 944 退出'],
 ['W ≥ 960 但 S − P < 400','浮动底部面板','浮动底部面板 + 悬停预览','侧栏开合时重新判定'],
 ['手机横屏（H < 500 且 W ≥ 600）','右侧面板，宽 400，无蒙层','—','H ≥ 516 时恢复按 W 判定'],
 ['跨档过渡','保留当前 Block、正文滚动位置、换行和渲染 / 原文状态。旧形态 120ms 淡出，新形态 160ms 淡入，不做位移。抽屉 / 浮动面板的全屏档 → 右侧面板；右侧面板 → 抽屉进入初始档。','同左','窗口拖动中不切换，停止 150ms 后再判定']
],['220px','minmax(0,1.3fr)','minmax(0,1fr)','220px'])}
${h3('5.2 各形态尺寸')}
${tbl(['形态','宽','高 / 档位','圆角','内边距 / 结构'],[
 ['底部抽屉（手机、窄窗）','= 屏宽','可用高 = 屏高 − 顶部安全区。初始 min(内容, 0.58 × 可用)；全屏 可用 − 8','上 16','把手 28（抓手 36 × 5，距顶 8）· 头部 52 · 工具栏 44 · 正文 · 底部安全区 34（Android 按系统 inset）'],
 ['浮动底部面板','min(W − 32, 760)，居中','初始 min(内容, 0.5 × 可用)；全屏 可用 − 24','16（四角）','距底 12 + 安全区；结构同抽屉，无底部安全区占位'],
 ['右侧面板','P = clamp(0.36W, 420, 640)；若内容列右侧空白 ≥ 436 则取空白 − 16（≤ 640）','贴满状态栏以下到底','0，左边框 1','无把手；头部 52 / 44（桌面）· 工具栏 44 / 36 · 正文；左缘 8 宽拖拽区，宽 360 – 0.6W'],
 ['悬停预览（指针）','= 内容列宽，若右侧面板打开则收窄到面板左侧 − 12','≤ 360，最小 240 × 120','10','工具栏 36（surface1）；拖动 / 8 向缩放 / 最大化逻辑沿用；最大化按钮改为「在面板中打开」'],
 ['头部','—','触屏 52 / 桌面 44','图标块 28，圆角 7','左 16 · 图标块 · 间距 10 · 标题 14/600（命令类 13 等宽）+ 副标题 12 · ‹ › × 按钮 36 / 28'],
 ['工具栏','—','触屏 44 / 桌面 36','分段 / 分页 / 复制 高 32 / 24','左：换行、渲染 / 原文、合并分页器；右：复制（主操作 + 下拉）、全屏 / 宽面板'],
 ['正文','—','—','代码条 4','路径行 12 等宽 muted；代码 12/18，行号列 40（11 号），隔行 surface1；diff 行号 36（桌面双列）、符号列 16；Markdown 14/22；错误分节：上边框 + danger 标题']
],['180px','minmax(0,1fr)','minmax(0,1fr)','120px','minmax(0,1.4fr)'])}
${h3('5.3 手势阈值')}
${tbl(['手势','阈值','说明'],[
 ['轴锁定','移动 10px 后判定；|dx| > 1.2|dy| 为横向','判定后整次不变'],
 ['竖拖切档 / 关闭','位移 > 64 或 |v| > 0.5 px/ms','仅把手、头部，以及正文顶部下拉移交'],
 ['全屏直接关闭','下甩 v > 1.2 px/ms','否则只回到初始档'],
 ['横滑切换 Block','位移 > 25% 宽 或 |v| > 0.5 px/ms','仅头部；首尾 Block 阻尼 0.3 回弹'],
 ['正文下拉移交','scrollTop ≤ 0 且向下，移交后按竖拖阈值','正文内横滑永不切换'],
 ['宿主侧滑让位','起点 x < 20 的横滑交给宿主','抽屉打开时手机有蒙层，宿主列表收不到触摸'],
 ['长按','500ms，移动容差 10px','触屏 Web 同值，禁用系统长按'],
 ['停止 / 恢复跟随','离底 > 48 停止；回到离底 ≤ 8 恢复','「回到最新」胶囊显示新增行数'],
 ['点把手切档','单击（< 10px，< 250ms）','自适应档无效']
],['200px','minmax(0,1fr)','minmax(0,1fr)'])}
${h3('5.4 点击模型')}
${tbl(['操作','触屏（手机 / 平板 / 触屏 Web）','指针（桌面 / iPad 触控板）'],[
 ['单击行身','打开详情（形态按断点）','打开详情（右侧面板等）。设置可改回「单击 = 原地展开」'],
 ['单击 chevron 区','原地展开 / 收起。热区 44 宽 × 行高','原地展开 / 收起。热区 28 宽；⌘ / Ctrl + 单击行身同效'],
 ['长按 500ms / 右键','操作菜单：打开详情、在时间线中展开、复制（按工具）','右键同一菜单'],
 ['悬停','—','1s（设置 0–10s）弹预览；离开 150ms 关闭；面板已显示该行时不弹'],
 ['无正文行','无 chevron；单击只有 120ms 按压态，不开面板；长按菜单仅「复制标题」','无悬停预览，单击无响应，光标保持默认'],
 ['读图片的行','单击直接开图片查看器；长按菜单首项「查看图片」','同左'],
 ['面板打开时单击其它行','手机：点在蒙层上 → 关闭。平板浮动 / 右侧面板：直接切换内容','直接切换内容'],
 ['单击当前行','（被蒙层覆盖）','关闭面板'],
 ['复制内容','Bash：命令 / 输出 / 全部；Read：内容 / 路径；Edit：diff / 新内容 / 路径；Search：结果 / 匹配文件列表；Fetch：Markdown / URL；Agent：结果 / 全部对话；思考、提问、todo：Markdown','主按钮执行第一项，下拉选其它']
],['200px','minmax(0,1fr)','minmax(0,1fr)'])}
${h3('5.5 动画参数（缓动统一 cubic-bezier(0.2, 0, 0, 1)）')}
${tbl(['动作','时长','做法'],[
 ['抽屉 / 浮动面板打开','280ms','translateY 100% → 0；蒙层 opacity 0 → 1，200ms 线性'],
 ['切档','240ms','手势松手时 = clamp(剩余距离 / 速度, 160, 240)'],
 ['关闭','200ms','translateY → 100%，蒙层同步淡出'],
 ['右侧面板打开 / 关闭','240ms / 160ms','translateX 24 → 0 + opacity 0 → 1；关闭反向'],
 ['切换 Block','220ms','旧内容 translateX ∓25% + 0 透明（前 120ms）；新内容 ±24 → 0 + 透明 0 → 1；高度变化 240ms'],
 ['时间线同步','滚动 240ms，标记 160ms','与切换同时开始'],
 ['回到最新胶囊','160ms','opacity + translateY 8 → 0'],
 ['长按菜单','160ms','scale 0.96 → 1 + opacity，原点在行'],
 ['悬停预览','淡入 120ms','离开延迟 150ms'],
 ['跨断点','120ms 淡出 + 160ms 淡入','不做位移'],
 ['prefers-reduced-motion','一律 120ms','只做 opacity；时间线同步直接跳到位；拖动仍跟手']
],['220px','200px','minmax(0,1fr)'])}
${h3('5.6 颜色公式与浅 / 深取值（mix(a, b, p) = a 占 p 叠在 b 上）')}
${tbl(['名称','公式','浅色','深色','用途'],[
 ['accentSoft','mix(accent, surface0, 10%)',sw(T.L.acS),sw(T.D.acS),'当前行底、搜索匹配底'],
 ['diffAdd','mix(success, surface0, 14%)',sw(T.L.add),sw(T.D.add),'diff 新增行'],
 ['diffDel','mix(danger, surface0, 12%)',sw(T.L.del),sw(T.D.del),'diff 删除行'],
 ['grabber','foregroundMuted @ 35%',sw('rgba(98,98,107,.35)'),sw('rgba(163,166,173,.35)'),'抓手、滚动条'],
 ['scrim','#000 @ (L(surface0) > 0.5 ? 20% : 50%)',sw('rgba(0,0,0,.2)'),sw('rgba(0,0,0,.5)'),'手机抽屉蒙层'],
 ['shadow','#000 @ 12% / 50%，y 8 blur 32',mono('rgba(0,0,0,.12)'),mono('rgba(0,0,0,.5)'),'抽屉、浮动面板、菜单'],
 ['直接使用','surface0 面板底；surface1 隔行 / 头部图标块 / 关闭按钮；surface2 按压 / 代码条 / 激活按钮；border 分隔；accent 标记、跟随箭头；success / danger 状态与 diff 符号',sw(T.L.s1),sw(T.D.s1),'不新增其它颜色']
],['130px','minmax(0,1fr)','190px','190px','minmax(0,0.8fr)'])}
${h3('5.7 键盘（iPad 外接键盘 / 桌面）')}
${tbl(['按键','行为'],[['← / →','上一个 / 下一个 Block（焦点在正文横向滚动区时让给滚动）'],['↑ / ↓、Space','滚动正文'],['Esc','关闭面板或悬停预览'],['W','切换换行'],['R','渲染 / 原文'],['[ / ]','合并行分页'],['⌘C / Ctrl+C','无文本选择时复制主内容'],['F','抽屉 / 浮动面板切全屏档；右侧面板切宽面板']],['200px','minmax(0,1fr)'])}
</div>`;}

// ---------- summary ----------
function summary(){const c=[
 ['1 点击模型','单击行身打开详情，chevron 区（热区 44 宽）保留原地展开。详情是读长内容的主路径，给最大的热区；原地展开是扫读用的，chevron 本来就是展开的视觉暗示。长按改为操作菜单。无正文行不显示 chevron，单击只有按压态。图片行单击直接看图。'],
 ['2 抽屉档位','自适应 + 全屏：初始高 = min(内容高, 0.58 × 可用高)，内容超过半屏才有全屏档（可用高 − 8）。3 行输出约 266 高；2000 行输出开在 462。工具栏「全屏」对应原来的「最大化」。'],
 ['3 头部与工具栏','头部：图标块、单行标题（单击展开多行）、状态 · 时长 · 序号，右侧 ‹ › ×。工具栏：换行、渲染 / 原文、合并分页器，右侧「复制 ▾」按工具给出不同复制项。'],
 ['4 切换 Block','范围是整个会话的可预览 Block（合并行算 1 个，无正文跳过）。头部横滑或 ‹ ›；时间线同步滚动，当前行用 accentSoft 底 + 2px accent 竖条标记。'],
 ['5 手势','只有把手和头部能拖抽屉；头部横滑切换。工具栏只点。正文只滚动，滚到顶后下拉才移交抽屉；正文横滑只滚代码。'],
 ['6 平板','< 600 底部抽屉；600–959 浮动底部面板（居中，最宽 760）；≥ 960 且 S − P ≥ 400 右侧面板。回差 16。浮动和右侧面板无蒙层，背后可点：点其它行直接切换。'],
 ['7 桌面','保留悬停预览；单击行身改为打开右侧面板，和平板一致，设置里可改回旧行为。chevron 与 ⌘ / Ctrl 单击原地展开。窄于 960 用浮动面板，窄于 600 用抽屉。'],
 ['8 触屏 Web','与原生同一套。行上禁用系统长按（-webkit-touch-callout: none、user-select: none），自己实现 500ms 长按；面板正文里文字仍可选择。'],
 ['9 动画','打开 280 / 切档 240 / 关闭 200 / 切换 220，cubic-bezier(0.2, 0, 0, 1)。减少动态效果时一律 120ms 淡入淡出。']];
 return `<div style="padding:80px 80px 64px"><div style="font-size:13px;color:${DOC.mu}">Better Paseo · 设计稿 · 2026-10-22</div><div style="font-size:48px;font-weight:700;letter-spacing:-1px;color:${DOC.fg};margin-top:8px">Block 详情抽屉</div><div style="font-size:16px;line-height:26px;color:${DOC.mu};max-width:980px;margin-top:12px;text-wrap:pretty">替换手机上「长按 Block 弹居中浮层」。单击 Block 打开详情：手机为底部抽屉，平板按宽度用浮动底部面板或右侧面板，桌面保留悬停预览并增加右侧面板。交互沿用任务看板详情 sheet 的参数。</div>
<div style="display:grid;grid-template-columns:repeat(3,minmax(0,440px));gap:16px;margin-top:40px">${c.map(x=>`<div style="background:${DOC.card};border:1px solid ${DOC.bd};border-radius:12px;padding:18px 20px"><div style="font-size:15px;font-weight:700;color:${DOC.fg};margin-bottom:6px">${x[0]}</div><div style="font-size:13px;line-height:21px;color:${DOC.mu};text-wrap:pretty">${x[1]}</div></div>`).join('')}</div>
<div style="display:flex;gap:20px;margin-top:28px;font-size:13px;color:${DOC.mu}">${[['ab1','画板 1 · 手机'],['ab2','画板 2 · 平板'],['ab3','画板 3 · 桌面'],['ab4','画板 4 · 交互细节'],['ab5','画板 5 · 移植规格']].map(a=>`<a href="#${a[0]}" style="color:${DOC.fg}">${a[1]}</a>`).join('')}</div></div>`;}

function build(){
 const ph=t=>rowOf(phoneScreens(t).map(s=>frameCap({...s,id:s.id+(t===T.D?'·深':'')})),40);
 const ab1=artboard('ab1','画板 1 · 手机 390','iPhone 390 × 844，顶部安全区 47、底部 34，宿主顶栏 56、输入框 104。上排浅色、下排深色，内容一致。',
  `<div style="font-size:18px;font-weight:700;color:${DOC.fg};margin-bottom:20px">浅色</div>${ph(T.L)}<div style="font-size:18px;font-weight:700;color:${DOC.fg};margin:64px 0 20px">深色</div>${ph(T.D)}<div style="font-size:18px;font-weight:700;color:${DOC.fg};margin:64px 0 20px">横屏</div>${frameCap({id:'1i',label:'手机横屏 · 844 × 390',note:'高度 < 500 时底部抽屉只剩一条缝，改用右侧面板（宽 400，贴右，高度贴满，底部安全区 21）。无蒙层，左侧时间线可滚可点，当前行可见。',capW:860,html:landscape(T.L)})}`);
 const ab2=artboard('ab2','画板 2 · 平板','浅色。每张都画出时间线与面板的关系：竖屏用浮动底部面板，与内容列同宽居中；横屏用右侧面板，盖在会话区右侧，左侧保留可读的时间线。',rowOf(tablets(T.L).map(s=>frameCap({...s,capW:620})),56));
 const ab3=artboard('ab3','画板 3 · 桌面','浅色。单击 = 详情（右侧面板），悬停 = 预览，两者可同时出现；预览不会盖到面板上。',rowOf(desktops(T.L).map(s=>frameCap({...s,capW:620})),56));
 const ab4=artboard('ab4','画板 4 · 交互细节','',
  `<div style="font-size:20px;font-weight:700;color:${DOC.fg};margin-bottom:20px">4a 手势分区</div>${zoneBoard()}
<div style="font-size:20px;font-weight:700;color:${DOC.fg};margin:72px 0 20px">4b 当前 Block 的标记</div>${markerBoard()}
<div style="font-size:20px;font-weight:700;color:${DOC.fg};margin:72px 0 20px">4c 档位切换</div>${detentBoard()}
<div style="font-size:20px;font-weight:700;color:${DOC.fg};margin:72px 0 20px">4d 关闭方式</div>${closeBoard()}
<div style="font-size:20px;font-weight:700;color:${DOC.fg};margin:72px 0 20px">4e 切换 Block 时时间线同步</div>${syncBoard()}`);
 const ab5=artboard('ab5','画板 5 · 移植规格','所有尺寸单位为 pt / px（RN 逻辑像素）。',specBoard());
 return `<helmet><meta name="design_doc_mode" content="canvas"><style>body{margin:0;background:${DOC.bg};font-family:${SANS};-webkit-font-smoothing:antialiased} a{color:#18181b;text-decoration:underline;text-underline-offset:3px} a:hover{color:#2563eb}</style></helmet>
<div style="background:${DOC.bg};min-width:3700px;font-family:${SANS}">${summary()}${ab1}${ab2}${ab3}${ab4}${ab5}<div style="height:120px"></div></div>`;}
