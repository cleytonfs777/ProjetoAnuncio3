// Initialize State
let db = {};
const DEFAULT_DB = {
    secoes: [{sigla: "S-1", desc: "RH"}],
    militares: [],
    legendas: [
        { sigla: "P", desc: "Presencial", color: "#dcfce7", text: "#166534", horas: 8.0 },
        { sigla: "FO", desc: "Folga", color: "#dbeafe", text: "#1e40af", horas: 0.0 }
    ],
    escala: {},
    horasExtras: {},
    cargasDiarias: {}
};

const meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const API_URL = 'http://localhost:3000/api';
let currentUser = null;

// Document Ready
document.addEventListener('DOMContentLoaded', async () => {
    // Show login overlay by default
    document.getElementById('loginOverlay').classList.remove('hidden');
    
    setupEventListeners();
    // Do NOT load data or render main app until login
});

// ------ AUTHENTICATION ------

async function handleLogin(e) {
    e.preventDefault();
    // Strip non-digits from username to ensure standard login format
    const rawUser = document.getElementById('loginUser').value;
    const user = rawUser.replace(/\D/g, ''); 
    const pass = document.getElementById('loginPass').value;
    const errorMsg = document.getElementById('loginError');

    try {
        const resp = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass })
        });
        
        if (resp.ok) {
            const data = await resp.json();
            // Server returns { user: { role: ... } }
            currentUser = { 
                username: data.user.username, 
                role: data.user.role 
            };
            
            // Hide Login Overlay
            document.getElementById('loginOverlay').classList.add('hidden');
            errorMsg.classList.add('hidden');
            
            // Apply Permissions
            applyRolePermissions();
            
            // Load Data & Initialize App
            await loadData();
        } else {
            errorMsg.textContent = "Usuário ou senha inválidos!";
            errorMsg.classList.remove('hidden');
        }
    } catch(err) {
        console.error("Login Error", err);
        errorMsg.textContent = "Erro de conexão com o servidor.";
        errorMsg.classList.remove('hidden');
    }
}

function logout() {
    currentUser = null;
    document.getElementById('loginOverlay').classList.remove('hidden');
    // Clear forms
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPass').value = '';
    document.getElementById('loginError').classList.add('hidden');
    // Maybe reload page to plain state
    window.location.reload(); 
}

// ------ PASSWORD CHANGE ------

function openModalChangePass() {
    document.getElementById('inputOldPass').value = '';
    document.getElementById('inputNewPass').value = '';
    document.getElementById('inputConfirmPass').value = '';
    
    document.getElementById('modalChangePass').classList.remove('hidden');
    requestAnimationFrame(() => {
        document.getElementById('modalChangePass').classList.remove('opacity-0');
        document.getElementById('modalChangePass').querySelector('div').classList.remove('scale-95');
    });
}

function closeModalChangePass() {
    const modal = document.getElementById('modalChangePass');
    modal.classList.add('opacity-0');
    modal.querySelector('div').classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

async function saveNewPassword() {
    const oldPass = document.getElementById('inputOldPass').value;
    const newPass = document.getElementById('inputNewPass').value;
    const confirmPass = document.getElementById('inputConfirmPass').value;

    if (!oldPass || !newPass) {
        alert("Preencha a senha atual e a nova senha.");
        return;
    }

    if (newPass !== confirmPass) {
        alert("A nova senha e a confirmação não conferem.");
        return;
    }
    
    // We need the raw username used solely for login purposes from `currentUser`.
    // However, `currentUser.username` might be the "cleaned" version or the one entered.
    // The server expects the stored username (which is the matricula numbers).
    // `currentUser` is set in handleLogin from the response or input.
    // In handleLogin we set `currentUser = { username: data.user.username ... }`. 
    // This comes from DB, so it should be correct (digits only).

    try {
        const resp = await fetch(`${API_URL}/user/password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: currentUser.username, 
                oldPassword: oldPass,
                newPassword: newPass
            })
        });

        if (resp.ok) {
            alert("Senha alterada com sucesso!");
            closeModalChangePass();
        } else {
            const err = await resp.json();
            alert("Erro: " + (err.error || "Não foi possível alterar a senha."));
        }
    } catch(e) {
        alert("Erro de conexão");
        console.error(e);
    }
}

function applyRolePermissions() {
    if (!currentUser) return;
    
    // Sidebar User Info
    document.getElementById('userNameDisplay').textContent = currentUser.username;
    document.getElementById('userRoleDisplay').textContent = currentUser.role;
    document.getElementById('userAvatar').textContent = currentUser.username.charAt(0).toUpperCase();
    
    // Sidebar Links
    if (currentUser.role !== 'ADMIN') {
        document.getElementById('link-config').classList.add('hidden');
    } else {
        document.getElementById('link-config').classList.remove('hidden');
    }
}

async function loadData() {
    try {
        const resp = await fetch(`${API_URL}/data`);
        if(resp.ok) {
            db = await resp.json();
            // Ensure structure
            if(!db.secoes) db.secoes = [];
            if(!db.militares) db.militares = [];
            if(!db.legendas) db.legendas = [];
            if(!db.escala) db.escala = {};
            if(!db.horasExtras) db.horasExtras = {};
            if(!db.cargasDiarias) db.cargasDiarias = {};
        } else {
            console.error("Failed to load from API");
            db = DEFAULT_DB;
        }
    } catch(e) {
        console.error("API Error - Ensure server is running", e);
        alert("Erro ao conectar com o servidor. Verifique se o Node.js está rodando.");
        db = DEFAULT_DB;
    }

    setupMonthSelector();
    setupSectionFilter(); 
    renderEscala();
    renderConfig();
}


function setupEventListeners() {
    document.getElementById('fileInputCSV').addEventListener('change', importCSV);
}

function setupSectionFilter() {
    const container = document.getElementById('filterSecoesContainer');
    if(!container) return;

    // Toggle logic for filter button
    const btn = container.previousElementSibling;
    if(btn) {
        // Reset old listeners by cloning
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        newBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            container.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
           if (!container.contains(e.target) && !newBtn.contains(e.target)) {
               container.classList.add('hidden');
           }
        });
    }

    container.innerHTML = '';
    
    if(!db.secoes || db.secoes.length === 0) {
        container.innerHTML = '<div class="text-xs text-slate-500 p-2">Nenhuma seção cadastrada</div>';
        return;
    }

    db.secoes.forEach(s => {
        const div = document.createElement('div');
        div.className = 'flex items-center gap-2 p-1.5 hover:bg-slate-50 rounded cursor-pointer';
        div.innerHTML = `
            <input type="checkbox" id="chk_secao_${s.sigla}" value="${s.sigla}" checked class="accent-indigo-600 w-4 h-4 cursor-pointer secao-filter-chk">
            <label for="chk_secao_${s.sigla}" class="text-xs font-bold text-slate-700 cursor-pointer flex-1 select-none">${s.sigla} - <span class="font-normal text-slate-500">${s.desc}</span></label>
        `;
        div.querySelector('input').addEventListener('change', renderEscala);
        container.appendChild(div);
    });
}


function setupMonthSelector() {
    const selMes = document.getElementById('selMes');
    const selMesExtras = document.getElementById('selMesExtras'); // New
    
    [selMes, selMesExtras].forEach(sel => {
        if(sel) {
            sel.innerHTML = '';
            meses.forEach((m, i) => sel.innerHTML += `<option value="${i}">${m.toUpperCase()} / 2026</option>`);
            sel.value = new Date().getMonth();
        }
    });
}

function handleRoute() {
    // Simple routing based on active class if needed, defaulting to escala
    // Handled by onclick events in HTML mostly
}

// ------ NAVIGATION ------

function showTab(id) {
    if (id === 'config' && currentUser && currentUser.role !== 'ADMIN') {
        alert("Acesso restrito a Administradores.");
        return;
    }

    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('nav a').forEach(a => {
        a.classList.remove('active-link', 'border-red-500');
        a.classList.add('border-transparent');
    });

    document.getElementById(id).classList.add('active');

    const activeLink = document.getElementById('link-'+id);
    activeLink.classList.add('active-link', 'border-red-500');
    activeLink.classList.remove('border-transparent');

    if(id === 'escala') renderEscala();
    if(id === 'horas-extras') renderHorasExtras();
    if(id === 'glossario') renderGlossario();
    if(id === 'config') renderConfig();
}

function changeMonth(delta) {
    // Determine which tab is active to update the correct selector
    const isExtras = document.getElementById('horas-extras').classList.contains('active');
    const selId = isExtras ? 'selMesExtras' : 'selMes';
    
    const sel = document.getElementById(selId);
    let newVal = parseInt(sel.value) + delta;
    if (newVal >= 0 && newVal < 12) {
        sel.value = newVal;
        if(isExtras) renderHorasExtras(); else renderEscala();
    }
}

function getRankValue(posto) {
    const ranks = {
        "Ten-Cel": 13,
        "Maj": 12,
        "Cap": 11,
        "1º Ten": 10,
        "2º Ten": 9,
        "Sub Ten": 8,
        "1º Sgt": 7,
        "2º Sgt": 6,
        "3º Sgt": 5,
        "Cb": 4,
        "Sd": 3,
        "Sd 2ª Cl": 2,
        "Civil": 1
    };
    return ranks[posto] || 0; // Unknown ranks go to bottom or top depending on sort direction
}

function sortMilitares(a, b) {
    // 1. Sort by Section (Alphabetical)
    if (a.secao < b.secao) return -1;
    if (a.secao > b.secao) return 1;

    // 2. Sort by Rank (Hierarchy Descending)
    const rankA = getRankValue(a.posto);
    const rankB = getRankValue(b.posto);
    
    // Higher rank value = Higher priority = appears first
    return rankB - rankA;
}

// ------ ESCALA RENDERER ------

function renderEscala() {
    const mesIdx = parseInt(document.getElementById('selMes').value);
    const diasNoMes = new Date(2026, mesIdx + 1, 0).getDate();
    const hoje = new Date();
    const diaAtual = hoje.getDate();
    const mesAtual = hoje.getMonth();
    const isMesAtual = mesIdx === mesAtual;
    
    // Header Generation
    const weekDays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
    let head = `<tr class="text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b">
        <th class="sticky-col-1 p-3 text-left w-20 min-w-[80px]">Seção</th>
        <th class="sticky-col-2 p-3 text-left w-48 min-w-[192px]">Militar</th>
        <th class="p-2 border-l w-32 min-w-[128px]">Status Atual</th>
        <th class="p-2 border-l w-16 text-center">Horas</th>
        <th class="p-2 border-l w-16 text-center">H. Extras</th>
        <th class="p-2 border-l w-16 text-center bg-slate-100">Total</th>`;
    
    for(let i=1; i<=diasNoMes; i++) {
        const date = new Date(2026, mesIdx, i);
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const isToday = isMesAtual && i === diaAtual;

        let bgClass = isToday ? 'bg-blue-100' : (isWeekend ? 'bg-orange-50' : '');
        let textClass = isToday ? 'text-blue-800' : (isWeekend ? 'text-orange-400' : '');

        head += `<th class="p-1 border-l w-[30px] min-w-[30px] text-center ${bgClass} ${textClass}">
            <div class="text-[9px] leading-none mb-0.5 opacity-70">${weekDays[dayOfWeek]}</div>
            <div>${i}</div>
        </th>`;
    }
    document.getElementById('headEscala').innerHTML = head + `</tr>`;

    // Filter Logic
    const search = document.getElementById('searchInput') ? document.getElementById('searchInput').value.toLowerCase() : "";
    
    // Get checked sections
    const secaoCheckboxes = document.querySelectorAll('.secao-filter-chk');
    const checkedSecoes = Array.from(secaoCheckboxes).filter(cb => cb.checked).map(cb => cb.value);
    
    const filteredMilitares = db.militares.filter(m => {
        // Apply Section Filter if checkboxes are present
        if(secaoCheckboxes.length > 0 && !checkedSecoes.includes(m.secao)) {
            return false;
        }

        if(!search) return true;
        const matchName = m.nome.toLowerCase().includes(search);
        const matchNum = m.num.includes(search);
        const matchSecao = m.secao.toLowerCase().includes(search);
        const matchPosto = (m.posto || "").toLowerCase().includes(search);
        return matchName || matchNum || matchSecao || matchPosto;
    });

    // Body Generation
    let body = "";
    filteredMilitares.sort(sortMilitares).forEach((m, index) => {
        let totalHoras = 0;
        let statusHoje = null;

        for(let i=1; i<=diasNoMes; i++){
            const key = `${m.id}-${mesIdx}-${i}`;
            const val = db.escala[key];
            const leg = val ? db.legendas.find(l => l.sigla === val) : null;
            
            if(leg) {
                if(leg.sigla === 'P') {
                    // Logic for Presencial based on Day of Week and typeHora
                    const date = new Date(2026, mesIdx, i);
                    const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
                    
                    // Check for daily override, fallback to military default
                    const overrideKey = `${m.id}-${mesIdx}-${i}`;
                    const type = (db.cargasDiarias && db.cargasDiarias[overrideKey]) ? db.cargasDiarias[overrideKey] : (m.typeHora || "6h");

                    if(type === '6h') {
                        if(dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) { // Mon, Wed, Fri
                            totalHoras += 6.0;
                        } else if(dayOfWeek === 2 || dayOfWeek === 4) { // Tue, Thu
                            totalHoras += 8.5;
                        } else {
                            // Sat, Sun default? applying P base hours (8.0) or 0? 
                            // Assuming base leg.horas for non-covered days if any
                            totalHoras += parseFloat(leg.horas);
                        }
                    } else if(type === '8h') {
                        if(dayOfWeek === 3) { // Wed
                            totalHoras += 4.5;
                        } else {
                            // Any other day (including weekends if P provided?)
                            totalHoras += 8.0; 
                        }
                    } else {
                        // Unknown type fallback
                        totalHoras += parseFloat(leg.horas);
                    }
                } else {
                    totalHoras += parseFloat(leg.horas);
                }
            }
            
            if (isMesAtual && i === diaAtual) {
                statusHoje = leg;
            }
        }

        // Calculate Overtime
        let horasExtras = 0;
        const extrasDb = db.horasExtras || {};
        for(let i=1; i<=diasNoMes; i++){
            const key = `${m.id}-${mesIdx}-${i}`;
            const entry = extrasDb[key];
            const val = (typeof entry === 'object' && entry !== null) ? (parseFloat(entry.val) || 0) : (parseFloat(entry) || 0);
            horasExtras += val;
        }

        const grandTotal = totalHoras + horasExtras;

        // Current Status Display
        let statusDisplay = `<span class="text-slate-300">-</span>`;
        let statusBg = "";
        let statusText = "";
        
        if (statusHoje) {
            statusDisplay = statusHoje.desc;
            statusBg = statusHoje.color;
            statusText = statusHoje.text;
        } else {
            statusDisplay = '<span class="text-orange-500 font-bold bg-orange-50 px-2 py-0.5 rounded-full text-[10px]">(Pendente)</span>';
        }

        const rowClass = index % 2 === 0 ? 'bg-white' : 'bg-slate-50';
        const extrasColor = horasExtras > 0 ? 'text-green-600' : (horasExtras < 0 ? 'text-red-500' : 'text-slate-400');

        body += `<tr class="${rowClass} hover:bg-blue-50 transition-colors border-b last:border-none">
            <td class="sticky-col-1 p-2 font-bold text-center text-slate-600 border-r text-xs">${m.secao}</td>
            <td class="sticky-col-2 p-2 font-bold text-slate-700 border-r text-xs">
                <div class="flex items-center justify-between">
                    <div>
                        <span class="text-indigo-600 mr-1">${m.posto || ''}</span>${m.nome}
                    </div>
                    <span class="cursor-pointer hover:ring-2 ring-indigo-300 px-1.5 py-0.5 rounded text-[9px] font-bold ${m.typeHora === '8h' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}" title="Gerenciar Carga (Clique para Exceções)" onclick="openCargaManager(${m.id})">
                        ${m.typeHora || '6h'}
                    </span>
                </div>
                <div class="text-[9px] font-normal text-slate-400 mt-0.5">Nº ${m.num}</div>
            </td>
            <td class="p-2 border-r text-xs font-bold text-center border-b-2" style="background-color: ${statusBg}; color: ${statusText}; border-bottom-color: ${statusText}">
                ${statusDisplay}
            </td>
            <td class="p-2 border-r text-center font-mono text-slate-600 font-bold">${totalHoras.toFixed(1)}</td>
            <td class="p-2 border-r text-center font-mono ${extrasColor} font-bold">${horasExtras.toFixed(1)}</td>
            <td class="p-2 border-r text-center font-mono text-indigo-700 font-black bg-indigo-50">${grandTotal.toFixed(1)}</td>`;
        
        for(let i=1; i<=diasNoMes; i++) {
            const key = `${m.id}-${mesIdx}-${i}`;
            const valor = db.escala[key]; // No default fallback
            const leg = valor ? db.legendas.find(l => l.sigla === valor) : null;
            const isToday = isMesAtual && i === diaAtual;
            const cellBg = leg ? leg.color : ''; // Empty if no legend
            const textColor = leg ? leg.text : '';

            const isDisabled = (currentUser && currentUser.role === 'USUARIO') ? 'disabled' : '';

            body += `<td style="background-color: ${cellBg};" class="border-r p-0 relative group h-10 w-[30px] min-w-[30px] ${isToday ? 'ring-2 ring-inset ring-blue-500 z-10' : ''}">
                <select class="status-select hover:bg-black/5 transition-colors focus:outline-none disabled:opacity-70 disabled:cursor-not-allowed" 
                        style="color: ${textColor}" 
                        onchange="atualizarStatus('${key}', this.value)" ${isDisabled}>
                    <option value=""></option>
                    ${db.legendas.map(l => `<option value="${l.sigla}" ${l.sigla === valor ? 'selected' : ''}>${l.sigla}</option>`).join('')}
                </select>
                ${leg ? `<div class="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-800 text-white text-[10px] rounded shadow-lg z-50 whitespace-nowrap pointer-events-none">
                    ${leg.desc}
                </div>` : ''}
            </td>`;
        }
        body += `</tr>`;
    });
    document.getElementById('bodyEscala').innerHTML = body;
}

function atualizarStatus(key, novo) {
    db.escala[key] = novo;
    save();
    renderEscala(); 
}

// ------ EXTRAS RENDERER ------

function renderHorasExtras() {
    const mesIdx = parseInt(document.getElementById('selMesExtras').value);
    const diasNoMes = new Date(2026, mesIdx + 1, 0).getDate();
    const hoje = new Date();
    const diaAtual = hoje.getDate();
    const mesAtual = hoje.getMonth();
    const isMesAtual = mesIdx === mesAtual;

    // Header Generation
    const weekDays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
    let head = `<tr class="text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b">
        <th class="sticky-col-1 p-3 text-left w-20 min-w-[80px]">Seção</th>
        <th class="sticky-col-2 p-3 text-left w-48 min-w-[192px]">Militar</th>
        <th class="p-2 border-l w-24 text-center bg-slate-50">Total H.E.</th>`;

    for(let i=1; i<=diasNoMes; i++) {
        const date = new Date(2026, mesIdx, i);
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const isToday = isMesAtual && i === diaAtual;

        let bgClass = isToday ? 'bg-red-100' : (isWeekend ? 'bg-orange-50' : '');
        let textClass = isToday ? 'text-red-800' : (isWeekend ? 'text-orange-400' : '');

        head += `<th class="p-1 border-l w-[30px] min-w-[30px] text-center ${bgClass} ${textClass}">
            <div class="text-[9px] leading-none mb-0.5 opacity-70">${weekDays[dayOfWeek]}</div>
            <div>${i}</div>
        </th>`;
    }
    document.getElementById('headHorasExtras').innerHTML = head + `</tr>`;

    // Filter Logic
    const search = document.getElementById('searchInputExtras') ? document.getElementById('searchInputExtras').value.toLowerCase() : "";
    const filteredMilitares = db.militares.filter(m => {
        if(!search) return true;
        return (m.nome.toLowerCase().includes(search) || m.num.includes(search) || m.secao.toLowerCase().includes(search));
    });

    // Body Generation
    let body = "";
    const extrasDb = db.horasExtras || {};
    filteredMilitares.sort(sortMilitares).forEach((m, index) => {
        let totalExtras = 0;
        
        // Setup row data cells string
        let dayCells = "";
        for(let i=1; i<=diasNoMes; i++){
            const key = `${m.id}-${mesIdx}-${i}`;
            const entry = extrasDb[key];
            const val = (typeof entry === 'object' && entry !== null) ? (parseFloat(entry.val) || 0) : (parseFloat(entry) || 0);
            const obs = (typeof entry === 'object' && entry !== null && entry.obs) ? entry.obs : "";
            
            totalExtras += val;
            
            const isToday = isMesAtual && i === diaAtual;
            
            // Determine styling based on value
            let colorClass = 'text-slate-300';
            let bgClass = '';
            if (val > 0) {
                colorClass = 'text-green-600 font-bold';
                bgClass = 'bg-green-50/50';
            } else if (val < 0) {
                colorClass = 'text-red-500 font-bold';
                bgClass = 'bg-red-50/50';
            }

            const hasObs = obs.length > 0;
            const infoIcon = hasObs ? `<i class="fas fa-info-circle text-[10px] text-blue-500 ml-1" title="${obs}"></i>` : '';
            const cellContent = val !== 0 ? val + infoIcon : (!hasObs ? '' : infoIcon);
            const cellTitle = hasObs ? `Obs: ${obs}` : 'Clique para editar';

            dayCells += `<td class="border-r p-0 relative h-10 w-[30px] min-w-[30px] cursor-pointer hover:bg-slate-100 transition-colors ${isToday ? 'ring-2 ring-inset ring-red-500 z-10' : ''} ${bgClass}" 
                            title="${cellTitle}"
                            onclick="openHoraExtraModal('${key}')">
                <div class="w-full h-full flex items-center justify-center text-xs ${colorClass}">
                    ${cellContent || '<span class="text-slate-200">-</span>'}
                </div>
            </td>`;
        }

        const rowClass = index % 2 === 0 ? 'bg-white' : 'bg-slate-50';
        const totalColor = totalExtras > 0 ? 'text-green-600' : (totalExtras < 0 ? 'text-red-600' : 'text-slate-300');

        body += `<tr class="${rowClass} hover:bg-red-50 transition-colors border-b last:border-none">
            <td class="sticky-col-1 p-2 font-bold text-center text-slate-600 border-r text-xs">${m.secao}</td>
            <td class="sticky-col-2 p-2 font-bold text-slate-700 border-r text-xs">
                <div class="flex items-center justify-between">
                    <div>
                        <span class="text-indigo-600 mr-1">${m.posto || ''}</span>${m.nome}
                    </div>
                    <span class="cursor-pointer hover:ring-2 ring-indigo-300 px-1.5 py-0.5 rounded text-[9px] font-bold ${m.typeHora === '8h' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}" title="Gerenciar Carga (Clique para Exceções)" onclick="openCargaManager(${m.id})">
                        ${m.typeHora || '6h'}
                    </span>
                </div>
                <div class="text-[9px] font-normal text-slate-400 mt-0.5">Nº ${m.num}</div>
            </td>
            <td class="p-2 border-r text-center font-mono font-black border-b-2 bg-slate-50 ${totalColor}">
                ${totalExtras.toFixed(1)}
            </td>
            ${dayCells}
        </tr>`;
    });
    document.getElementById('bodyHorasExtras').innerHTML = body;
}

// ------ MODAL HORA EXTRA ------
let currentHoraExtraKey = null;

function openHoraExtraModal(key) {
    if (currentUser && currentUser.role === 'USUARIO') {
        alert("Acesso Negado: Usuários não podem editar horas extras.");
        return;
    }

    currentHoraExtraKey = key;
    if(!db.horasExtras) db.horasExtras = {};
    
    // Get existing values
    const entry = db.horasExtras[key];
    const val = (typeof entry === 'object' && entry !== null) ? (parseFloat(entry.val) || 0) : (parseFloat(entry) || 0);
    const obs = (typeof entry === 'object' && entry !== null && entry.obs) ? entry.obs : "";

    document.getElementById('inputHoraExtraVal').value = val === 0 ? "" : val;
    document.getElementById('inputHoraExtraObs').value = obs;

    document.getElementById('modalHoraExtra').classList.add('active');
    setTimeout(() => document.getElementById('inputHoraExtraVal').focus(), 100);
}

function closeModalHoraExtra() {
    document.getElementById('modalHoraExtra').classList.remove('active');
    currentHoraExtraKey = null;
}

function saveHoraExtraModal() {
    if(!currentHoraExtraKey) return;

    const valStr = document.getElementById('inputHoraExtraVal').value;
    const obs = document.getElementById('inputHoraExtraObs').value.trim();
    const val = parseFloat(valStr);

    // Logic: 
    // If val is empty/NaN/0 AND obs is empty -> remove entry
    // Else -> save obj { val, obs }
    
    const isValZero = isNaN(val) || val === 0;

    if(isValZero && !obs) {
        delete db.horasExtras[currentHoraExtraKey];
    } else {
        db.horasExtras[currentHoraExtraKey] = {
            val: isNaN(val) ? 0 : val,
            obs: obs
        };
    }
    
    save();
    renderHorasExtras();
    closeModalHoraExtra();
}


// ------ GLOSSARIO & CONFIG ------

function renderGlossario() {
    const cards = db.legendas.map(l => `
        <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow flex items-center justify-between group">
            <div class="flex items-center gap-5">
                <div style="background-color: ${l.color}; color: ${l.text}" class="w-14 h-14 rounded-xl flex items-center justify-center font-black text-xl shadow-inner">${l.sigla}</div>
                <div>
                    <div class="font-bold text-lg text-slate-700 group-hover:text-indigo-600 transition-colors">${l.desc}</div>
                    <div class="text-xs text-slate-400 font-medium">Código: <span class="font-mono text-slate-500">${l.sigla}</span></div>
                </div>
            </div>
            <div class="text-right">
                <div class="text-2xl font-black text-indigo-600 tracking-tighter">${parseFloat(l.horas).toFixed(1)}<span class="text-sm text-indigo-300 ml-1">h</span></div>
            </div>
        </div>
    `).join('');

    const explanation = `
        <div class="col-span-full mt-4 bg-indigo-50 p-6 rounded-2xl border border-indigo-100">
            <h3 class="text-indigo-900 font-bold mb-4 flex items-center gap-2 text-lg">
                <i class="fas fa-info-circle"></i>
                Regras de Contagem de Horas (Presencial - P)
            </h3>
            <div class="grid md:grid-cols-2 gap-6 text-sm text-indigo-800">
                <div class="bg-white p-4 rounded-xl shadow-sm border border-indigo-100">
                    <div class="font-bold mb-2 text-indigo-900 flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-indigo-500"></span>
                        Militar com Carga 6h
                    </div>
                    <ul class="space-y-2">
                        <li class="flex justify-between border-b border-dashed border-indigo-100 pb-1">
                            <span>Segunda / Quarta / Sexta</span>
                            <span class="font-bold font-mono">6.0 h</span>
                        </li>
                        <li class="flex justify-between border-b border-dashed border-indigo-100 pb-1">
                            <span>Terça / Quinta</span>
                            <span class="font-bold font-mono">8.5 h</span>
                        </li>
                        <li class="flex justify-between">
                            <span>Outros dias</span>
                            <span class="font-bold font-mono">8.0 h</span>
                        </li>
                    </ul>
                </div>
                 <div class="bg-white p-4 rounded-xl shadow-sm border border-indigo-100">
                    <div class="font-bold mb-2 text-indigo-900 flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                        Militar com Carga 8h
                    </div>
                    <ul class="space-y-2">
                        <li class="flex justify-between border-b border-dashed border-indigo-100 pb-1">
                            <span>Quarta-feira</span>
                            <span class="font-bold font-mono">4.5 h</span>
                        </li>
                        <li class="flex justify-between">
                            <span>Outros dias</span>
                            <span class="font-bold font-mono">8.0 h</span>
                        </li>
                    </ul>
                </div>
            </div>
             <p class="mt-4 text-xs text-indigo-600/80 font-medium">
                * Para outras legendas (Folga, Férias, etc.), é considerado o valor fixo configurado no cartão acima.
             </p>
        </div>
    `;

    document.getElementById('gridGlossario').innerHTML = cards + explanation;
}

function renderConfig() {
    renderLegendasConfig();
    renderSecoesConfig();
    renderMilitaresConfig();
    // Removed renderUsersConfig call as requested
}

function renderLegendasConfig() {
    document.getElementById('gridLegendasConfig').innerHTML = db.legendas.map((l, i) => `
        <div class="p-4 border rounded-xl bg-white shadow-sm hover:shadow-md transition flex items-center justify-between group">
            <div class="flex items-center gap-4">
                <div style="background-color: ${l.color}; color: ${l.text}" class="w-12 h-12 rounded-lg flex items-center justify-center font-bold text-lg shadow-sm border border-black/5">
                    ${l.sigla}
                </div>
                <div>
                    <div class="font-bold text-slate-800">${l.desc}</div>
                    <div class="text-xs text-slate-400 font-medium">
                        ${parseFloat(l.horas).toFixed(1)}h · 
                        <span class="inline-block w-2 h-2 rounded-full" style="background-color:${l.color}"></span> Fundo / 
                        <span class="inline-block w-2 h-2 rounded-full" style="background-color:${l.text}"></span> Texto
                    </div>
                </div>
            </div>
            <div class="flex gap-2">
                <button onclick="openModalLegenda(${i})" class="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 flex items-center justify-center transition">
                    <i class="fas fa-edit text-xs"></i>
                </button>
                <button onclick="removeLegenda(${i})" class="w-8 h-8 rounded-full bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center transition">
                    <i class="fas fa-trash text-xs"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function renderMilitaresConfig() {
    const list = document.getElementById('listMilitares');
    if(!list) return;
    
    list.innerHTML = db.militares.map((m, i) => `
        <div class="p-4 border rounded-xl bg-white shadow-sm flex items-center gap-4 hover:shadow-md transition">
            <div class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-500 text-xs text-center">
                ${m.posto || m.secao.substring(0,2)}
            </div>
            <div class="flex-1">
                <div class="font-bold text-slate-800">${m.posto || ''} ${m.nome}</div>
                <div class="text-xs text-slate-400 font-mono">${m.num} · ${m.secao} · ${m.typeHora || "6h"}</div>
            </div>
            <div class="flex gap-2">
                <button onclick="openModalMilitar(${i})" class="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 flex items-center justify-center transition">
                    <i class="fas fa-edit text-xs"></i>
                </button>
                <button onclick="removeMilitar(${i})" class="w-8 h-8 rounded-full bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center transition">
                    <i class="fas fa-trash text-xs"></i>
                </button>
            </div>
        </div>
    `).join('');
}

// ------ MODAL LOGIC (LEGENDA) ------
let currentEditLegendaId = null;

function openModalLegenda(idx = null) {
    const modal = document.getElementById('modalLegenda');
    const title = document.getElementById('modalTitleLegenda');
    
    // Attach live preview listeners
    ['inputSigla', 'inputColorBg', 'inputColorText'].forEach(id => {
        document.getElementById(id).oninput = updateLegendaPreview;
    });

    currentEditLegendaId = idx;

    if (idx !== null) {
        const l = db.legendas[idx];
        title.innerText = "Editar Legenda";
        document.getElementById('inputSigla').value = l.sigla;
        document.getElementById('inputDesc').value = l.desc;
        document.getElementById('inputHoras').value = l.horas;
        document.getElementById('inputColorBg').value = l.color;
        document.getElementById('inputColorText').value = l.text;
    } else {
        title.innerText = "Nova Legenda"; // Reset for new
        document.getElementById('inputSigla').value = "";
        document.getElementById('inputDesc').value = "";
        document.getElementById('inputHoras').value = "0.0";
        document.getElementById('inputColorBg').value = "#f1f5f9";
        document.getElementById('inputColorText').value = "#64748b";
    }
    
    updateLegendaPreview();
    modal.classList.add('active');
}

function updateLegendaPreview() {
    const preview = document.getElementById('previewLegenda');
    preview.innerText = document.getElementById('inputSigla').value || "SG";
    preview.style.backgroundColor = document.getElementById('inputColorBg').value;
    preview.style.color = document.getElementById('inputColorText').value;
    preview.style.borderColor = document.getElementById('inputColorText').value;
}

function closeModalLegenda() {
    document.getElementById('modalLegenda').classList.remove('active');
    currentEditLegendaId = null;
}

function saveLegenda() {
    const sigla = document.getElementById('inputSigla').value.toUpperCase();
    const desc = document.getElementById('inputDesc').value;
    const horas = parseFloat(document.getElementById('inputHoras').value) || 0.0;
    const color = document.getElementById('inputColorBg').value;
    const text = document.getElementById('inputColorText').value;

    if (!sigla || !desc) {
        alert("Preencha Sigla e Descrição.");
        return;
    }

    if (currentEditLegendaId !== null) {
        // Edit
        db.legendas[currentEditLegendaId] = { sigla, desc, horas, color, text };
    } else {
        // Create
        db.legendas.push({ sigla, desc, horas, color, text });
    }

    save();
    renderConfig();
    renderEscala(); // Re-render escala in case colors changed
    closeModalLegenda();
}

// ------ MODAL LOGIC (MILITAR) ------
let currentEditId = null;

function openModalMilitar(idx = null) {
    const modal = document.getElementById('modalMilitar');
    const title = document.getElementById('modalTitle');
    
    // Populate Section Select
    const selSecao = document.getElementById('inputSecao');
    selSecao.innerHTML = `<option value="" disabled selected>Selecione...</option>` + 
        db.secoes.map(s => `<option value="${s.sigla}">${s.sigla} - ${s.desc}</option>`).join('');

    currentEditId = idx;
    
    // Reset Fields
    document.getElementById('inputNome').value = "";
    document.getElementById('inputNum').value = "";
    document.getElementById('inputPosto').value = "";
    document.getElementById('inputSecao').value = "";
    document.getElementById('inputTypeHora').value = "6h"; // Default
    
    // Auth Fields Reset
    document.getElementById('chkAcessoSistema').checked = false;
    document.getElementById('inputMilitarRole').value = "USUARIO";
    document.getElementById('inputMilitarPass').value = "";
    toggleAccessFields();

    if (idx !== null) {
        const m = db.militares[idx];
        title.innerText = "Editar Militar";
        document.getElementById('inputNome').value = m.nome;
        document.getElementById('inputNum').value = m.num;
        document.getElementById('inputSecao').value = m.secao;
        document.getElementById('inputPosto').value = m.posto || "";
        document.getElementById('inputTypeHora').value = m.typeHora || "6h";

        // Check user link logic
        // If m.user_role exists and is not empty, means they have login
        if (m.user_role) {
            document.getElementById('chkAcessoSistema').checked = true;
            document.getElementById('inputMilitarRole').value = m.user_role;
            toggleAccessFields();
        }
    } else {
        title.innerText = "Novo Militar";
    }

    modal.classList.add('active');
}

function toggleAccessFields() {
    const isChecked = document.getElementById('chkAcessoSistema').checked;
    const fields = document.getElementById('accessFields');
    if (isChecked) {
        fields.classList.remove('hidden');
    } else {
        fields.classList.add('hidden');
    }
}

function closeModalMilitar() {
    document.getElementById('modalMilitar').classList.remove('active');
    currentEditId = null;
}

async function saveMilitar() {
    const nome = document.getElementById('inputNome').value;
    const num = document.getElementById('inputNum').value;
    const secao = document.getElementById('inputSecao').value;
    const posto = document.getElementById('inputPosto').value;
    const typeHora = document.getElementById('inputTypeHora').value;

    const hasAccess = document.getElementById('chkAcessoSistema').checked;
    const role = document.getElementById('inputMilitarRole').value;
    const password = document.getElementById('inputMilitarPass').value;

    if (!nome || !num) {
        alert("Preencha os campos obrigatórios.");
        return;
    }

    const payload = {
        id: (currentEditId !== null && db.militares[currentEditId]) ? db.militares[currentEditId].id : null,
        num, nome, secao, posto, typeHora,
        hasAccess, role, password
    };
    
    try {
        const resp = await fetch(`${API_URL}/manage/militar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Role': currentUser.role },
            body: JSON.stringify(payload)
        });

        if(resp.ok) {
            closeModalMilitar();
            await loadData();
            renderConfig();
            renderEscala();
        } else {
            const err = await resp.json();
            alert("Erro: " + (err.error || "Erro desconhecido"));
        }
    } catch(e) {
        alert("Erro de conexão");
    }
}

// ------ CRUD OPERATIONS ------

function editLegenda(idx, field, val) { db.legendas[idx][field] = val; save(); renderEscala(); }
function addLegenda() {
    db.legendas.push({ sigla: "NV", desc: "Nova Legenda", color: "#f1f5f9", text: "#64748b", horas: 0.0 });
    save(); renderConfig();
}
function removeLegenda(i) {
    if(confirm('Remover esta legenda?')) {
        db.legendas.splice(i, 1);
        save(); renderConfig();
    }
}

async function removeMilitar(i) {
    if(!confirm('Tem certeza que deseja remover este militar e todos os seus dados? Esta ação não pode ser desfeita.')) {
        return;
    }

    const militar = db.militares[i];
    if (!militar || !militar.id) {
        // Fallback for local-only entries? Should not happen if loaded from DB
        db.militares.splice(i, 1);
        save(); renderConfig();
        return;
    }

    try {
        const resp = await fetch(`${API_URL}/manage/militar/${militar.id}`, {
            method: 'DELETE',
            headers: { 'X-Role': currentUser.role }
        });

        if (resp.ok) {
            await loadData(); // Reload from server
            renderConfig();
            renderEscala();
        } else {
            const err = await resp.json();
            alert("Erro ao excluir: " + (err.error || "Desconhecido"));
        }
    } catch(e) {
        alert("Erro de conexão");
        console.error(e);
    }
}


// ------ PERSISTENCE & CSV ------

async function save() {
    // Optimistic UI update (also save to local storage as backup if needed, but primary is API)
    // localStorage.setItem('bm_v5', JSON.stringify(db)); 

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (currentUser) {
            headers['X-Role'] = currentUser.role;
        }

        const resp = await fetch(`${API_URL}/save`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(db)
        });
        
        if (resp.status === 403) {
            alert("Acesso Negado: Você não tem permissão para salvar alterações.");
            // Optionally revert UI changes here by reloading data
            // loadData(); 
        } else if(!resp.ok) {
            console.error("Failed to save to server");
        }
    } catch(e) {
        console.error("Save error", e);
    }
}

function downloadDatabase() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(db, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "database.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function exportCSV() {
    const mesIdx = parseInt(document.getElementById('selMes').value);
    const diasNoMes = new Date(2026, mesIdx + 1, 0).getDate();
    
    // Header
    let csvContent = "data:text/csv;charset=utf-8,";
    let header = ["ID", "Matricula", "Nome", "Secao"];
    for(let i=1; i<=diasNoMes; i++) header.push(i);
    csvContent += header.join(";") + "\r\n";

    // Rows
    db.militares.forEach(m => {
        let row = [m.id, m.num, m.nome, m.secao];
        for(let i=1; i<=diasNoMes; i++) {
            const key = `${m.id}-${mesIdx}-${i}`;
            row.push(db.escala[key] || "P");
        }
        csvContent += row.join(";") + "\r\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `escala_${meses[mesIdx]}_2026.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function triggerImportCSV() {
    document.getElementById('fileInputCSV').click();
}

function importCSV(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const rows = text.split("\n").map(r => r.trim()).filter(r => r);
        if(rows.length < 2) return alert("Arquivo vazio ou inválido");

        const mesIdx = parseInt(document.getElementById('selMes').value);
        
        // Skip header
        for(let i=1; i<rows.length; i++) {
            const cols = rows[i].split(";");
            if(cols.length < 4) continue;

            const id = cols[0]; // Not really used for lookup if we match by Matricula? Let's use ID for safety if exists.
            const matricula = cols[1];
            
            // Find militar
            let m = db.militares.find(mil => mil.num == matricula);
            if(!m) {
                // Optional: Create if not exists?
                // For now, let's just skip unknown militares to avoid mess
                continue; 
            }

            // Fill days
            let dayColIndex = 4; // 0:ID, 1:Mat, 2:Nome, 3:Secao, 4: Day 1
            for(let d=1; d<=31; d++) {
                if(cols[dayColIndex]) {
                    db.escala[`${m.id}-${mesIdx}-${d}`] = cols[dayColIndex];
                }
                dayColIndex++;
            }
        }
        save();
        renderEscala();
        alert("Importação CSV concluída para o mês atual!");
        event.target.value = ''; // Reset input
    };
    reader.readAsText(file);
}

// ------ SECTION MANAGEMENT ------

function renderSecoesConfig() {
    document.getElementById('gridSecoesConfig').innerHTML = db.secoes.map((s, i) => `
        <div class="p-4 border rounded-xl bg-emerald-50/50 shadow-sm hover:shadow-md transition flex items-center justify-between group">
            <div>
                <div class="font-bold text-emerald-800">${s.sigla}</div>
                <div class="text-xs text-emerald-600 font-medium">${s.desc}</div>
            </div>
            <div class="flex gap-2">
                <button onclick="openModalSecao(${i})" class="w-8 h-8 rounded-full bg-white text-emerald-600 hover:bg-emerald-100 flex items-center justify-center transition shadow-sm">
                    <i class="fas fa-edit text-xs"></i>
                </button>
                <button onclick="removeSecao(${i})" class="w-8 h-8 rounded-full bg-white text-red-500 hover:bg-red-100 flex items-center justify-center transition shadow-sm">
                    <i class="fas fa-trash text-xs"></i>
                </button>
            </div>
        </div>
    `).join('');
}

let currentEditSecaoId = null;

function openModalSecao(idx = null) {
    const modal = document.getElementById('modalSecao');
    const title = document.getElementById('modalTitleSecao');
    
    currentEditSecaoId = idx;

    if (idx !== null) {
        const s = db.secoes[idx];
        title.innerText = "Editar Seção";
        document.getElementById('inputSiglaSecao').value = s.sigla;
        document.getElementById('inputDescSecao').value = s.desc;
    } else {
        title.innerText = "Nova Seção";
        document.getElementById('inputSiglaSecao').value = "";
        document.getElementById('inputDescSecao').value = "";
    }

    modal.classList.add('active');
}

function closeModalSecao() {
    document.getElementById('modalSecao').classList.remove('active');
    currentEditSecaoId = null;
}

function saveSecao() {
    const sigla = document.getElementById('inputSiglaSecao').value.toUpperCase();
    const desc = document.getElementById('inputDescSecao').value;

    if (!sigla) {
        alert("Preencha a Sigla da seção.");
        return;
    }

    if (currentEditSecaoId !== null) {
        db.secoes[currentEditSecaoId] = { sigla, desc };
    } else {
        db.secoes.push({ sigla, desc });
    }

    save();
    renderConfig();
    setupSectionFilter(); // Update filter list
    closeModalSecao();
}

function removeSecao(i) {
    if(confirm('Remover esta seção?')) {
        db.secoes.splice(i, 1);
        save();
        renderConfig();
        setupSectionFilter(); // Update filter list
    }
}


// ------ MANAGING WORKLOAD EXCEPTIONS ------

let currentMilitarCargaId = null;

function openCargaManager(militarId) {
    if (currentUser && currentUser.role === 'USUARIO') {
        alert("Ação permitida apenas para Gerentes e Administradores.");
        return;
    }

    currentMilitarCargaId = militarId;
    
    // Reset inputs
    document.getElementById('cargaStart').value = '';
    document.getElementById('cargaEnd').value = '';
    selectCargaModal('6h'); // Default

    // Render Active Exceptions List
    const mesIdx = parseInt(document.getElementById('selMes').value);
    renderExcecoesList(currentMilitarCargaId, mesIdx);

    const modal = document.getElementById('modalCargaManager');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('div').classList.remove('scale-95');
    });
}

function renderExcecoesList(militarId, mesIdx) {
    const container = document.getElementById('listaExcecoesContainer');
    const content = document.getElementById('listaExcecoesContent');
    if(!container || !content) return;

    content.innerHTML = '';
    
    // Find all exceptions for this month
    const exceptions = [];
    const diasNoMes = new Date(2026, mesIdx + 1, 0).getDate();
    
    for(let d=1; d<=diasNoMes; d++) {
        const key = `${militarId}-${mesIdx}-${d}`;
        if(db.cargasDiarias && db.cargasDiarias[key]) {
             exceptions.push({ day: d, type: db.cargasDiarias[key] });
        }
    }
    
    if (exceptions.length === 0) {
        container.classList.add('hidden');
        return;
    }
    
    container.classList.remove('hidden');

    // Grouping consecutive days
    let ranges = [];
    if(exceptions.length > 0) {
        let currentRange = { start: exceptions[0].day, end: exceptions[0].day, type: exceptions[0].type };
        
        for(let i=1; i<exceptions.length; i++) {
            const ex = exceptions[i];
            // Check if consecutive day AND same type
            if(ex.day === currentRange.end + 1 && ex.type === currentRange.type) {
                currentRange.end = ex.day;
            } else {
                ranges.push(currentRange);
                currentRange = { start: ex.day, end: ex.day, type: ex.type };
            }
        }
        ranges.push(currentRange);
    }

    ranges.forEach(r => {
        const rangeText = (r.start === r.end) ? `Dia ${r.start}` : `Dias ${r.start} a ${r.end}`;
        const item = document.createElement('div');
        item.className = "flex justify-between items-center bg-gray-50 p-2 rounded border border-gray-100 text-xs";
        item.innerHTML = `
            <span class="text-slate-600 font-medium">
                ${rangeText} <span class="ml-2 font-bold ${r.type==='8h'?'text-emerald-600':'text-blue-600'}">${r.type}</span>
            </span>
            <button onclick="deleteCargaRange(${militarId}, ${mesIdx}, ${r.start}, ${r.end})" class="text-gray-400 hover:text-red-500 transition px-2" title="Excluir Exceção">
                <i class="fas fa-trash-alt"></i>
            </button>
        `;
        content.appendChild(item);
    });
}

function deleteCargaRange(militarId, mesIdx, start, end) {
    if(!confirm("Deseja remover esta exceção?")) return;

    for (let d = start; d <= end; d++) {
        const key = `${militarId}-${mesIdx}-${d}`;
        if(db.cargasDiarias[key]) delete db.cargasDiarias[key];
    }
    
    save();
    renderEscala();
    // Refresh list without closing modal
    renderExcecoesList(militarId, mesIdx); 
}

function closeModalCarga() {
    const modal = document.getElementById('modalCargaManager');
    modal.classList.add('opacity-0');
    modal.querySelector('div').classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
        currentMilitarCargaId = null;
    }, 300);
}

function selectCargaModal(val) {
    document.getElementById('inputCargaVal').value = val;
    
    const btn6 = document.getElementById('btnCarga6h');
    const btn8 = document.getElementById('btnCarga8h');
    
    // Reset classes
    const activeClass = "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100";
    const inactiveClass = "border-gray-200 text-gray-400 hover:bg-gray-50";

    // Clean first
    btn6.className = "flex-1 py-2 rounded font-bold transition " + (val === '6h' ? activeClass : inactiveClass);
    btn8.className = "flex-1 py-2 rounded font-bold transition " + (val === '8h' ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : inactiveClass);
}

function saveCargaPeriod() {
    if (!currentMilitarCargaId) return;
    
    const start = parseInt(document.getElementById('cargaStart').value);
    const end = parseInt(document.getElementById('cargaEnd').value);
    const type = document.getElementById('inputCargaVal').value;
    const mesIdx = parseInt(document.getElementById('selMes').value); // Use current global month context

    if (!start || !end || start > end) {
        alert("Por favor selecione um intervalo de dias válido.");
        return;
    }

    // Apply to DB
    for (let d = start; d <= end; d++) {
        const key = `${currentMilitarCargaId}-${mesIdx}-${d}`;
        db.cargasDiarias[key] = type;
    }

    save();
    closeModalCarga();
    renderEscala();
    // Also re-render extras if that tab is open, but simple renderEscala is mostly enough
}

function clearCargaPeriod() {
    if (!currentMilitarCargaId) return;

    const start = parseInt(document.getElementById('cargaStart').value);
    const end = parseInt(document.getElementById('cargaEnd').value);
    const mesIdx = parseInt(document.getElementById('selMes').value);

    // If no range specified, maybe clear all for this month? 
    // Or ask for range. Let's require range for safety.
     if (!start || !end || start > end) {
        if(confirm("Nenhum intervalo válido selecionado. Deseja limpar TODAS as exceções deste militar neste mês?")) {
            // Clear all for month
            // We need to iterate keys
             Object.keys(db.cargasDiarias).forEach(k => {
                const [mid, m, d] = k.split('-').map(Number);
                if(mid === currentMilitarCargaId && m === mesIdx) {
                    delete db.cargasDiarias[k];
                }
             });
        } else {
            return;
        }
    } else {
        // Clear range
         for (let d = start; d <= end; d++) {
            const key = `${currentMilitarCargaId}-${mesIdx}-${d}`;
            delete db.cargasDiarias[key];
        }
    }

    save();
    closeModalCarga();
    renderEscala();
}
