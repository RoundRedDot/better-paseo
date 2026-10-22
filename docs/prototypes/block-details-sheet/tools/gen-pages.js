// ---------- page content ----------
const BUILD_OUT=['> better-paseo@0.1.0 build','> vite build','','vite v5.4.8 building for production...','transforming (212) src/preview/hover-preview.tsx','✓ 211 modules transformed.','rendering chunks...','computing gzip size...','dist/index.html                 0.46 kB','dist/assets/index-4f1c.css      8.12 kB','dist/assets/vendor-91ab.js    142.30 kB','dist/assets/index-c2e7.js      38.74 kB'];
function pgBuild(t,sz){return {icon:'term',title:'npm run build',mono:1,sub:sub(t,[stErr(t,'退出码 1'),'2.1s','6 / 15']),
 toolbar:tb(t,sz,[iconBtn(t,sz,'wrap',true)],[copyBtns(t,sz,['sq','out','both']),iconBtn(t,sz,'max',false)]),
 body:cmdStrip(t,'npm run build')+outLines(t,BUILD_OUT)+errBox(t,'构建失败 · 1 个错误',['src/preview/block-drawer.tsx:48:12','error TS2322: Type \'number | undefined\' is not','assignable to type \'number\'.','  48 │ const top = detentTop(state.detent);','     │             ~~~~~~~~~','Build failed in 2.06s'])+vbar(t,4,46)};}
const DIFF=[
 ['@','@@ -36,14 +36,23 @@ export function TimelineRow(props: RowProps)'],
 [' ',36,36,'  const rowRef = useRef<View>(null);'],
 [' ',37,37,'  const anchor = usePreviewAnchor(rowRef);'],
 ['-',38,'','  const onLongPress = useCallback(() => {'],
 ['-',39,'','    openFloatingPreview(anchor, props.block);'],
 ['-',40,'','  }, [anchor, props.block]);'],
 ['+','',38,'  const drawer = useBlockDrawer();'],
 ['+','',39,'  const onPressBody = useCallback(() => {'],
 ['+','',40,'    if (!hasBody(props.block)) return flashPressed();'],
 ['+','',41,'    if (isImageRead(props.block)) return openImage(props.block);'],
 ['+','',42,'    drawer.open(props.block.id, "row");'],
 ['+','',43,'  }, [drawer, props.block]);'],
 [' ',41,44,''],
 [' ',42,45,'  return ('],
 [' ',43,46,'    <Pressable'],
 ['-',44,'','      onPress={toggleExpanded}'],
 ['-',45,'','      onLongPress={onLongPress}'],
 ['+','',47,'      onPress={onPressBody}'],
 ['+','',48,'      onLongPress={openRowMenu}'],
 ['+','',49,'      delayLongPress={500}'],
 [' ',46,50,'      style={styles.row}'],
 [' ',47,51,'    >'],
 ['@','@@ -88,9 +97,14 @@ function ChevronHit(props: ChevronProps)'],
 [' ',88,97,'  return ('],
 [' ',89,98,'    <Pressable'],
 ['+','',99,'      hitSlop={{ left: 16, right: 12 }}'],
 [' ',90,100,'      onPress={props.onToggle}'],
 ['-',91,'','      style={styles.chevron}'],
 ['+','',101,'      style={[styles.chevron, { width: 44 }]}'],
 [' ',92,102,'    >'],
 ['@','@@ -131,6 +145,11 @@ export const styles = StyleSheet.create('],
 [' ',131,145,'  row: {'],
 [' ',132,146,'    height: 28,'],
 ['+','',147,'    borderRadius: 6,'],
 ['+','',148,'    marginHorizontal: 8,'],
 ['+','',149,'    paddingHorizontal: 8,'],
 [' ',133,150,'    flexDirection: "row",'],
 [' ',134,151,'    alignItems: "center",'],
 ['+','',152,'    gap: 8,'],
 ['+','',153,'  },'],
 [' ',135,154,'  current: { backgroundColor: tokens.accentSoft },']
];
// avoid double braces in template output
DIFF.forEach(r=>{if(r[3])r[3]=r[3].replace('{{','{ {').replace('}}','} }');});
function pgDiff(t,sz,o){o=o||{};return {icon:'pencil',title:'Edit hover-preview.tsx',sub:sub(t,[`<span style="color:${t.ok}">+12</span> <span style="color:${t.er}">−3</span>`,'3 处改动','11 / 15']),
 toolbar:tb(t,sz,[iconBtn(t,sz,'wrap',true),seg(t,sz,['统一','并排'],0)],[copyBtns(t,sz,['path','patch','newc']),iconBtn(t,sz,o.full?'min':'max',!!o.full)]),
 body:pathLine(t,'src/preview/hover-preview.tsx','+12 −3')+diff(t,o.rows||DIFF,{two:o.two})+vbar(t,2,o.full?70:40)};}
const READ6=['import { useCallback, useRef, useState } from "react";','import type { View } from "react-native";','import { measureInWindow } from "../platform/measure";','','export type Anchor = {','  x: number;','  y: number;','  width: number;','  height: number;','};','','// Measures the row in window coordinates so the','// drawer can scroll it into the visible region.','export function usePreviewAnchor(ref: RefObject<View>) {','  const [anchor, setAnchor] = useState<Anchor | null>(null);','  const measure = useCallback(async () => {','    const box = await measureInWindow(ref.current);','    setAnchor(box);','    return box;','  }, [ref]);','  return { anchor, measure };','}'];
function pgRead6(t,sz){return {icon:'file',title:'Read 6 files',sub:sub(t,[stOk(t,'6 个文件'),'340ms','8 / 15']),
 toolbar:tb(t,sz,[pager(t,sz,'2 / 6'),iconBtn(t,sz,'wrap',true)],[copyBtns(t,sz,['path','content']),iconBtn(t,sz,'max',false)]),
 body:pathLine(t,'src/preview/use-preview-anchor.ts','L1–64','file')+code(t,READ6)+vbar(t,2,34)};}
const WIDE=['export function ToolRow({ block, compact, onPressBody, onToggle }: ToolRowProps) {','  const height = compact ? ROW_HEIGHT_COMPACT : ROW_HEIGHT; // 26 / 28','  const title = formatToolTitle(block.kind, block.input, { maxPathSegments: 3 });','  const status = block.running ? <RunningDots /> : <StatusLabel ok={block.ok} ms={block.durationMs} />;','  const canPreview = hasBody(block) && block.kind !== "noop" && !block.merged?.empty;','','  return (','    <View style={[styles.row, { height }, isCurrent(block.id) && styles.current]} testID="tool-row">','      <ChevronHit visible={canPreview} expanded={block.expanded} onToggle={onToggle} />','      <ToolIcon kind={block.kind} size={14} strokeWidth={1.5} color={tokens.foregroundMuted} />','      <Text numberOfLines={1} ellipsizeMode="middle" style={styles.title}>{title}</Text>','      {status}','    </View>','  );','}','','function formatToolTitle(kind: ToolKind, input: ToolInput, opts: FormatOptions): string {','  switch (kind) {','    case "bash": return input.command.split("\\n")[0];','    case "read": return "Read " + shortenPath(input.path, opts.maxPathSegments);'];
function pgWide(t,sz){return {icon:'file',title:'Read src/timeline/tool-row.tsx',mono:1,sub:sub(t,[stOk(t,'96ms'),'1 / 15']),first:1,
 toolbar:tb(t,sz,[iconBtn(t,sz,'wrap',false)],[copyBtns(t,sz,['path','content']),iconBtn(t,sz,'max',false)]),
 body:pathLine(t,'src/timeline/tool-row.tsx','L1–212','file')+code(t,WIDE,{wrap:false,shift:118,start:41})+`<div style="position:absolute;left:52px;right:16px;bottom:6px;height:3px;border-radius:2px;background:${t.s2}"><div style="position:absolute;left:28%;width:42%;top:0;bottom:0;border-radius:2px;background:${t.grab}"></div></div>`};}
const TEST_OUT=[' ✓ src/preview/detent.test.ts (12 tests) 18ms',' ✓ src/preview/use-preview-anchor.test.ts (6 tests) 9ms',' ✓ src/timeline/merge-rows.test.ts (21 tests) 31ms',' ✓ src/timeline/tool-row.test.tsx (14 tests) 212ms',' ✓ src/drawer/gesture-zones.test.ts (9 tests) 15ms',' ✓ src/drawer/follow-output.test.ts (7 tests) 11ms',' ✓ src/drawer/block-nav.test.ts (11 tests) 22ms',' × src/drawer/breakpoints.test.ts (8 tests | 1 failed) 27ms','   × switches to side panel at 960 with 16px hysteresis','     → expected "floating" to be "side"',' ✓ src/hover/hover-preview.test.tsx (17 tests) 388ms',' ✓ src/hover/placement.test.ts (10 tests) 6ms',' ✓ src/copy/copy-targets.test.ts (9 tests) 8ms',' ✓ src/web/touch-callout.test.ts (4 tests) 5ms',' ✓ src/theme/derive-tokens.test.ts (16 tests) 12ms',' ✓ src/timeline/scroll-sync.test.ts (8 tests) 19ms'];
function pgTest(t,sz){return {icon:'term',title:'npm test -- --watch=false',mono:1,sub:sub(t,[stRun(t,'运行中'),'38s','15 / 15']),last:1,
 toolbar:tb(t,sz,[iconBtn(t,sz,'wrap',true)],[copyBtns(t,sz,['sq','out','both']),iconBtn(t,sz,'max',false)]),
 body:outLines(t,TEST_OUT.slice(0,13).map(x=>x),{})+vbar(t,30,22)};}
function followPill(t){return `<div style="position:absolute;left:50%;bottom:14px;transform:translateX(-50%);height:36px;padding:0 14px 0 10px;border-radius:18px;background:${t.s0};border:1px solid ${t.bd};box-shadow:${t.sh};display:flex;align-items:center;gap:6px;font-size:13px;color:${t.fg};white-space:nowrap;z-index:5">${ic('down',16,t.ac)}回到最新<span style="color:${t.mu}">· 24 行新输出</span></div>`;}
const SEARCH=[['src/preview/hover-preview.tsx',[[12,'import { usePreviewAnchor } from "./use-preview-anchor";'],[37,'  const anchor = usePreviewAnchor(rowRef);'],[88,'  usePreviewAnchor.reset(rowRef);']]],['src/preview/use-preview-anchor.ts',[[14,'export function usePreviewAnchor(ref: RefObject<View>) {'],[40,'usePreviewAnchor.reset = (ref) => cache.delete(ref);']]],['src/timeline/tool-row.tsx',[[7,'import { usePreviewAnchor } from "../preview";']]],['src/preview/__tests__/anchor.test.ts',[[3,'import { usePreviewAnchor } from "../use-preview-anchor";'],[19,'  const { result } = renderHook(() => usePreviewAnchor(ref));']]]];
function pgSearch(t,sz){return {icon:'search',title:'Search "usePreviewAnchor"',mono:1,sub:sub(t,[stOk(t,'8 处 · 4 个文件'),'88ms','9 / 15']),
 toolbar:tb(t,sz,[iconBtn(t,sz,'wrap',false)],[copyBtns(t,sz,['query','summary','files']),iconBtn(t,sz,'max',false)]),
 body:searchRes(t,SEARCH,'usePreviewAnchor')};}
const THINK=[['h','抽屉档位怎么定'],['p','短输出撑不满半屏时，固定半屏会留下大片空白，还挡住时间线。改成按内容适配：'],['li','初始高度取内容高度与 0.58 倍可用高度中较小的一个；'],['li','内容超过半屏才提供全屏档；'],['li','全屏档顶部留 8，和任务 sheet 一致。'],['p','切换 Block 时如果两档高度不同，高度用 240ms 过渡，避免跳动。'],['h','手势分区'],['p','把手和头部负责拖动抽屉和横滑切换，正文只负责滚动。正文滚到顶后继续下拉，才把手势交给抽屉。'],['code','const initial = Math.min(fitHeight, avail * 0.58);\nconst full = avail - 8;'],['q','横向滑动在正文里只滚代码，永远不切换 Block。']];
function pgThink(t,sz,raw){return {icon:'bulb',title:'思考',sub:sub(t,['6.2s','10 / 15']),
 toolbar:tb(t,sz,[seg(t,sz,['渲染','原文'],raw?1:0),iconBtn(t,sz,'wrap',!!raw,{dis:!raw})],[copyBtns(t,sz,['plain']),iconBtn(t,sz,'max',false)]),
 body:md(t,THINK)};}
function pgAgent(t,sz){return {icon:'bot',title:'Agent · 梳理手势冲突',sub:sub(t,[stOk(t,'完成'),'48s · 2 次调用','4 / 15']),
 toolbar:tb(t,sz,[seg(t,sz,['对话','结果'],0)],[copyBtns(t,sz,['query','summary','files']),iconBtn(t,sz,'max',false)]),
 body:`<div style="padding:12px 16px 4px"><div style="font-size:11px;color:${t.mu};margin-bottom:4px">任务</div><div style="background:${t.s1};border:1px solid ${t.bd};border-radius:10px;padding:8px 12px;font-size:14px;line-height:21px;color:${t.fg}">列出抽屉在手机上会和哪些手势冲突，给出处理规则。</div></div>
<div style="padding:10px 16px 4px;font-size:14px;line-height:21px;color:${t.fg}">先看宿主列表和侧滑的手势注册方式。</div>
<div style="padding:2px 0">${row(t,{k:'x1',icon:'file',title:'Read host/session/timeline-list.tsx',st:'ok',dur:'40ms'},{})}${row(t,{k:'x2',icon:'search',title:'Search "onStartShouldSetPanResponder"',st:'ok',dur:'31ms'},{})}</div>
${md(t,[['p','有三处会抢手势：'],['li','宿主时间线的纵向滚动：Modal 打开后被蒙层隔开，不再冲突。'],['li','宿主右滑打开 agent 列表：只在屏幕左缘 20 内触发，抽屉头部横滑需要让出这 20。'],['li','正文横向滚动：只有正文可横滚，切换 Block 只认头部。'],['p','建议用 `onStartShouldSetPanResponderCapture` 只在把手和头部抢占。']])}`};}
function pgFetch(t,sz){return {icon:'globe',title:'Fetch reactnative.dev/docs/modal',mono:1,sub:sub(t,[stOk(t,'200'),'1.2s','3 / 15']),
 toolbar:tb(t,sz,[seg(t,sz,['渲染','原文'],0),iconBtn(t,sz,'wrap',false,{dis:1})],[copyBtns(t,sz,['url','result']),iconBtn(t,sz,'max',false)]),
 body:pathLine(t,'https://reactnative.dev/docs/modal','12.4 kB','globe')+md(t,[['h','Modal'],['p','Modal 用于在当前视图之上展示内容。透明 Modal 不会遮住背后的视图。'],['h','常用属性'],['li','`transparent`：背景透明，背后内容可见。'],['li','`onRequestClose`：Android 返回键时调用，需要在这里关闭。'],['li','`animationType`：none、slide 或 fade。'],['li','`statusBarTranslucent`：内容延伸到状态栏下方。'],['h','注意'],['p','Modal 在 iOS 上会占据整个窗口，背后视图的触摸取决于内容的 pointerEvents。']])};}
function pgShort(t,sz){return {icon:'term',title:'git status --short',mono:1,sub:sub(t,[stOk(t,'退出码 0'),'38ms','12 / 15']),
 toolbar:tb(t,sz,[iconBtn(t,sz,'wrap',false,{dis:1})],[copyBtns(t,sz,['sq','out','both'])]),
 body:cmdStrip(t,'git status --short')+outLines(t,[' M src/preview/hover-preview.tsx',' M src/preview/use-preview-anchor.ts','?? src/preview/block-drawer.tsx'])};}
function pgRead1(t,sz){return {icon:'file',title:'Read src/preview/hover-preview.tsx',mono:1,sub:sub(t,[stOk(t,'120ms'),'7 / 15']),
 toolbar:'',body:pathLine(t,'src/preview/hover-preview.tsx','L1–148','file')+code(t,READ6.slice(0,12),{})};}

// ---------- phone host ----------
function phoneStatus(t){return `<div style="position:absolute;top:0;left:0;right:0;height:47px;display:flex;align-items:center;justify-content:space-between;padding:0 30px 0 40px;z-index:60;pointer-events:none"><span style="font-size:15px;font-weight:600;color:${t.fg}">9:41</span><span style="display:flex;align-items:center;gap:5px">${[5,7,9,11].map(h=>`<span style="width:3px;height:${h}px;border-radius:1px;background:${t.fg}"></span>`).join('')}<span style="width:22px;height:11px;border:1.2px solid ${t.fg};border-radius:3px;margin-left:6px;padding:1px;box-sizing:border-box;display:flex"><span style="flex:1;background:${t.fg};border-radius:1px"></span></span></span></div>`;}
function hostTop(t,top,h,o){o=o||{};return `<div style="position:absolute;top:${top}px;left:${o.l||0}px;right:${o.r||0}px;height:${h}px;display:flex;align-items:center;gap:8px;padding:0 8px;border-bottom:1px solid ${t.bd};background:${t.s0}">${iconBtn(t,TS,o.sidebarIcon?'panelL':'chevL',false)}<div style="flex:1;min-width:0"><div style="font-size:15px;font-weight:600;color:${t.fg}">重构 hover 预览</div><div style="font-size:12px;color:${t.mu}">Claude · better-paseo/main</div></div>${iconBtn(t,TS,'more',false)}</div>`;}
function composer(t,h,o){o=o||{};return `<div style="position:absolute;bottom:0;left:${o.l||0}px;right:${o.r||0}px;height:${h}px;border-top:1px solid ${t.bd};background:${t.s0};padding:10px 12px 0;box-sizing:border-box;display:flex;justify-content:center"><div style="flex:1;max-width:${o.max||9999}px;height:44px;border:1px solid ${t.bd};border-radius:22px;display:flex;align-items:center;padding:0 6px 0 16px;gap:8px"><span style="flex:1;font-size:15px;color:${t.mu}">给 agent 发消息…</span><div style="width:32px;height:32px;border-radius:16px;background:${t.s2};display:flex;align-items:center;justify-content:center">${ic('up',16,t.mu)}</div></div></div>`;}
function phone(t,o){
 return `<div style="width:410px;height:864px;border-radius:56px;background:#111113;padding:10px;box-sizing:border-box;flex-shrink:0"><div style="width:390px;height:844px;border-radius:46px;overflow:hidden;position:relative;background:${t.s0};font-family:${SANS}">
${phoneStatus(t)}${hostTop(t,47,56)}
<div style="position:absolute;top:103px;bottom:104px;left:0;right:0;overflow:hidden"><div style="position:absolute;left:0;right:0;bottom:${o.tlb==null?10:o.tlb}px">${timeline(t,(o.rows||R1.slice(1).concat(R2)).slice(-22),o.tl||{})}</div></div>
${composer(t,104)}
${o.scrim?`<div style="position:absolute;inset:0;background:${t.scrim};z-index:10"></div>`:''}
${o.overlay||''}
<div style="position:absolute;top:11px;left:50%;width:120px;height:34px;margin-left:-60px;border-radius:20px;background:#000;z-index:70"></div>
<div style="position:absolute;bottom:8px;left:50%;width:134px;height:5px;margin-left:-67px;border-radius:3px;background:${t.fg};z-index:70"></div>
</div></div>`;}
const HALF=462,FULL=789;
function legend(t){const it=(b,s)=>`<div style="display:flex;align-items:center;gap:8px;font-size:12px;line-height:16px;color:${t.fg}">${b}<span>${s}</span></div>`;const sq=c=>`<span style="width:18px;height:12px;border:1.5px dashed ${c};border-radius:3px;flex-shrink:0"></span>`;
 return `<div style="position:absolute;top:112px;left:12px;right:12px;z-index:30;background:${t.s0};border:1px solid ${t.bd};box-shadow:${t.sh};border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px">${it(sq(ANN),'chevron 区 · 热区 44 × 行高 · 原地展开 / 收起')}${it(sq(t.ac),'行身 · 单击打开详情抽屉')}${it(sq(t.mu),'无正文行 · 无 chevron，单击只有按压态')}${it(`<span style="width:18px;display:flex;justify-content:center">${ic('more',14,t.mu)}</span>`,'长按 500ms · 操作菜单（见 1h）')}</div>`;}
function ctxMenu(t){const it=(n,s,c)=>`<div style="height:44px;display:flex;align-items:center;gap:12px;padding:0 14px;font-size:15px;color:${c||t.fg}">${ic(n,18,t.mu)}${s}</div>`;
 return `<div style="position:absolute;right:16px;top:34px;width:240px;z-index:40;background:${t.s0};border:1px solid ${t.bd};border-radius:12px;box-shadow:${t.sh};overflow:hidden"><div style="padding:8px 14px 6px;font-family:${MONO};font-size:11px;color:${t.mu};border-bottom:1px solid ${t.bd}">npm run build · 2.1s</div>${it('panelB','打开详情')}${it('updown','在时间线中展开')}<div style="height:1px;background:${t.bd}"></div>${it('copy','复制命令')}${it('copy','复制输出')}${it('copy','复制命令和输出')}</div>`;}
function touchDot(x,y,dir){return `<div style="position:absolute;left:${x}px;top:${y}px;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:22px;border:2px solid ${ANN};background:rgba(212,56,13,0.14);z-index:80"></div>${dir?`<div style="position:absolute;left:${x-70}px;top:${y-34}px;z-index:80">${tag('← 横滑 · 进度 46%')}</div>`:''}`;}
function switchDrawer(t){
 const a=pgDiff(t,TS),b=pgBuild(t,TS);
 b.sub=sub(t,[stErr(t,'退出码 1'),'2.1s','6 / 15']);
 const r=pgRead1(t,TS); r.toolbar=tb(t,TS,[iconBtn(t,TS,'wrap',true)],[copyBtns(t,TS,['path','content']),iconBtn(t,TS,'max',false)]);
 return `<div style="position:absolute;left:0;right:0;bottom:0;height:${HALF}px;z-index:20;background:${t.s0};border-radius:16px 16px 0 0;border:1px solid ${t.bd};border-bottom:none;box-shadow:${t.sh};overflow:hidden;display:flex;flex-direction:column">${handle(t)}<div style="flex:1;position:relative;overflow:hidden"><div style="position:absolute;top:0;bottom:34px;left:-180px;width:390px;display:flex;flex-direction:column;opacity:.45">${pane(t,TS,b)}</div><div style="position:absolute;top:0;bottom:34px;left:210px;width:390px;display:flex;flex-direction:column;border-left:1px solid ${t.bd};background:${t.s0}">${pane(t,TS,r)}</div></div></div>`;}

function phoneScreens(t){
 const S=[];
 S.push({id:'1a',label:'时间线 · 可点区域',note:'行身（蓝虚线）单击开抽屉；左侧 chevron 热区 44（橙虚线）原地展开，这里 typecheck 已原地展开。无正文的 kill 行没有 chevron。',
  html:phone(t,{tl:{exp:'tc',annot:{build:1,read1:1,read6:1,grep:1,tc:1,kill:'nobody',commit:1}},overlay:legend(t)})});
 S.push({id:'1b',label:'单击 Bash → 半屏抽屉',note:'高 = 可用高 × 0.58 = 462。蒙层 20%，时间线滚动使当前行（accentSoft 底 + 竖条）留在抽屉上方。错误在输出后分节，退出码进头部。',
  html:phone(t,{tlb:65,tl:{cur:'build'},scrim:1,overlay:drawer(t,pgBuild(t,TS),HALF)})});
 S.push({id:'1c',label:'长 diff · 全屏',note:'上拉把手或点工具栏「全屏」。高 = 可用高 − 8 = 789，工具栏按钮变为「退出全屏」。diff 单列行号，增删行用 diffAdd / diffDel 底色。',
  html:phone(t,{tl:{cur:'edit'},scrim:1,overlay:drawer(t,pgDiff(t,TS,{full:1}),FULL)})});
 S.push({id:'1d',label:'运行中 · 停止跟随',note:'默认跟随到底部；用户上滑离底 > 48 后停止跟随，出现「回到最新」胶囊（带新增行数），点按回到底部并恢复跟随。',
  html:phone(t,{tl:{cur:'test'},scrim:1,overlay:drawer(t,pgTest(t,TS),HALF,{overlay:followPill(t)})})});
 S.push({id:'1e',label:'合并行 · Read 6 files',note:'工具栏左侧分页器 ‹ 2 / 6 ›，只翻合并行内部；头部 ‹ › 切换整个 Block。路径行显示当前文件和行范围。',
  html:phone(t,{tlb:121,tl:{cur:'read6'},scrim:1,overlay:drawer(t,pgRead6(t,TS),HALF)})});
 S.push({id:'1f',label:'关掉换行 · 横向滚动',note:'行号列固定不动，代码区横向滚动，底部出现横向滚动条。正文横滑只滚代码，不切换 Block。',
  html:phone(t,{tlb:93,tl:{cur:'read1'},scrim:1,overlay:drawer(t,pgWide(t,TS),HALF)+`<div style="position:absolute;left:150px;top:640px;z-index:80">${tag('正文横滑 = 滚代码')}</div>`+touchDot(250,610)})});
 S.push({id:'1g',label:'切换到下一个 Block（进行中）',note:'在头部横滑，页面跟手移动；松手时位移 > 25% 宽或速度 > 0.5px/ms 即提交。时间线同步滚动，标记从 build 移到 hover-preview。',
  html:phone(t,{tlb:93,tl:{cur:'read1',ghost:'build'},scrim:1,overlay:switchDrawer(t)+touchDot(230,428,1)})});
 S.push({id:'1h',label:'长按 · 操作菜单',note:'长按 500ms（移动 < 10px）弹菜单，行保持按压底色。复制项与工具栏一致（见 5.9）。图片行见 1o；无正文行只有「复制标题」。',
  html:phone(t,{tl:{press:'build',extra:{build:ctxMenu(t)}},scrim:1})});
 return S;
}
function landscape(t){
 const p=pgBuild(t,TS);
 return `<div style="width:864px;height:410px;border-radius:56px;background:#111113;padding:10px;box-sizing:border-box"><div style="width:844px;height:390px;border-radius:46px;overflow:hidden;position:relative;background:${t.s0};font-family:${SANS}">
${hostTop(t,0,52,{l:47,r:0})}
<div style="position:absolute;top:52px;bottom:72px;left:47px;right:0;overflow:hidden"><div style="position:absolute;left:0;right:0;bottom:8px">${timeline(t,R2.slice(0,9),{cur:'build'})}</div></div>
${composer(t,72,{l:47})}
${sidePanel(t,p,{w:400,top:0,safe:21})}
<div style="position:absolute;left:10px;top:50%;width:34px;height:120px;margin-top:-60px;border-radius:20px;background:#000;z-index:70"></div>
<div style="position:absolute;bottom:6px;left:50%;width:134px;height:5px;margin-left:-67px;border-radius:3px;background:${t.fg};z-index:70"></div>
</div></div>`;}
