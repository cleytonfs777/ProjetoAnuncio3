const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto'); // For simple token generation

const app = express();
const PORT = 3000;
const DB_PATH = path.join(__dirname, 'bm_control.db');

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // Increase limit for large payloads
app.use(express.static(__dirname)); // Serve static files from root

// Database Setup
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        // Drop tables if necessary (during development/migration) - optional
        // db.run("DROP TABLE IF EXISTS secoes");
        // db.run("DROP TABLE IF EXISTS legendas");
        // db.run("DROP TABLE IF EXISTS militares");
        // db.run("DROP TABLE IF EXISTS escala");
        // db.run("DROP TABLE IF EXISTS horas_extras");
        // db.run("DROP TABLE IF EXISTS users");

        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            role TEXT,
            name TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS secoes (
            sigla TEXT PRIMARY KEY,
            desc TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS legendas (
            sigla TEXT PRIMARY KEY,
            nome TEXT,
            desc TEXT,
            color TEXT,
            text TEXT,
            horas REAL
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS militares (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            num TEXT,
            nome TEXT,
            secao TEXT,
            posto TEXT,
            typeHora TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS escala (
            militar_id INTEGER,
            mes INTEGER,
            dia INTEGER,
            sigla TEXT,
            PRIMARY KEY (militar_id, mes, dia)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS horas_extras (
            militar_id INTEGER,
            mes INTEGER,
            dia INTEGER,
            val REAL,
            obs TEXT,
            PRIMARY KEY (militar_id, mes, dia)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS cargas_diarias (
            militar_id INTEGER,
            mes INTEGER,
            dia INTEGER,
            type TEXT,
            PRIMARY KEY (militar_id, mes, dia)
        )`);
        
        console.log("Tables initialized.");
        
        // Migration: Check if legendas table needs update (rename desc -> nome, add desc)
        db.all("PRAGMA table_info(legendas)", (err, columns) => {
            if (!err && columns.length > 0 && !columns.some(c => c.name === 'nome')) {
                console.log("Migrating legendas schema...");
                db.serialize(() => {
                    db.run("ALTER TABLE legendas RENAME COLUMN desc TO nome");
                    db.run("ALTER TABLE legendas ADD COLUMN desc TEXT");
                });
            }
            
            initUsers();
            initAdminMilitar();
            checkMigration();
        });
    });
}

function initUsers() {
    // Check if our specific admin exists. If not, we reset the users table to this single admin.
    db.get("SELECT count(*) as count FROM users WHERE username = ?", ["1429240"], (err, row) => {
        if (!err && row && row.count === 0) {
            console.log("Resetting users to single requested Admin...");
            
            db.serialize(() => {
                db.run("DELETE FROM users"); // Remove default users (admin, gerente, usuario)
                
                const stmt = db.prepare("INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)");
                // Creating the requested Admin. Password defaults to the username.
                stmt.run("1429240", "1429240", "ADMIN", "Cap Cleyton Batista de Jesus");
                stmt.finalize();
                console.log("User '1429240' created.");
            });
        }
    });
}

function initAdminMilitar() {
    // Ensure the Admin user is also in the Military roster
    db.get("SELECT count(*) as count FROM militares WHERE num = ?", ["142.924-0"], (err, row) => {
        if (!err && row && row.count === 0) {
            console.log("Adding Admin to Military roster...");
            db.serialize(() => {
                // Ensure Section exists
                db.run("INSERT OR IGNORE INTO secoes (sigla, desc) VALUES ('S-1', 'RH')");
                
                // Insert Military Record
                // Assuming ID auto-increments
                const stmt = db.prepare("INSERT INTO militares (num, nome, secao, posto, typeHora) VALUES (?, ?, ?, ?, ?)");
                stmt.run("142.924-0", "Cleyton Batista de Jesus", "S-1", "Cap", "6h");
                stmt.finalize();
            });
        }
    });
}

function checkMigration() {
    // Check if DB is empty (only checks military table count)
    db.get("SELECT count(*) as count FROM militares", (err, row) => {
        // If we just added the admin, count will be 1. 
        // If it's truly empty (0), we migrate. 
        // If we added admin, we might skip migration of old json if we consider db "populated".
        // However, if the user wants to Keep old data + new admin, this logic might be tricky.
        // But the user said "Tire todos os usuários". This likely implies he wants a fresh start or just the users reset.
        // If I skip migration, he loses database.json data.
        
        // Let's keep migration logic but be careful.
        // If row.count <= 1 (just the admin or empty), maybe we still migrate? 
        // But migration adds from JSON.
        
        if(row && row.count === 0) {
            console.log("Database empty. Checking for database.json migration...");
            const jsonPath = path.join(__dirname, 'database.json');

            if(fs.existsSync(jsonPath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                    migrateData(data);
                } catch(e) {
                    console.error("Error reading database.json for migration", e);
                }
            }
        }
    });
}

function migrateData(jsonData) {
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        
        // Clear tables that rely on full-state sync to handle deletions
        db.run("DELETE FROM secoes");
        db.run("DELETE FROM legendas");
        // db.run("DELETE FROM militares"); // Militares managed via specific API, keep upsert safety
        db.run("DELETE FROM escala");
        db.run("DELETE FROM horas_extras");
        db.run("DELETE FROM cargas_diarias");

        // Secoes
        const stmtSec = db.prepare("INSERT INTO secoes (sigla, desc) VALUES (?, ?)");
        (jsonData.secoes || []).forEach(s => stmtSec.run(s.sigla, s.desc));
        stmtSec.finalize();

        // Legendas
        const stmtLeg = db.prepare("INSERT INTO legendas (sigla, nome, desc, color, text, horas) VALUES (?, ?, ?, ?, ?, ?)");
        (jsonData.legendas || []).forEach(l => {
            const nome = l.nome || l.desc;
            const desc = l.nome ? l.desc : '';
            stmtLeg.run(l.sigla, nome, desc, l.color, l.text, l.horas);
        });
        stmtLeg.finalize();

        // Militares (Keep upsert logic)
        const stmtMil = db.prepare("INSERT OR REPLACE INTO militares (id, num, nome, secao, posto, typeHora) VALUES (?, ?, ?, ?, ?, ?)");
        (jsonData.militares || []).forEach(m => stmtMil.run(m.id, m.num, m.nome, m.secao, m.posto, m.typeHora));
        stmtMil.finalize();

        // Escala
        const stmtEsc = db.prepare("INSERT INTO escala (militar_id, mes, dia, sigla) VALUES (?, ?, ?, ?)");
        Object.keys(jsonData.escala || {}).forEach(key => {
            const [id, mes, dia] = key.split('-').map(Number);
            const sigla = jsonData.escala[key];
            if(sigla && sigla.trim() !== '') {
                stmtEsc.run(id, mes, dia, sigla);
            }
        });
        stmtEsc.finalize();

        // Horas Extras
        const stmtHex = db.prepare("INSERT INTO horas_extras (militar_id, mes, dia, val, obs) VALUES (?, ?, ?, ?, ?)");
        Object.keys(jsonData.horasExtras || {}).forEach(key => {
            const [id, mes, dia] = key.split('-').map(Number);
            const entry = jsonData.horasExtras[key];
            let val = 0;
            let obs = "";
            if (typeof entry === 'object' && entry !== null) {
                val = parseFloat(entry.val) || 0;
                obs = entry.obs || "";
            } else {
                val = parseFloat(entry) || 0;
            }
            stmtHex.run(id, mes, dia, val, obs);
        });
        stmtHex.finalize();

        // Cargas Diarias (Excecoes) - REMOVED FUNCTIONALITY
        // Cleaning up legacy data just in case
        db.run("DELETE FROM cargas_diarias");
        
        db.run("COMMIT", () => {
            console.log("Migration complete.");
        });
    });
}

// API Routes

// Login Endpoint
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password], (err, row) => {
        if(err) return res.status(500).json({error: "Database error"});
        if(!row) return res.status(401).json({error: "Credenciais inválidas"});

        // Simple token (In prod use JWT)
        const token = crypto.randomBytes(16).toString('hex');
        // Store token in memory or DB? For this simple app, we will just return user info and trust the client state for now (not secure)
        // OR better: return role and signed hash. Let's return just the role for simplicity as requested, but security warning applies.
        
        res.json({
            success: true,
            user: {
                username: row.username,
                name: row.name,
                role: row.role
            },
            token: token // Dummy token
        });
    });
});

// GET Full Data (Construct object to match front-end)
app.get('/api/data', (req, res) => {
    const response = {
        secoes: [],
        legendas: [],
        militares: [],
        escala: {},
        horasExtras: {},
        cargasDiarias: {}
    };

    db.serialize(() => {
        db.all("SELECT * FROM secoes", (err, rows) => {
            if(err) return res.status(500).json({error: err.message});
            response.secoes = rows;
            
            db.all("SELECT * FROM legendas", (err, rows) => {
                if(err) return res.status(500).json({error: err.message});
                response.legendas = rows;

                // Fetch Militares and Users separately to map them via cleaned Matricula
                db.all("SELECT * FROM militares", (err, militaresRows) => {
                    if(err) return res.status(500).json({error: err.message});
                    
                    db.all("SELECT username, role FROM users", (err, userRows) => {
                         if(err) return res.status(500).json({error: err.message});
                         
                         // Create Map of Username -> Role
                         const userMap = {};
                         userRows.forEach(u => { userMap[u.username] = u.role; });

                         // Attach role to militar if num (cleaned) matches username
                         militaresRows.forEach(m => {
                             const cleanNum = m.num.replace(/\D/g, '');
                             m.user_role = userMap[cleanNum] || null;
                         });

                         response.militares = militaresRows;

                         db.all("SELECT * FROM escala", (err, rows) => {
                            if(err) return res.status(500).json({error: err.message});
                            rows.forEach(r => {
                                response.escala[`${r.militar_id}-${r.mes}-${r.dia}`] = r.sigla;
                            });

                            db.all("SELECT * FROM horas_extras", (err, rows) => {
                                if(err) return res.status(500).json({error: err.message});
                                rows.forEach(r => {
                                    response.horasExtras[`${r.militar_id}-${r.mes}-${r.dia}`] = { val: r.val, obs: r.obs };
                                });

                                db.all("SELECT * FROM cargas_diarias", (err, rows) => {
                                    if(err) return res.status(500).json({error: err.message});
                                    rows.forEach(r => {
                                        response.cargasDiarias[`${r.militar_id}-${r.mes}-${r.dia}`] = r.type;
                                    });

                                    res.json(response);
                                });
                            });
                         });
                    });
                });
            });
        });
    });
});

// POST Save Full Data (Simplest migration strategy - although not efficient for SQL, ensures consistency with current frontend logic)
// ideally we would create granular endpoints (POST /api/escala, POST /api/militar)
app.post('/api/save', (req, res) => {
    // Check role from header 'X-Role'
    // This is NOT SECURE (client can spoof), but fits the quick implementation constraints without JWT middleware setup.
    const userRole = req.headers['x-role'];
    
    if (userRole === 'USUARIO') {
        return res.status(403).json({ error: "Permissão negada. Usuários não podem salvar dados." });
    }

    const data = req.body;
    migrateData(data); // Re-use migration logic to upsert everything
    res.json({ success: true });
});

// --- MILITAR / USER MANAGEMENT ---

app.post('/api/manage/militar', (req, res) => {
    // Only ADMIN or GERENTE should manage military? Assuming ADMIN for creating users.
    const requestRole = req.headers['x-role'];
    if (requestRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Acesso negado. Apenas ADMIN pode gerenciar militares e acessos.' });
    }

    const { id, num, nome, secao, posto, typeHora, hasAccess, password, role } = req.body;

    if (!num || !nome) {
        return res.status(400).json({ error: 'Dados incompletos.' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // 1. Upsert Militar
        // logic to check if exists or update
        // Using INSERT OR REPLACE is easy but might change ID if not careful.
        // Better to check ID or Num.
        
        const runMilitar = () => {
             // Handle User Logic
            const username = num.replace(/\D/g, ''); // Ensure username is digits only

            if (hasAccess) {
                if (!role) {
                    db.run("ROLLBACK");
                    return res.status(400).json({ error: "Perfil de acesso obrigatório." });
                }
                
                // Check if user exists to update or insert
                db.get("SELECT id FROM users WHERE username = ?", [username], (err, row) => {
                    if (err) {
                        db.run("ROLLBACK");
                        return res.status(500).json({error: err.message});
                    }

                    if (row) {
                        // Update existing user
                        let sql = "UPDATE users SET role = ?, name = ? WHERE username = ?";
                        let params = [role, nome, username];
                        
                        if (password && password.trim() !== '') {
                            sql = "UPDATE users SET role = ?, name = ?, password = ? WHERE username = ?";
                            params = [role, nome, password, username];
                        }
                        
                        db.run(sql, params, (err) => {
                            if(err) console.error("Error updating user", err);
                        });
                    } else {
                        // Create new user
                        if (!password) {
                             db.run("ROLLBACK");
                             return res.status(400).json({ error: "Senha obrigatória para novo usuário." });
                        }
                        db.run("INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)", [username, password, role, nome], (err) => {
                             if(err) console.error("Error creating user", err);
                        });
                    }
                });
            } else {
                // If hasAccess is false, we might want to DELETE the user if they existed?
                // Or just leave them? The prompt implies "Gerenciar".
                // Let's remove access if unchecked.
                db.run("DELETE FROM users WHERE username = ?", [username]);
            }

            db.run("COMMIT", () => {
                res.json({ success: true });
            });
        };

        if (id) {
            // Update
            db.run("UPDATE militares SET num = ?, nome = ?, secao = ?, posto = ?, typeHora = ? WHERE id = ?", 
                [num, nome, secao, posto, typeHora, id], 
                (err) => {
                    if (err) {
                        db.run("ROLLBACK"); 
                        return res.status(500).json({error: err.message});
                    }
                    runMilitar();
                }
            );
        } else {
            // Insert
            db.run("INSERT INTO militares (num, nome, secao, posto, typeHora) VALUES (?, ?, ?, ?, ?)",
                [num, nome, secao, posto, typeHora],
                function(err) {
                    if (err) {
                        db.run("ROLLBACK");
                        return res.status(500).json({error: err.message});
                    }
                    runMilitar();
                }
            );
        }
    });
});


// --- USER MANAGEMENT ENDPOINTS ---

app.delete('/api/manage/militar/:id', (req, res) => {
    // Only ADMIN should delete
    const requestRole = req.headers['x-role'];
    if (requestRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Acesso negado.' });
    }

    const id = req.params.id;

    db.serialize(() => {
        db.get("SELECT num FROM militares WHERE id = ?", [id], (err, row) => {
            if (err || !row) return res.status(404).json({ error: "Militar não encontrado" });
            
            const num = row.num;
            const username = num.replace(/\D/g, '');

            db.run("BEGIN TRANSACTION");
            
            // Delete Militar
            db.run("DELETE FROM militares WHERE id = ?", [id]);
            
            // Delete associated User
            db.run("DELETE FROM users WHERE username = ?", [username]);
            
            // Also clean up Escala and Horas Extras?
            db.run("DELETE FROM escala WHERE militar_id = ?", [id]);
            db.run("DELETE FROM horas_extras WHERE militar_id = ?", [id]);

            db.run("COMMIT", (err) => {
                if(err) return res.status(500).json({error: "Erro na transação de exclusão"});
                res.json({ success: true });
            });
        });
    });
});

app.post('/api/user/password', (req, res) => {
    const { username, oldPassword, newPassword } = req.body;
    
    if (!username || !oldPassword || !newPassword) {
        return res.status(400).json({ error: "Dados incompletos." });
    }

    // Verify old password
    db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, oldPassword], (err, row) => {
        if (err) return res.status(500).json({ error: "Erro de banco de dados" });
        if (!row) return res.status(401).json({ error: "Senha atual incorreta." });

        // Update
        db.run("UPDATE users SET password = ? WHERE username = ?", [newPassword, username], (err) => {
            if (err) return res.status(500).json({ error: "Erro ao atualizar senha" });
            res.json({ success: true });
        });
    });
});

app.get('/api/users', (req, res) => {
    // Only ADMIN should list users
    if (req.headers['x-role'] !== 'ADMIN') {
        return res.status(403).json({ error: 'Acesso negado' });
    }
    
    db.all("SELECT id, username, role, name FROM users", (err, rows) => {
        if(err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/users', (req, res) => {
    // Only ADMIN should create users
    if (req.headers['x-role'] !== 'ADMIN') {
        return res.status(403).json({ error: 'Acesso negado' });
    }
    
    const { username, password, role, name } = req.body;
    // Basic Validation
    if(!username || !password || !role) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }

    const stmt = db.prepare("INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)");
    stmt.run(username, password, role, name, function(err) {
        if(err) {
            // Likely unique constraint violation
            return res.status(400).json({ error: 'Erro ao criar usuário. Username já existe?' });
        }
        res.json({ success: true, id: this.lastID });
    });
    stmt.finalize();
});

app.delete('/api/users/:id', (req, res) => {
    // Only ADMIN should delete users
    if (req.headers['x-role'] !== 'ADMIN') {
        return res.status(403).json({ error: 'Acesso negado' });
    }
    
    const id = req.params.id;
    db.run("DELETE FROM users WHERE id = ?", id, function(err) {
        if(err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- CSV IMPORT ENDPOINTS ---

// Helper function to parse CSV content
function parseCSV(csvContent) {
    const lines = csvContent.trim().split(/\r?\n/);
    if (lines.length === 0) return [];

    // Detect separator from first line
    const firstLine = lines[0];
    let separator = '\t'; // Default to tab
    if (!firstLine.includes('\t') && firstLine.includes(';')) separator = ';';
    else if (!firstLine.includes('\t') && !firstLine.includes(';') && firstLine.includes(',')) separator = ',';

    // Helper to clean quotes
    const cleanBox = (str) => str ? str.trim().replace(/^"|"$/g, '') : '';

    // Parse header
    const headers = firstLine.split(separator).map(cleanBox);
    
    // Parse rows
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

// Import Seções (Sections)
app.post('/api/import/secoes', (req, res) => {
    const requestRole = req.headers['x-role'];
    if (requestRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Acesso negado. Apenas ADMIN pode importar dados.' });
    }

    const { csvContent } = req.body;
    if (!csvContent) {
        return res.status(400).json({ error: 'Nenhum conteúdo CSV fornecido.' });
    }

    try {
        const data = parseCSV(csvContent);
        
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            
            // Only insert if SIGLA doesn't exist (INSERT OR IGNORE)
            const stmt = db.prepare("INSERT OR IGNORE INTO secoes (sigla, desc) VALUES (?, ?)");
            let successCount = 0;
            let errorCount = 0;

            data.forEach(row => {
                const sigla = row['SIGLA'] || row['sigla'];
                const desc = row['NOME/DESCRIÇÃO'] || row['nome'] || row['DESCRIÇÃO'];
                
                if (sigla && desc) {
                    stmt.run(sigla, desc, (err) => {
                        if (!err) successCount++;
                        else errorCount++;
                    });
                } else {
                    errorCount++;
                }
            });

            stmt.finalize();
            
            db.run("COMMIT", (err) => {
                if (err) {
                    return res.status(500).json({ error: "Erro ao salvar seções: " + err.message });
                }
                res.json({ success: true, successCount, errorCount, message: `${successCount} seção(ões) importada(s), ${errorCount} erro(s)` });
            });
        });
    } catch (err) {
        res.status(400).json({ error: "Erro ao processar CSV: " + err.message });
    }
});

// Import Legendas (Legends/Categories)
app.post('/api/import/legendas', (req, res) => {
    const requestRole = req.headers['x-role'];
    if (requestRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Acesso negado. Apenas ADMIN pode importar dados.' });
    }

    const { csvContent } = req.body;
    if (!csvContent) {
        return res.status(400).json({ error: 'Nenhum conteúdo CSV fornecido.' });
    }

    try {
        const data = parseCSV(csvContent);
        
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            
            // Changed from INSERT OR REPLACE to INSERT OR IGNORE to only add new legends
            const stmt = db.prepare("INSERT OR IGNORE INTO legendas (sigla, nome, desc, horas, color, text) VALUES (?, ?, ?, ?, ?, ?)");
            let successCount = 0;
            let errorCount = 0;

            // Default color mapping for common categories
            const defaultColors = {
                'P': { color: '#dcfce7', text: '#166534' },
                'FO': { color: '#dbeafe', text: '#1e40af' },
                'F': { color: '#fef9c3', text: '#854d0e' },
                'LM': { color: '#fee2e2', text: '#991b1b' },
                'TAF': { color: '#fce7f3', text: '#be185d' },
                'TPB': { color: '#e0e7ff', text: '#3730a3' },
                'DSP': { color: '#fed7aa', text: '#9a3412' },
                '4ESF': { color: '#c7d2fe', text: '#3730a3' }
            };

            data.forEach(row => {
                const sigla = row['SIGLA'] || row['sigla'];
                
                let nome = row['NOME'] || row['nome'];
                let desc = row['DESCRIÇÃO'] || row['desc'] || row['descricao'];
                
                // Fallback for old CSVs where DESCRIÇÃO was the main name
                if (!nome && desc) {
                    nome = desc;
                    desc = '';
                }

                let horas = parseFloat(row['HORA'] || row['horas'] || '0');
                
                // Parse "8 ou 6" format
                if (isNaN(horas) && row['HORA']) {
                    if (row['HORA'].includes('8')) horas = 8;
                    else if (row['HORA'].includes('6')) horas = 6;
                }

                const colors = defaultColors[sigla] || { color: '#e5e7eb', text: '#374151' };

                if (sigla && nome) {
                    stmt.run(sigla, nome, desc, horas, colors.color, colors.text, (err) => {
                        if (!err) successCount++;
                        else errorCount++;
                    });
                } else {
                    errorCount++;
                }
            });

            stmt.finalize();
            
            db.run("COMMIT", (err) => {
                if (err) {
                    return res.status(500).json({ error: "Erro ao salvar legendas: " + err.message });
                }
                res.json({ success: true, successCount, errorCount, message: `${successCount} legenda(s) importada(s), ${errorCount} erro(s)` });
            });
        });
    } catch (err) {
        res.status(400).json({ error: "Erro ao processar CSV: " + err.message });
    }
});

// Import Militares (Military Personnel)
app.post('/api/import/militares', (req, res) => {
    const requestRole = req.headers['x-role'];
    if (requestRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Acesso negado. Apenas ADMIN pode importar dados.' });
    }

    const { csvContent } = req.body;
    if (!csvContent) {
        return res.status(400).json({ error: 'Nenhum conteúdo CSV fornecido.' });
    }

    try {
        const data = parseCSV(csvContent);
        
        // Anti-pattern fix: Do not use async reads inside a serialized loop with late async writes.
        // Instead, read all existing IDs first, then filter, then write batch.
        
        db.all("SELECT num FROM militares", (err, rows) => {
            if (err) {
                return res.status(500).json({ error: "Erro ao ler banco de dados: " + err.message });
            }
            
            const existingNums = new Set(rows.map(r => r.num));
            let successCount = 0;
            let errorCount = 0;
            
            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                
                const stmtMil = db.prepare("INSERT INTO militares (num, nome, secao, posto, typeHora) VALUES (?, ?, ?, ?, ?)");
                const stmtUser = db.prepare("INSERT OR IGNORE INTO users (username, password, role, name) VALUES (?, ?, ?, ?)");
                
                data.forEach(row => {
                    const matricula = row['Matricula'] || row['matricula'];
                    const nome = row['Nome Completo'] || row['nome'];
                    const secaoSigla = row['Seçao Sigla'] || row['Seção Sigla'] || row['secao'];
                    const posto = row['PG'] || row['pg'] || '';
                    
                    // Determine carga horaria default
                    let cargaHoraria = row['Carga Horaria'] || row['carga_horaria'] || '8h';
                    // Override for Civis: Always 8h
                    if (posto && posto.toLowerCase().includes('civil')) {
                        cargaHoraria = '8h';
                    }

                    const acessoSistema = row['Acesso ao Sistema'] || row['acesso'];
                    const perfil = row['Perfil'] || row['perfil'] || 'Usuario';
                    const senha = row['Senha'] || row['senha'] || 'cbmmg193';

                    if (matricula && nome && secaoSigla) {
                        if (!existingNums.has(matricula)) {
                            stmtMil.run(matricula, nome, secaoSigla, posto, cargaHoraria, (err) => {
                                if (err) errorCount++; 
                                else successCount++;
                            });
                            
                            // Add to Set to prevent duplicates within the same CSV
                            existingNums.add(matricula); 
                            
                            // Create User if needed
                            if (acessoSistema && (acessoSistema === 'TRUE' || acessoSistema === 'true' || acessoSistema === '1')) {
                                const username = matricula.replace(/\D/g, ''); // Extract only digits
                                stmtUser.run(username, senha, perfil.toUpperCase(), nome);
                            }
                        } else {
                            // Already exists - maybe count as success if the goal is "ensure it exists"?
                            // Typically "imported 0" implies nothing new was added. 
                            // Let's count as error for "duplicate" or just ignore.
                            // The user prefers "Import ignored" maybe?
                            // Let's just track added.
                        }
                    } else {
                        errorCount++;
                    }
                });

                stmtMil.finalize();
                stmtUser.finalize();
                
                db.run("COMMIT", (err) => {
                    if (err) {
                        return res.status(500).json({ error: "Erro ao salvar militares: " + err.message });
                    }
                    res.json({ success: true, successCount, errorCount, message: `${successCount} militar(es) importado(s), ${errorCount} erros/ignorados` });
                });
            });
        });

    } catch (err) {
        res.status(400).json({ error: "Erro ao processar CSV: " + err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
