let authToken = localStorage.getItem('bot_token') || '';
function apiH() { return { 'Content-Type':'application/json', 'x-auth-token': authToken }; }

async function doLogin() {
  const pass = document.getElementById('login-pass').value;
  document.getElementById('login-error').textContent = '';
  try {
    const res = await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pass})});
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    authToken = d.token; localStorage.setItem('bot_token',authToken); showApp();
  } catch(e){ document.getElementById('login-error').textContent = e.message||'Senha incorreta.'; }
}
function doLogout() {
  localStorage.removeItem('bot_token'); authToken='';
  document.getElementById('app').style.display='none';
  document.getElementById('login-screen').classList.add('show');
  document.getElementById('login-pass').value='';
}
async function checkAuth() {
  if (!authToken){ document.getElementById('login-screen').classList.add('show'); return; }
  try { const r=await fetch('/api/status',{headers:apiH()}); if(r.status===401){doLogout();return;} showApp(); } catch{ showApp(); }
}
function showApp() {
  document.getElementById('login-screen').classList.remove('show');
  document.getElementById('app').style.display='block';
  loadAll();
}

function showTab(name,btn) {
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active'); btn.classList.add('active');
  if(name==='financeiro') renderFinanceiro();
  if(name==='compras') renderCompras(7);
  if(name==='recuperacao') renderRecuperacao();
  if(name==='historico') loadHistorico();
  if(name==='relatorios') setRelPeriod('month');
}

function closeModal(id){ document.getElementById(id).classList.remove('show'); }
window.addEventListener('click',e=>{ document.querySelectorAll('.modal').forEach(m=>{ if(e.target===m) m.classList.remove('show'); }); });

let statusData={personal:{},work:{}}; let currentQRTab='personal';
async function checkStatus() {
  try { const r=await fetch('/api/status',{headers:apiH()}); if(r.status===401) return; statusData=await r.json(); updateStatusBtn('personal'); updateStatusBtn('work'); renderQR(); } catch{}
}
function updateStatusBtn(k) {
  const s=statusData[k]||{}; const btn=document.getElementById('status-'+k); if(!btn) return;
  btn.className='wa-status '+(s.status||'loading');
  const i={connected:'✅',qr:'📷',loading:'⏳'};
  btn.innerHTML=`<span class="dot"></span><span>${i[s.status]||'⏳'} ${s.label||k}</span>`;
}
function showQR(k){ document.getElementById('qr-modal').classList.add('show'); switchQRTab(k); }
function switchQRTab(k) {
  currentQRTab=k;
  document.getElementById('tab-personal').className='qr-tab'+(k==='personal'?' active':'');
  document.getElementById('tab-work').className='qr-tab'+(k==='work'?' active':'');
  renderQR();
}
function renderQR() {
  const s=statusData[currentQRTab]||{};
  const img=document.getElementById('qr-img'),load=document.getElementById('qr-loading'),conn=document.getElementById('qr-connected');
  if(s.status==='connected'){img.style.display='none';load.style.display='none';conn.style.display='block';}
  else if(s.status==='qr'&&s.qr){load.style.display='none';conn.style.display='none';img.src=s.qr;img.style.display='block';}
  else{img.style.display='none';conn.style.display='none';load.style.display='block';}
}

let allClients=[],allServers=[];
let currentPage=1;
async function loadAll(){ await Promise.all([loadClients(),loadServers()]); checkStatus(); }

async function loadClients() {
  const r=await fetch('/api/clients',{headers:apiH()}); if(r.status===401){doLogout();return;}
  allClients=await r.json();
  const today=new Date(); today.setHours(0,0,0,0);
  const in7=new Date(today); in7.setDate(in7.getDate()+7);
  const todayStr=new Date().toISOString().split('T')[0];
  const active=allClients.filter(c=>c.status==='active'&&c.dueDate>=todayStr);
  const overdue=allClients.filter(c=>c.status==='active'&&c.dueDate<todayStr);
  const revenue=active.reduce((s,c)=>s+monthlyValue(c),0);
  const expiring=active.filter(c=>{const d=new Date(c.dueDate+'T12:00:00');return d>=today&&d<=in7;}).length;
  document.getElementById('stat-active').value=active.length;
  document.getElementById('stat-revenue').textContent=fmtMoney(revenue);
  document.getElementById('stat-expiring').textContent=expiring;
  document.getElementById('stat-overdue').value=overdue.length;
  document.getElementById('stat-active-sub').textContent=active.length+' clientes ativos';
  document.getElementById('stat-overdue-sub').textContent=overdue.length+' vencido'+(overdue.length!==1?'s':'');
  const totalCostTop=active.reduce((s,cc)=>{const sv=allServers.find(x=>x.id===cc.serverId);return s+(sv?sv.costPerCredit*(cc.credits||1):0);},0);
  document.getElementById('stat-profit').textContent=fmtMoney(revenue-totalCostTop);
  document.getElementById('stat-cost-sub').textContent='custo: '+fmtMoney(totalCostTop)+'/mês';
  renderClients();
}
async function loadServers() {
  const r=await fetch('/api/servers',{headers:apiH()}); allServers=await r.json();
  renderServers(); populateServerSelects();
}

function planMonths(plan) {
  const map={mensal:1,bimestral:2,trimestral:3,semestral:6,anual:12};
  return map[(plan||'').toLowerCase()]||1;
}
function monthlyValue(client){ return(client.price||0)/planMonths(client.plan); }
function getDaysLeft(d){ const t=new Date();t.setHours(0,0,0,0);const due=new Date(d+'T12:00:00');due.setHours(0,0,0,0);return Math.round((due-t)/86400000); }
function fmtDate(d){ const[y,m,day]=d.split('-');return`${day}/${m}/${y}`; }
function fmtMoney(v){ return'R$ '+Number(v||0).toFixed(2).replace('.',','); }
function fmtPhone(p){ const n=p.replace(/\D/g,''); if(n.length===13) return`+${n.slice(0,2)} (${n.slice(2,4)}) ${n.slice(4,9)}-${n.slice(9)}`; if(n.length===11) return`(${n.slice(0,2)}) ${n.slice(2,7)}-${n.slice(7)}`; return p; }

function statusBadge(c) {
  if(c.status==='inactive') return'<span class="badge badge-inactive">Inativo</span>';
  const d=getDaysLeft(c.dueDate);
  if(d>7) return`<span class="badge badge-ok">OK (${d}d)</span>`;
  if(d>=1) return`<span class="badge badge-warn">Vence em ${d}d</span>`;
  if(d===0) return'<span class="badge badge-danger">Vence hoje</span>';
  return`<span class="badge badge-overdue">Vencido há ${Math.abs(d)}d</span>`;
}
function senderBadge(s){ return s==='work'?'<span class="badge badge-work">💼</span>':'<span class="badge badge-personal">📱</span>'; }
function serverName(id){ const s=allServers.find(sv=>sv.id===id); return s?`<span class="badge badge-server">${s.name}</span>`:'<span style="color:#b2bec3">—</span>'; }

function calcProfit(c) {
  const sv=allServers.find(s=>s.id===c.serverId);
  const mv=monthlyValue(c);
  const cost=sv?sv.costPerCredit*(c.credits||1):0;
  return{cost,profit:mv-cost,monthly:mv};
}

function filterChanged() {
  currentPage = 1;
  renderClients();
}

function renderClients() {
  const q       = document.getElementById('search').value.toLowerCase();
  const fStatus = document.getElementById('filter-status').value;
  const fService= document.getElementById('filter-service').value;
  const fServer = document.getElementById('filter-server').value;
  const fDue    = document.getElementById('filter-due').value;
  const perPage = parseInt(document.getElementById('per-page')?.value || '25');
  const today   = new Date().toISOString().split('T')[0];

  const filtered = allClients.filter(c => {
    if (q && !c.name.toLowerCase().includes(q) && !c.phone.includes(q) && !(c.plan||'').toLowerCase().includes(q)) return false;
    if (fStatus === 'active'   && !(c.status === 'active' && c.dueDate >= today)) return false;
    if (fStatus === 'overdue'  && !(c.status === 'active' && c.dueDate < today))  return false;
    if (fStatus === 'inactive' && c.status !== 'inactive') return false;
    if (fService && c.serviceType !== fService) return false;
    if (fServer === '__none__' && c.serverId)                          return false;
    if (fServer && fServer !== '__none__' && c.serverId !== fServer)   return false;
    if (fDue) {
      const d = getDaysLeft(c.dueDate);
      if (fDue === 'today'    && d !== 0)            return false;
      if (fDue === '7d'       && (d < 0 || d > 7))  return false;
      if (fDue === '15d'      && (d < 0 || d > 15)) return false;
      if (fDue === 'past_due' && d >= 0)             return false;
      if (fDue === 'ok'       && d < 15)             return false;
    }
    return true;
  }).sort((a,b) => getDaysLeft(a.dueDate) - getDaysLeft(b.dueDate));

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * perPage;
  const pageItems = filtered.slice(start, start + perPage);

  const countEl = document.getElementById('filter-count');
  if (countEl) {
    const end = Math.min(start + perPage, filtered.length);
    countEl.textContent = filtered.length
      ? `${start+1}–${end} de ${filtered.length} (total: ${allClients.length})`
      : `0 de ${allClients.length}`;
  }

  const tbody = document.getElementById('clients-tbody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="11">Nenhum cliente encontrado</td></tr>';
    renderPagination(0, 0, 0);
    return;
  }
  tbody.innerHTML = pageItems.map(c => {
    const p = calcProfit(c);
    const profitHtml = p ? `<span style="color:${p.profit>=0?'#2e7d32':'#c62828'};font-weight:700">${fmtMoney(p.profit)}</span>` : '<span style="color:#b2bec3">—</span>';
    return `<tr>
      <td><strong>${c.name}</strong></td>
      <td>${fmtPhone(c.phone)}</td>
      <td>${c.plan||'—'}</td>
      <td>${fmtMoney(c.price)}</td>
      <td>${serverName(c.serverId)}</td>
      <td style="text-align:center">${c.credits||1}</td>
      <td>${profitHtml}</td>
      <td>${fmtDate(c.dueDate)}</td>
      <td>${senderBadge(c.sender)}</td>
      <td>${statusBadge(c)}</td>
      <td><div class="actions">
        <button class="btn-action btn-edit" onclick="openEdit('${c.id}')">✏️</button>
        <button class="btn-action btn-renew" onclick="openPaymentModal('${c.id}')">💰 Renovar</button>
        <button class="btn-action btn-test" onclick="testClient('${c.id}')">📨</button>
        <button class="btn-action btn-toggle" onclick="toggleClient('${c.id}','${c.status}')">${c.status==='active'?'⏸':'▶'}</button>
        <button class="btn-action btn-delete" onclick="deleteClient('${c.id}','${c.name}')">🗑</button>
      </div></td>
    </tr>`;
  }).join('');

  renderPagination(totalPages, filtered.length, perPage);
}

function renderPagination(totalPages, total, perPage) {
  const el = document.getElementById('clients-pagination');
  if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  const prev = `<button class="page-btn" ${currentPage===1?'disabled':''} onclick="goToPage(${currentPage-1})">‹ Anterior</button>`;
  const next = `<button class="page-btn" ${currentPage===totalPages?'disabled':''} onclick="goToPage(${currentPage+1})">Próximo ›</button>`;

  let pages = '';
  const delta = 2;
  const left  = currentPage - delta;
  const right = currentPage + delta;

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= left && i <= right)) {
      pages += `<button class="page-btn${i===currentPage?' active':''}" onclick="goToPage(${i})">${i}</button>`;
    } else if (i === left - 1 || i === right + 1) {
      pages += `<span class="page-ellipsis">…</span>`;
    }
  }

  el.innerHTML = prev + pages + next;
}

function goToPage(page) {
  currentPage = page;
  renderClients();
  document.getElementById('tab-clientes').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetFilters() {
  ['search','filter-status','filter-service','filter-server','filter-due'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  currentPage = 1;
  renderClients();
}

function populateServerSelects() {
  ['f-server','edit-server'].forEach(id => {
    const sel = document.getElementById(id); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">Servidor (opcional)</option>';
    allServers.forEach(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; sel.appendChild(o); });
    sel.value = cur;
  });
  const fSv = document.getElementById('filter-server');
  if (fSv) {
    const cur = fSv.value;
    fSv.innerHTML = '<option value="">Todos os servidores</option><option value="__none__">Sem servidor</option>';
    allServers.forEach(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; fSv.appendChild(o); });
    fSv.value = cur;
  }
}

function openEdit(id) {
  const c=allClients.find(x=>x.id===id); if(!c) return;
  document.getElementById('edit-id').value=c.id;
  document.getElementById('edit-name').value=c.name;
  document.getElementById('edit-phone').value=c.phone;
  document.getElementById('edit-plan').value=c.plan||'';
  document.getElementById('edit-price').value=c.price||'';
  const credVal=Math.min(c.credits||1,5); document.getElementById('edit-credits').value=credVal;
  document.getElementById('edit-date').value=c.dueDate;
  document.getElementById('edit-sender').value=c.sender||'personal';
  document.getElementById('edit-server').value=c.serverId||'';
  document.getElementById('edit-service').value=c.serviceType||'iptv';
  document.getElementById('edit-status').value=c.status||'active';
  populateServerSelects();
  document.getElementById('edit-modal').classList.add('show');
}
async function saveEdit() {
  const id=document.getElementById('edit-id').value;
  const name=document.getElementById('edit-name').value.trim();
  const phone=document.getElementById('edit-phone').value.trim();
  const plan=document.getElementById('edit-plan').value;
  const price=document.getElementById('edit-price').value;
  const credits=document.getElementById('edit-credits').value;
  const dueDate=document.getElementById('edit-date').value;
  const sender=document.getElementById('edit-sender').value;
  const serverId=document.getElementById('edit-server').value;
  const serviceType=document.getElementById('edit-service').value;
  const status=document.getElementById('edit-status').value;
  if(!name||!plan||!price||!dueDate) return toast('Preencha pelo menos nome, plano, valor e vencimento!','error');
  try {
    const res=await fetch(`/api/clients/${id}`,{method:'PUT',headers:apiH(),body:JSON.stringify({name,phone:phone?phone.replace(/\D/g,''):'',plan,price:parseFloat(price),credits:parseInt(credits)||1,dueDate,sender:sender||'personal',serverId:serverId||null,status,serviceType})});
    if(!res.ok) throw new Error((await res.json()).error);
    closeModal('edit-modal'); toast('✅ Cliente atualizado!','success'); loadClients();
  } catch(e){toast(e.message,'error');}
}

async function addClient() {
  const name=document.getElementById('f-name').value.trim();
  const phone=document.getElementById('f-phone').value.trim();
  const plan=document.getElementById('f-plan').value;
  const price=document.getElementById('f-price').value;
  const credits=document.getElementById('f-credits').value||1;
  const dueDate=document.getElementById('f-date').value;
  const sender=document.getElementById('f-sender').value;
  const serverId=document.getElementById('f-server').value;
  const serviceType=document.getElementById('f-service').value;
  if(!name||!phone||!plan||!price||!dueDate||!sender) return toast('Preencha todos os campos obrigatórios!','error');
  try {
    const res=await fetch('/api/clients',{method:'POST',headers:apiH(),body:JSON.stringify({name,phone,plan,price,credits,dueDate,sender,serverId,serviceType})});
    if(!res.ok) throw new Error((await res.json()).error);
    ['f-name','f-phone','f-price','f-date'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('f-plan').value=''; document.getElementById('f-credits').value='1';
    document.getElementById('f-sender').value=''; document.getElementById('f-server').value='';
    toast(`✅ ${name} cadastrado!`,'success'); loadClients();
  } catch(e){toast(e.message,'error');}
}

async function testClient(id) {
  toast('📨 Enviando teste...','');
  try {
    const res=await fetch(`/api/clients/${id}/test`,{method:'POST',headers:apiH()});
    const d=await res.json(); if(!res.ok) throw new Error(d.error);
    toast('✅ Mensagem enviada!','success');
  } catch(e){toast('❌ '+e.message,'error');}
}
async function toggleClient(id,s) {
  const ns=s==='active'?'inactive':'active';
  await fetch(`/api/clients/${id}`,{method:'PUT',headers:apiH(),body:JSON.stringify({status:ns})});
  if(ns==='active') {
    const c=allClients.find(x=>x.id===id);
    const today=new Date().toISOString().split('T')[0];
    if(c&&c.dueDate<today) {
      await fetch(`/api/clients/${id}/renew`,{method:'POST',headers:apiH()});
      toast('▶ Ativado e renovado!','success');
    } else { toast('▶ Ativado!','success'); }
  } else { toast('⏸ Pausado!','success'); }
  loadClients();
}
async function deleteClient(id,name) {
  if(!confirm(`Excluir "${name}"?`)) return;
  await fetch(`/api/clients/${id}`,{method:'DELETE',headers:apiH()});
  toast(`🗑 ${name} excluído.`,''); loadClients();
}

function renderServers() {
  const tbody=document.getElementById('servers-tbody');
  if(!allServers.length){tbody.innerHTML='<tr class="empty-row"><td colspan="7">Nenhum servidor cadastrado</td></tr>';return;}
  tbody.innerHTML=allServers.map(s=>{
    const cls=allClients.filter(c=>c.serverId===s.id&&c.status==='active');
    const totalCredits=cls.reduce((t,c)=>t+(c.credits||1),0);
    return`<tr>
      <td><strong>${s.name}</strong></td>
      <td style="color:var(--red);font-weight:700">${fmtMoney(s.costPerCredit)}</td>
      <td>${cls.length}</td>
      <td style="text-align:center">${totalCredits}</td>
      <td style="color:var(--red);font-weight:700">${fmtMoney(s.costPerCredit*totalCredits)}</td>
      <td>${s.notes||'—'}</td>
      <td><button class="btn-action btn-delete" onclick="deleteServer('${s.id}','${s.name}')">🗑</button></td>
    </tr>`;
  }).join('');
}
async function addServer() {
  const name=document.getElementById('sv-name').value.trim();
  const cost=document.getElementById('sv-cost').value;
  const notes=document.getElementById('sv-notes').value.trim();
  if(!name||!cost) return toast('Nome e custo são obrigatórios!','error');
  try {
    const res=await fetch('/api/servers',{method:'POST',headers:apiH(),body:JSON.stringify({name,costPerCredit:parseFloat(cost),notes})});
    if(!res.ok) throw new Error((await res.json()).error);
    ['sv-name','sv-cost','sv-notes'].forEach(id=>document.getElementById(id).value='');
    toast(`✅ Servidor "${name}" cadastrado!`,'success'); loadServers();
  } catch(e){toast(e.message,'error');}
}
async function deleteServer(id,name) {
  const inUse=allClients.some(c=>c.serverId===id);
  if(!confirm(inUse?`"${name}" tem clientes. Excluir mesmo assim?`:`Excluir "${name}"?`)) return;
  await fetch(`/api/servers/${id}`,{method:'DELETE',headers:apiH()});
  toast('🗑 Servidor excluído.',''); loadServers();
}

function renderFinanceiro() {
  const todayStr=new Date().toISOString().split('T')[0];
  const active=allClients.filter(c=>c.status==='active'&&c.dueDate>=todayStr);
  let totalRevenue=0,totalCost=0;
  const clientRows=active.map(c=>{
    const sv=allServers.find(s=>s.id===c.serverId);
    const revenue=monthlyValue(c);
    const cost=sv?sv.costPerCredit*(c.credits||1):0;
    const profit=revenue-cost;
    totalRevenue+=revenue; totalCost+=cost;
    return`<tr>
      <td><strong>${c.name}</strong></td>
      <td>${sv?sv.name:'—'}</td>
      <td style="text-align:center">${c.credits||1}</td>
      <td>${c.plan||'—'}</td>
      <td>${fmtMoney(c.price)}<br><span style="font-size:.75rem;color:#636e72">${fmtMoney(revenue)}/mês</span></td>
      <td style="color:var(--red)">${fmtMoney(cost)}</td>
      <td style="color:${profit>=0?'#2e7d32':'#c62828'};font-weight:700">${fmtMoney(profit)}</td>
    </tr>`;
  }).join('');
  document.getElementById('fin-clients-tbody').innerHTML=clientRows||'<tr class="empty-row"><td colspan="7">Nenhum cliente ativo</td></tr>';
  const byServer={};
  active.forEach(c=>{
    const sv=allServers.find(s=>s.id===c.serverId);
    const key=sv?sv.id:'__none__';
    if(!byServer[key]) byServer[key]={name:sv?sv.name:'Sem servidor',revenue:0,cost:0,count:0};
    byServer[key].revenue+=c.price||0;
    byServer[key].cost+=sv?sv.costPerCredit*(c.credits||1):0;
    byServer[key].count++;
  });
  document.getElementById('fin-servers-tbody').innerHTML=Object.values(byServer).map(s=>`<tr>
    <td><strong>${s.name}</strong></td><td>${s.count}</td>
    <td>${fmtMoney(s.revenue)}</td>
    <td style="color:var(--red)">${fmtMoney(s.cost)}</td>
    <td style="color:${(s.revenue-s.cost)>=0?'#2e7d32':'#c62828'};font-weight:700">${fmtMoney(s.revenue-s.cost)}</td>
  </tr>`).join('')||'<tr class="empty-row"><td colspan="5">Nenhum dado</td></tr>';
  const cashflow=active.reduce((s,c)=>s+(c.price||0),0);
  document.getElementById('fin-cashflow').textContent=fmtMoney(cashflow);
  document.getElementById('fin-revenue').textContent=fmtMoney(totalRevenue);
  document.getElementById('fin-cost').value=totalCost;
  document.getElementById('fin-profit').textContent=fmtMoney(totalRevenue-totalCost);
  document.getElementById('fin-clients').value=active.length;
  document.getElementById('fin-clients-sub').textContent=active.length+' clientes ativos';
  document.getElementById('fin-cost-sub').textContent='seu custo: '+fmtMoney(totalCost)+'/mês';
}

let tt;
function toast(msg,type=''){
  const el=document.getElementById('toast');
  el.textContent=msg; el.className='show'+(type?' '+type:'');
  clearTimeout(tt); tt=setTimeout(()=>el.className='',4000);
}

function renderCompras(days) {
  days=days||7;
  document.getElementById('cp-periodo').textContent='Mostrando: próximos '+days+' dias';
  const today=new Date(); today.setHours(0,0,0,0);
  const limit=new Date(today); limit.setDate(limit.getDate()+days);
  const expiring=allClients.filter(c=>{if(c.status!=='active') return false; const d=new Date(c.dueDate+'T12:00:00'); d.setHours(0,0,0,0); return d>=today&&d<=limit;});
  const c7=allClients.filter(c=>{if(c.status!=='active') return false; const d=new Date(c.dueDate+'T12:00:00'); d.setHours(0,0,0,0); const l=new Date(today); l.setDate(l.getDate()+7); return d>=today&&d<=l;});
  const c15=allClients.filter(c=>{if(c.status!=='active') return false; const d=new Date(c.dueDate+'T12:00:00'); d.setHours(0,0,0,0); const l=new Date(today); l.setDate(l.getDate()+15); return d>=today&&d<=l;});
  document.getElementById('cp-7d-clients').textContent=c7.length;
  document.getElementById('cp-7d-credits').textContent=c7.reduce((s,c)=>s+(c.credits||1),0)+' créd';
  document.getElementById('cp-15d-clients').textContent=c15.length;
  document.getElementById('cp-15d-credits').textContent=c15.reduce((s,c)=>s+(c.credits||1),0)+' créd';
  const bySv={};
  expiring.forEach(c=>{
    const sv=allServers.find(s=>s.id===c.serverId);
    const key=sv?sv.id:'__none__';
    if(!bySv[key]) bySv[key]={name:sv?sv.name:'Sem servidor',credits:0,cost:0,revenue:0,count:0};
    bySv[key].credits+=(c.credits||1);
    bySv[key].cost+=sv?sv.costPerCredit*(c.credits||1):0;
    bySv[key].revenue+=c.price||0;
    bySv[key].count++;
  });
  const tbody=document.getElementById('cp-tbody');
  const rows=Object.values(bySv);
  tbody.innerHTML=rows.length?rows.map(s=>'<tr><td><strong>'+s.name+'</strong></td><td>'+s.count+'</td><td><span style="background:#fce4ec;color:#c62828;font-weight:800;padding:4px 12px;border-radius:20px">'+s.credits+' créditos</span></td><td style="color:var(--red);font-weight:700">'+fmtMoney(s.cost)+'</td><td style="color:#2e7d32;font-weight:700">'+fmtMoney(s.revenue)+'</td><td style="color:var(--purple);font-weight:700">'+fmtMoney(s.revenue-s.cost)+'</td></tr>').join(''):'<tr class="empty-row"><td colspan="6">Nenhum cliente vence neste período</td></tr>';
  const ctbody=document.getElementById('cp-clients-tbody');
  ctbody.innerHTML=expiring.length?expiring.sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).map(c=>{
    const sv=allServers.find(s=>s.id===c.serverId);
    const dl=getDaysLeft(c.dueDate);
    const urg=dl<=3?'color:var(--red);font-weight:700':dl<=7?'color:var(--orange);font-weight:700':'';
    return'<tr><td><strong>'+c.name+'</strong></td><td style="'+urg+'">'+fmtDate(c.dueDate)+' ('+(dl===0?'hoje':dl+'d')+')</td><td>'+(c.plan||'—')+'</td><td>'+(sv?'<span class="badge badge-server">'+sv.name+'</span>':'—')+'</td><td style="text-align:center">'+(c.credits||1)+'</td><td>'+fmtMoney(c.price)+'</td></tr>';
  }).join(''):'<tr class="empty-row"><td colspan="6">Nenhum cliente</td></tr>';
}

let bannerBase64=null,bannerMime=null;
function previewBanner(input) {
  const file=input.files[0]; if(!file) return;
  bannerMime=file.type;
  const reader=new FileReader();
  reader.onload=e=>{
    const data=e.target.result; bannerBase64=data.split(',')[1];
    document.getElementById('banner-preview').src=data;
    document.getElementById('banner-preview').style.display='block';
    document.getElementById('upload-placeholder').style.display='none';
    document.getElementById('banner-name').textContent=file.name;
    document.getElementById('clear-banner-btn').style.display='inline-block';
  };
  reader.readAsDataURL(file);
}
function clearBanner() {
  bannerBase64=null; bannerMime=null;
  document.getElementById('banner-preview').style.display='none';
  document.getElementById('upload-placeholder').style.display='block';
  document.getElementById('banner-name').textContent='';
  document.getElementById('clear-banner-btn').style.display='none';
  document.getElementById('banner-input').value='';
}

function renderRecuperacao() {
  const today=new Date(); today.setHours(0,0,0,0);
  const overdue=allClients.filter(c=>c.status==='active'&&new Date(c.dueDate+'T12:00:00')<today);
  const withPhone=overdue.filter(c=>c.phone);
  document.getElementById('rec-total').textContent=overdue.length;
  document.getElementById('rec-revenue').textContent=fmtMoney(overdue.reduce((s,c)=>s+(c.price||0),0));
  document.getElementById('rec-withphone').textContent=withPhone.length;
  const tbody=document.getElementById('rec-tbody');
  if(!overdue.length){tbody.innerHTML='<tr class="empty-row"><td colspan="7">Nenhum cliente vencido 🎉</td></tr>';return;}
  tbody.innerHTML=overdue.sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).map(c=>{
    const days=Math.abs(getDaysLeft(c.dueDate));
    const hasPhone=!!c.phone;
    return'<tr><td class="checkbox-col"><input type="checkbox" class="rec-check" value="'+c.id+'" '+(hasPhone?'':'disabled title="Sem WhatsApp"')+' onchange="updateSelectedCount()" /></td><td><strong>'+c.name+'</strong></td><td><span class="badge-overdue-days">há '+days+' dia'+(days>1?'s':'')+'</span></td><td>'+(c.plan||'—')+'</td><td>'+fmtMoney(c.price)+'</td><td>'+(hasPhone?'✅ '+fmtPhone(c.phone):'<span style="color:#b2bec3">Sem número</span>')+'</td><td>'+senderBadge(c.sender)+'</td></tr>';
  }).join('');
  updateSelectedCount();
}
function updateSelectedCount(){ document.getElementById('rec-selected').textContent=document.querySelectorAll('.rec-check:checked').length; }
function selectAllOverdue(){ document.querySelectorAll('.rec-check:not(:disabled)').forEach(cb=>cb.checked=true); updateSelectedCount(); }
function deselectAll(){ document.querySelectorAll('.rec-check').forEach(cb=>cb.checked=false); updateSelectedCount(); }

async function fireBlast() {
  const msg=document.getElementById('blast-msg').value.trim();
  if(!msg) return toast('Escreva uma mensagem!','error');
  const checked=[...document.querySelectorAll('.rec-check:checked')].map(cb=>cb.value);
  if(!checked.length) return toast('Selecione pelo menos um cliente!','error');
  if(!confirm('Disparar para '+checked.length+' cliente(s)?')) return;
  const btn=document.getElementById('blast-btn');
  btn.disabled=true; btn.textContent='⏳ Enviando...';
  toast('📨 Enviando...','');
  try {
    const body={clientIds:checked,message:msg};
    if(bannerBase64){body.imageBase64=bannerBase64;body.imageMime=bannerMime;}
    const res=await fetch('/api/blast',{method:'POST',headers:apiH(),body:JSON.stringify(body)});
    const data=await res.json();
    if(!res.ok) throw new Error(data.error);
    const resultDiv=document.getElementById('blast-result');
    resultDiv.style.display='block';
    document.getElementById('blast-result-content').innerHTML='<p style="color:#2e7d32;font-weight:700;margin-bottom:12px">✅ Enviado para '+data.sent.length+' cliente(s)</p>'+(data.sent.length?'<p style="font-size:.85rem;color:#636e72">'+data.sent.map(s=>s.name).join(', ')+'</p>':'')+(data.failed.length?'<p style="color:#c62828;font-weight:700;margin-top:12px">❌ Falhou: '+data.failed.map(s=>s.name+' ('+s.reason+')').join(', ')+'</p>':'');
    toast('✅ '+data.sent.length+' enviado(s)','success');
  } catch(e){toast('❌ '+e.message,'error');}
  finally{btn.disabled=false;btn.textContent='📨 Disparar para selecionados';}
}

let allLogs=[];
async function loadHistorico() {
  const res=await fetch('/api/logs',{headers:apiH()}); allLogs=await res.json(); renderHistorico();
}
function renderHistorico() {
  const filter=document.getElementById('log-filter').value;
  const filtered=filter?allLogs.filter(l=>l.type===filter):allLogs;
  const tbody=document.getElementById('historico-tbody');
  if(!filtered.length){tbody.innerHTML='<tr class="empty-row"><td colspan="4">Nenhuma atividade registrada</td></tr>';return;}
  const icons={cobranca:'📨',renovacao:'🔄',ativacao:'▶',pausa:'⏸',recuperacao:'🎯',cadastro:'➕',exclusao:'🗑'};
  const labels={cobranca:'Cobrança',renovacao:'Renovação',ativacao:'Ativação',pausa:'Pausa',recuperacao:'Recuperação',cadastro:'Cadastro',exclusao:'Exclusão'};
  tbody.innerHTML=filtered.map(l=>{
    const d=new Date(l.createdAt);
    const dateStr=d.toLocaleDateString('pt-BR')+' '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    return'<tr class="log-row"><td style="color:#636e72;white-space:nowrap">'+dateStr+'</td><td><span class="badge-log-'+l.type+'">'+(icons[l.type]||'•')+' '+(labels[l.type]||l.type)+'</span></td><td><strong>'+l.clientName+'</strong></td><td style="color:#636e72">'+(l.detail||'')+'</td></tr>';
  }).join('');
}

async function sendManualBackup() {
  toast('📦 Enviando backup...','');
  try {
    const res=await fetch('/api/backup',{method:'POST',headers:apiH()});
    const d=await res.json(); if(!res.ok) throw new Error(d.error);
    toast('✅ '+d.message,'success');
  } catch(e){toast('❌ '+e.message,'error');}
}

function warnHighCredits(val,ctx) {
  const n=parseInt(val);
  if(n>=3){
    const sv=ctx==='edit'?allServers.find(s=>s.id===document.getElementById('edit-server').value):allServers.find(s=>s.id===document.getElementById('f-server').value);
    const cost=sv?sv.costPerCredit*n:0;
    if(!confirm('Atenção: você está adicionando '+n+' acessos.'+(cost?' Custo: R$ '+cost.toFixed(2)+'/mês.':'')+'\n\nConfirmar?')){
      document.getElementById(ctx==='edit'?'edit-credits':'f-credits').value='1';
    }
  }
}

async function runMigration() {
  if(!confirm('Corrigir todos os clientes com créditos > 3 para 1 acesso?')) return;
  try {
    const res=await fetch('/api/migrate/fix-credits',{method:'POST',headers:apiH()});
    const data=await res.json();
    toast(data.fixed===0?'✅ Nenhum cliente precisava de correção!':'✅ '+data.fixed+' cliente(s) corrigido(s)!','success');
    loadAll();
  } catch(e){toast('❌ '+e.message,'error');}
}

// ── Pagamentos ────────────────────────────────────────────────────────────────
let allPayments=[];

function openPaymentModal(id) {
  const cl=allClients.find(x=>x.id===id); if(!cl) return;
  document.getElementById('payment-client-id').value=cl.id;
  document.getElementById('payment-client-name').textContent='Cliente: '+cl.name+' — Plano: '+(cl.plan||'mensal')+' — '+fmtMoney(cl.price);
  document.getElementById('payment-amount').value=cl.price||'';
  document.getElementById('payment-service').value=cl.serviceType||'iptv';
  document.getElementById('payment-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('payment-note').value='';
  document.getElementById('payment-modal').classList.add('show');
}

async function savePayment() {
  const clientId=document.getElementById('payment-client-id').value;
  const amount=document.getElementById('payment-amount').value;
  const bank=document.getElementById('payment-bank').value;
  const service=document.getElementById('payment-service').value;
  const paidAt=document.getElementById('payment-date').value;
  const note=document.getElementById('payment-note').value;
  const cl=allClients.find(x=>x.id===clientId);
  if(!amount) return toast('Informe o valor recebido!','error');
  try {
    await fetch('/api/payments',{method:'POST',headers:apiH(),body:JSON.stringify({clientId,clientName:cl?.name||'',amount,bank,serviceType:service,note,paidAt})});
    await fetch('/api/clients/'+clientId+'/renew',{method:'POST',headers:apiH()});
    closeModal('payment-modal');
    toast('✅ Pagamento registrado e cliente renovado!','success');
    loadClients();
  } catch(e){toast('❌ '+e.message,'error');}
}

// ── Editar/Excluir Pagamentos ─────────────────────────────────────────────────
function openEditPayment(id) {
  const p=relPayments.find(x=>x.id===id); if(!p) return;
  document.getElementById('edit-payment-id').value=p.id;
  document.getElementById('edit-payment-client-name').textContent='Cliente: '+p.clientName;
  document.getElementById('edit-payment-amount').value=p.amount;
  document.getElementById('edit-payment-bank').value=p.bank;
  document.getElementById('edit-payment-service').value=p.serviceType||'iptv';
  document.getElementById('edit-payment-date').value=p.paidAt;
  document.getElementById('edit-payment-note').value=p.note||'';
  document.getElementById('edit-payment-modal').classList.add('show');
}

async function saveEditPayment() {
  const id=document.getElementById('edit-payment-id').value;
  const amount=document.getElementById('edit-payment-amount').value;
  const bank=document.getElementById('edit-payment-bank').value;
  const service=document.getElementById('edit-payment-service').value;
  const paidAt=document.getElementById('edit-payment-date').value;
  const note=document.getElementById('edit-payment-note').value;
  if(!amount) return toast('Informe o valor!','error');
  try {
    const res=await fetch('/api/payments/'+id,{method:'PUT',headers:apiH(),body:JSON.stringify({amount:parseFloat(amount),bank,serviceType:service,paidAt,note})});
    if(!res.ok) throw new Error((await res.json()).error);
    closeModal('edit-payment-modal');
    toast('✅ Pagamento atualizado!','success');
    loadRelatorios();
  } catch(e){toast('❌ '+e.message,'error');}
}

async function deletePayment(id,name) {
  if(!confirm('Excluir pagamento de "'+name+'"?')) return;
  try {
    const res=await fetch('/api/payments/'+id,{method:'DELETE',headers:apiH()});
    if(!res.ok) throw new Error((await res.json()).error);
    toast('🗑 Pagamento excluído.','');
    loadRelatorios();
  } catch(e){toast('❌ '+e.message,'error');}
}

// ── Relatórios ────────────────────────────────────────────────────────────────
let relPayments=[];

function setRelPeriod(type) {
  const now=new Date();
  let from,to;
  if(type==='month'){
    from=new Date(now.getFullYear(),now.getMonth(),1).toISOString().split('T')[0];
    to=new Date(now.getFullYear(),now.getMonth()+1,0).toISOString().split('T')[0];
  } else {
    from=new Date(now.getFullYear(),now.getMonth()-1,1).toISOString().split('T')[0];
    to=new Date(now.getFullYear(),now.getMonth(),0).toISOString().split('T')[0];
  }
  document.getElementById('rel-from').value=from;
  document.getElementById('rel-to').value=to;
  loadRelatorios();
}

async function loadRelatorios() {
  const from=document.getElementById('rel-from').value;
  const to=document.getElementById('rel-to').value;
  if(!from||!to){toast('Selecione o período!','error');return;}
  const res=await fetch('/api/payments?from='+from+'&to='+to,{headers:apiH()});
  relPayments=await res.json();
  const total=relPayments.reduce((s,p)=>s+p.amount,0);
  const iptv=relPayments.filter(p=>p.serviceType==='iptv').reduce((s,p)=>s+p.amount,0);
  const cs=relPayments.filter(p=>p.serviceType==='cs').reduce((s,p)=>s+p.amount,0);
  document.getElementById('rel-total').textContent=fmtMoney(total);
  document.getElementById('rel-iptv').textContent=fmtMoney(iptv);
  document.getElementById('rel-cs').textContent=fmtMoney(cs);
  document.getElementById('rel-count').textContent=relPayments.length+' pgtos';
  const byBank={};
  relPayments.forEach(p=>{if(!byBank[p.bank]) byBank[p.bank]={count:0,total:0}; byBank[p.bank].count++; byBank[p.bank].total+=p.amount;});
  document.getElementById('rel-bank-tbody').innerHTML=Object.entries(byBank).sort((a,b)=>b[1].total-a[1].total).map(([bank,d])=>`<tr><td><strong>${bank}</strong></td><td>${d.count}</td><td style="color:#2e7d32;font-weight:700">${fmtMoney(d.total)}</td><td style="color:#636e72">${total>0?Math.round(d.total/total*100):0}%</td></tr>`).join('')||'<tr class="empty-row"><td colspan="4">Nenhum pagamento</td></tr>';
  const todayStr=new Date().toISOString().split('T')[0];
  const overdue=allClients.filter(c=>c.status==='active'&&c.dueDate<todayStr);
  const overdueTotal=overdue.reduce((s,c)=>s+monthlyValue(c),0);
  document.getElementById('rel-overdue-total').textContent=fmtMoney(overdueTotal)+'/mês';
  document.getElementById('rel-overdue-tbody').innerHTML=overdue.sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).map(c=>`<tr><td><strong>${c.name}</strong></td><td style="color:#c62828">${Math.abs(getDaysLeft(c.dueDate))} dia(s)</td><td>${c.serviceType==='cs'?'📡 CS':'📺 IPTV'}</td><td>${fmtMoney(monthlyValue(c))}/mês</td></tr>`).join('')||'<tr class="empty-row"><td colspan="4">Nenhum vencido 🎉</td></tr>';
  renderExtrato();
}

function renderExtrato() {
  const filterService=document.getElementById('rel-filter-service').value;
  const filterBank=document.getElementById('rel-filter-bank').value;
  const filtered=relPayments.filter(p=>(!filterService||p.serviceType===filterService)&&(!filterBank||p.bank===filterBank)).sort((a,b)=>b.paidAt.localeCompare(a.paidAt));
  document.getElementById('rel-extrato-tbody').innerHTML=filtered.map(p=>`
    <tr>
      <td>${fmtDate(p.paidAt)}</td>
      <td><strong>${p.clientName}</strong></td>
      <td>${p.serviceType==='cs'?'📡 CS':'📺 IPTV'}</td>
      <td><span class="badge badge-server">${p.bank}</span></td>
      <td style="color:#2e7d32;font-weight:700">${fmtMoney(p.amount)}</td>
      <td style="color:#636e72;font-size:.82rem">${p.note||'—'}</td>
      <td><div class="actions">
        <button class="btn-action btn-edit" onclick="openEditPayment('${p.id}')">✏️</button>
        <button class="btn-action btn-delete" onclick="deletePayment('${p.id}','${p.clientName}')">🗑</button>
      </div></td>
    </tr>
  `).join('')||'<tr class="empty-row"><td colspan="7">Nenhum pagamento no período</td></tr>';
}

document.getElementById('f-date').min=new Date().toISOString().split('T')[0];
setTimeout(()=>{ if(authToken) setRelPeriod('month'); },2000);
checkAuth();
setInterval(checkStatus,6000);
setInterval(()=>{if(authToken) loadClients();},30000);