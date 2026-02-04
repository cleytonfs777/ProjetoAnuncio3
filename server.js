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
        initUsers();
        initAdminMilitar();
        checkMigration();
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
        
        // Secoes
        const stmtSec = db.prepare("INSERT OR REPLACE INTO secoes (sigla, desc) VALUES (?, ?)");
        (jsonData.secoes || []).forEach(s => stmtSec.run(s.sigla, s.desc));
        stmtSec.finalize();

        // Legendas
        const stmtLeg = db.prepare("INSERT OR REPLACE INTO legendas (sigla, desc, color, text, horas) VALUES (?, ?, ?, ?, ?)");
        (jsonData.legendas || []).forEach(l => stmtLeg.run(l.sigla, l.desc, l.color, l.text, l.horas));
        stmtLeg.finalize();

        // Militares
        const stmtMil = db.prepare("INSERT OR REPLACE INTO militares (id, num, nome, secao, posto, typeHora) VALUES (?, ?, ?, ?, ?, ?)");
        (jsonData.militares || []).forEach(m => stmtMil.run(m.id, m.num, m.nome, m.secao, m.posto, m.typeHora));
        stmtMil.finalize();

        // Escala
        const stmtEsc = db.prepare("INSERT OR REPLACE INTO escala (militar_id, mes, dia, sigla) VALUES (?, ?, ?, ?)");
        Object.keys(jsonData.escala || {}).forEach(key => {
            const [id, mes, dia] = key.split('-').map(Number);
            const sigla = jsonData.escala[key];
            stmtEsc.run(id, mes, dia, sigla);
        });
        stmtEsc.finalize();

        // Horas Extras
        const stmtHex = db.prepare("INSERT OR REPLACE INTO horas_extras (militar_id, mes, dia, val, obs) VALUES (?, ?, ?, ?, ?)");
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

        // Cargas Diarias (Excecoes)
        const stmtCarga = db.prepare("INSERT OR REPLACE INTO cargas_diarias (militar_id, mes, dia, type) VALUES (?, ?, ?, ?)");
        Object.keys(jsonData.cargasDiarias || {}).forEach(key => {
            const [id, mes, dia] = key.split('-').map(Number);
            const type = jsonData.cargasDiarias[key];
            stmtCarga.run(id, mes, dia, type);
        });
        stmtCarga.finalize();

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


app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
