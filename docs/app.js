/* ============================================================
 * 班级排座位 · 在线版 v2（GitHub Pages + 实时同步）
 * 功能：登录（学生/班主任/管理员）→ 座位显示 → 换座申请与同意
 *       班主任规则（不可同桌/左右护法/强制互换）+ 管理员管理
 * 同步：所有操作写 GitHub 仓库 state.json，多端轮询实时同步
 * ============================================================ */
'use strict';

// ---------- 配置 ----------
const SYNC = {
  owner: 'tangyuan9325',
  repo: 'classroom-seat-arranger',
  branch: 'main',
  path: 'docs/data/state.json',
  rawBase: 'https://raw.githubusercontent.com',
  apiBase: 'https://api.github.com'
};
const pagesUrl = `https://${SYNC.owner}.github.io/${SYNC.repo}/`;
// 写凭据（混淆存储，运行时还原）。⚠️ 公开仓库任何人可提取，见 docs/README
const WRITE_TOKEN = atob('Z09zUXgzS1Z4enhhMDRaY2FybVkySDc5c3duTExUUmFITlFMX3BoZw==').split('').reverse().join('');
const DEFAULT_TEACHER = '崔孝禹';
const DEFAULT_ADMIN_HASH = 'aaffebecec560fec66e75f24062224ffa4e07696d2ae9a1fee3707c3f8fd9373'; // admin888
const DEFAULT_LAYOUT = {
  rows: 6, cols: 8,
  middle_cols: [2,3,4,5],
  side_cols: [0,1,6,7],
  side_rows: 5,
  girl_cols: [4,5],
  girl_last_alone: true,
  empty_side: true,
  group_size: 2
};
const DEFAULT_FIXED = { fixed_pairs: [['杨天雪','徐雨辰']], alone: ['张千慧'] };
const DEFAULT_RULES = { podium_guards: ['沙宇桐'], no_deskmate: [] };
const DEFAULT_WEIGHTS = { seatmate:50, pos:50, height:1.0, mutual:1.5, single:1.0 };

// ---------- 全局状态 ----------
let S = null;          // 完整状态对象
let roster = [];       // 学生列表（来自 S.roster）
let layout = null;     // 布局
let current = null;    // 当前教室（grid/podium/score）
let lastSavedAt = null;
let me = null;         // 当前会话 {role, name, no}
let selected = null;   // 选中的姓名（教师强制互换用）
let dirty = false;
let panelTouched = {}; // 规则输入框被用户编辑后不再被轮询覆盖

// ---------- 工具 ----------
const $ = id => document.getElementById(id);
let toastTimer = null;
function toast(msg, err=false){
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> t.className='toast', 3000);
}
function setSync(text, ok){
  const el = $('syncStatus');
  el.classList.toggle('off', !ok);
  $('syncText').textContent = text;
}
function shuffle(a, rng){ for(let i=a.length-1;i>0;i--){ const j=(rng||Math.random)()<0?0:Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
async function sha256hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function askConfirm(msg){
  return new Promise(res=>{
    const mask=$('modalMask'), ok=$('modalOk'), cancel=$('modalCancel');
    $('modalMsg').textContent=msg;
    mask.classList.remove('hide');
    const done=(v)=>{ mask.classList.add('hide'); ok.onclick=null; cancel.onclick=null; res(v); };
    ok.onclick=()=>done(true);
    cancel.onclick=()=>done(false);
  });
}
function getRules(){ return (S&&S.rules)||{...DEFAULT_RULES}; }
function getFixed(){ return (S&&S.fixed)||{...DEFAULT_FIXED}; }
function getTeacher(){ return (S&&S.teacher_name)||DEFAULT_TEACHER; }
function getAdminHash(){ return (S&&S.admin_hash)||DEFAULT_ADMIN_HASH; }
function isTeacherOrAdmin(){ return me && (me.role==='teacher'||me.role==='admin'); }
function isAdminRole(){ return me && me.role==='admin'; }

// ---------- 布局 ----------
function layoutSeats(l){
  const isSide = {}; l.side_cols.forEach(c=>isSide[c]=true);
  const out = [];
  for(let r=0;r<l.rows;r++){
    for(let c=0;c<l.cols;c++){
      if(isSide[c]){ if(l.empty_side){ if(r>=l.side_rows) continue; } else { if(r<l.rows-l.side_rows) continue; } }
      out.push({row:r, col:c});
    }
  }
  return out;
}
const isMiddleCol = (l,c)=> l.middle_cols.includes(c);
const isGirlCol = (l,c)=> l.girl_cols.includes(c);
function rowZone(l,r){ const t=Math.floor(l.rows/3); return r<t?-1:(r>=l.rows-t?1:0); }
function colZone(l,c){ const m=Math.floor(l.cols/2); return c<m-1?-1:(c>m?1:0); }
function neighborSeats(l,s){ return [-1,1].filter(dc=>{const nc=s.col+dc; return nc>=0&&nc<l.cols;}).map(dc=>({row:s.row,col:s.col+dc})); }
function areDeskmates(l, a, b){
  // 同桌：同一行、同一两列组、相邻列
  return a.row===b.row && Math.floor(a.col/2)===Math.floor(b.col/2) && Math.abs(a.col-b.col)===1;
}

// ---------- 算法：构造初始解 ----------
function pairRowsOf(l, colMap){
  const ca=l.girl_cols[0], cb=l.girl_cols[1];
  const a={}, b={};
  (colMap[ca]||[]).forEach(s=>a[s.row]=true);
  (colMap[cb]||[]).forEach(s=>b[s.row]=true);
  const out=[];
  for(let r=0;r<l.rows;r++) if(a[r]&&b[r]) out.push({row:r, colA:ca, colB:cb});
  return out;
}
function colSeatsOf(l){
  const colMap={};
  layoutSeats(l).forEach(s=>{ (colMap[s.col]=colMap[s.col]||[]).push(s); });
  Object.values(colMap).forEach(ar=>ar.sort((x,y)=>x.row-y.row));
  const seen={}, order=[];
  l.girl_cols.forEach(c=>{ order.push(c); seen[c]=true; });
  for(let c=0;c<l.cols;c++) if(!seen[c]) order.push(c);
  return {colMap, order};
}
function findStudent(list, name){ return list.find(s=>s.name===name); }
function pairByPref(sts){
  const idx={}; sts.forEach((s,i)=>idx[s.name]=i);
  const paired={}, order=[];
  for(let i=0;i<sts.length;i++){
    if(paired[sts[i].name]) continue;
    order.push(sts[i]);
    let best=-1;
    for(const n of (sts[i].seatmate_pref||[])){
      if(idx[n]!==undefined && !paired[n] && idx[n]!==i){ best=idx[n]; break; }
    }
    if(best>=0){ order.push(sts[best]); paired[sts[best].name]=true; }
    paired[sts[i].name]=true;
  }
  return order;
}
function buildInitial(students, l, opt, rules, fixed){
  const guards = (rules&&rules.podium_guards)||[];
  const podium = guards.map(n=>findStudent(students,n)).filter(Boolean);
  const pool = students.filter(st=>!guards.includes(st.name));
  const {colMap, order} = colSeatsOf(l);
  const girls=[], boys=[];
  pool.forEach(st=>{ (st.gender==='女'?girls:boys).push(st); });
  const fixedPairSet={}, aloneSet={};
  (fixed.fixed_pairs||[]).forEach(p=>{ if(p.length===2){ fixedPairSet[p[0]]=p[1]; fixedPairSet[p[1]]=p[0]; } });
  (fixed.alone||[]).forEach(n=>aloneSet[n]=true);
  const girlSeatRows = pairRowsOf(l, colMap);
  const slots=[];
  const used={};
  // 固定同桌（只处理女生，与旧逻辑一致）
  (fixed.fixed_pairs||[]).forEach(p=>{
    const pair=[];
    p.forEach(n=>{ const st=findStudent(girls,n); if(st){ pair.push(st); used[n]=true; } });
    if(pair.length) slots.push({members:pair, alone:pair.length===1});
  });
  // 单人
  (fixed.alone||[]).forEach(n=>{
    const st=findStudent(girls,n);
    if(st && !used[n]){ slots.push({members:[st], alone:true}); used[n]=true; }
  });
  // 其余女生
  const rest=girls.filter(s=>!used[s.name]);
  if(opt.randomize) shuffle(rest);
  else if(opt.use_pref) { const o=pairByPref(rest); rest.splice(0,rest.length,...o); }
  else if(opt.use_height) rest.sort((a,b)=>(a.height||0)-(b.height||0));
  // 处理不可同桌：若相邻两名恰好是禁止同桌，则尝试与后面交换
  const noDesk=(rules&&rules.no_deskmate)||[];
  const isForbidden=(n1,n2)=> noDesk.some(p=> (p[0]===n1&&p[1]===n2)||(p[0]===n2&&p[1]===n1) );
  for(let i=0;i<rest.length;i+=2){
    if(i+1<rest.length && isForbidden(rest[i].name, rest[i+1].name)){
      for(let j=i+2;j<rest.length;j++){
        if(!isForbidden(rest[i].name, rest[j].name) && !isForbidden(rest[i+1].name, rest[i+1].name)){
          const t=rest[i+1]; rest[i+1]=rest[j]; rest[j]=t; break;
        }
      }
    }
    const m=[rest[i]];
    if(i+1<rest.length) m.push(rest[i+1]);
    slots.push({members:m, alone:m.length===1});
  }
  // 分配女生
  const assign={}, usedSeat={};
  let usedRows=0;
  slots.forEach(slot=>{
    if(usedRows>=girlSeatRows.length) return;
    const row=girlSeatRows[usedRows++];
    if(slot.alone){
      assign[slot.members[0].name]={row:row.row,col:row.colA};
      usedSeat[row.row+','+row.colA]=true;
      usedSeat[row.row+','+row.colB]=true;
    } else {
      slot.members.forEach((m,i)=>{
        const c=i===0?row.colA:row.colB;
        assign[m.name]={row:row.row,col:c};
        usedSeat[row.row+','+c]=true;
      });
    }
  });
  // 男生填其余
  const restSeats=[];
  order.forEach(c=>colMap[c].forEach(s=>{ if(!usedSeat[s.row+','+s.col]) restSeats.push(s); }));
  const ob=boys.slice();
  if(opt.randomize) shuffle(ob);
  else if(opt.use_height) ob.sort((a,b)=>(a.height||0)-(b.height||0));
  // 男生填座时避开不可同桌（启发式）
  const occupied={};
  ob.forEach((st,i)=>{
    if(i>=restSeats.length) return;
    let seat=restSeats[i];
    const nbSeats=neighborSeats(l,seat);
    // 找第一个不会与已有邻居形成禁止同桌的座位
    let bad=true;
    for(const cand of [seat].concat(restSeats.slice(i+1))){
      const nb=neighborSeats(l,cand).map(n=>n.row+','+n.col).filter(k=>occupied[k]);
      const nbNames=nb.map(k=>{ const idx=occupied[k]; return idx!==undefined?ob[idx].name:null; }).filter(Boolean);
      const clash=nbNames.some(nn=>isForbidden(st.name, nn));
      if(!clash){ seat=cand; bad=false; break; }
    }
    if(bad) seat=restSeats[i];
    assign[st.name]=seat;
    occupied[seat.row+','+seat.col]=i;
    usedSeat[seat.row+','+seat.col]=true;
  });
  // 组装
  const grid=layoutSeats(l).map(s=>({seat:s, empty:true, is_middle:isMiddleCol(l,s.col), is_girl_col:isGirlCol(l,s.col)}));
  grid.forEach(cell=>{
    const name=Object.keys(assign).find(n=>assign[n].row===cell.seat.row && assign[n].col===cell.seat.col);
    if(name){
      const st=students.find(s=>s.name===name);
      cell.student=st; cell.empty=false;
    }
  });
  return {layout:l, grid, podium: podium.map(p=>({student:p, empty:false})), score:0};
}
// ---------- 算法：评分 ----------
function cellAt(cr,r,c){ return cr.grid.find(cell=>cell.seat.row===r&&cell.seat.col===c); }
function idxOf(cr, s){ return cr.grid.findIndex(cell=>cell.seat.row===s.row&&cell.seat.col===s.col); }
function prefRank(pref,name){ const i=pref.indexOf(name); return i>=0?i:null; }
function score(cr, opt, rules){
  let total=0;
  const stAt = {};
  cr.grid.forEach((cell,i)=>{ if(cell.student) stAt[cell.student.name]=i; });
  // 不可同桌：严重扣分
  const noDesk=(rules&&rules.no_deskmate)||[];
  noDesk.forEach(p=>{
    if(p.length!==2) return;
    const ia=stAt[p[0]], ib=stAt[p[1]];
    if(ia==null||ib==null) return;
    if(areDeskmates(cr.layout, cr.grid[ia].seat, cr.grid[ib].seat)) total -= 5000;
  });
  cr.grid.forEach(cell=>{
    const st=cell.student; if(!st) return;
    const s=cell.seat;
    if(opt.use_pref && st.seatmate_pref && st.seatmate_pref.length){
      neighborSeats(cr.layout,s).forEach(nb=>{
        const ni=idxOf(cr,nb);
        if(ni<0) return;
        const nbSt=cr.grid[ni].student; if(!nbSt) return;
        const rank=prefRank(st.seatmate_pref, nbSt.name);
        if(rank!==null){
          let gain=1/(rank+1);
          if(prefRank(nbSt.seatmate_pref||[], st.name)!==null) gain*=opt.weights.mutual;
          total += gain * opt.weights.seatmate/100*2;
        }
      });
    }
    if(opt.use_pref && st.single_desk){
      let alone=true;
      neighborSeats(cr.layout,s).forEach(nb=>{ const ni=idxOf(cr,nb); if(ni>=0&&cr.grid[ni].student){ alone=false; } });
      if(alone) total += opt.weights.single*opt.weights.seatmate/100*2;
    }
    if(opt.use_pref && (st.row_pref||st.col_pref)){
      let g=0;
      if(st.row_pref){ if(rowZone(cr.layout,s.row)===st.row_pref) g+=0.5; else if(rowZone(cr.layout,s.row)===0) g+=0.15; }
      if(st.col_pref){ if(colZone(cr.layout,s.col)===st.col_pref) g+=0.5; else if(colZone(cr.layout,s.col)===0) g+=0.15; }
      total += g*opt.weights.pos/100*2;
    }
    if(opt.use_height && st.height>0 && s.row<cr.layout.rows/2) total -= opt.weights.height*(st.height/100)*0.5;
  });
  return total;
}
function cloneRoom(cr){ return {layout:cr.layout, grid:cr.grid.map(c=>Object.assign({},c)), podium:(cr.podium||[]).map(p=>Object.assign({},p)), score:cr.score}; }
function optimize(cr, opt, rules){
  let best=cloneRoom(cr), bestScore=score(best,opt,rules);
  let cur=cloneRoom(cr), curScore=bestScore;
  const occs=[];
  cur.grid.forEach((cell,i)=>{ if(cell.student) occs.push({cell}); });
  const N=occs.length;
  for(let it=0; it<opt.iterations; it++){
    const i=Math.floor(Math.random()*N), j=Math.floor(Math.random()*N);
    if(i===j) continue;
    const a=occs[i].cell, b=occs[j].cell;
    if(!a.student||!b.student||a.student.gender!==b.student.gender) continue;
    const t=a.student; a.student=b.student; b.student=t;
    const ns=score(cur,opt,rules);
    if(ns>=curScore){ curScore=ns; if(ns>bestScore){ bestScore=ns; best=cloneRoom(cur); } }
    else { const t2=a.student; a.student=b.student; b.student=t2; }
  }
  return best;
}
function arrange(students, l, opt, rules, fixed){
  let cr=buildInitial(students, l, opt, rules, fixed);
  if(!opt.randomize) cr=optimize(cr, opt, rules);
  cr.score=score(cr,opt,rules);
  return cr;
}
// ---------- 轮换 ----------
function rotate(cr, mode){
  const l=cr.layout;
  const colSeats={};
  layoutSeats(l).forEach(s=>{ (colSeats[s.col]=colSeats[s.col]||[]).push(s); });
  Object.values(colSeats).forEach(ar=>ar.sort((x,y)=>x.row-y.row));
  const cur={};
  cr.grid.forEach(cell=>{ if(cell.student) cur[cell.student.name]=cell.seat; });
  const next={};
  const nearest=(seats,row)=> seats.reduce((b,s)=>Math.abs(s.row-row)<Math.abs(b.row-row)?s:b, seats[0]);
  if(mode==='row'){
    for(const name in cur){
      const s=cur[name], cs=colSeats[s.col];
      const idx=cs.findIndex(x=>x.row===s.row&&x.col===s.col);
      const ni=(idx+1)%cs.length;
      next[name]=cs[ni];
    }
  } else if(mode==='colgroup'){
    const nb=2, ng=Math.floor(l.cols/nb);
    for(const name in cur){
      const s=cur[name], g=Math.floor(s.col/nb), ng2=(g+1)%ng;
      const nc=ng2*nb+(s.col%nb);
      next[name]=colSeats[nc]?nearest(colSeats[nc],s.row):s;
    }
  } else {
    const girlCols=l.girl_cols, boyCols=[];
    for(let c=0;c<l.cols;c++) if(!isGirlCol(l,c)) boyCols.push(c);
    for(const name in cur){
      const s=cur[name];
      const st=cr.grid.find(c=>c.student&&c.student.name===name).student;
      if(st&&st.gender==='女'){
        const other=girlCols.find(c=>c!==s.col);
        next[name]=other!==undefined&&colSeats[other]?nearest(colSeats[other],s.row):s;
      } else {
        const idx=boyCols.indexOf(s.col);
        if(idx<0){ next[name]=s; continue; }
        const nidx=(idx+2)%boyCols.length;
        next[name]=colSeats[boyCols[nidx]]?nearest(colSeats[boyCols[nidx]],s.row):s;
      }
    }
  }
  const nc=cloneRoom(cr);
  nc.grid.forEach(cell=>{ cell.student=undefined; cell.empty=true; });
  const occ={};
  for(const name in next){
    const s=next[name];
    const cell=nc.grid.find(c=>c.seat.row===s.row&&c.seat.col===s.col&&!occ[s.row+','+s.col]);
    if(cell){ cell.student=curStu(cr,name); cell.empty=false; occ[s.row+','+s.col]=true; }
  }
  nc.score=score(nc,{use_pref:true,use_height:true,weights:DEFAULT_WEIGHTS},getRules());
  return nc;
}
function curStu(cr,name){ return cr.grid.find(c=>c.student&&c.student.name===name).student; }

// ---------- 规则助手 ----------
function isPodiumGuard(name){ return (getRules().podium_guards||[]).includes(name); }
function isFixedPairMember(name){ return (getFixed().fixed_pairs||[]).some(p=>p.includes(name)); }
function isAloneStudent(name){ return (getFixed().alone||[]).includes(name); }
function findPos(cr, name){
  const g=cr.grid.find(c=>c.student&&c.student.name===name);
  if(g) return {grid:g};
  const pi=(cr.podium||[]).findIndex(p=>p.student&&p.student.name===name);
  if(pi>=0) return {podium:pi};
  return null;
}
function doSwapRoom(cr, n1, n2){
  const p1=findPos(cr,n1), p2=findPos(cr,n2);
  if(!p1||!p2) return false;
  if(p1.grid&&p2.grid){ const t=p1.grid.student; p1.grid.student=p2.grid.student; p2.grid.student=t; }
  else if(p1.podium!=null&&p2.podium!=null){ const t=cr.podium[p1.podium].student; cr.podium[p1.podium].student=cr.podium[p2.podium].student; cr.podium[p2.podium].student=t; }
  else {
    const g=p1.grid||p2.grid, pi=p1.podium!=null?p1.podium:p2.podium;
    const gs=g.student; g.student=cr.podium[pi].student; cr.podium[pi].student=gs;
  }
  return true;
}
// 学生换座是否允许（尊重规则）；force=true 无视一切
function canStudentSwap(n1, n2){
  if(n1===n2) return {ok:false, why:'不能和自己换'};
  if(isPodiumGuard(n1)||isPodiumGuard(n2)) return {ok:false, why:'讲台旁/护法座位不可由学生申请互换'};
  if(isFixedPairMember(n1)||isFixedPairMember(n2)) return {ok:false, why:'固定同桌的同学不可由学生申请互换'};
  if(isAloneStudent(n1)||isAloneStudent(n2)) return {ok:false, why:'单人单座的同学不可由学生申请互换'};
  // 模拟互换后检查不可同桌
  const cr=cloneRoom(current);
  if(!doSwapRoom(cr,n1,n2)) return {ok:false, why:'学生未找到'};
  const pos={};
  cr.grid.forEach(c=>{ if(c.student) pos[c.student.name]=c.seat; });
  const noDesk=getRules().no_deskmate||[];
  for(const p of noDesk){
    if(p.length!==2) continue;
    const sa=pos[p[0]], sb=pos[p[1]];
    if(sa&&sb&&areDeskmates(cr.layout,sa,sb)) return {ok:false, why:'换后「'+p[0]+'」与「'+p[1]+'」会成为同桌（违反不可同桌规则）'};
  }
  return {ok:true};
}

// ---------- 同步层 ----------
function stateUrl(){ return `${SYNC.rawBase}/${SYNC.owner}/${SYNC.repo}/${SYNC.branch}/${SYNC.path}`; }
function apiUrl(p){ return `${SYNC.apiBase}/repos/${SYNC.owner}/${SYNC.repo}/contents/${p}`; }
function pagesStateUrl(){ return `${pagesUrl}data/state.json`; }
async function getStateAPI(){
  const r=await fetch(apiUrl(SYNC.path), {headers:{Authorization:'Bearer '+WRITE_TOKEN}, cache:'no-store'});
  if(!r.ok){ const d=await r.json().catch(()=>({})); throw new Error(d.message||('读取失败 '+r.status)); }
  const d=await r.json();
  return {sha:d.sha, state:JSON.parse(decodeURIComponent(escape(atob(d.content))))};
}
async function fetchRawState(){
  const sources=[
    ()=>fetch(pagesStateUrl()+'?cb='+Date.now(), {cache:'no-store'}),
    ()=>fetch(stateUrl()+'?cb='+Date.now(), {cache:'no-store'})
  ];
  let best=null;
  for(const f of sources){
    try{ const r=await f(); if(r.ok){ const j=await r.json(); if(j&&j.version){ if(!best||new Date(j.updated_at)>new Date(best.updated_at)) best=j; } } }catch(e){}
  }
  if(best) return best;
  throw new Error('state.json 读取失败');
}
function normalizeState(st){
  // 迁移旧版本/缺省字段
  if(!st.rules) st.rules = st.layout&&st.layout.fixed&&st.layout.fixed.podium_seat
    ? {podium_guards:[st.layout.fixed.podium_seat], no_deskmate:[]}
    : {...DEFAULT_RULES};
  if(!st.fixed) st.fixed = {...DEFAULT_FIXED};
  if(!st.teacher_name) st.teacher_name = DEFAULT_TEACHER;
  if(!st.admin_hash) st.admin_hash = DEFAULT_ADMIN_HASH;
  if(!st.pending_requests) st.pending_requests = [];
  return st;
}
function applyState(st){
  S = normalizeState(st);
  roster = S.roster || roster;
  layout = S.layout || layout;
  current = {layout, grid:S.grid||[], podium:S.podium||[], score:S.score||0};
  lastSavedAt = S.updated_at || null;
  if(me){
    if(me.role==='student' && !roster.find(s=>s.name===me.name)){ logout(); return; }
    if(me.role==='teacher' && me.name!==getTeacher()){ logout(); return; }
  }
  return true;
}
async function readModifyWrite(mutator){
  for(let attempt=0; attempt<5; attempt++){
    let cur;
    try{ cur=await getStateAPI(); }catch(e){ throw e; }
    const next=normalizeState(cur.state);
    next.version=2;
    mutator(next);
    next.updated_at=new Date().toISOString();
    const content=btoa(unescape(encodeURIComponent(JSON.stringify(next))));
    const body={message:'update '+new Date().toLocaleString('zh-CN'), content, sha:cur.sha};
    const r=await fetch(apiUrl(SYNC.path), {method:'PUT', headers:{Authorization:'Bearer '+WRITE_TOKEN,'Content-Type':'application/json'}, body:JSON.stringify(body)});
    if(r.ok){ applyState(next); return next; }
    if(r.status===409){ continue; }
    const d=await r.json().catch(()=>({}));
    throw new Error(d.message||('写入失败 '+r.status));
  }
  throw new Error('并发写入冲突，请重试');
}

// ---------- 会话（登录） ----------
function saveSession(){ localStorage.setItem('seat_session', JSON.stringify(me||{})); }
function clearSession(){ localStorage.removeItem('seat_session'); }
function enterSession(role, name, no){
  me={role, name, no:no||0};
  saveSession();
  $('loginView').classList.add('hide');
  $('appView').classList.remove('hide');
  renderPanel(); render(); renderRequests();
  toast('欢迎，'+(role==='student'?name+'同学':(role==='teacher'?'班主任 '+name:'管理员'))+' 👋');
}
function logout(){
  me=null; clearSession(); selected=null;
  $('appView').classList.add('hide');
  $('loginView').classList.remove('hide');
}
async function doLogin(){
  const name=$('loginName').value.trim();
  const noRaw=$('loginNo').value.trim();
  const no=parseInt(noRaw);
  if(!name){ toast('请输入姓名', true); return; }
  if(name==='admin'){
    const h=await sha256hex(noRaw||'');
    if(h===getAdminHash()){ enterSession('admin', name, no); return; }
    toast('管理员密码错误', true); return;
  }
  if(name===getTeacher()){
    enterSession('teacher', name, no); return; // 班主任学号任意
  }
  const st=roster.find(s=>s.name===name && s.no>0 && s.no===no);
  if(st){ enterSession('student', name, no); return; }
  const any=roster.find(s=>s.name===name);
  toast(any?('学号不正确：班级名单中「'+name+'」的学号是 '+any.no):'该同学不在班级名单中', true);
}

// ---------- 换座申请 ----------
function renderRequests(){
  const el=$('reqList'); if(!el) return;
  const reqs=(S&&S.pending_requests)||[];
  const pending=reqs.filter(r=>r.status==='pending');
  if(!pending.length){ el.innerHTML='<div class="tip">暂无申请</div>'; return; }
  const shown=pending.filter(r=> isTeacherOrAdmin() || (me&&(r.from===me.name || r.to===me.name)));
  if(!shown.length){ el.innerHTML='<div class="tip">暂无申请</div>'; return; }
  el.innerHTML='';
  shown.forEach(r=>{
    const div=document.createElement('div'); div.className='req-item';
    const who=document.createElement('div'); who.className='who';
    who.textContent = r.from+' 想与 '+r.to+' 换座位';
    const meta=document.createElement('div'); meta.className='meta';
    meta.textContent='发起于 '+new Date(r.at).toLocaleString('zh-CN',{hour12:false});
    div.append(who, meta);
    const btns=document.createElement('div'); btns.className='btns';
    const canAct = r.to===me.name || isTeacherOrAdmin();
    if(canAct){
      const ok=document.createElement('button'); ok.className='btn mini green'; ok.textContent='同意';
      ok.onclick=()=>acceptRequest(r.id);
      const no=document.createElement('button'); no.className='btn mini red'; no.textContent='拒绝';
      no.onclick=()=>rejectRequest(r.id);
      btns.append(ok,no);
    } else {
      const wait=document.createElement('div'); wait.className='tip'; wait.textContent='等待对方同意…';
      btns.append(wait);
    }
    div.append(btns); el.appendChild(div);
  });
}
async function requestSwap(toName){
  const check=canStudentSwap(me.name, toName);
  if(!check.ok){ toast(check.why, true); return; }
  const pending=(S&&S.pending_requests)||[];
  const dup=pending.some(r=>r.status==='pending' && ((r.from===me.name&&r.to===toName)||(r.from===toName&&r.to===me.name)));
  if(dup){ toast('你们之间已有待处理的换座申请', true); return; }
  await readModifyWrite(st=>{
    st.pending_requests.push({id:'r'+Date.now(), from:me.name, to:toName, at:new Date().toISOString(), status:'pending'});
  });
  toast('已向「'+toName+'」发起换座申请 ✓');
  renderRequests();
}
async function acceptRequest(id){
  const req=(S&&S.pending_requests)||[];
  const r=req.find(x=>x.id===id && x.status==='pending');
  if(!r){ toast('申请不存在', true); return; }
  // 若为学生本人同意，也校验规则；老师/管理员同意则无视规则
  const check=canStudentSwap(r.from, r.to);
  if(!isTeacherOrAdmin() && !check.ok){ toast(check.why, true); return; }
  await readModifyWrite(st=>{
    const rr=st.pending_requests.find(x=>x.id===id);
    if(!rr||rr.status!=='pending') return;
    const cr={layout:st.layout, grid:st.grid, podium:st.podium||[]};
    doSwapRoom(cr, rr.from, rr.to);
    st.grid=cr.grid; st.podium=cr.podium;
    rr.status='done';
  });
  toast('换座成功：'+r.from+' 与 '+r.to+' 已互换 ✓');
  render(); renderRequests();
}
async function rejectRequest(id){
  await readModifyWrite(st=>{
    const rr=st.pending_requests.find(x=>x.id===id);
    if(rr) rr.status='rejected';
  });
  toast('已拒绝该换座申请');
  renderRequests();
}

// ---------- 班主任/管理员操作 ----------
async function saveRules(){
  const guards=$('fixGuards').value.split(/[,，]/).map(s=>s.trim()).filter(Boolean).slice(0,2);
  const pairs=$('fixPairs').value.split(/[,，]/).map(s=>s.trim()).filter(Boolean);
  const pairs2=[]; for(let i=0;i+1<pairs.length;i+=2) pairs2.push([pairs[i],pairs[i+1]]);
  const alone=$('fixAlone').value.split(/[,，]/).map(s=>s.trim()).filter(Boolean);
  const nd=$('fixNoDesk').value.split(/[,，]/).map(s=>s.trim()).filter(Boolean);
  const nd2=[]; for(let i=0;i+1<nd.length;i+=2) nd2.push([nd[i],nd[i+1]]);
  await readModifyWrite(st=>{
    st.rules.podium_guards=guards;
    st.rules.no_deskmate=nd2;
    st.fixed.fixed_pairs=pairs2;
    st.fixed.alone=alone;
  });
  panelTouched={};
  toast('规则已保存 ✓（再次生成排位时生效）');
  render();
}
async function forceSwap(){
  const a=$('forceA').value, b=$('forceB').value;
  if(!a||!b||a===b){ toast('请选择两名不同的学生', true); return; }
  await readModifyWrite(st=>{
    const cr={layout:st.layout, grid:st.grid, podium:st.podium||[]};
    doSwapRoom(cr,a,b);
    st.grid=cr.grid; st.podium=cr.podium;
  });
  toast('已强制互换 '+a+' 与 '+b+' ✓（无视规则）');
  render();
}
async function doArrange(){
  const rules=getRules(), fixed=getFixed();
  const l=JSON.parse(JSON.stringify(layout)); l.fixed=fixed;
  const opt={ randomize:$('randomize').checked, use_height:$('useHeight').checked, use_pref:$('usePref').checked,
    iterations:parseInt($('iterations').value)||4000, weights:DEFAULT_WEIGHTS };
  const room=arrange(roster,l,opt,rules,fixed);
  await readModifyWrite(st=>{ st.grid=room.grid; st.podium=room.podium; st.score=room.score; });
  toast('已生成并同步新排位 ✓');
  render();
}
async function doRotate(mode){
  if(!current){ toast('请先生成排位', true); return; }
  const nc=rotate(current, mode);
  await readModifyWrite(st=>{ st.grid=nc.grid; st.podium=nc.podium; st.score=nc.score; });
  toast(mode==='row'?'前后轮换 ✓':(mode==='colkeep'?'左右轮换（保女生列）✓':'左右大组轮换 ✓'));
  render();
}
async function doClear(){
  await readModifyWrite(st=>{ st.grid=[]; st.podium=[]; st.score=0; });
  toast('已清空座位');
  render();
}
async function adminSave(){
  const tname=$('admTeacher').value.trim();
  const pnew=$('admPass').value;
  if(!tname){ toast('班主任姓名不能为空', true); return; }
  await readModifyWrite(async st=>{
    st.teacher_name=tname;
    if(pnew){ st.admin_hash=await sha256hex(pnew); }
  });
  toast('管理员设置已保存 ✓'+(pnew?'（管理员密码已更新）':''));
  $('admPass').value='';
  renderPanel();
}
async function adminRoster(rosterList){
  await readModifyWrite(st=>{ st.roster=rosterList; });
  roster=rosterList;
  toast('名单已更新（共 '+rosterList.length+' 人）✓');
  renderPanel(); render();
}
function addRosterRow(){
  const name=prompt('新增学生姓名：'); if(!name||!name.trim()) return;
  const gender=confirm('性别：确定=女，取消=男')?'女':'男';
  const noRaw=prompt('学号：'); const no=parseInt(noRaw);
  const nr=roster.slice();
  nr.push({name:name.trim(), gender, no:no||0});
  adminRoster(nr);
}
function deleteRosterRow(name){
  askConfirm('删除学生「'+name+'」？').then(y=>{ if(y) adminRoster(roster.filter(s=>s.name!==name)); });
}

// ---------- UI ----------
function renderPanel(){
  // 角色相关区块显隐
  $('secMySeat').classList.toggle('hide', !me || me.role!=='student');
  $('secTeacher').classList.toggle('hide', !isTeacherOrAdmin());
  $('secAdmin').classList.toggle('hide', !isAdminRole());
  // 用户信息
  if(me){
    $('whoami').textContent = me.role==='admin'?'admin':me.name;
    const tag=$('roleTag');
    tag.textContent = me.role==='student'?'学生':(me.role==='teacher'?'班主任':'管理员');
    tag.className='role-tag '+(me.role==='student'?'stu':(me.role==='teacher'?'tch':'adm'));
    $('brandSub').textContent = '2706 高三 · 实时同步';
  }
  // 班主任规则输入框预填（仅当用户未手动编辑时）
  const rules=getRules(), fixed=getFixed();
  if(!panelTouched.fixGuards) $('fixGuards').value=(rules.podium_guards||[]).join(',');
  if(!panelTouched.fixPairs) $('fixPairs').value=(fixed.fixed_pairs||[]).map(p=>p.join(',')).join(',');
  if(!panelTouched.fixAlone) $('fixAlone').value=(fixed.alone||[]).join(',');
  if(!panelTouched.fixNoDesk) $('fixNoDesk').value=(rules.no_deskmate||[]).map(p=>p.join(',')).join(',');
  // 强制互换下拉
  const fa=$('forceA'), fb=$('forceB');
  fa.innerHTML=''; fb.innerHTML='';
  const names=roster.map(s=>s.name);
  names.forEach(n=>{ const o1=document.createElement('option'); o1.value=n; o1.textContent=n; fa.appendChild(o1); const o2=document.createElement('option'); o2.value=n; o2.textContent=n; fb.appendChild(o2); });
  // 管理员
  $('admTeacher').value=getTeacher();
  $('rosterCount').textContent=roster.length;
  const rl=$('rosterList'); rl.innerHTML='';
  roster.slice().sort((a,b)=>(a.no||999)-(b.no||999)).forEach(s=>{
    const row=document.createElement('div'); row.className='roster-item';
    const no=document.createElement('span'); no.className='no'; no.textContent=s.no||'—';
    const g=document.createElement('span'); g.className='g '+(s.gender==='女'?'f':'m'); g.textContent=s.gender==='女'?'女':'男';
    const nm=document.createElement('span'); nm.className='nm'; nm.textContent=s.name;
    const del=document.createElement('button'); del.className='btn mini red'; del.textContent='删';
    del.onclick=()=>deleteRosterRow(s.name);
    row.append(no,g,nm,del); rl.appendChild(row);
  });
  // 登录提示里的班主任名字
  $('hintTeacher').textContent=getTeacher();
  // 底部角色提示
  const msg=$('roleMsg');
  if(me){
    msg.style.display='block';
    msg.textContent = me.role==='student'
      ? '👆 点击其他同学座位可发起「换座申请」；对方同意后即可换座（讲台旁/固定同桌/单人单座除外）'
      : (me.role==='teacher'?'👩‍🏫 班主任模式：可设置规则、强制互换、处理申请':'🛠 管理员模式：可管理名单/班主任/密码，无视一切规则');
  }
}
function render(){
  if(!layout||!current) return;
  const grid=$('grid');
  grid.style.gridTemplateColumns=`repeat(${layout.cols}, 1fr)`;
  grid.innerHTML='';
  // 讲台旁（左右护法）
  const pa=$('podiumArea'); pa.innerHTML='';
  const guards=current.podium||[];
  guards.forEach((p,idx)=>{
    const pe=document.createElement('div'); pe.className='podium-seat';
    const nm=document.createElement('div'); nm.className='nm'; nm.textContent=p.student?p.student.name:'空';
    const sub=document.createElement('div'); sub.className='sub';
    sub.textContent = guards.length>1 ? (idx===0?'讲台左护法':'讲台右护法') : '讲台旁 · 护法';
    pe.append(nm,sub);
    if(me&&isTeacherOrAdmin()) pe.style.cursor='pointer';
    pe.addEventListener('click',()=>{ if(me&&isTeacherOrAdmin()) onSeatClick(p.student?p.student.name:null); });
    pa.appendChild(pe);
  });
  if(guards.length===0){
    const e=document.createElement('div'); e.className='podium-empty'; e.textContent='讲台旁（可设左右护法）'; pa.appendChild(e);
  }
  for(let r=0;r<layout.rows;r++){
    for(let c=0;c<layout.cols;c++){
      const cell=cellAt(current,r,c);
      const el=document.createElement('div'); el.className='seat';
      if(cell&&!cell.empty&&cell.student){
        const st=cell.student, isG=st.gender==='女';
        el.classList.add(isG?'girl':'boy');
        if(layout.middle_cols.includes(c)) el.classList.add('middle');
        if(isPodiumGuard(st.name)) el.classList.add('guard');
        if(isAloneStudent(st.name)) el.classList.add('single');
        if(isFixedPairMember(st.name)) el.classList.add('fixed-pair');
        if(me&&me.name===st.name) el.classList.add('me');
        if(isTeacherOrAdmin()&&selected===st.name) el.classList.add('selected');
        const nm=document.createElement('div'); nm.className='nm'; nm.textContent=st.name;
        const sub=document.createElement('div'); sub.className='sub';
        const info=[]; if(st.no) info.push('#'+st.no); info.push(isG?'女':'男');
        sub.textContent=info.join(' · ');
        el.append(nm,sub);
        const f=(getFixed()||{}); const fav='';
        if(f.alone&&f.alone.includes(st.name)) el.setAttribute('data-tag','单');
        if(f.fixed_pairs&&f.fixed_pairs.some(p=>p.includes(st.name))) el.setAttribute('data-tag','同');
        if(getRules().no_deskmate&&getRules().no_deskmate.some(p=>p.includes(st.name))) el.classList.add('ban');
        const title=st.name+(isG?'（女）':'（男）');
        el.title=title;
        el.addEventListener('click',()=>onSeatClick(st.name));
      } else {
        el.classList.add('empty');
        if(layout.middle_cols.includes(c)) el.classList.add('middle');
        const nm=document.createElement('div'); nm.className='nm'; nm.textContent='空';
        el.append(nm);
      }
      grid.appendChild(el);
    }
  }
  const g=roster.filter(s=>s.gender==='女').length;
  $('stGirls').textContent=g; $('stBoys').textContent=roster.length-g;
  $('stTotal').textContent=roster.length;
  $('stSeats').textContent=layoutSeats(layout).length;
  $('layoutDesc').textContent=`中间${layout.middle_cols.length}列×${layout.rows}行 · 旁${layout.side_cols.length}列×${layout.side_rows}行`;
  if(current.score!=null) $('scoreBox').textContent='优化评分：'+current.score.toFixed(1);
  else $('scoreBox').textContent='—';
  // 我的座位
  if(me&&me.role==='student'){
    const pos=findPos(current, me.name);
    $('mySeatText').textContent = pos? (pos.grid?('第'+(pos.grid.seat.row+1)+'排 第'+(pos.grid.seat.col+1)+'列'):'讲台旁') : '未分配';
  }
}
async function onSeatClick(name){
  if(!me) return;
  if(isTeacherOrAdmin()){
    // 强制互换：选择两名
    if(!name){ toast('请选择学生座位', true); return; }
    if(!selected){ selected=name; toast('已选「'+name+'」，再点一名学生即可互换（或点自己取消）', false); render(); return; }
    if(selected===name){ selected=null; render(); return; }
    const a=selected; selected=null; render();
    const y=await askConfirm('强制互换「'+a+'」与「'+name+'」？（无视一切规则）');
    if(y) forceSwapAB(a,name);
    return;
  }
  // 学生：点击他人发起换座申请
  if(name===me.name){ toast('这是你的座位', true); return; }
  if(!name){ toast('空座位，无法申请', true); return; }
  const y=await askConfirm('向「'+name+'」发起换座申请？');
  if(y) requestSwap(name);
}
async function forceSwapAB(a,b){
  await readModifyWrite(st=>{
    const cr={layout:st.layout, grid:st.grid, podium:st.podium||[]};
    doSwapRoom(cr,a,b);
    st.grid=cr.grid; st.podium=cr.podium;
  });
  toast('已强制互换 '+a+' 与 '+b+' ✓');
  render();
}

// ---------- 轮询 ----------
function syncLabel(st){
  const t=st&&st.updated_at?new Date(st.updated_at).toLocaleTimeString('zh-CN'):'';
  return t?('已同步 · 更新于 '+t):'已连接';
}
async function pollCDN(){
  const chk=document.getElementById('lastCheck');
  if(chk) chk.textContent='检测于 '+new Date().toLocaleTimeString('zh-CN',{hour12:false});
  try{
    const st=await fetchRawState();
    if(st&&st.version&&new Date(st.updated_at)>new Date(lastSavedAt||0)&&!dirty){ applyState(st); if(me){ render(); renderRequests(); renderPanel(); } setSync(syncLabel(st), true); }
  }catch(e){}
}
async function pollAPI(){
  try{
    const {state}=await getStateAPI();
    if(state&&new Date(state.updated_at)>new Date(lastSavedAt||0)&&!dirty){ applyState(state); if(me){ render(); renderRequests(); renderPanel(); } setSync(syncLabel(state), true); }
  }catch(e){}
}

// ---------- 导入 ----------
function parseRosterCSV(text){
  const lines=text.split(/\r?\n/).filter(l=>l.trim());
  const out=[];
  lines.forEach((line,i)=>{
    if(i===0&&/^[,学号no]*姓名.*性别/.test(line)) return;
    const p=line.split(',').map(x=>x.trim());
    if(p.length<2) return;
    const name=p[1]||p[0];
    if(!name) return;
    const gender=p[2]? (p[2]==='女'?'女':'男') : (/[女]/.test(p[1])?'女':'男');
    const no=parseInt(p[0])||0;
    if(!out.find(s=>s.name===name)) out.push({name,gender,no});
  });
  return out;
}
function readFile(file){
  return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsText(file,'utf-8'); });
}
async function handleRosterFile(file){
  const name=file.name.toLowerCase();
  let list;
  if(name.endsWith('.xlsx')||name.endsWith('.xls')){
    if(!window.XLSX){
      await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
    }
    const data=await file.arrayBuffer();
    const wb=XLSX.read(data);
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header:1});
    list=[];
    rows.forEach((r,i)=>{
      if(i===0&&r.join('').match(/姓名|性别|name|gender/i)) return;
      const cells=r.map(x=>String(x==null?'':x).trim());
      let n='',gender='',no=0;
      cells.forEach((cv,ci)=>{
        if(/^[\u4e00-\u9fa5]{2,4}$/.test(cv)&&cv!=='男'&&cv!=='女'&&!n) n=cv;
        if(cv==='男'||cv==='女') gender=cv;
      });
      cells.forEach(cv=>{ const x=parseInt(cv); if(!isNaN(x)&&x>0&&x<1000) no=x; });
      if(n&&!list.find(s=>s.name===n)) list.push({name:n,gender:gender==='女'?'女':'男',no});
    });
  } else {
    list=parseRosterCSV(await readFile(file));
  }
  const y=await askConfirm('导入名单将替换当前名单（共 '+list.length+' 人），确认？');
  if(y) await adminRoster(list);
}
// ---------- 导出 ----------
function exportCSV(){
  if(!current) return;
  const head=['行','列','学号','姓名','性别','区域'];
  const lines=[head.join(',')];
  current.grid.forEach(cell=>{
    if(cell.empty||!cell.student) return;
    const st=cell.student;
    const zone=isMiddleCol(layout,cell.seat.col)?'中':'旁';
    lines.push([cell.seat.row+1,cell.seat.col+1,st.no||'',st.name,st.gender,zone].join(','));
  });
  (current.podium||[]).forEach(p=>{ if(p.student) lines.push(['讲台旁','-',p.student.no||'',p.student.name,p.student.gender,'护法'].join(',')); });
  const blob=new Blob(['\uFEFF'+lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='seats.csv'; a.click();
}

// ---------- 事件 ----------
function initEvents(){
  $('btnLogin').addEventListener('click',doLogin);
  $('loginName').addEventListener('keydown',e=>{ if(e.key==='Enter') $('loginNo').focus(); });
  $('loginNo').addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });
  $('btnLogout').addEventListener('click',logout);
  $('btnSaveRules').addEventListener('click',async()=>{ try{ await saveRules(); }catch(e){ toast('保存失败：'+e.message, true); } });
  ['fixGuards','fixPairs','fixAlone','fixNoDesk'].forEach(id=>{
    $(id).addEventListener('input',()=>{ panelTouched[id]=true; });
  });
  $('btnForceSwap').addEventListener('click',async()=>{ try{ await forceSwap(); }catch(e){ toast('保存失败：'+e.message, true); } });
  $('btnArrange').addEventListener('click',async()=>{ try{ await doArrange(); }catch(e){ toast('生成失败：'+e.message, true); } });
  $('btnClear').addEventListener('click',async()=>{ try{ await doClear(); }catch(e){ toast('失败：'+e.message, true); } });
  $('btnRotRow').addEventListener('click',async()=>{ try{ await doRotate('row'); }catch(e){ toast('失败：'+e.message, true); } });
  $('btnRotColKeep').addEventListener('click',async()=>{ try{ await doRotate('colkeep'); }catch(e){ toast('失败：'+e.message, true); } });
  $('btnRotColGroup').addEventListener('click',async()=>{ try{ await doRotate('colgroup'); }catch(e){ toast('失败：'+e.message, true); } });
  $('btnCsv').addEventListener('click',exportCSV);
  $('randomize').addEventListener('change',()=>{ if($('randomize').checked){ $('useHeight').checked=false; $('usePref').checked=false; } });
  $('btnAdmSave').addEventListener('click',async()=>{ try{ await adminSave(); }catch(e){ toast('保存失败：'+e.message, true); } });
  $('btnAddRoster').addEventListener('click',addRosterRow);
  $('btnImportRoster').addEventListener('click',()=>$('fileRoster').click());
  $('fileRoster').addEventListener('change',async e=>{ if(e.target.files[0]){ try{ await handleRosterFile(e.target.files[0]); }catch(err){ toast('导入失败：'+err.message, true); } } e.target.value=''; });
}

// ---------- 启动 ----------
(async function boot(){
  initEvents();
  // 读取状态（优先 API 保证最新；失败退回 CDN；再退回内置）
  let ok=false;
  try{ const {state}=await getStateAPI(); applyState(state); ok=true; }
  catch(e){}
  if(!ok){
    try{ const st=await fetchRawState(); if(st&&st.version){ applyState(st); ok=true; } }catch(e){}
  }
  if(!ok){
    try{ const r=await fetch(`${SYNC.rawBase}/${SYNC.owner}/${SYNC.repo}/${SYNC.branch}/docs/data/roster.json?cb=`+Date.now(), {cache:'no-store'}); if(r.ok) roster=await r.json(); }catch(e){}
    try{ const r=await fetch('data/roster.json'); if(r.ok) roster=await r.json(); }catch(e){}
    layout=JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
    S=normalizeState({version:2, updated_at:new Date().toISOString(), teacher_name:DEFAULT_TEACHER, admin_hash:DEFAULT_ADMIN_HASH, roster, layout, grid:[], podium:[], rules:{...DEFAULT_RULES}, fixed:{...DEFAULT_FIXED}, pending_requests:[], score:0});
    current={layout, grid:[], podium:[], score:0};
  }
  if(roster&&roster.length) renderPanel();
  setSync('已同步 · '+(lastSavedAt?new Date(lastSavedAt).toLocaleTimeString('zh-CN'):''), true);
  // 恢复会话
  try{
    const sv=JSON.parse(localStorage.getItem('seat_session')||'null');
    if(sv&&sv.role){
      if(sv.role==='student' && roster.find(s=>s.name===sv.name)){ me=sv; }
      else if(sv.role==='teacher' && sv.name===getTeacher()){ me=sv; }
      else if(sv.role==='admin'){ me=sv; }
      if(me){ saveSession(); $('loginView').classList.add('hide'); $('appView').classList.remove('hide'); }
    }
  }catch(e){}
  renderPanel(); render(); renderRequests();
  // 轮询：CDN 5s（不限量）+ API 60s（更快捕获交互变更）
  setInterval(pollCDN, 5000);
  setInterval(pollAPI, 60000);
})();
