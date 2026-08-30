/* ============================================================
 * 班级排座位 · 在线版（GitHub Pages 静态站 + 实时同步）
 * 算法与桌面版（Go）一致：固定规则 + 身高 + 偏好匹配 + 局部搜索优化
 * 同步：老师保存座位到 GitHub 仓库 state.json，访客轮询实时查看
 * ============================================================ */
'use strict';

// ---------- 基础数据 ----------
const SYNC = {
  owner: 'tangyuan9325',
  repo: 'classroom-seat-arranger',
  branch: 'main',
  path: 'docs/data/state.json',
  rawBase: 'https://raw.githubusercontent.com',
  apiBase: 'https://api.github.com'
};
const pagesUrl = `https://${SYNC.owner}.github.io/${SYNC.repo}/`;

const DEFAULT_LAYOUT = {
  rows: 6, cols: 8,
  middle_cols: [2,3,4,5],
  side_cols: [0,1,6,7],
  side_rows: 5,
  girl_cols: [4,5],
  girl_last_alone: true,
  empty_side: true,
  group_size: 2,
  fixed: { podium_seat:'沙宇桐', fixed_pairs:[['杨天雪','徐雨辰']], alone:['张千慧'] }
};
const DEFAULT_WEIGHTS = { seatmate:50, pos:50, height:1.0, mutual:1.5, single:1.0 };

let roster = [];      // 学生列表
let layout = null;    // 布局
let current = null;   // 当前教室（grid/podium/score）
let selected = null;  // 选中的姓名
let isAdmin = false;  // 是否有 token
let dirty = false;    // 本地有未保存改动
let lastSavedAt = null;

// ---------- 工具 ----------
const $ = id => document.getElementById(id);
let toastTimer = null;
function toast(msg, err=false){
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> t.className='toast', 2600);
}
function setSync(text, ok){
  const el = $('syncStatus');
  el.classList.toggle('off', !ok);
  $('syncText').textContent = text;
}
function shuffle(a, rng){ for(let i=a.length-1;i>0;i--){ const j=(rng||Math.random)()<0?0:Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

// ---------- 布局 ----------
function layoutSeats(l){
  const isSide = {}; l.side_cols.forEach(c=>isSide[c]=true);
  const out = [];
  for(let r=0;r<l.rows;r++){
    for(let c=0;c<l.cols;c++){
      if(isSide[c]){
        if(l.empty_side){ if(r>=l.side_rows) continue; }
        else { if(r<l.rows-l.side_rows) continue; }
      }
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

function buildInitial(students, l, opt){
  const fixed = l.fixed || {};
  const {colMap, order} = colSeatsOf(l);
  // 讲台旁
  let podium = null;
  const pool = [];
  students.forEach(st=>{ if(fixed.podium_seat && st.name===fixed.podium_seat) podium=st; else pool.push(st); });
  const girls=[], boys=[];
  pool.forEach(st=>{ (st.gender==='女'?girls:boys).push(st); });

  const fixedPairSet={}, aloneSet={};
  (fixed.fixed_pairs||[]).forEach(p=>{ if(p.length===2){ fixedPairSet[p[0]]=p[1]; fixedPairSet[p[1]]=p[0]; } });
  (fixed.alone||[]).forEach(n=>aloneSet[n]=true);

  const girlSeatRows = pairRowsOf(l, colMap);
  const slots=[];
  const used={};
  // 固定同桌
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
  for(let i=0;i<rest.length;i+=2){
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
      usedSeat[row.row+','+row.colB]=true; // 预留空位
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
  ob.forEach((st,i)=>{ if(i<restSeats.length){ assign[st.name]=restSeats[i]; usedSeat[restSeats[i].row+','+restSeats[i].col]=true; } });

  // 组装
  const grid=layoutSeats(l).map(s=>({seat:s, empty:true, is_middle:isMiddleCol(l,s.col), is_girl_col:isGirlCol(l,s.col)}));
  grid.forEach(cell=>{
    const name=Object.keys(assign).find(n=>assign[n].row===cell.seat.row && assign[n].col===cell.seat.col);
    if(name){
      const st=students.find(s=>s.name===name);
      cell.student=st; cell.empty=false;
    }
  });
  return {layout:l, grid, podium: podium?[{student:podium, empty:false}]:[], score:0};
}

// ---------- 算法：评分 ----------
function cellAt(cr,r,c){ return cr.grid.find(cell=>cell.seat.row===r&&cell.seat.col===c); }
function idxOf(cr, s){ return cr.grid.findIndex(cell=>cell.seat.row===s.row&&cell.seat.col===s.col); }
function prefRank(pref,name){ const i=pref.indexOf(name); return i>=0?i:null; }

function score(cr, opt){
  let total=0;
  const stAt = {};
  cr.grid.forEach((cell,i)=>{ if(cell.student) stAt[cell.student.name]=i; });
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
function cloneRoom(cr){ return {layout:cr.layout, grid:cr.grid.map(c=>Object.assign({},c)), podium:cr.podium.map(p=>Object.assign({},p)), score:cr.score}; }

function optimize(cr, opt){
  let best=cloneRoom(cr), bestScore=score(best,opt);
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
    const ns=score(cur,opt);
    if(ns>=curScore){ curScore=ns; if(ns>bestScore){ bestScore=ns; best=cloneRoom(cur); } }
    else { const t2=a.student; a.student=b.student; b.student=t2; }
  }
  return best;
}

// ---------- 算法：主入口 ----------
function arrange(students, l, opt){
  let cr=buildInitial(students, l, opt);
  if(!opt.randomize) cr=optimize(cr, opt);
  cr.score=score(cr,opt);
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
  } else { // colkeep
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
  nc.score=score(nc,{use_pref:true,use_height:true,weights:DEFAULT_WEIGHTS});
  return nc;
}
function curStu(cr,name){ return cr.grid.find(c=>c.student&&c.student.name===name).student; }

// ---------- 同步 ----------
function stateUrl(){ return `${SYNC.rawBase}/${SYNC.owner}/${SYNC.repo}/${SYNC.branch}/${SYNC.path}`; }
function apiUrl(p){ return `${SYNC.apiBase}/repos/${SYNC.owner}/${SYNC.repo}/contents/${p}`; }

function pagesStateUrl(){ return `${pagesUrl}data/state.json`; }
async function fetchRawState(){
  // 双源获取并取最新 updated_at：GitHub Pages(自动重建) + raw(兜底)
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
function applyState(st){
  roster = st.roster || roster;
  layout = st.layout || layout;
  current = {layout, grid:st.grid, podium:st.podium||[], score:st.score||0};
  lastSavedAt = st.updated_at || null;
  return true;
}
async function fetchState(){
  const st=await fetchRawState();
  if(st && st.version) return applyState(st);
  return false;
}
async function saveState(){
  const token=localStorage.getItem('gh_token');
  if(!token){ toast('请先在上方“管理员同步设置”填入 GitHub Token', true); return false; }
  const payload={
    version:1,
    updated_at:new Date().toISOString(),
    saved_by:SYNC.owner,
    layout,
    roster,
    grid:current.grid,
    podium:current.podium,
    score:current.score
  };
  const content=btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  // 获取当前 sha
  let sha=null;
  try{
    const r=await fetch(apiUrl(SYNC.path), {headers:{Authorization:'Bearer '+token}});
    if(r.ok){ const d=await r.json(); sha=d.sha; }
  }catch(e){}
  const body={message:'seat update '+(new Date().toLocaleString('zh-CN')), content};
  if(sha) body.sha=sha;
  const r=await fetch(apiUrl(SYNC.path), {
    method:'PUT',
    headers:{Authorization:'Bearer '+token, 'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  if(!r.ok){ const d=await r.json().catch(()=>({})); throw new Error(d.message||('保存失败 '+r.status)); }
  lastSavedAt=payload.updated_at;
  // 保存成功后 GitHub Pages 会自动重建（约 1-2 分钟），访客轮询到新版本即自动更新
  return true;
}

// ---------- UI ----------
function render(){
  if(!layout) return;
  const grid=$('grid');
  grid.style.gridTemplateColumns=`repeat(${layout.cols}, 1fr)`;
  grid.innerHTML='';
  // 讲台旁
  const pa=$('podiumArea');
  if(pa){
    pa.innerHTML='';
    if(current&&current.podium&&current.podium.length&&current.podium[0].student){
      const p=current.podium[0].student;
      const pe=document.createElement('div'); pe.className='podium-seat glass';
      const nm=document.createElement('div'); nm.className='nm'; nm.textContent=p.name;
      const sub=document.createElement('div'); sub.className='sub'; sub.textContent='讲台旁 · 单人单座';
      pe.append(nm,sub); pa.appendChild(pe);
    }
  }
  for(let r=0;r<layout.rows;r++){
    for(let c=0;c<layout.cols;c++){
      const cell=cellAt(current,r,c);
      const el=document.createElement('div'); el.className='seat';
      if(cell&&!cell.empty&&cell.student){
        const st=cell.student, isG=st.gender==='女';
        el.classList.add(isG?'girl':'boy');
        if(layout.middle_cols.includes(c)) el.classList.add('middle');
        const fx=fixedInfo(st.name);
        if(st.single_desk||fx.alone) el.classList.add('single');
        if(fx.pair) el.classList.add('fixed-pair');
        const nm=document.createElement('div'); nm.className='nm'; nm.textContent=st.name;
        const sub=document.createElement('div'); sub.className='sub';
        const info=[]; if(st.no) info.push('#'+st.no); info.push(isG?'女':'男'); if(st.height) info.push(st.height+'cm');
        sub.textContent=info.join(' · ');
        const fav=document.createElement('div'); fav.className='fav'; fav.textContent=fx.pair?'同':'单';
        if(!st.single_desk&&!fx.alone&&!fx.pair) fav.style.display='none';
        el.append(nm,sub,fav);
        const pref=(st.seatmate_pref||[]).slice(0,3).join('、');
        el.title=st.name+'（'+(isG?'女':'男')+'）'+(pref?'\n期望同桌：'+pref:'');
        if(selected===st.name) el.classList.add('selected');
        el.addEventListener('click',()=>onSeatClick(st.name,el));
      } else {
        el.classList.add('empty');
        if(layout.middle_cols.includes(c)) el.classList.add('middle');
        const nm=document.createElement('div'); nm.className='nm'; nm.textContent='空';
        el.append(nm);
        el.addEventListener('click',()=>onSeatClick(null,el));
      }
      grid.appendChild(el);
    }
  }
  const g=roster.filter(s=>s.gender==='女').length;
  $('stGirls').textContent=g; $('stBoys').textContent=roster.length-g;
  $('stTotal').textContent=roster.length;
  $('stSeats').textContent=layoutSeats(layout).length;
  $('layoutDesc').textContent=`中间${layout.middle_cols.length}列×${layout.rows}行 · 旁${layout.side_cols.length}列×${layout.side_rows}行`;
  if(current&&current.score!=null) $('scoreBox').textContent='优化评分：'+current.score.toFixed(1);
  $('viewerMsg').style.display = isAdmin?'none':'block';
}
function fixedInfo(name){
  const f=(layout&&layout.fixed)||{};
  return { pair:(f.fixed_pairs||[]).some(p=>p.includes(name)), alone:(f.alone||[]).includes(name) };
}
function onSeatClick(name){
  if(!isAdmin){ toast('访客只读，切换管理员后可操作'); return; }
  if(name===null){ selected=null; render(); return; }
  if(!selected){ selected=name; render(); }
  else if(selected===name){ selected=null; render(); }
  else { swapLocal(selected,name); selected=null; }
}
function markDirty(){ dirty=true; setSync('有未同步的本地改动', true); }
function swapLocal(n1,n2){
  const a=current.grid.find(c=>c.student&&c.student.name===n1);
  const b=current.grid.find(c=>c.student&&c.student.name===n2);
  if(!a||!b){ toast('找不到学生',true); return; }
  const t=a.student; a.student=b.student; b.student=t;
  render(); markDirty();
}
function doArrange(){
  const l=JSON.parse(JSON.stringify(layout));
  l.fixed={ podium_seat:$('fixPodium').value.trim(),
    fixed_pairs: (()=>{ const p=$('fixPairs').value.split(/[,，]/).map(s=>s.trim()).filter(Boolean); return p.length>=2?[p.slice(0,2)]:[]; })(),
    alone:$('fixAlone').value.split(/[,，]/).map(s=>s.trim()).filter(Boolean) };
  layout=l;
  const opt={ randomize:$('randomize').checked, use_height:$('useHeight').checked, use_pref:$('usePref').checked,
    iterations:parseInt($('iterations').value)||4000, weights:DEFAULT_WEIGHTS };
  current=arrange(roster,l,opt);
  render(); markDirty(); toast('已生成排位 ✓');
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
    if(!name||/男|女/.test(name)&&p.length<2) return;
    const gender=p[2]? (p[2]==='女'?'女':'男') : (/[女]/.test(p[1])?'女':'男');
    const no=parseInt(p[0])||0;
    const height=parseFloat(p[3])||0;
    if(!out.find(s=>s.name===name)) out.push({name,gender,no,height:height||undefined});
  });
  return out;
}
function parseSurveyCSV(text){
  const lines=text.split(/\r?\n/).filter(l=>l.trim());
  const map={};
  lines.slice(1).forEach(line=>{
    const p=line.split(',').map(x=>x.trim());
    if(p.length<2) return;
    const name=p[0]; if(!name) return;
    const rec={ seatmate_pref:(p[3]?p[3].split('|').filter(Boolean):[]),
      single_desk:p[4]==='true'||p[4]==='1',
      row_pref:zoneNum(p[5]), col_pref:zoneNum(p[6]),
      weight_seatmate:parseInt(p[7])||0, weight_pos:parseInt(p[8])||0 };
    const h=parseFloat(p[9]); if(h) rec.height=h;
    map[name]=rec;
  });
  roster.forEach(st=>{ if(map[st.name]) Object.assign(st,map[st.name]); });
}
function zoneNum(v){ if(v==='前'||v==='前排'||v==='-1') return -1; if(v==='后'||v==='后排'||v==='1') return 1; if(v==='左'||v==='左侧') return -1; if(v==='右'||v==='右侧') return 1; return 0; }
function readFile(file){
  return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsText(file,'utf-8'); });
}
async function handleRosterFile(file){
  const name=file.name.toLowerCase();
  if(name.endsWith('.xlsx')||name.endsWith('.xls')){
    // 用 SheetJS 解析 xlsx（从 CDN 加载）
    if(!window.XLSX){
      await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
    }
    const data=await file.arrayBuffer();
    const wb=XLSX.read(data);
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header:1});
    roster=[];
    rows.forEach((r,i)=>{
      if(i===0&&r.join('').match(/姓名|性别|name|gender/i)) return;
      const cells=r.map(x=>String(x==null?'':x).trim());
      let name='',gender='',no=0;
      cells.forEach((cv,ci)=>{
        if(/^[\u4e00-\u9fa5]{2,4}$/.test(cv)&&cv!=='男'&&cv!=='女'&&!name) name=cv;
        if(cv==='男'||cv==='女') gender=cv;
      });
      cells.forEach(cv=>{ const n=parseInt(cv); if(!isNaN(n)&&n>0&&n<1000) no=n; });
      if(name&&!roster.find(s=>s.name===name)) roster.push({name,gender:gender==='女'?'女':'男',no});
    });
  } else {
    roster=parseRosterCSV(await readFile(file));
  }
  toast('名单导入成功：'+roster.length+' 人 ✓');
  render(); markDirty();
}
async function handleSurveyFile(file){
  await readFile(file).then(parseSurveyCSV);
  toast('调查数据导入成功 ✓'); render(); markDirty();
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
  if(current.podium&&current.podium[0]&&current.podium[0].student){
    const st=current.podium[0].student;
    lines.push(['讲台旁','-',st.no||'',st.name,st.gender,'讲台旁'].join(','));
  }
  const blob=new Blob(['\uFEFF'+lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='seats.csv'; a.click();
}

// ---------- 轮询同步（双通道：Pages 5秒 + 内容API 60秒）----------
function syncLabel(st){
  const t=st&&st.updated_at?new Date(st.updated_at).toLocaleTimeString('zh-CN'):'';
  return t?('已同步 · 更新于 '+t):'已连接';
}
async function poll(){
  try{
    const st=await fetchRawState();
    if(st&&st.version&&st.updated_at!==lastSavedAt&&!dirty){
      applyState(st); render();
      setSync(syncLabel(st), true);
    }
  }catch(e){ /* 静默 */ }
}
// 内容API 因未登录速率限制(60/h)不可靠，改由 jsDelivr + Pages 双 CDN 轮询保证实时

// ---------- 事件 ----------
function init(){
  const saved=localStorage.getItem('gh_token');
  if(saved){ isAdmin=true; $('ghToken').value='********'; setSync('管理员模式 · 已连接', true); }
  $('btnSaveToken').addEventListener('click',()=>{
    const v=$('ghToken').value.trim();
    if(!v||v==='********'){ toast('请输入有效 Token',true); return; }
    localStorage.setItem('gh_token',v); isAdmin=true; setSync('管理员模式 · 已连接', true); toast('Token 已保存 ✓');
  });
  $('btnClearToken').addEventListener('click',()=>{ localStorage.removeItem('gh_token'); isAdmin=false; $('ghToken').value=''; setSync('访客模式 · 只读', false); toast('已切换为访客模式'); });
  $('btnArrange').addEventListener('click',doArrange);
  $('btnClear').addEventListener('click',()=>{ current=null; selected=null; render(); });
  $('btnRotRow').addEventListener('click',()=>{ if(!current){toast('请先生成排位',true);return;} current=rotate(current,'row'); render(); markDirty(); toast('前后轮换 ✓'); });
  $('btnRotColKeep').addEventListener('click',()=>{ if(!current){toast('请先生成排位',true);return;} current=rotate(current,'colkeep'); render(); markDirty(); toast('左右轮换（保女生列）✓'); });
  $('btnRotColGroup').addEventListener('click',()=>{ if(!current){toast('请先生成排位',true);return;} current=rotate(current,'colgroup'); render(); markDirty(); toast('左右大组轮换 ✓'); });
  $('btnSave').addEventListener('click',async()=>{
    if(!current){ toast('请先生成排位',true); return; }
    setSync('正在保存到 GitHub…', true);
    try{ await saveState(); dirty=false; setSync('已同步 · 更新于 '+new Date(lastSavedAt).toLocaleTimeString('zh-CN'), true); toast('已保存并同步到网站 ✓'); }
    catch(e){ setSync('保存失败', false); toast('保存失败：'+e.message, true); }
  });
  $('btnCsv').addEventListener('click',exportCSV);
  $('btnResetRoster').addEventListener('click',()=>{ location.reload(); });
  $('fileRoster').addEventListener('change',e=>{ if(e.target.files[0]) handleRosterFile(e.target.files[0]); e.target.value=''; });
  $('fileSurvey').addEventListener('change',e=>{ if(e.target.files[0]) handleSurveyFile(e.target.files[0]); e.target.value=''; });
  $('randomize').addEventListener('change',()=>{ if($('randomize').checked){ $('useHeight').checked=false; $('usePref').checked=false; } });
}

// ---------- 启动 ----------
(async function boot(){
  init();
  // 尝试读取名单
  try{
    const r=await fetch(`${SYNC.rawBase}/${SYNC.owner}/${SYNC.repo}/${SYNC.branch}/docs/data/roster.json?cb=`+Date.now(), {cache:'no-store'});
    if(r.ok) roster=await r.json();
  }catch(e){}
  if(!roster||!roster.length){
    try{ const r=await fetch('data/roster.json'); roster=await r.json(); }catch(e){}
  }
  layout=JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
  // 尝试读取共享状态
  try{
    const ok=await fetchState();
    if(ok){ setSync('已同步 · 更新于 '+(lastSavedAt?new Date(lastSavedAt).toLocaleTimeString('zh-CN'):''), true); }
    else { current=null; setSync('暂无共享数据', false); }
  }catch(e){
    current=null; setSync('网站已就绪（请老师保存后同步）', false);
  }
  render();
  // 轮询：5秒一次，Pages + raw 双源取最新（老师保存后 Pages 自动重建，约1-2分钟内访客看到）
  setInterval(poll, 5000);
  $('viewerMsg').style.display = isAdmin?'none':'block';
})();
