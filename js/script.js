// Initialize State
let db = {};
const DEFAULT_DB = {
    secoes: [{sigla: "S-1", desc: "RH"}],
    militares: [],
    legendas: [
        { sigla: "P", nome: "Presente", desc: "Presença Integral", color: "#dcfce7", text: "#166534", horas: 8.0 },
        { sigla: "PM", nome: "Presente Manhã", desc: "Turno Matutino", color: "#fef9c3", text: "#854d0e", horas: 6.0 },
        { sigla: "PT", nome: "Presente Tarde", desc: "Turno Vespertino", color: "#e0f2fe", text: "#0369a1", horas: 6.0 },
        { sigla: "FO", nome: "Folga", desc: "", color: "#f1f5f9", text: "#475569", horas: 0.0 }
    ],
    escala: {},
    horasExtras: {},
    cargasDiarias: {},
    avisos: {}
};

// Pagination State
let currentPageEscala = 1;
let currentPageExtras = 1;
let currentPageConfigMilitares = 1;
const ITEMS_PER_PAGE = 20;
const ITEMS_PER_PAGE_CONFIG = 12;

const meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const API_URL = '/api';
let currentUser = null;

// Utility: Debounce to prevent lag on rapid input
function debounce(func, timeout = 300){
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { func.apply(this, args); }, timeout);
  };
}

const renderEscalaDebounced = debounce(() => {
    currentPageEscala = 1; // Reset to first page on search
    renderEscala();
});

const renderHorasExtrasDebounced = debounce(() => {
    currentPageExtras = 1; // Reset to first page on search
    renderHorasExtras();
});

const renderMilitaresConfigDebounced = debounce(() => {
    currentPageConfigMilitares = 1; // Reset to first page on search
    renderMilitaresConfig();
});

// Document Ready
document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();

    // Check for persisted session
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            // Hide Login Overlay
            document.getElementById('loginOverlay').classList.add('hidden');
            document.getElementById('loginError').classList.add('hidden');
            
            // Apply Permissions
            applyRolePermissions();
            
            // Load Data
            await loadData();
        } catch (e) {
            console.error("Session restore failed", e);
            localStorage.removeItem('currentUser');
            document.getElementById('loginOverlay').classList.remove('hidden');
        }
    } else {
        // Show login overlay
        document.getElementById('loginOverlay').classList.remove('hidden');
    }
});

// ------ AUTHENTICATION ------

function toggleLoginPassword() {
    const passInput = document.getElementById('loginPass');
    const icon = document.getElementById('iconLoginPass');
    
    if (passInput.type === 'password') {
        passInput.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        passInput.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

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
            
            // Persist Session
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            
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
    localStorage.removeItem('currentUser');
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
            if(!db.avisos) db.avisos = {};

            // Ensure PM/PT exist and update colors
            let pm = db.legendas.find(l => l.sigla === 'PM');
            if (!pm) {
                db.legendas.push({ sigla: "PM", nome: "Presente Manhã", desc: "Presente Manhã", color: "#fef9c3", text: "#854d0e", horas: 6.0 });
            } else {
                pm.color = "#fef9c3"; pm.text = "#854d0e"; pm.desc = "Presente Manhã";
                if (!pm.nome) pm.nome = "Presente Manhã";
            }

            let pt = db.legendas.find(l => l.sigla === 'PT');
            if (!pt) {
                db.legendas.push({ sigla: "PT", nome: "Presente Tarde", desc: "Presente Tarde", color: "#e0f2fe", text: "#0369a1", horas: 6.0 });
            } else {
                pt.color = "#e0f2fe"; pt.text = "#0369a1"; pt.desc = "Presente Tarde";
                if (!pt.nome) pt.nome = "Presente Tarde";
            }
            
            // Fix 'P' name if needed
            let p = db.legendas.find(l => l.sigla === 'P');
            if(p) { p.desc = "Presente"; if (!p.nome) p.nome = "Presente"; }

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
    const fileInputCSV = document.getElementById('fileInputCSV');
    if(fileInputCSV) fileInputCSV.addEventListener('change', importCSV);

    const searchMilitaresConfig = document.getElementById('searchMilitaresConfig');
    if (searchMilitaresConfig) {
        searchMilitaresConfig.addEventListener('input', renderMilitaresConfigDebounced);
    }

    // Auto-set workload to 8h if Posto is 'Civil'
    const inputPosto = document.getElementById('inputPosto');
    if (inputPosto) {
        inputPosto.addEventListener('input', (e) => {
            const val = e.target.value;
            if (val && val.toLowerCase().includes('civil')) {
                const typeHora = document.getElementById('inputTypeHora');
                if (typeHora) typeHora.value = '8h';
            }
        });
    }

    // Dashboard Date Reference Change
    const dashDateRef = document.getElementById('dashDateRef');
    if (dashDateRef) {
        dashDateRef.addEventListener('change', renderDashboard);
    }
}

function setupSectionFilter() {
    setupSpecificFilter('filterSecoesContainer', renderEscala);
    setupSpecificFilter('filterSecoesContainerExtras', renderHorasExtras);
    setupSpecificFilter('filterSecoesContainerDashboard', renderDashboard);
    
    applyUserSectionPreference();
}

function applyUserSectionPreference() {
    if (!currentUser || !db.militares) return;
    
    // Find User's Section
    // Ensure accurate matching by stripping formatting just in case, though usually clean.
    // currentUser.username is digits only (as per login logic).
    // db.militares.num is formatted "123.456-7".
    
    const userMilitar = db.militares.find(m => m.num.replace(/\D/g, '') === currentUser.username);
    
    // If admin, maybe we select all? Or still filter?
    // Request says: "por default venha PRE-selecionado ... a seção que o militar pertence"
    // Even if Admin, if they have a section, we select it.
    
    if (userMilitar && userMilitar.secao) {
        const userSecao = userMilitar.secao;
        
        ['filterSecoesContainer', 'filterSecoesContainerExtras', 'filterSecoesContainerDashboard'].forEach(id => {
            const container = document.getElementById(id);
            if (!container) return;
            
            const checkBoxes = container.querySelectorAll('.filter-chk-item');
            let found = false;
            
            checkBoxes.forEach(cb => {
                if(cb.value === userSecao) {
                    cb.checked = true;
                    found = true;
                } else {
                    cb.checked = false;
                }
            });
            
            // Update "Select All" status
            const chkAll = container.querySelector('input[id^="chk_all_"]');
            if(chkAll) {
                 // If we filtered to specific, "All" should likely be unchecked, 
                 // unless the user belongs to ALL sections (impossible) or there is only 1 section.
                 const allItems = container.querySelectorAll('.filter-chk-item');
                 const allChecked = Array.from(allItems).every(i => i.checked);
                 chkAll.checked = allChecked;
            }
        });
    }
}

function setupSpecificFilter(containerId, renderCallback) {
    const container = document.getElementById(containerId);
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

    // "Select All" Option
    const divAll = document.createElement('div');
    divAll.className = 'flex items-center gap-2 p-1.5 hover:bg-slate-50 rounded cursor-pointer border-b mb-1 pb-2 border-slate-100';
    const allId = `chk_all_${containerId}`;
    divAll.innerHTML = `
        <input type="checkbox" id="${allId}" checked class="accent-indigo-600 w-4 h-4 cursor-pointer">
        <label for="${allId}" class="text-xs font-black text-indigo-700 cursor-pointer flex-1 select-none">MARCAR TODOS</label>
    `;
    
    container.appendChild(divAll);
    const chkAll = divAll.querySelector('input');

    // Individual Sections
    db.secoes.forEach(s => {
        const div = document.createElement('div');
        div.className = 'flex items-center gap-2 p-1.5 hover:bg-slate-50 rounded cursor-pointer';
        // Unique ID for each checkbox
        const chkId = `chk_${containerId}_${s.sigla}`;
        div.innerHTML = `
            <input type="checkbox" id="${chkId}" value="${s.sigla}" checked class="accent-indigo-600 w-4 h-4 cursor-pointer filter-chk-item">
            <label for="${chkId}" class="text-xs font-bold text-slate-700 cursor-pointer flex-1 select-none">${s.sigla} - <span class="font-normal text-slate-500">${s.desc}</span></label>
        `;
        
        const chkItem = div.querySelector('input');
        chkItem.addEventListener('change', () => {
            // Update "All" checkbox if any item is unchecked
            const allItems = container.querySelectorAll('.filter-chk-item');
            const allChecked = Array.from(allItems).every(i => i.checked);
            chkAll.checked = allChecked;
            renderCallback();
        });
        
        container.appendChild(div);
    });

    // Handle "Select All" click
    chkAll.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        const allItems = container.querySelectorAll('.filter-chk-item');
        allItems.forEach(item => item.checked = isChecked);
        renderCallback();
    });
}


function setupMonthSelector() {
    const selMes = document.getElementById('selMes');
    const selMesExtras = document.getElementById('selMesExtras');
    const selMesDash = document.getElementById('selMesDashboard');
    
    [selMes, selMesExtras, selMesDash].forEach(sel => {
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

    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active', 'hidden'));
    document.querySelectorAll('.tab-content:not(#' + id + ')').forEach(t => t.classList.add('hidden')); // Explicitly hide others

    document.querySelectorAll('nav a').forEach(a => {
        a.classList.remove('active-link', 'border-red-500');
        a.classList.add('border-transparent');
    });

    document.getElementById(id).classList.add('active'); // active class might use display block in CSS, but 'hidden' class overrides it often. 
    // Usually 'active' sets display:flex per CSS. Let's trust classList manipulation.
    // Actually, looking at index.html, tab-content has 'hidden' in dashboard but not others initially.
    // The CSS probably has .tab-content { display: none } .tab-content.active { display: flex }.
    // If so, just toggling active is enough if CSS is correct.
    // But 'dashboard' has 'hidden' explicitly in HTML.
    document.getElementById(id).classList.remove('hidden');

    const activeLink = document.getElementById('link-'+id);
    activeLink.classList.add('active-link', 'border-red-500');
    activeLink.classList.remove('border-transparent');

    if(id === 'escala') renderEscala();
    if(id === 'horas-extras') renderHorasExtras();
    if(id === 'glossario') renderGlossario();
    if(id === 'config') renderConfig();
    if(id === 'dashboard') renderDashboard();
}

function changeMonth(delta) {
    let selId = 'selMes';
    const activeTab = document.querySelector('.tab-content.active');
    
    if(activeTab.id === 'horas-extras') selId = 'selMesExtras';
    if(activeTab.id === 'dashboard') selId = 'selMesDashboard';
    
    const sel = document.getElementById(selId);
    let newVal = parseInt(sel.value) + delta;
    if (newVal >= 0 && newVal < 12) {
        sel.value = newVal;
        if(activeTab.id === 'horas-extras') renderHorasExtras();
        else if(activeTab.id === 'dashboard') renderDashboard();
        else renderEscala();
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

// ------ PAGINATION HANDLERS ------

function changePageEscala(delta) {
    currentPageEscala += delta;
    renderEscala();
}

function changePageExtras(delta) {
    currentPageExtras += delta;
    renderHorasExtras();
}

function changePageMilitaresConfig(delta) {
    currentPageConfigMilitares += delta;
    renderMilitaresConfig();
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
        <th class="p-3 text-left w-20 min-w-[80px]">Seção</th>
        <th class="p-3 text-left w-48 min-w-[192px]">Militar</th>
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
    
    // Render Avisos whenever Escala updates (since it depends on selected month)
    renderAvisos();

    // Filter Logic
    const search = document.getElementById('searchInput') ? document.getElementById('searchInput').value.toLowerCase() : "";
    
    // Get checked sections
    const filterContainer = document.getElementById('filterSecoesContainer');
    let checkedSecoes = [];
    let hasFilter = false;
    
    if(filterContainer) {
        // Only select item checkboxes, ignore "select all"
        const checkboxes = filterContainer.querySelectorAll('.filter-chk-item');
        if(checkboxes.length > 0) {
            hasFilter = true;
            checkedSecoes = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
        }
    }
    
    const filteredMilitares = db.militares.filter(m => {
        // Apply Section Filter if checkboxes are present
        if(hasFilter && !checkedSecoes.includes(m.secao)) {
            return false;
        }

        if(!search) return true;
        const matchName = m.nome.toLowerCase().includes(search);
        const matchNum = m.num.includes(search);
        const matchSecao = m.secao.toLowerCase().includes(search);
        const matchPosto = (m.posto || "").toLowerCase().includes(search);
        return matchName || matchNum || matchSecao || matchPosto;
    });

    // --- Pagination Logic Escala ---
    filteredMilitares.sort(sortMilitares);
    
    const totalItems = filteredMilitares.length;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
    if (currentPageEscala > totalPages) currentPageEscala = totalPages;
    if (currentPageEscala < 1) currentPageEscala = 1;
    
    const startIndex = (currentPageEscala - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedMilitares = filteredMilitares.slice(startIndex, endIndex);
    
    // Update UI Controls
    const pageInfo = document.getElementById('pageInfoEscala');
    if(pageInfo) pageInfo.textContent = `Página ${currentPageEscala} de ${totalPages}`;
    
    const btnPrev = document.querySelector('#paginationEscala button:first-child');
    const btnNext = document.querySelector('#paginationEscala button:last-child');
    if(btnPrev) btnPrev.disabled = currentPageEscala === 1;
    if(btnNext) btnNext.disabled = currentPageEscala === totalPages;

    // Body Generation
    let body = "";
    paginatedMilitares.forEach((m, index) => {
        let totalHoras = 0;
        let statusHoje = null;

        for(let i=1; i<=diasNoMes; i++){
            const key = `${m.id}-${mesIdx}-${i}`;
            const val = db.escala[key];
            const leg = val ? db.legendas.find(l => l.sigla === val) : null;
            
            if(leg) {
                if(['P', 'PM', 'PT'].includes(leg.sigla)) {
                    // Logic based on Legend used (P=8h rules, PM/PT=6h rules)
                    const date = new Date(2026, mesIdx, i);
                    const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
                    
                    if(leg.sigla === 'PM' || leg.sigla === 'PT') {
                        // 6h Profile Rules
                        if(dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) { // Mon, Wed, Fri
                            totalHoras += 6.0;
                        } else if(dayOfWeek === 2 || dayOfWeek === 4) { // Tue, Thu
                            totalHoras += 8.5;
                        } else {
                            // Outros dias (Sáb, Dom) = 8.0h default
                            totalHoras += 8.0;
                        }
                    } else if(leg.sigla === 'P') {
                        // 8h Profile Rules
                        if(dayOfWeek === 3) { // Wed
                            totalHoras += 4.5;
                        } else {
                            // Any other day
                            totalHoras += 8.0; 
                        }
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
            statusDisplay = statusHoje.nome;
            statusBg = statusHoje.color;
            statusText = statusHoje.text;
        } else {
            statusDisplay = '<span class="text-orange-500 font-bold bg-orange-50 px-2 py-0.5 rounded-full text-[10px]">(Pendente)</span>';
        }

        const rowClass = index % 2 === 0 ? 'bg-white' : 'bg-slate-50';
        const extrasColor = horasExtras > 0 ? 'text-green-600' : (horasExtras < 0 ? 'text-red-500' : 'text-slate-400');

        body += `<tr class="${rowClass} hover:bg-blue-50 transition-colors border-b last:border-none">
            <td class="p-2 font-bold text-center text-slate-600 border-r text-xs">${m.secao}</td>
            <td class="p-2 font-bold text-slate-700 border-r text-xs">
                <div class="flex items-center justify-between">
                    <div>
                        <span class="text-indigo-600 mr-1">${m.posto || ''}</span>${m.nome}
                    </div>
                    <span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${m.typeHora === '8h' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}" title="Carga Horária">
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

            // Show all options for everyone (requested by user)
            const options = db.legendas.map(l => `<option value="${l.sigla}" ${l.sigla === valor ? 'selected' : ''}>${l.sigla}</option>`).join('');

            body += `<td style="background-color: ${cellBg};" class="border-r p-0 relative group h-10 w-[30px] min-w-[30px] ${isToday ? 'ring-2 ring-inset ring-blue-500 z-10' : ''}">
                <select class="status-select hover:bg-black/5 transition-colors focus:outline-none disabled:opacity-70 disabled:cursor-not-allowed" 
                        style="color: ${textColor}" 
                        onchange="atualizarStatus('${key}', this.value)" ${isDisabled}>
                    <option value=""></option>
                    ${options}
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
        <th class="p-3 text-left w-20 min-w-[80px]">Seção</th>
        <th class="p-3 text-left w-48 min-w-[192px]">Militar</th>
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

    // Get checked sections for Extras
    const filterContainer = document.getElementById('filterSecoesContainerExtras');
    let checkedSecoes = [];
    let hasFilter = false;
    
    if(filterContainer) {
        // Only select item checkboxes, ignore "select all"
        const checkboxes = filterContainer.querySelectorAll('.filter-chk-item');
        if(checkboxes.length > 0) {
            hasFilter = true;
            checkedSecoes = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
        }
    }

    const filteredMilitares = db.militares.filter(m => {
        // Apply Section Filter
        if(hasFilter && !checkedSecoes.includes(m.secao)) {
            return false;
        }

        if(!search) return true;
        return (m.nome.toLowerCase().includes(search) || m.num.includes(search) || m.secao.toLowerCase().includes(search));
    });

    // --- Pagination Logic Extras ---
    filteredMilitares.sort(sortMilitares);
    
    const totalItems = filteredMilitares.length;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
    if (currentPageExtras > totalPages) currentPageExtras = totalPages;
    if (currentPageExtras < 1) currentPageExtras = 1;

    const startIndex = (currentPageExtras - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedMilitares = filteredMilitares.slice(startIndex, endIndex);

    // Update UI Controls
    const pageInfo = document.getElementById('pageInfoExtras');
    if(pageInfo) pageInfo.textContent = `Página ${currentPageExtras} de ${totalPages}`;

    const btnPrev = document.querySelector('#paginationExtras button:first-child');
    const btnNext = document.querySelector('#paginationExtras button:last-child');
    if(btnPrev) btnPrev.disabled = currentPageExtras === 1;
    if(btnNext) btnNext.disabled = currentPageExtras === totalPages;

    // Body Generation
    let body = "";
    const extrasDb = db.horasExtras || {};
    paginatedMilitares.forEach((m, index) => {
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
            <td class="p-2 font-bold text-center text-slate-600 border-r text-xs">${m.secao}</td>
            <td class="p-2 font-bold text-slate-700 border-r text-xs">
                <div class="flex items-center justify-between">
                    <div>
                        <span class="text-indigo-600 mr-1">${m.posto || ''}</span>${m.nome}
                    </div>
                    <span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${m.typeHora === '8h' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}" title="Carga Horária">
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
    const resp = (typeof entry === 'object' && entry !== null && entry.responsible) ? entry.responsible : "";

    document.getElementById('inputHoraExtraVal').value = val === 0 ? "" : val;
    document.getElementById('inputHoraExtraObs').value = obs;
    
    const respInput = document.getElementById('inputHoraExtraResp');
    if (respInput) respInput.value = resp;

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
        let responsible = "";
        if (currentUser) {
             const m = db.militares.find(mil => mil.num.replace(/\D/g, '') === currentUser.username);
             if (m) {
                 responsible = `${m.num} ${m.posto || ''} ${m.nome}`;
             } else {
                 responsible = currentUser.username;
             }
        }

        db.horasExtras[currentHoraExtraKey] = {
            val: isNaN(val) ? 0 : val,
            obs: obs,
            responsible: responsible
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
                    <div class="font-bold text-lg text-slate-700 group-hover:text-indigo-600 transition-colors">${l.nome}</div>
                    <div class="text-[11px] text-slate-500 mt-0.5 leading-tight">${l.desc || ''}</div>
                    <div class="text-[10px] text-slate-400 font-medium mt-1">Código: <span class="font-mono text-slate-500">${l.sigla}</span></div>
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
                Regras de Contagem de Horas
            </h3>
            <div class="grid md:grid-cols-2 gap-6 text-sm text-indigo-800">
                <div class="bg-white p-4 rounded-xl shadow-sm border border-indigo-100">
                    <div class="font-bold mb-2 text-indigo-900 flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-indigo-500"></span>
                        Militar 6h (Use PM/PT)
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
                        Militar 8h (Use P)
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
                    <div class="font-bold text-slate-800">${l.nome}</div>
                    <div class="text-[10px] text-slate-500">${l.desc || ''}</div>
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
    
    const searchInput = document.getElementById('searchMilitaresConfig');
    const search = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const filteredMilitares = db.militares.filter(m => {
        if (!search) return true;
        const nome = (m.nome || '').toLowerCase();
        const num = (m.num || '').toLowerCase();
        const secao = (m.secao || '').toLowerCase();
        const posto = (m.posto || '').toLowerCase();
        const typeHora = (m.typeHora || '').toLowerCase();
        return nome.includes(search) || num.includes(search) || secao.includes(search) || posto.includes(search) || typeHora.includes(search);
    });

    filteredMilitares.sort(sortMilitares);

    const totalItems = filteredMilitares.length;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE_CONFIG) || 1;
    if (currentPageConfigMilitares > totalPages) currentPageConfigMilitares = totalPages;
    if (currentPageConfigMilitares < 1) currentPageConfigMilitares = 1;
    const startIndex = (currentPageConfigMilitares - 1) * ITEMS_PER_PAGE_CONFIG;
    const endIndex = startIndex + ITEMS_PER_PAGE_CONFIG;
    const paginatedMilitares = filteredMilitares.slice(startIndex, endIndex);

    const pageInfo = document.getElementById('pageInfoMilitaresConfig');
    if (pageInfo) pageInfo.textContent = `Página ${currentPageConfigMilitares} de ${totalPages}`;

    const btnPrev = document.querySelector('#paginationMilitaresConfig button:first-child');
    const btnNext = document.querySelector('#paginationMilitaresConfig button:last-child');
    if (btnPrev) btnPrev.disabled = currentPageConfigMilitares === 1;
    if (btnNext) btnNext.disabled = currentPageConfigMilitares === totalPages;

    const countLabel = document.getElementById('militaresConfigCount');
    if (countLabel) countLabel.textContent = `${totalItems} militar${totalItems !== 1 ? 'es' : ''}`;

    if (totalItems === 0) {
        list.innerHTML = `
            <div class="p-6 text-center text-sm text-slate-500 border border-dashed rounded-xl bg-slate-50">
                Nenhum militar encontrado.
            </div>
        `;
        return;
    }

    list.innerHTML = paginatedMilitares.map((m, i) => `
        <div class="p-4 border rounded-xl bg-white shadow-sm flex items-center gap-4 hover:shadow-md transition">
            <div class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-500 text-xs text-center">
                ${m.posto || m.secao.substring(0,2)}
            </div>
            <div class="flex-1">
                <div class="font-bold text-slate-800">${m.posto || ''} ${m.nome}</div>
                <div class="text-xs text-slate-400 font-mono">${m.num} · ${m.secao} · ${m.typeHora || "6h"}</div>
            </div>
            <div class="flex gap-2">
                <button onclick="openModalMilitar(${db.militares.indexOf(m)})" class="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 flex items-center justify-center transition">
                    <i class="fas fa-edit text-xs"></i>
                </button>
                <button onclick="removeMilitar(${db.militares.indexOf(m)})" class="w-8 h-8 rounded-full bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center transition">
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
        document.getElementById('inputNomeLegenda').value = l.nome;
        document.getElementById('inputDescLegenda').value = l.desc || "";
        document.getElementById('inputHoras').value = l.horas;
        document.getElementById('inputColorBg').value = l.color;
        document.getElementById('inputColorText').value = l.text;
    } else {
        title.innerText = "Nova Legenda"; // Reset for new
        document.getElementById('inputSigla').value = "";
        document.getElementById('inputNomeLegenda').value = "";
        document.getElementById('inputDescLegenda').value = "";
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
    const nome = document.getElementById('inputNomeLegenda').value;
    const desc = document.getElementById('inputDescLegenda').value;
    const horas = parseFloat(document.getElementById('inputHoras').value) || 0.0;
    const color = document.getElementById('inputColorBg').value;
    const text = document.getElementById('inputColorText').value;

    if (!sigla || !nome) {
        alert("Preencha Sigla e Nome.");
        return;
    }

    if (currentEditLegendaId !== null) {
        // Edit
        db.legendas[currentEditLegendaId] = { sigla, nome, desc, horas, color, text };
    } else {
        // Create
        db.legendas.push({ sigla, nome, desc, horas, color, text });
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
    let typeHora = document.getElementById('inputTypeHora').value;

    // Rule: Civis must be 8h
    if (posto && posto.toLowerCase().includes('civil')) {
        typeHora = '8h';
    }

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

// Functionality removed as requested (2026-02-05).
// Workload deviations now handled by explicit legend use (PT/PM vs P).

// ------ CSV IMPORT FUNCTIONS ------

// Modal Functions
function openModalImportSecoes() {
    const modal = document.getElementById('modalImportSecoes');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('div').classList.remove('scale-95');
    });
}

function closeModalImportSecoes() {
    const modal = document.getElementById('modalImportSecoes');
    modal.classList.add('opacity-0');
    modal.querySelector('div').classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
    document.getElementById('fileImportSecoes').value = '';
    document.getElementById('previewSecoes').classList.add('hidden');
}

function openModalImportLegendas() {
    const modal = document.getElementById('modalImportLegendas');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('div').classList.remove('scale-95');
    });
}

function closeModalImportLegendas() {
    const modal = document.getElementById('modalImportLegendas');
    modal.classList.add('opacity-0');
    modal.querySelector('div').classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
    document.getElementById('fileImportLegendas').value = '';
    document.getElementById('previewLegendas').classList.add('hidden');
}

function openModalImportMilitares() {
    const modal = document.getElementById('modalImportMilitares');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('div').classList.remove('scale-95');
    });
}

function closeModalImportMilitares() {
    const modal = document.getElementById('modalImportMilitares');
    modal.classList.add('opacity-0');
    modal.querySelector('div').classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
    document.getElementById('fileImportMilitares').value = '';
    document.getElementById('previewMilitares').classList.add('hidden');
}

// Helper: Read file and parse CSV
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
}

// Seções Import
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileImportSecoes');
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    const content = await readFileAsText(file);
                    const preview = parseCSVPreview(content, 2);
                    const previewDiv = document.getElementById('previewSecoesContent');
                    previewDiv.innerHTML = preview.map(row => 
                        `<div class="border-b pb-1"><strong>${row.SIGLA || row.sigla || 'N/A'}</strong> - ${row['NOME/DESCRIÇÃO'] || row.nome || 'N/A'}</div>`
                    ).join('');
                    document.getElementById('previewSecoes').classList.remove('hidden');
                } catch (err) {
                    alert('Erro ao ler arquivo: ' + err.message);
                }
            }
        });
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileImportLegendas');
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    const content = await readFileAsText(file);
                    const preview = parseCSVPreview(content, 2);
                    const previewDiv = document.getElementById('previewLegendasContent');
                    previewDiv.innerHTML = preview.map(row => 
                        `<div class="border-b pb-1"><strong>${row.SIGLA || row.sigla || 'N/A'}</strong> - ${row.DESCRIÇÃO || row.desc || 'N/A'} (${row.HORA || row.horas || '0'} h)</div>`
                    ).join('');
                    document.getElementById('previewLegendas').classList.remove('hidden');
                } catch (err) {
                    alert('Erro ao ler arquivo: ' + err.message);
                }
            }
        });
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileImportMilitares');
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    const content = await readFileAsText(file);
                    const preview = parseCSVPreview(content, 3);
                    const previewDiv = document.getElementById('previewMilitaresContent');
                    previewDiv.innerHTML = preview.map(row => 
                        `<div class="border-b pb-1"><strong>${row.Matricula || row.matricula || 'N/A'}</strong> - ${row['Nome Completo'] || row.nome || 'N/A'}</div>`
                    ).join('');
                    document.getElementById('previewMilitares').classList.remove('hidden');
                } catch (err) {
                    alert('Erro ao ler arquivo: ' + err.message);
                }
            }
        });
    }
});

// Parse CSV for preview (show first N rows)
function parseCSVPreview(csvContent, maxRows = 5) {
    const lines = csvContent.trim().split('\n');
    if (lines.length === 0) return [];

    // Detect separator (TAB or comma)
    const firstLine = lines[0];
    const separator = firstLine.includes('\t') ? '\t' : ',';

    const headers = firstLine.split(separator).map(h => h.trim());
    const data = [];

    for (let i = 1; i < lines.length && i <= maxRows; i++) {
        const values = lines[i].split(separator).map(v => v.trim());
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });
        data.push(row);
    }

    return data;
}

// Import Seções
async function importSecoesCSV() {
    const fileInput = document.getElementById('fileImportSecoes');
    const file = fileInput.files[0];

    if (!file) {
        alert('Selecione um arquivo CSV');
        return;
    }

    try {
        const content = await readFileAsText(file);
        const resp = await fetch(`${API_URL}/import/secoes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Role': currentUser.role
            },
            body: JSON.stringify({ csvContent: content })
        });

        const result = await resp.json();

        if (resp.ok) {
            alert(result.message || 'Seções importadas com sucesso!');
            closeModalImportSecoes();
            await loadData();
            renderConfig();
            setupSectionFilter();
        } else {
            alert('Erro: ' + (result.error || 'Erro desconhecido'));
        }
    } catch (err) {
        alert('Erro ao importar: ' + err.message);
    }
}

// Import Legendas
async function importLegendasCSV() {
    const fileInput = document.getElementById('fileImportLegendas');
    const file = fileInput.files[0];

    if (!file) {
        alert('Selecione um arquivo CSV');
        return;
    }

    try {
        const content = await readFileAsText(file);
        const resp = await fetch(`${API_URL}/import/legendas`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Role': currentUser.role
            },
            body: JSON.stringify({ csvContent: content })
        });

        const result = await resp.json();

        if (resp.ok) {
            alert(result.message || 'Legendas importadas com sucesso!');
            closeModalImportLegendas();
            await loadData();
            renderConfig();
            renderGlossario();
            renderEscala();
        } else {
            alert('Erro: ' + (result.error || 'Erro desconhecido'));
        }
    } catch (err) {
        alert('Erro ao importar: ' + err.message);
    }
}

// Import Militares
async function importMilitaresCSV() {
    const fileInput = document.getElementById('fileImportMilitares');
    const file = fileInput.files[0];

    if (!file) {
        alert('Selecione um arquivo CSV');
        return;
    }

    try {
        const content = await readFileAsText(file);
        const resp = await fetch(`${API_URL}/import/militares`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Role': currentUser.role
            },
            body: JSON.stringify({ csvContent: content })
        });

        const result = await resp.json();

        if (resp.ok) {
            alert(result.message || 'Militares importados com sucesso!');
            closeModalImportMilitares();
            await loadData();
            renderConfig();
            renderEscala();
        } else {
            alert('Erro: ' + (result.error || 'Erro desconhecido'));
        }
    } catch (err) {
        alert('Erro ao importar: ' + err.message);
    }
}

// ------ DASHBOARD ------

function renderDashboard() {
    const selMes = document.getElementById('selMesDashboard');
    const dateRefInput = document.getElementById('dashDateRef');
    if (!selMes || !dateRefInput) return;
    
    // Set default date to TODAY if empty
    if (!dateRefInput.value) {
        // Adjust for timezone offset to ensure "Today" is correct locally
        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        dateRefInput.value = `${y}-${m}-${d}`;
    }

    // Sync Hidden Month Selector with Date Picker
    // Because selMesDashboard is now hidden, we must ensure it stays in sync so 'month' var is correct
    // or just derive everything from dateRefInput.
    const refDateVal = dateRefInput.value; // YYYY-MM-DD
    if (refDateVal) {
        const [rY, rM, rD] = refDateVal.split('-').map(Number);
        // selMes values are 0-11
        const targetMesVal = String(rM - 1);
        if (selMes.value !== targetMesVal) {
            selMes.value = targetMesVal;
        }
    }
    
    const month = parseInt(selMes.value); // 0-based
    const year = 2026; 
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const tableBody = document.getElementById('dashboardTableBody');
    const tableFoot = document.getElementById('dashboardTableFoot');
    if(tableBody) tableBody.innerHTML = '';
    if(tableFoot) tableFoot.innerHTML = '';
    
    // Sort sections
    const sortedSecoes = [...db.secoes].sort((a,b) => a.sigla.localeCompare(b.sigla));

    // Filter Logic for Dashboard
    const filterContainer = document.getElementById('filterSecoesContainerDashboard');
    let checkedSecoes = [];
    let hasFilter = false;
    
    if(filterContainer) {
        // Only select item checkboxes, ignore "select all"
        const checkboxes = filterContainer.querySelectorAll('.filter-chk-item');
        if(checkboxes.length > 0) {
            hasFilter = true;
            checkedSecoes = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
        }
    }
    
    // Accumulators for Footer
    let grandTotalMil = 0;
    let grandTotalPreenchidos = 0;
    let grandTotalPresentes = 0;

    const [refY, refM, refD] = refDateVal.split('-').map(Number);
    const refMonthIdx = refM - 1;

    sortedSecoes.forEach(secao => {
        // Apply Filters
        if (hasFilter && !checkedSecoes.includes(secao.sigla)) {
            return;
        }

        const militaresDaSecao = db.militares.filter(m => m.secao === secao.sigla);
        
        let countPreenchidos = 0;
        let countPresentes = 0;
        
        militaresDaSecao.forEach(m => {
            const refKey = `${m.id}-${refMonthIdx}-${refD}`;

            // Count Preenchidos:
            // Consider "Preenchido" if the soldier has ANY defined status for the Reference Date.
            if(db.escala[refKey] && db.escala[refKey] !== "") {
                countPreenchidos++;
            }
            
            // Count Presentes:
            // "Presente" check is specific to the Reference Date (dashDateRef).
            // We consider P, PM, PT as "Presente".
            if(db.escala[refKey]) {
                const val = db.escala[refKey];
                if(['P', 'PM', 'PT'].includes(val)) {
                    countPresentes++;
                }
            }
        });

        // Calculations
        const total = militaresDaSecao.length;
        const percPres = total > 0 ? (countPresentes / total * 100).toFixed(2) : "0.00";
        const percPreench = total > 0 ? (countPreenchidos / total * 100).toFixed(2) : "0.00";

        // Update Grand Totals
        grandTotalMil += total;
        grandTotalPreenchidos += countPreenchidos;
        grandTotalPresentes += countPresentes;
        
        // Render Row
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition border-b border-slate-100 last:border-none";
        tr.innerHTML = `
            <td class="px-6 py-4 font-bold text-slate-700 max-w-[150px] truncate" title="${secao.desc || ''}">${secao.sigla}</td>
            <td class="px-6 py-4 text-center font-bold text-emerald-600">${countPresentes}</td>
            <td class="px-6 py-4 text-center font-bold text-blue-600">${countPreenchidos}</td>
            <td class="px-6 py-4 text-center font-bold text-slate-800">${total}</td>
            <td class="px-6 py-4 text-center font-medium text-slate-600 bg-slate-50/50">${percPres}%</td>
            <td class="px-6 py-4 text-center font-medium text-slate-600 bg-slate-50/50">${percPreench}%</td>
        `;
        tableBody.appendChild(tr);
    });
    
    // Render Footer
    const grandPercPres = grandTotalMil > 0 ? (grandTotalPresentes / grandTotalMil * 100).toFixed(2) : "0.00";
    const grandPercPreench = grandTotalMil > 0 ? (grandTotalPreenchidos / grandTotalMil * 100).toFixed(2) : "0.00";
    
    tableFoot.innerHTML = `
        <tr class="bg-slate-100 p-2 border-t-2 border-slate-200">
            <td class="px-6 py-4 font-black text-slate-800 uppercase tracking-wider">TOTAL GERAL</td>
            <td class="px-6 py-4 text-center font-black text-emerald-700 text-lg">${grandTotalPresentes}</td>
            <td class="px-6 py-4 text-center font-black text-blue-700 text-lg">${grandTotalPreenchidos}</td>
            <td class="px-6 py-4 text-center font-black text-slate-900 text-lg">${grandTotalMil}</td>
            <td class="px-6 py-4 text-center font-bold text-slate-700">${grandPercPres}%</td>
            <td class="px-6 py-4 text-center font-bold text-slate-700">${grandPercPreench}%</td>
        </tr>
    `;
}

// ------ MOBILE UI ------

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlaySidebar');
    
    if (sidebar.classList.contains('-translate-x-full')) {
        // Open
        sidebar.classList.remove('-translate-x-full');
        sidebar.classList.add('translate-x-0'); 
        overlay.classList.remove('hidden');
    } else {
        // Close
        sidebar.classList.add('-translate-x-full');
        sidebar.classList.remove('translate-x-0');
        overlay.classList.add('hidden');
    }
}

// ------ AVISOS / OBSERVAÇÕES ------
let currentEditAvisoId = null;

function renderAvisos() {
    const list = document.getElementById('listaAvisos');
    if(!list) return;

    if(!db.avisos) db.avisos = {};

    const monthIdx = document.getElementById('selMes').value;
    const year = 2026;
    const key = `${monthIdx}-${year}`;
    
    // items is array of { id, text, createdAt, author, ... }
    const items = db.avisos[key] || [];

    if(items.length === 0) {
        list.innerHTML = `<div class="col-span-full text-xs text-slate-400 italic p-4 text-center border rounded-lg bg-slate-50">Nenhum aviso ou observação para este mês.</div>`;
        return;
    }

    list.innerHTML = items.map((aviso, idx) => {
        // Check if current user can edit/delete this aviso
        const canModify = currentUser && (
            currentUser.role === 'ADMIN' || 
            aviso.authorUsername === currentUser.username
        );
        
        const actionButtons = canModify ? `
            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onclick="openModalAviso('${aviso.id}')" class="w-7 h-7 flex items-center justify-center rounded text-blue-600 hover:bg-blue-200" title="Editar">
                    <i class="fas fa-edit text-xs"></i>
                </button>
                <button onclick="deleteAviso('${aviso.id}')" class="w-7 h-7 flex items-center justify-center rounded text-red-500 hover:bg-red-200" title="Excluir">
                    <i class="fas fa-trash text-xs"></i>
                </button>
            </div>
        ` : '';
        
        return `
        <div class="p-4 border border-blue-100 bg-blue-50/50 rounded-xl flex justify-between items-start gap-3 hover:bg-blue-50 transition group">
            <div class="flex-1">
                <div class="text-xs font-bold text-blue-700 mb-1 flex items-center gap-2">
                    <i class="fas fa-user-circle"></i> ${aviso.author || 'Sistema'}
                    <span class="text-blue-400 font-normal">em ${aviso.dateDisplay || ''}</span>
                </div>
                <div class="text-sm text-slate-700 whitespace-pre-wrap">${aviso.text}</div>
            </div>
            ${actionButtons}
        </div>
    `;
    }).join('');
}

function openModalAviso(id = null) {
    const modal = document.getElementById('modalAviso');
    const title = document.getElementById('modalTitleAviso');
    const txtArea = document.getElementById('inputAvisoTexto');
    
    currentEditAvisoId = id;

    if(id) {
        title.innerText = "Editar Aviso";
        const monthIdx = document.getElementById('selMes').value;
        const key = `${monthIdx}-2026`;
        const items = db.avisos[key] || [];
        const item = items.find(i => i.id === id);
        if(item) {
            // Verify ownership before allowing edit
            const canModify = currentUser && (
                currentUser.role === 'ADMIN' || 
                item.authorUsername === currentUser.username
            );
            if(!canModify) {
                alert("Você não tem permissão para editar este aviso.");
                return;
            }
            txtArea.value = item.text;
        }
    } else {
        title.innerText = "Novo Aviso";
        txtArea.value = "";
    }
    
    modal.classList.add('active');
    setTimeout(() => txtArea.focus(), 100);
}

function closeModalAviso() {
    document.getElementById('modalAviso').classList.remove('active');
    currentEditAvisoId = null;
}

function saveAviso() {
    const txt = document.getElementById('inputAvisoTexto').value.trim();
    if(!txt) {
        alert("O aviso não pode ser vazio.");
        return;
    }

    const monthIdx = document.getElementById('selMes').value;
    const key = `${monthIdx}-2026`;
    
    if(!db.avisos[key]) db.avisos[key] = [];

    const now = new Date();
    const dateDisplay = now.toLocaleDateString('pt-BR') + ' às ' + now.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
    
    let author = "Anônimo";
    if(currentUser) {
        // Try to get Name + Rank
        const m = db.militares.find(mil => mil.num.replace(/\D/g, '') === currentUser.username);
        if(m) {
            author = `${m.posto || ''} ${m.nome}`;
        } else {
            author = currentUser.username;
        }
    }

    if(currentEditAvisoId) {
        // Edit
        const item = db.avisos[key].find(i => i.id === currentEditAvisoId);
        if(item) {
            // Verify ownership before saving edit
            const canModify = currentUser && (
                currentUser.role === 'ADMIN' || 
                item.authorUsername === currentUser.username
            );
            if(!canModify) {
                alert("Você não tem permissão para editar este aviso.");
                closeModalAviso();
                return;
            }
            item.text = txt;
            // Optionally update author/date on edit? Let's update dateDisplay to show last edited.
            item.dateDisplay = dateDisplay + ' (editado)';
            // Keep original author, don't change it
        }
    } else {
        // Create
        const newId = 'aviso_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        db.avisos[key].push({
            id: newId,
            text: txt,
            author: author,
            authorUsername: currentUser ? currentUser.username : null,
            dateDisplay: dateDisplay,
            createdAt: now.toISOString()
        });
    }

    save();
    renderAvisos();
    closeModalAviso();
}

function deleteAviso(id) {
    const monthIdx = document.getElementById('selMes').value;
    const key = `${monthIdx}-2026`;
    
    if(db.avisos[key]) {
        const item = db.avisos[key].find(i => i.id === id);
        if(item) {
            // Verify ownership before deleting
            const canModify = currentUser && (
                currentUser.role === 'ADMIN' || 
                item.authorUsername === currentUser.username
            );
            if(!canModify) {
                alert("Você não tem permissão para excluir este aviso.");
                return;
            }
        }
        
        if(!confirm("Tem certeza que deseja excluir este aviso?")) return;
        
        db.avisos[key] = db.avisos[key].filter(i => i.id !== id);
        save();
        renderAvisos();
    }
}
