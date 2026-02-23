const cluster = require('cluster');
const os = require('os');
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const PORT = 3000;
const BCRYPT_ROUNDS = 4; // Mínimo seguro para performance máxima

// Cluster Mode - utiliza todos os CPUs disponíveis
if (cluster.isMaster) {
    const numCPUs = os.cpus().length;
    console.log(`Master process ${process.pid} starting...`);
    console.log(`Forking ${numCPUs} workers...`);

    // Fork workers
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died. Restarting...`);
        cluster.fork();
    });

    return;
}

console.log(`Worker ${process.pid} started`);

const app = express();

// PostgreSQL Connection Pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://bmtrack:bmtrack123@postgres:5432/bmtrack',
    max: 100,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
    console.log('Connected to PostgreSQL database.');
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

// Middleware
app.use(compression());
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// Initialize Database
async function initDb() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Seções
        await client.query(`
            CREATE TABLE IF NOT EXISTS secoes (
                sigla TEXT PRIMARY KEY,
                "desc" TEXT
            )
        `);

        // Legendas
        await client.query(`
            CREATE TABLE IF NOT EXISTS legendas (
                sigla TEXT PRIMARY KEY,
                nome TEXT,
                "desc" TEXT,
                color TEXT,
                "text" TEXT,
                horas REAL
            )
        `);

        // Militares - UNIFIED (includes user data: password, role)
        await client.query(`
            CREATE TABLE IF NOT EXISTS militares (
                id SERIAL PRIMARY KEY,
                num TEXT UNIQUE,
                nome TEXT,
                secao TEXT,
                posto TEXT,
                typeHora TEXT,
                password TEXT,
                role TEXT
            )
        `);

        // Escala
        await client.query(`
            CREATE TABLE IF NOT EXISTS escala (
                militar_id INTEGER,
                mes INTEGER,
                dia INTEGER,
                sigla TEXT,
                PRIMARY KEY (militar_id, mes, dia)
            )
        `);

        // Horas Extras
        await client.query(`
            CREATE TABLE IF NOT EXISTS horas_extras (
                militar_id INTEGER,
                mes INTEGER,
                dia INTEGER,
                val REAL,
                obs TEXT,
                PRIMARY KEY (militar_id, mes, dia)
            )
        `);

        // Cargas Diárias
        await client.query(`
            CREATE TABLE IF NOT EXISTS cargas_diarias (
                militar_id INTEGER,
                mes INTEGER,
                dia INTEGER,
                type TEXT,
                PRIMARY KEY (militar_id, mes, dia)
            )
        `);

        // Avisos
        await client.query(`
            CREATE TABLE IF NOT EXISTS avisos (
                id TEXT PRIMARY KEY,
                ref_key TEXT,
                text TEXT,
                author TEXT,
                authorUsername TEXT,
                dateDisplay TEXT,
                createdAt TEXT
            )
        `);

        await client.query('COMMIT');
        console.log("Tables initialized.");

        // Check if data needs to be imported
        await checkAndImportInitialData();
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Error initializing database:", err);
        throw err;
    } finally {
        client.release();
    }
}

async function checkAndImportInitialData() {
    try {
        const result = await pool.query("SELECT count(*) as count FROM militares");
        const count = parseInt(result.rows[0].count);
        
        if (count === 0) {
            console.log("Database empty. Importing initial data from CSV files...");
            await importInitialData();
        } else {
            console.log(`Database has ${count} military records.`);
            await ensureAdminExists();
        }
    } catch (err) {
        console.error("Error checking initial data:", err);
    }
}

async function importInitialData() {
    const secoesPath = path.join(__dirname, 'importacoes', 'DADOS PRINCIPAIS - SEÇOES.csv');
    const legendasPath = path.join(__dirname, 'importacoes', 'DADOS PRINCIPAIS - LEGENDA.csv');
    const militaresPath = path.join(__dirname, 'importacoes', 'DADOS PRINCIPAIS - MILITARES.csv');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Import Seções
        if (fs.existsSync(secoesPath)) {
            console.log("Importing seções...");
            const data = parseCSV(fs.readFileSync(secoesPath, 'utf8'));
            
            for (const row of data) {
                const sigla = row['SIGLA'] || row['sigla'];
                const desc = row['NOME/DESCRIÇÃO'] || row['nome'] || row['DESCRIÇÃO'];
                if (sigla && desc) {
                    await client.query(
                        "INSERT INTO secoes (sigla, \"desc\") VALUES ($1, $2) ON CONFLICT (sigla) DO NOTHING",
                        [sigla, desc.trim()]
                    );
                }
            }
            console.log(`Imported ${data.length} seções.`);
        }

        // 2. Import Legendas
        if (fs.existsSync(legendasPath)) {
            console.log("Importing legendas...");
            const data = parseCSV(fs.readFileSync(legendasPath, 'utf8'));
            
            const defaultColors = {
                'P': { color: '#dcfce7', text: '#166534' },
                'PM': { color: '#fef9c3', text: '#854d0e' },
                'PT': { color: '#e0f2fe', text: '#0369a1' },
                'FO': { color: '#dbeafe', text: '#1e40af' },
                'F': { color: '#fef9c3', text: '#854d0e' },
                'LM': { color: '#fee2e2', text: '#991b1b' },
                'TAF': { color: '#fce7f3', text: '#be185d' },
                'TPB': { color: '#e0e7ff', text: '#3730a3' },
                'DSP': { color: '#fed7aa', text: '#9a3412' },
                '4ESF': { color: '#c7d2fe', text: '#3730a3' },
                'C': { color: '#d1fae5', text: '#065f46' },
                'PSO': { color: '#fecaca', text: '#991b1b' },
                'INT': { color: '#bfdbfe', text: '#1e40af' },
                'AUL': { color: '#ddd6fe', text: '#5b21b6' },
                'OD': { color: '#e5e7eb', text: '#374151' }
            };

            for (const row of data) {
                const sigla = row['SIGLA'] || row['sigla'];
                const desc = row['DESCRIÇÃO'] || row['desc'] || row['descricao'];
                let horas = parseFloat(row['HORA'] || row['horas'] || '0');
                
                if (isNaN(horas) && row['HORA']) {
                    if (row['HORA'].includes('8')) horas = 8;
                    else if (row['HORA'].includes('6')) horas = 6;
                }

                const colors = defaultColors[sigla] || { color: '#e5e7eb', text: '#374151' };

                if (sigla) {
                    await client.query(
                        "INSERT INTO legendas (sigla, nome, \"desc\", horas, color, \"text\") VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (sigla) DO NOTHING",
                        [sigla, desc || sigla, desc || '', horas, colors.color, colors.text]
                    );
                }
            }
            console.log(`Imported ${data.length} legendas.`);
        }

        // 3. Import Militares (with user data)
        if (fs.existsSync(militaresPath)) {
            console.log("Importing militares...");
            const data = parseCSV(fs.readFileSync(militaresPath, 'utf8'));
            
            for (const row of data) {
                const matricula = row['Matricula'] || row['matricula'];
                const nome = row['Nome Completo'] || row['nome'];
                const secaoSigla = row['Seçao Sigla'] || row['Seção Sigla'] || row['secao'];
                const posto = row['PG'] || row['pg'] || '';
                let cargaHoraria = row['Carga Horaria'] || row['carga_horaria'] || '8h';
                
                if (posto && posto.toLowerCase().includes('civil')) {
                    cargaHoraria = '8h';
                }

                const acessoSistema = row['Acesso ao Sistema'] || row['acesso'];
                const perfil = row['Perfil'] || row['perfil'] || 'USUARIO';
                const senha = row['Senha'] || row['senha'] || 'cbmmg193';

                if (matricula && nome) {
                    let hashedPassword = null;
                    let role = null;
                    
                    if (acessoSistema && (acessoSistema === 'TRUE' || acessoSistema === 'true' || acessoSistema === '1')) {
                        hashedPassword = bcrypt.hashSync(senha, BCRYPT_ROUNDS);
                        role = perfil.toUpperCase();
                    }
                    
                    await client.query(
                        "INSERT INTO militares (num, nome, secao, posto, typeHora, password, role) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (num) DO NOTHING",
                        [matricula, nome, secaoSigla || '', posto, cargaHoraria, hashedPassword, role]
                    );
                }
            }
            console.log(`Imported ${data.length} militares.`);
        }

        await client.query('COMMIT');
        console.log("Initial data import complete.");
        await ensureAdminExists();
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Error importing initial data:", err);
        throw err;
    } finally {
        client.release();
    }
}

async function ensureAdminExists() {
    // Ensure at least one ADMIN exists (142.924-0)
    const adminNum = "142.924-0";
    const adminUsername = adminNum.replace(/\D/g, '');
    
    try {
        const result = await pool.query("SELECT * FROM militares WHERE num = $1", [adminNum]);
        
        if (result.rows.length === 0) {
            // Create admin if doesn't exist
            console.log("Creating default Admin (142.924-0)...");
            const hashedPassword = bcrypt.hashSync(adminUsername, BCRYPT_ROUNDS);
            await pool.query(
                "INSERT INTO militares (num, nome, secao, posto, typeHora, password, role) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                [adminNum, "Administrador do Sistema", "S-1", "Cap", "6h", hashedPassword, "ADMIN"]
            );
        } else if (result.rows[0].role !== 'ADMIN') {
            // Always ensure this specific user is ADMIN
            console.log("Ensuring 142.924-0 has ADMIN role...");
            const hashedPassword = bcrypt.hashSync(adminUsername, BCRYPT_ROUNDS);
            await pool.query(
                "UPDATE militares SET password = $1, role = $2 WHERE num = $3",
                [hashedPassword, "ADMIN", adminNum]
            );
        }
    } catch (err) {
        console.error("Error ensuring admin exists:", err);
    }
}

// Helper function to parse CSV content
function parseCSV(csvContent) {
    const lines = csvContent.trim().split(/\r?\n/);
    if (lines.length === 0) return [];

    const firstLine = lines[0];
    let separator = ',';
    if (firstLine.includes('\t')) separator = '\t';
    else if (firstLine.includes(';') && !firstLine.includes(',')) separator = ';';

    const cleanBox = (str) => str ? str.trim().replace(/^"|"$/g, '') : '';
    const headers = firstLine.split(separator).map(cleanBox);
    
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = lines[i].split(separator).map(cleanBox);
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });
        data.push(row);
    }
    
    return data;
}

// ============================================
// API Routes
// ============================================

// Login Endpoint - now queries militares table
app.post('/api/login', async (req, res) => {
    try {
        const rawUsername = req.body.username || '';
        const username = rawUsername.replace(/\D/g, ''); // Extract only digits
        const password = req.body.password;
        
        // Query militares by num (cleaned to digits)
        const result = await pool.query(
            "SELECT * FROM militares WHERE REPLACE(REPLACE(REPLACE(num, '.', ''), '-', ''), ' ', '') = $1",
            [username]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Credenciais inválidas" });
        }
        
        const row = result.rows[0];
        if (!row.password || !row.role) {
            return res.status(401).json({ error: "Usuário sem acesso ao sistema" });
        }

        if (!bcrypt.compareSync(password, row.password)) {
            return res.status(401).json({ error: "Credenciais inválidas" });
        }

        const token = crypto.randomBytes(16).toString('hex');
        
        res.json({
            success: true,
            user: {
                username: row.num.replace(/\D/g, ''),
                name: row.nome,
                role: row.role
            },
            token: token
        });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: "Database error" });
    }
});

// GET Full Data
app.get('/api/data', async (req, res) => {
    try {
        const response = {
            secoes: [],
            legendas: [],
            militares: [],
            escala: {},
            horasExtras: {},
            cargasDiarias: {},
            avisos: {}
        };

        // Execute all queries in parallel
        const [secoesResult, legendasResult, militaresResult, escalaResult, horasExtrasResult, cargasDiariasResult, avisosResult] = await Promise.all([
            pool.query("SELECT * FROM secoes"),
            pool.query("SELECT * FROM legendas"),
            pool.query("SELECT id, num, nome, secao, posto, typeHora, role FROM militares"),
            pool.query("SELECT * FROM escala"),
            pool.query("SELECT * FROM horas_extras"),
            pool.query("SELECT * FROM cargas_diarias"),
            pool.query("SELECT * FROM avisos")
        ]);

        response.secoes = secoesResult.rows;
        response.legendas = legendasResult.rows;
        
        // Map role as user_role for frontend compatibility
        response.militares = militaresResult.rows.map(m => ({
            ...m,
            user_role: m.role || null
        }));

        escalaResult.rows.forEach(r => {
            response.escala[`${r.militar_id}-${r.mes}-${r.dia}`] = r.sigla;
        });

        horasExtrasResult.rows.forEach(r => {
            response.horasExtras[`${r.militar_id}-${r.mes}-${r.dia}`] = { val: r.val, obs: r.obs };
        });

        cargasDiariasResult.rows.forEach(r => {
            response.cargasDiarias[`${r.militar_id}-${r.mes}-${r.dia}`] = r.type;
        });

        avisosResult.rows.forEach(r => {
            const key = r.ref_key;
            if (!response.avisos[key]) response.avisos[key] = [];
            response.avisos[key].push({
                id: r.id,
                text: r.text,
                author: r.author,
                authorUsername: r.authorusername,
                dateDisplay: r.datedisplay,
                createdAt: r.createdat
            });
        });

        res.json(response);
    } catch (err) {
        console.error("Error fetching data:", err);
        res.status(500).json({ error: err.message });
    }
});

// POST Save Full Data
app.post('/api/save', async (req, res) => {
    const userRole = req.headers['x-role'];
    
    if (userRole === 'USUARIO') {
        return res.status(403).json({ error: "Permissão negada. Usuários não podem salvar dados." });
    }

    const data = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Save Escala
        await client.query("DELETE FROM escala");
        for (const key in data.escala) {
            const [id, mes, dia] = key.split('-').map(Number);
            const sigla = data.escala[key];
            if (sigla && sigla.trim() !== '') {
                await client.query(
                    "INSERT INTO escala (militar_id, mes, dia, sigla) VALUES ($1, $2, $3, $4)",
                    [id, mes, dia, sigla]
                );
            }
        }

        // Save Horas Extras
        await client.query("DELETE FROM horas_extras");
        for (const key in data.horasExtras) {
            const [id, mes, dia] = key.split('-').map(Number);
            const he = data.horasExtras[key];
            if (he && (he.val || he.obs)) {
                await client.query(
                    "INSERT INTO horas_extras (militar_id, mes, dia, val, obs) VALUES ($1, $2, $3, $4, $5)",
                    [id, mes, dia, he.val || 0, he.obs || '']
                );
            }
        }

        // Save Cargas Diárias
        await client.query("DELETE FROM cargas_diarias");
        for (const key in data.cargasDiarias) {
            const [id, mes, dia] = key.split('-').map(Number);
            const type = data.cargasDiarias[key];
            if (type) {
                await client.query(
                    "INSERT INTO cargas_diarias (militar_id, mes, dia, type) VALUES ($1, $2, $3, $4)",
                    [id, mes, dia, type]
                );
            }
        }

        // Save Avisos
        await client.query("DELETE FROM avisos");
        for (const key in data.avisos) {
            const avisosList = data.avisos[key];
            if (Array.isArray(avisosList)) {
                for (const av of avisosList) {
                    await client.query(
                        "INSERT INTO avisos (id, ref_key, text, author, authorUsername, dateDisplay, createdAt) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                        [av.id, key, av.text, av.author, av.authorUsername || null, av.dateDisplay, av.createdAt]
                    );
                }
            }
        }

        // Save Legendas
        await client.query("DELETE FROM legendas");
        for (const l of data.legendas || []) {
            await client.query(
                "INSERT INTO legendas (sigla, nome, \"desc\", color, \"text\", horas) VALUES ($1, $2, $3, $4, $5, $6)",
                [l.sigla, l.nome || l.desc, l.desc || '', l.color, l.text, l.horas]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Save error:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// --- MILITAR MANAGEMENT ---

app.post('/api/manage/militar', async (req, res) => {
    const requestRole = req.headers['x-role'];
    if (requestRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Acesso negado. Apenas ADMIN pode gerenciar militares.' });
    }

    const { id, num, nome, secao, posto, typeHora, hasAccess, password, role } = req.body;

    if (!num || !nome) {
        return res.status(400).json({ error: 'Dados incompletos.' });
    }

    let finalPassword = null;
    let finalRole = null;

    if (hasAccess) {
        if (!role) {
            return res.status(400).json({ error: "Perfil de acesso obrigatório." });
        }
        finalRole = role;
        
        if (password && password.trim() !== '') {
            finalPassword = bcrypt.hashSync(password, BCRYPT_ROUNDS);
        }
    }

    try {
        if (id) {
            // Update existing militar
            if (hasAccess && password && password.trim() !== '') {
                await pool.query(
                    "UPDATE militares SET num = $1, nome = $2, secao = $3, posto = $4, typeHora = $5, password = $6, role = $7 WHERE id = $8",
                    [num, nome, secao, posto, typeHora, finalPassword, finalRole, id]
                );
            } else if (hasAccess) {
                // Update without changing password
                await pool.query(
                    "UPDATE militares SET num = $1, nome = $2, secao = $3, posto = $4, typeHora = $5, role = $6 WHERE id = $7",
                    [num, nome, secao, posto, typeHora, finalRole, id]
                );
            } else {
                // Remove access (clear password and role)
                await pool.query(
                    "UPDATE militares SET num = $1, nome = $2, secao = $3, posto = $4, typeHora = $5, password = NULL, role = NULL WHERE id = $6",
                    [num, nome, secao, posto, typeHora, id]
                );
            }
            res.json({ success: true });
        } else {
            // Insert new militar
            if (hasAccess && !password) {
                return res.status(400).json({ error: "Senha obrigatória para novo usuário com acesso." });
            }
            
            const result = await pool.query(
                "INSERT INTO militares (num, nome, secao, posto, typeHora, password, role) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
                [num, nome, secao, posto, typeHora, finalPassword, finalRole]
            );
            res.json({ success: true, id: result.rows[0].id });
        }
    } catch (err) {
        console.error("Militar management error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/manage/militar/:id', async (req, res) => {
    const requestRole = req.headers['x-role'];
    if (requestRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Acesso negado.' });
    }

    const id = req.params.id;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        
        await client.query("DELETE FROM militares WHERE id = $1", [id]);
        await client.query("DELETE FROM escala WHERE militar_id = $1", [id]);
        await client.query("DELETE FROM horas_extras WHERE militar_id = $1", [id]);
        await client.query("DELETE FROM cargas_diarias WHERE militar_id = $1", [id]);

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Delete error:", err);
        res.status(500).json({ error: "Erro na exclusão" });
    } finally {
        client.release();
    }
});

// Password change
app.post('/api/user/password', async (req, res) => {
    try {
        const rawUsername = req.body.username || '';
        const username = rawUsername.replace(/\D/g, '');
        const { oldPassword, newPassword } = req.body;
        
        if (!username || !oldPassword || !newPassword) {
            return res.status(400).json({ error: "Dados incompletos." });
        }

        const result = await pool.query(
            "SELECT * FROM militares WHERE REPLACE(REPLACE(REPLACE(num, '.', ''), '-', ''), ' ', '') = $1",
            [username]
        );
        
        if (result.rows.length === 0 || !result.rows[0].password) {
            return res.status(401).json({ error: "Usuário não encontrado ou sem acesso." });
        }
        
        const row = result.rows[0];
        
        if (!bcrypt.compareSync(oldPassword, row.password)) {
            return res.status(401).json({ error: "Senha atual incorreta." });
        }

        const hashedNew = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
        await pool.query("UPDATE militares SET password = $1 WHERE id = $2", [hashedNew, row.id]);
        
        res.json({ success: true });
    } catch (err) {
        console.error("Password change error:", err);
        res.status(500).json({ error: "Erro ao atualizar senha" });
    }
});

// List users (militares with access)
app.get('/api/users', async (req, res) => {
    if (req.headers['x-role'] !== 'ADMIN') {
        return res.status(403).json({ error: 'Acesso negado' });
    }
    
    try {
        const result = await pool.query(
            "SELECT id, num as username, role, nome as name FROM militares WHERE password IS NOT NULL AND role IS NOT NULL"
        );
        res.json(result.rows);
    } catch (err) {
        console.error("Users list error:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- CSV IMPORT ENDPOINTS ---

app.post('/api/import/secoes', async (req, res) => {
    const requestRole = req.headers['x-role'];
    if (requestRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Acesso negado.' });
    }

    const { csvContent } = req.body;
    if (!csvContent) {
        return res.status(400).json({ error: 'Nenhum conteúdo CSV fornecido.' });
    }

    const client = await pool.connect();
    try {
        const data = parseCSV(csvContent);
        
        await client.query('BEGIN');
        
        let successCount = 0;
        let errorCount = 0;

        for (const row of data) {
            const sigla = row['SIGLA'] || row['sigla'];
            const desc = row['NOME/DESCRIÇÃO'] || row['nome'] || row['DESCRIÇÃO'];
            
            if (sigla && desc) {
                try {
                    await client.query(
                        "INSERT INTO secoes (sigla, \"desc\") VALUES ($1, $2) ON CONFLICT (sigla) DO NOTHING",
                        [sigla, desc]
                    );
                    successCount++;
                } catch (err) {
                    errorCount++;
                }
            } else {
                errorCount++;
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, successCount, errorCount, message: `${successCount} seção(ões) importada(s)` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Seções import error:", err);
        res.status(400).json({ error: "Erro ao processar CSV: " + err.message });
    } finally {
        client.release();
    }
});

app.post('/api/import/legendas', async (req, res) => {
    const requestRole = req.headers['x-role'];
    if (requestRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Acesso negado.' });
    }

    const { csvContent } = req.body;
    if (!csvContent) {
        return res.status(400).json({ error: 'Nenhum conteúdo CSV fornecido.' });
    }

    const client = await pool.connect();
    try {
        const data = parseCSV(csvContent);
        
        await client.query('BEGIN');
        
        let successCount = 0;
        let errorCount = 0;

        const defaultColors = {
            'P': { color: '#dcfce7', text: '#166534' },
            'PM': { color: '#fef9c3', text: '#854d0e' },
            'PT': { color: '#e0f2fe', text: '#0369a1' },
            'FO': { color: '#dbeafe', text: '#1e40af' },
            'F': { color: '#fef9c3', text: '#854d0e' },
            'LM': { color: '#fee2e2', text: '#991b1b' },
            'TAF': { color: '#fce7f3', text: '#be185d' },
            'TPB': { color: '#e0e7ff', text: '#3730a3' },
            'DSP': { color: '#fed7aa', text: '#9a3412' },
            '4ESF': { color: '#c7d2fe', text: '#3730a3' }
        };

        for (const row of data) {
            const sigla = row['SIGLA'] || row['sigla'];
            let nome = row['NOME'] || row['nome'];
            let desc = row['DESCRIÇÃO'] || row['desc'] || row['descricao'];
            
            if (!nome && desc) {
                nome = desc;
                desc = '';
            }

            let horas = parseFloat(row['HORA'] || row['horas'] || '0');
            if (isNaN(horas) && row['HORA']) {
                if (row['HORA'].includes('8')) horas = 8;
                else if (row['HORA'].includes('6')) horas = 6;
            }

            const colors = defaultColors[sigla] || { color: '#e5e7eb', text: '#374151' };

            if (sigla && nome) {
                try {
                    await client.query(
                        "INSERT INTO legendas (sigla, nome, \"desc\", horas, color, \"text\") VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (sigla) DO NOTHING",
                        [sigla, nome, desc, horas, colors.color, colors.text]
                    );
                    successCount++;
                } catch (err) {
                    errorCount++;
                }
            } else {
                errorCount++;
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, successCount, errorCount, message: `${successCount} legenda(s) importada(s)` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Legendas import error:", err);
        res.status(400).json({ error: "Erro ao processar CSV: " + err.message });
    } finally {
        client.release();
    }
});

app.post('/api/import/militares', async (req, res) => {
    const requestRole = req.headers['x-role'];
    if (requestRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Acesso negado.' });
    }

    const { csvContent } = req.body;
    if (!csvContent) {
        return res.status(400).json({ error: 'Nenhum conteúdo CSV fornecido.' });
    }

    const client = await pool.connect();
    try {
        const data = parseCSV(csvContent);
        
        // Get existing nums
        const existingResult = await client.query("SELECT num FROM militares");
        const existingNums = new Set(existingResult.rows.map(r => r.num));
        
        let successCount = 0;
        let errorCount = 0;
        
        await client.query('BEGIN');
        
        for (const row of data) {
            const matricula = row['Matricula'] || row['matricula'];
            const nome = row['Nome Completo'] || row['nome'];
            const secaoSigla = row['Seçao Sigla'] || row['Seção Sigla'] || row['secao'];
            const posto = row['PG'] || row['pg'] || '';
            let cargaHoraria = row['Carga Horaria'] || row['carga_horaria'] || '8h';
            
            if (posto && posto.toLowerCase().includes('civil')) {
                cargaHoraria = '8h';
            }

            const acessoSistema = row['Acesso ao Sistema'] || row['acesso'];
            const perfil = row['Perfil'] || row['perfil'] || 'USUARIO';
            const senha = row['Senha'] || row['senha'] || 'cbmmg193';

            if (matricula && nome && secaoSigla) {
                if (!existingNums.has(matricula)) {
                    let hashedPassword = null;
                    let role = null;
                    
                    if (acessoSistema && (acessoSistema === 'TRUE' || acessoSistema === 'true' || acessoSistema === '1')) {
                        hashedPassword = bcrypt.hashSync(senha, BCRYPT_ROUNDS);
                        role = perfil.toUpperCase();
                    }
                    
                    try {
                        await client.query(
                            "INSERT INTO militares (num, nome, secao, posto, typeHora, password, role) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                            [matricula, nome, secaoSigla, posto, cargaHoraria, hashedPassword, role]
                        );
                        existingNums.add(matricula);
                        successCount++;
                    } catch (err) {
                        errorCount++;
                    }
                }
            } else {
                errorCount++;
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, successCount, errorCount, message: `${successCount} militar(es) importado(s)` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Militares import error:", err);
        res.status(400).json({ error: "Erro ao processar CSV: " + err.message });
    } finally {
        client.release();
    }
});

// Initialize database and start server
initDb().then(() => {
    app.listen(PORT, () => {
        console.log(`Worker ${process.pid} listening on port ${PORT}`);
    });
}).catch(err => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
});
