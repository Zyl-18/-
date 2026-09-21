'use strict';
/* 一、纹样与线材。坐标是网眼计线坐标；原模板的色彩与坐标不变，正面方向独立于背面走线。
   两款为传统花卉题材的教学简化创作，不是历史绣品的精确复刻。 */
// 正面针脚、底布与命中检测共用一套坐标；Canvas的负角度指向右上。
const GRID = Object.freeze({ step: 27, x: 42, y: 13 });
const STITCH_ANGLE = -Math.PI / 4;
const STITCH_LENGTH = Math.SQRT2 * GRID.step;
const COLORS = {
  ivory: { name: '玉兰米白', hex: '#e9dfbf', light: '#fff7dc', dark: '#b4a380' },
  red: { name: '胭脂暗红', hex: '#96594f', light: '#c28a76', dark: '#653c35' },
  green: { name: '墨绿', hex: '#586c50', light: '#92a080', dark: '#344534' },
  brown: { name: '深棕', hex: '#796047', light: '#b49b75', dark: '#4e4030' },
  ochre: { name: '赭石', hex: '#b28b50', light: '#dbc095', dark: '#80613c' }
};
function makePattern(id, name, culture, difficulty, groups) {
  const points = [];
  groups.forEach(([color, coords]) => coords.forEach(([x,y]) => {
    points.push({ id: points.length, x, y, color, angle: STITCH_ANGLE, length: STITCH_LENGTH });
  }));
  const palette = [...new Set(points.map(p => p.color))];
  const routes = palette.map(color => referenceRoute(points.filter(p => p.color === color)));
  const reference = routes.reduce((sum, route) => sum + 8 + route.slice(1).reduce((n,p,i) => n + Math.min(8, distance(route[i],p)), 0), 0);
  return { id, name, culture, difficulty, points, palette, routes, reference };
}
const PATTERNS = {
  magnolia: makePattern('magnolia', '玉兰折枝', '以玉兰的舒展花瓣与折枝构图为意。羊毛绒线覆于网眼底布，疏密之间见花姿。教学简化纹样。', '入门 · 三色', [
    ['ivory', [[7,6],[7,7],[8,5],[8,6],[8,7],[9,5],[9,6],[9,7],[10,6],[10,7]], -1.38, 34],
    ['ivory', [[5,8],[6,8],[6,9],[7,8],[7,9],[8,8],[8,9],[9,8],[9,9]], -.67, 33],
    ['ivory', [[10,8],[10,9],[11,7],[11,8],[11,9],[12,7],[12,8],[13,6],[13,7]], -2.18, 34],
    ['ivory', [[16,7],[16,8],[17,6],[17,7],[17,8],[18,7]], -1.25, 33],
    ['green', [[10,13],[9,13],[8,12],[7,12],[6,11],[7,11],[8,11],[9,12]], .65, 34],
    ['green', [[13,15],[14,14],[15,13],[16,12],[16,13],[15,14],[14,15]], -.7, 34],
    ['brown', [[9,10],[10,11],[11,12],[12,13],[12,14],[12,15],[11,16],[11,17],[11,18],[13,12],[14,11],[15,10],[16,9]], -1.0, 31]
  ]),
  begonia: makePattern('begonia', '如意海棠', '海棠花团与如意曲枝相映，取温润、圆满之意。以花瓣、花心和回转叶枝练习同色走线。教学简化纹样。', '进阶 · 四色', [
    ['red', [[10,5],[11,5],[12,5],[10,6],[11,6],[12,6]], -1.5, 32],
    ['red', [[8,7],[9,7],[8,8],[9,8],[8,9],[9,9]], -.3, 32],
    ['red', [[13,7],[14,7],[13,8],[14,8],[13,9],[14,9]], .3, 32],
    ['red', [[10,10],[11,10],[12,10],[10,11],[11,11],[12,11]], -1.5, 32],
    ['ochre', [[10,8],[11,7],[11,8],[11,9],[12,8]], -.9, 27],
    ['green', [[6,12],[7,12],[7,13],[8,13],[8,14],[9,14]], .7, 34],
    ['green', [[15,11],[16,10],[17,10],[16,11],[17,11],[15,12]], -.55, 33],
    ['green', [[13,17],[14,17],[14,18],[15,18],[16,17],[16,16]], -.65, 32],
    ['brown', [[11,12],[11,13],[11,14],[12,15],[13,15],[14,15],[15,14],[16,14],[17,15],[17,16],[17,17],[17,18],[16,19],[15,19],[14,19],[13,18]], -.8, 30]
  ])
};
function distance(a,b) { return Math.max(Math.abs(a.x-b.x), Math.abs(a.y-b.y)); }
// 多起点最近邻路线提供可复现的参考值；大于8的移动改为收针再起针。
function referenceRoute(points) {
  let best = null, cost = Infinity;
  points.forEach(first => {
    const route = [first], left = points.filter(p => p !== first);
    while (left.length) {
      left.sort((a,b) => distance(route[route.length-1],a)-distance(route[route.length-1],b) || a.id-b.id);
      route.push(left.shift());
    }
    const n = route.slice(1).reduce((sum,p,i) => sum + Math.min(8,distance(route[i],p)),0);
    if(n < cost) { cost = n; best = route; }
  });
  return best;
}
/* 二、状态与计线。只有成功操作写入历史，撤销恢复完整快照。 */
const $ = id => document.getElementById(id);
let pattern = PATTERNS.magnolia, state, history = [], animation = null, focusPoint = null, aiTimer = null, version = 0;
const canvas = $('embroidery'), ctx = canvas.getContext('2d');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/* 本地偏好与完整通关纪录。不依赖网络；存储被禁用时保留本次会话功能。 */
const STORAGE = { sound: 'wool.sound.v1', best: 'wool.best.v1' };
let storageAvailable = true;
function readLocal(key) {
  let raw;
  try { raw=window.localStorage.getItem(key); }
  catch (_) { storageAvailable=false;return null; }
  try { return JSON.parse(raw); }
  catch (_) { return null; } // 损坏的旧值视为未保存，不妨碍后续写入。
}
function writeLocal(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (_) { storageAvailable = false; return false; }
}
function validRecords(value) {
  const clean = {};
  if(value && typeof value === 'object') Object.keys(PATTERNS).forEach(id => {
    if(Number.isSafeInteger(value[id]) && value[id] > 0) clean[id] = value[id];
  });
  return clean;
}
let bestRecords = validRecords(readLocal(STORAGE.best)), resultComparison = '';
const sound = { enabled: readLocal(STORAGE.sound) === true, context: null, voice: null, last: -Infinity, unavailable: false };
function updateSoundButton() {
  $('sound-toggle').textContent = sound.unavailable ? '音效不可用 · 点击重试' : sound.enabled ? '音效：开' : '音效：关';
  $('sound-toggle').setAttribute('aria-pressed', String(sound.enabled));
  $('sound-toggle').setAttribute('aria-label', sound.unavailable ? '音效不可用，点击重试' : sound.enabled ? '音效已开启，点击静音' : '音效已关闭，点击开启');
}
// 仅真实点击、触摸或键盘激活后初始化音频。恢复已保存偏好也不自动播放。
function unlockSound(event) {
  if(!event.isTrusted || !sound.enabled) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if(!Audio) throw new Error('Audio unavailable');
    if(!sound.context) sound.context = new Audio();
    if(sound.context.state === 'suspended') sound.context.resume().catch(() => { sound.unavailable=true; updateSoundButton(); });
    sound.unavailable=false;
  } catch (_) { sound.unavailable=true; }
  updateSoundButton();
}
function stopSound() {
  if(!sound.voice) return;
  const { source, gain } = sound.voice;
  try {
    const now = sound.context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0, now, .004);
    source.stop(now + .02);
  } catch (_) { /* 已结束的声音无需再次停止。 */ }
  sound.voice=null;
}
function playSound(kind) {
  const audio=sound.context;
  if(!sound.enabled || sound.unavailable || !audio || audio.state !== 'running') return;
  const now=audio.currentTime;
  // 最多一段有效音效；快速连点不排队，完成音可替换上一针的声音。
  if(kind!=='complete' && now-sound.last<.075) return;
  stopSound(); sound.last=now;
  try {
    const gain=audio.createGain(); gain.connect(audio.destination);
    const duration=kind==='complete'?.34:kind==='stitch'?.075:.12;
    let source, filter;
    if(kind==='stitch') {
      const buffer=audio.createBuffer(1, Math.ceil(audio.sampleRate*duration), audio.sampleRate);
      const data=buffer.getChannelData(0);
      for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*.45;
      source=audio.createBufferSource();source.buffer=buffer;
      filter=audio.createBiquadFilter();filter.type='bandpass';filter.frequency.value=1300;filter.Q.value=.7;
      source.connect(filter);filter.connect(gain);
    } else {
      source=audio.createOscillator();source.type='sine';
      source.frequency.setValueAtTime(kind==='change'?390:kind==='finish'?260:440,now);
      source.frequency.exponentialRampToValueAtTime(kind==='complete'?554:kind==='change'?330:220,now+duration*.65);
      source.connect(gain);
    }
    gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(kind==='stitch'?.09:.035,now+.012);
    gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
    const voice={source,gain};sound.voice=voice;
    source.onended=()=>{ source.disconnect(); if(filter)filter.disconnect();gain.disconnect();if(sound.voice===voice)sound.voice=null; };
    source.start(now);source.stop(now+duration+.01);
  } catch (_) { stopSound();sound.unavailable=true;updateSoundButton(); }
}
function toggleSound(event) {
  if(sound.unavailable) { sound.unavailable=false;sound.enabled=true; }
  else sound.enabled=!sound.enabled;
  writeLocal(STORAGE.sound,sound.enabled);updateBest();
  if(sound.enabled) { unlockSound(event);playSound('change'); } else stopSound();
  updateSoundButton();
}
function updateBest() {
  const best=bestRecords[pattern.id];
  $('personal-best').textContent=best ? `个人最佳：${best} 单位` : '个人最佳：尚无完整通关纪录';
  $('best-note').textContent=storageAvailable ? '仅记录本浏览器的完整手作挑战；演示模式不更新纪录。' : '本地存储不可用：纪录与音效偏好仅在本次会话保留。';
}
function recordBest() {
  // 必须在最终收针之后记录；未完成、演示和重复查看成绩均不会刷新纪录。
  if(!state.submitted || state.done.length!==pattern.points.length) return;
  const saved=validRecords(readLocal(STORAGE.best));
  Object.keys(saved).forEach(id=>{ bestRecords[id]=Math.min(bestRecords[id] || Infinity,saved[id]); });
  const old=bestRecords[pattern.id];
  if(state.demo) { resultComparison=`本次用线 ${state.length} 单位。${old ? `手作个人最佳 ${old} 单位。` : '尚无手作通关纪录。'}演示模式不更新个人最佳。`;return; }
  if(!old) resultComparison=`本次用线 ${state.length} 单位，建立首个个人最佳。下次试试再省一单位。`;
  else if(state.length<old) resultComparison=`新个人最佳！本次 ${state.length} 单位，比此前最佳 ${old} 单位节省 ${old-state.length} 单位。`;
  else if(state.length===old) resultComparison=`本次 ${state.length} 单位，追平个人最佳 ${old} 单位。再挑战一条更紧凑的路线吧。`;
  else resultComparison=`本次 ${state.length} 单位，个人最佳 ${old} 单位；还可挑战节省 ${state.length-old} 单位。`;
  if(!old || state.length<old) { bestRecords[pattern.id]=state.length;writeLocal(STORAGE.best,bestRecords); }
  if(!storageAvailable) resultComparison+=' 本地存储不可用，纪录仅保留于本次会话。';
}
function newState() { return { color: pattern.palette[0], done: [], active: null, length:0, starts:0, ends:0, jumps:0, lastDistance:0, isolatedPeak:0, demo:false, submitted:false }; }
function snapshot() { history.push(JSON.parse(JSON.stringify(state))); }
function pending(color = state.color) { return pattern.points.filter(p => p.color === color && !state.done.includes(p.id)); }
function closeThread() { if(state.active !== null) { state.length += 3; state.ends++; state.active = null; } }
function invalidateAI() { version++; clearTimeout(aiTimer); $('analyze').disabled = false; $('analyze').textContent = 'AI分析当前走线 ↗'; }
function changed(message) { invalidateAI(); $('ai-output').textContent = '走线状态已更新。点击分析，查看当前针位与剩余区域的建议。'; update(); if(message) feedback(message); }
function selectColor(color) {
  if(state.submitted || color === state.color) return;
  snapshot(); const hadThread = state.active !== null; closeThread(); state.color = color; state.lastDistance = 0;
  playSound('change');
  changed(`已选择${COLORS[color].name}${hadThread ? '，上一段走线已收针（+3单位）' : ''}。`);
}
function isolatedCount() {
  return pending().filter(p => !pending().some(q => p.id !== q.id && distance(p,q) === 1)).length;
}
function stitch(id, options = {}) {
  if(state.submitted) return false;
  const p = pattern.points.find(p => p.id === id);
  if(!p) { feedback('请点按纹样中的淡色针脚。',true); return false; }
  if(state.done.includes(id)) { feedback('这一针已经完成，不会重复计分或消耗绒线。'); return false; }
  if(p.color !== state.color) { feedback(`该位置需要使用其他颜色：${COLORS[p.color].name}。`,true); return false; }
  if(!options.noHistory) snapshot();
  let message;
  if(state.active === null) { state.length += 5; state.starts++; state.lastDistance=0; message='起针 +5单位。沿着同色区域继续走线。'; }
  else {
    const d = distance(pattern.points[state.active],p); state.length += d; state.lastDistance=d;
    if(d>1) { state.jumps++; message=`跨格移动 ${d}格，本次增加 ${d}个绒线单位。`; }
    else message='连续走线中 · 同色相邻，本次仅 +1单位。';
  }
  state.active=id; state.done.push(id); state.isolatedPeak=Math.max(state.isolatedPeak,isolatedCount());
  if(!options.silent) {
    playSound(state.done.length === pattern.points.length ? 'complete' : 'stitch');
    animation = reducedMotion ? null : {id, start:performance.now()};
    changed(state.done.length === pattern.points.length ? '纹样已完整绣成。请提交作品，收针后查看最终评价。' : message);
    if(animation) requestAnimationFrame(draw);
  }
  return true;
}
function finish() {
  if(state.submitted || state.active === null) return;
  snapshot(); closeThread(); playSound('finish'); state.lastDistance=0; changed('已结束当前走线，收针 +3单位。');
}
function undo() {
  if(!history.length || state.submitted) return;
  state = history.pop(); animation=null; changed('已撤销上一步，针脚、线长与操作次数同步恢复。');
}
function reset(id = pattern.id) {
  stopSound();resultComparison='';invalidateAI(); pattern=PATTERNS[id]; state=newState(); history=[]; animation=null; focusPoint=null;
  $('pattern').value=id; if($('result').open) $('result').close();
  $('ai-output').textContent='先选一缕线，落下第一针。分析后，这里会给出与你当前路线相关的建议。';
  makePalette(); update(); feedback('从一枚淡淡的落针点开始。');
}
/* 三、评分。完成度使用0～1的比例；初始省线分严格为0。 */
function scores(s = state) {
  const completion = s.done.length / pattern.points.length;
  const completionScore = completion * 70;
  const savingScore = s.length > 0 ? Math.min(30, pattern.reference / s.length * 30) : 0;
  return { completion, completionScore, savingScore, total: Math.round(completionScore+savingScore) };
}
function evaluation() {
  const ratio = state.length / pattern.reference;
  let text = ratio <= 1.1 ? '走线规划优秀，相同颜色区域衔接自然，绒线消耗接近参考最优水平。' : ratio <= 1.3 ? '走线规划较为合理，但仍有少量重复起针或跨格，可以进一步减少绒线消耗。' : '绣线消耗过多，你可以优化走线方式，优先连续完成相邻的同色区域。';
  if(state.jumps > 5) text += ` 本次跨格${state.jumps}次，建议从距离更近的同色针脚开始。`;
  if(state.starts > pattern.palette.length+2) text += ` 起针${state.starts}次，建议完成一片连续区域后再更换颜色。`;
  if(state.isolatedPeak >= 4) text += ` 走线中曾留下${state.isolatedPeak}个同色孤立点，后续可先规划这些点的衔接。`;
  return text;
}
function submit() {
  const left = pattern.points.length-state.done.length;
  if(left) { feedback(`还剩 ${left}个针脚；完整绣完后才能通关。`,true); return; }
  if(!state.submitted) { const hadThread=state.active!==null;closeThread();if(hadThread)playSound('finish');state.submitted=true;recordBest();invalidateAI();update(); }
  const score=scores();
  $('result-pattern').textContent=`${pattern.name}${state.demo ? ' · 演示模式' : ''}`;
  $('final-score').textContent=score.total;
  const items=[['图案完成度','100%'],['实际用线',`${state.length} 单位`],['参考最省线',`${pattern.reference} 单位`],['起针次数',state.starts],['收针次数',state.ends],['跨格次数',state.jumps],['完成度得分',score.completionScore.toFixed(1)],['省线得分',score.savingScore.toFixed(1)]];
  $('result-metrics').replaceChildren(...items.map(([label,value]) => { const div=document.createElement('div'), dt=document.createElement('dt'), dd=document.createElement('dd'); dt.textContent=label; dd.textContent=value; div.append(dt,dd); return div; }));
  $('best-comparison').textContent=resultComparison;
  $('evaluation').textContent=evaluation(); if(!$('result').open) $('result').showModal();
  feedback('通关成功。作品已收针，最终成绩已生成。');
}
/* 演示沿可行参考路线落针，保留最后5针。所有消耗仍由相同计线函数产生。 */
function demo() {
  if(state.submitted) return;
  if(pattern.points.length-state.done.length <= 5) { feedback('当前已接近完成，请亲手完成剩余针脚。'); return; }
  snapshot(); state.demo=true;
  const target=pattern.points.length-5;
  for(const route of pattern.routes) {
    for(const p of route) {
      if(state.done.length>=target) break;
      if(state.done.includes(p.id)) continue;
      if(state.color!==p.color) { closeThread(); state.color=p.color; }
      if(state.active!==null && distance(pattern.points[state.active],p)>8) closeThread();
      stitch(p.id,{noHistory:true,silent:true});
    }
    if(state.done.length>=target) break;
  }
  animation=null; changed('演示模式：已保留5针，所有起针、收针和跨格均按正常规则计线。');
}
/* 四、规则模拟AI：以当前邻域、连通区域、孤立点和实际消耗生成建议。 */
function components(points) {
  const unseen = new Set(points.map(p=>p.id)), groups=[];
  while(unseen.size) {
    const first=unseen.values().next().value, group=[], queue=[first]; unseen.delete(first);
    while(queue.length) { const id=queue.shift(); group.push(id); points.filter(p=>unseen.has(p.id) && distance(pattern.points[id],p)===1).forEach(p=>{ unseen.delete(p.id); queue.push(p.id); }); }
    groups.push(group);
  }
  return groups.sort((a,b)=>b.length-a.length);
}
function analyzeState() {
  const left=pattern.points.length-state.done.length, current=pending(), parts=components(current), tips=[];
  if(!left) return `纹样已完成100%，剩余0针。${state.active!==null ? '提交时将自动收针，增加3单位。' : ''}${evaluation()}`;
  const active=state.active===null ? null : pattern.points[state.active];
  const adjacent=active ? current.filter(p=>distance(active,p)===1) : [];
  if(adjacent.length) tips.push(`当前${COLORS[state.color].name}区域仍有${adjacent.length}个相邻针脚，建议继续连续走线，不要立即收针。`);
  else if(active && current.length) { const near=[...current].sort((a,b)=>distance(active,a)-distance(active,b))[0], d=distance(active,near); tips.push(`最近的同色针脚距当前${d}格。${d>8?'重新起收共8单位，比直接跨格更省。':'继续走线可避免额外起收的8单位。'}`); }
  if(parts[0]?.length>1) tips.push(`${COLORS[state.color].name}还有一片${parts[0].length}针的连续区域，可优先连绣。`);
  const isolated=parts.filter(g=>g.length===1);
  if(isolated.length) { const p=pattern.points[isolated[0][0]], area=`${p.y<12?'上':'下'}${p.x<12?'左':'右'}方`; tips.push(`${area}等位置共有${isolated.length}个同色孤立针脚，结束走线前留意它们的衔接。`); }
  if(state.lastDistance>1) tips.push(`最近一次跨格为${state.lastDistance}格，可尝试从距离更近的同色针脚开始。`);
  if(state.starts>pattern.palette.length+1) tips.push(`你已经进行了${state.starts}次起针、${state.ends}次收针，建议绣完一片连续区域后再换色。`);
  if(state.length>pattern.reference*1.3) tips.push('当前用线已明显高于完整参考路线，请减少跨格与重复起收。');
  else if(state.done.length>0) tips.push(`当前已用${state.length}单位，完整参考路线为${pattern.reference}单位；完成前不能仅凭总量判断是否省线。`);
  const ranked=pattern.palette.map(color=>({color,groups:components(pending(color))})).filter(v=>v.groups.length).sort((a,b)=>b.groups[0].length-a.groups[0].length);
  if(!adjacent.length && ranked.length) tips.push(`建议${current.length?'规划后继续或选择':'下一步选择'}${COLORS[ranked[0].color].name}，其最大连续区域还有${ranked[0].groups[0].length}针。`);
  tips.push(`完成度${Math.round(scores().completion*100)}%，剩余${left}针。`);
  return tips.join('\n');
}
function analyze() {
  invalidateAI(); const token=version; $('analyze').disabled=true; $('analyze').textContent='正在分析…'; $('ai-output').textContent='AI正在分析走线路径、同色邻域与起收针记录…';
  aiTimer=setTimeout(()=>{ if(token!==version)return; $('ai-output').textContent=analyzeState(); $('analyze').disabled=false; $('analyze').textContent='AI分析当前走线 ↗'; },650);
}
/* 五、Canvas材料绘制。确定性随机数保证重绘、撤销和缩放时纤维不会闪烁。 */
function randomSeed(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }
const fabric=document.createElement('canvas'); fabric.width=720; fabric.height=680;
function makeFabric() {
  const c=fabric.getContext('2d'), rand=randomSeed(9281), step=GRID.step;
  c.clearRect(0,0,720,680);
  // 浅米灰是透过孔隙所见的底色。每27单位一个网眼，不再用6单位密纹和随机噪点。
  c.fillStyle='#c8c6bc';c.fillRect(0,0,720,680);
  function thread(x,y,horizontal,length,width,over=false) {
    c.save();c.translate(x,y);if(!horizontal)c.rotate(Math.PI/2);
    c.lineCap='butt';
    const bend=(rand()-.5)*.7;
    function fiber(offset,w,color) {
      c.beginPath();c.moveTo(-length/2,offset);
      c.bezierCurveTo(-length/6,offset+bend,length/6,offset-bend,length/2,offset);
      c.strokeStyle=color;c.lineWidth=w;c.stroke();
    }
    // 宽纱束的柔和暗边、高光与少量平行纤维共同形成材质，孔隙保持可辨识。
    fiber(.7,width+1.2,over?'#b8b7ae':'#bebdb4');
    fiber(0,width,over?'#e8e6dc':'#dfded4');
    fiber(-width*.25,2.5,'#f2f0e7');fiber(width*.27,2,'#d1d0c6');
    if(!compactFabric) { fiber(-1.2,.9,'#f3f1e8');fiber(2,.8,'#cccbbf'); }
    c.restore();
  }
  // 经纬纱中心位于针脚中心；四角网眼位于±半格，恰为统一斜针的进出针孔。
  for(let y=GRID.y-step;y<680+step;y+=step) thread(360,y,true,720,16+rand()*.8);
  for(let x=GRID.x-step*2;x<720+step;x+=step) thread(x,340,false,680,16+rand()*.8);
  for(let row=-1;GRID.y+row*step<680+step;row++) {
    for(let col=-2;GRID.x+col*step<720+step;col++) {
      const horizontal=(row+col)%2===0;
      thread(GRID.x+col*step,GRID.y+row*step,horizontal,step-2,16+rand()*.8,true);
    }
  }
}
function position(p) { return {x: GRID.x+p.x*GRID.step, y: GRID.y+p.y*GRID.step}; }
// 小屏减少亚像素细纤维，仍保留同一网眼间距与坐标，避免高频纹理干扰。
let compactFabric=false;
function resizeFabric() {
  compactFabric=canvas.getBoundingClientRect().width<480;
  makeFabric();draw();
}
function yarn(p, ghost=false, growth=1) {
  const pos=position(p), color=COLORS[p.color], rand=randomSeed(41+p.id*379), len=STITCH_LENGTH;
  ctx.save();ctx.translate(pos.x,pos.y);ctx.rotate(STITCH_ANGLE);
  // 生长从左下针孔向右上针孔展开，与点击先后、背面移动向量无关。
  ctx.translate(-len/2,0);ctx.scale(growth,1);ctx.translate(len/2,0);
  ctx.globalAlpha=ghost ? (p.color===state.color ? .36:.17) : 1;
  const bend=(rand()-.5)*5;
  function strand(offset,width,shade) { ctx.beginPath();ctx.moveTo(-len/2,offset);ctx.bezierCurveTo(-len/5,offset+bend, len/4,offset+bend+1,len/2,offset);ctx.lineWidth=width;ctx.strokeStyle=shade;ctx.lineCap='round';ctx.stroke(); }
  if(!ghost){ctx.shadowColor='#3b2b2080';ctx.shadowBlur=4;ctx.shadowOffsetY=3;strand(0,13,color.dark);ctx.shadowColor='transparent';}
  strand(0,12,color.hex);strand(-1.8,7,color.light);strand(1.8,4,color.hex);
  // 毛束内部纤维：轻弯、有粗细差和局部高光，不以色块填充。
  for(let i=0;i<24;i++){const offset=(rand()-.5)*12;strand(offset,.35+rand()*.65, i%3===0 ? color.dark : i%3===1 ? color.light : color.hex);}
  if(!ghost)for(let i=0;i<23;i++){const x=(rand()-.5)*len,y=(rand()>.5?1:-1)*(4+rand()*3);ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x+rand()*4-2,y*1.4,x+rand()*7-3,y*1.45);ctx.strokeStyle=i%2?color.light:color.hex;ctx.globalAlpha=.35;ctx.lineWidth=.55;ctx.stroke();}
  ctx.restore();
}
function draw(now=performance.now()) {
  ctx.clearRect(0,0,720,680);ctx.drawImage(fabric,0,0);
  // 未绣针脚使用低透明度纤维虚影，针孔标示点击区域。
  pattern.points.filter(p=>!state.done.includes(p.id)).forEach(p=>{
    yarn(p,true);const q=position(p);ctx.fillStyle=p.color===state.color?'#574b3c90':'#66523d40';ctx.beginPath();ctx.arc(q.x,q.y,2,0,Math.PI*2);ctx.fill();
  });
  state.done.forEach(id=>{const growth=animation?.id===id ? Math.min(1,Math.max(.05,(now-animation.start)/220)):1;yarn(pattern.points[id],false,growth);});
  if(state.active!==null){const q=position(pattern.points[state.active]);ctx.strokeStyle='#423d31';ctx.lineWidth=1.3;ctx.beginPath();ctx.arc(q.x,q.y,12,0,Math.PI*2);ctx.stroke();}
  if(focusPoint!==null){const q=position(pattern.points[focusPoint]);ctx.strokeStyle='#8a453b';ctx.lineWidth=2;ctx.setLineDash([3,3]);ctx.beginPath();ctx.arc(q.x,q.y,17,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
  if(animation){if(now-animation.start<220)requestAnimationFrame(draw);else animation=null;}
}
/* 六、界面与鼠标、触摸、键盘。Pointer事件同时覆盖鼠标与触屏。 */
function makePalette() {
  $('palette').replaceChildren(...pattern.palette.map(color=>{
    const button=document.createElement('button');button.className='swatch-button';button.dataset.color=color;
    const swatch=document.createElement('span');swatch.className='swatch';swatch.style.setProperty('--yarn',COLORS[color].hex);swatch.setAttribute('aria-hidden','true');
    const name=document.createElement('span');name.textContent=COLORS[color].name;
    const count=document.createElement('span');count.className='count';button.append(swatch,name,count);button.addEventListener('click',()=>selectColor(color));return button;
  }));
}
function update() {
  const s=scores(), remaining=pattern.points.length-state.done.length;
  const values={length:state.length,starts:state.starts,ends:state.ends,jumps:state.jumps,done:state.done.length,remaining,score:s.total,reference:pattern.reference,percent:`${Math.round(s.completion*100)}%`};
  Object.entries(values).forEach(([id,v])=>$(id).textContent=v);
  updateBest();
  $('progress').value=s.completion*100;$('live-color').textContent=COLORS[state.color].name;$('pattern-title').textContent=pattern.name;$('culture').textContent=pattern.culture;$('difficulty').textContent=pattern.difficulty;$('target-count').textContent=`${pattern.points.length}针 · 约3–6分钟`;
  $('mode-badge').textContent=state.demo?'演示模式 · 正常计线':'手作挑战';
  document.querySelectorAll('.swatch-button').forEach(button=>{const color=button.dataset.color;button.setAttribute('aria-pressed',String(state.color===color));button.querySelector('.count').textContent=pending(color).length;button.setAttribute('aria-label',`${COLORS[color].name}，剩余${pending(color).length}针${state.color===color?'，当前已选':''}`);button.disabled=state.submitted;});
  $('undo').disabled=!history.length||state.submitted;$('finish').disabled=state.active===null||state.submitted;$('demo').disabled=state.submitted;
  $('submit').innerHTML=state.submitted?'查看最终成绩 <span>→</span>':'提交作品 <span>→</span>';
  canvas.setAttribute('aria-label',`${pattern.name}绒绣画布，${COLORS[state.color].name}，已完成${state.done.length}针，共${pattern.points.length}针`);draw();
}
let feedbackTimer;
function feedback(text,invalid=false) { $('feedback').textContent=text;if(invalid){$('frame').classList.add('invalid');clearTimeout(feedbackTimer);feedbackTimer=setTimeout(()=>$('frame').classList.remove('invalid'),650);} }
canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0 && event.pointerType==='mouse')return;
  const box=canvas.getBoundingClientRect(), x=(event.clientX-box.left)*720/box.width, y=(event.clientY-box.top)*680/box.height;
  // 最近中心命中，避免移动端相邻针脚的触摸区域相互遮挡。
  const nearest=pattern.points.map(p=>({p,d:Math.hypot(position(p).x-x,position(p).y-y)})).sort((a,b)=>a.d-b.d)[0];
  focusPoint=null; if(nearest.d<=19)stitch(nearest.p.id);else feedback('请点按纹样中的淡色针脚。',true);
});
canvas.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(event.key))return;
  event.preventDefault();
  if(focusPoint===null)focusPoint=(pending()[0] || pattern.points[0]).id;
  else if(event.key.startsWith('Arrow')){
    const p=pattern.points[focusPoint], vector={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    const candidates=pattern.points.filter(q=>(q.x-p.x)*vector[0]+(q.y-p.y)*vector[1]>0).sort((a,b)=>{
      const weight=q=>Math.hypot(q.x-p.x,q.y-p.y)+Math.abs((q.x-p.x)*vector[1]-(q.y-p.y)*vector[0])*2;
      return weight(a)-weight(b);
    });if(candidates.length)focusPoint=candidates[0].id;
  }
  if(event.key==='Enter'||event.key===' ')stitch(focusPoint);
  else{const p=pattern.points[focusPoint];feedback(`目标第${p.id+1}针，${COLORS[p.color].name}，${state.done.includes(p.id)?'已完成':'未完成'}。按Enter落针。`);}
  draw();
});
// 捕获阶段只负责解锁音频，实际发声由成功操作触发；无效落针不发声。
document.addEventListener('pointerdown',unlockSound,{capture:true,passive:true});
document.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')unlockSound(event);},{capture:true});
$('sound-toggle').addEventListener('click',toggleSound);
$('pattern').addEventListener('change',e=>reset(e.target.value));
$('undo').addEventListener('click',undo);$('finish').addEventListener('click',finish);
$('restart').addEventListener('click',()=>{if(window.confirm('重新开始会清空当前针脚和用线记录，确定吗？'))reset();});
$('demo').addEventListener('click',demo);$('analyze').addEventListener('click',analyze);$('submit').addEventListener('click',submit);
$('again').addEventListener('click',()=>{if(window.confirm('确定重新挑战当前纹样吗？'))reset();});
$('next-pattern').addEventListener('click',()=>reset(pattern.id==='magnolia'?'begonia':'magnolia'));
$('close-result').addEventListener('click',()=>$('result').close());
makeFabric();reset();updateSoundButton();
if(window.ResizeObserver) new ResizeObserver(resizeFabric).observe(canvas);
else window.addEventListener('resize',resizeFabric);
resizeFabric();
