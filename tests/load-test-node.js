/**
 * Teste de Carga com Node.js (sem dependências externas)
 * 
 * Execução:
 *   node tests/load-test-node.js
 *   node tests/load-test-node.js --users=150 --duration=60
 */

const http = require('http');
const https = require('https');

// Configuração
const config = {
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    users: parseInt(process.argv.find(a => a.startsWith('--users='))?.split('=')[1] || '150'),
    duration: parseInt(process.argv.find(a => a.startsWith('--duration='))?.split('=')[1] || '60'), // segundos
    rampUp: 10, // segundos para subir todos os usuários
};

// Usuários de teste
const TEST_USERS = [
    { username: '1284025', password: 'cbmmg193' },
    { username: '1363233', password: 'cbmmg193' },
    { username: '1361733', password: 'cbmmg193' },
    { username: '1592617', password: 'cbmmg193' },
    { username: '1591445', password: 'cbmmg193' },
    { username: '1261106', password: 'cbmmg193' },
    { username: '1050947', password: 'cbmmg193' },
    { username: '1362961', password: 'cbmmg193' },
    { username: '1362854', password: 'cbmmg193' },
    { username: '1481886', password: 'cbmmg193' },
];

// Métricas
const metrics = {
    requests: 0,
    errors: 0,
    latencies: [],
    loginLatencies: [],
    dataLatencies: [],
    saveLatencies: [],
    startTime: null,
    activeUsers: 0,
};

function makeRequest(options, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(options.path, config.baseUrl);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;
        
        const reqOptions = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname,
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        };
        
        const startTime = Date.now();
        
        const req = lib.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const latency = Date.now() - startTime;
                metrics.latencies.push(latency);
                metrics.requests++;
                
                resolve({
                    status: res.statusCode,
                    body: data,
                    latency,
                    json: () => {
                        try { return JSON.parse(data); } 
                        catch { return null; }
                    }
                });
            });
        });
        
        req.on('error', (err) => {
            metrics.errors++;
            reject(err);
        });
        
        req.setTimeout(30000, () => {
            metrics.errors++;
            req.destroy();
            reject(new Error('Timeout'));
        });
        
        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function simulateUser(userId) {
    const user = TEST_USERS[userId % TEST_USERS.length];
    
    while (Date.now() - metrics.startTime < config.duration * 1000) {
        try {
            // 1. Login
            const loginStart = Date.now();
            const loginRes = await makeRequest({
                method: 'POST',
                path: '/api/login',
            }, { username: user.username, password: user.password });
            metrics.loginLatencies.push(Date.now() - loginStart);
            
            if (loginRes.status !== 200) {
                metrics.errors++;
                await sleep(2000);
                continue;
            }
            
            const userData = loginRes.json();
            await sleep(500);
            
            // 2. Carregar dados
            const dataStart = Date.now();
            const dataRes = await makeRequest({ path: '/api/data' });
            metrics.dataLatencies.push(Date.now() - dataStart);
            
            if (dataRes.status !== 200) {
                metrics.errors++;
            }
            
            await sleep(1000);
            
            // 3. Salvar (30% das vezes, se não for USUARIO)
            if (userData?.user?.role !== 'USUARIO' && Math.random() < 0.3) {
                const dbData = dataRes.json();
                if (dbData) {
                    const saveStart = Date.now();
                    const saveRes = await makeRequest({
                        method: 'POST',
                        path: '/api/save',
                        headers: { 'X-Role': userData.user.role }
                    }, dbData);
                    metrics.saveLatencies.push(Date.now() - saveStart);
                    
                    if (saveRes.status !== 200) {
                        metrics.errors++;
                    }
                }
            }
            
            await sleep(2000);
            
        } catch (err) {
            // Continua mesmo com erro
            await sleep(1000);
        }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

function average(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function runTest() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║              TESTE DE CARGA - BM Track                       ║
╠══════════════════════════════════════════════════════════════╣
║ URL:       ${config.baseUrl.padEnd(47)}║
║ Usuários:  ${String(config.users).padEnd(47)}║
║ Duração:   ${(config.duration + 's').padEnd(47)}║
║ Ramp-up:   ${(config.rampUp + 's').padEnd(47)}║
╚══════════════════════════════════════════════════════════════╝
`);

    console.log('Iniciando teste...\n');
    
    metrics.startTime = Date.now();
    const userPromises = [];
    
    // Ramp-up: adiciona usuários gradualmente
    const usersPerSecond = config.users / config.rampUp;
    
    for (let i = 0; i < config.users; i++) {
        const delay = (i / usersPerSecond) * 1000;
        
        setTimeout(() => {
            metrics.activeUsers++;
            userPromises.push(simulateUser(i));
        }, delay);
    }
    
    // Mostrar progresso
    const progressInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - metrics.startTime) / 1000);
        const remaining = config.duration - elapsed;
        process.stdout.write(`\r⏱  ${elapsed}s/${config.duration}s | 👥 ${metrics.activeUsers} usuários | 📊 ${metrics.requests} requests | ❌ ${metrics.errors} erros`);
    }, 1000);
    
    // Espera o tempo do teste + ramp-up
    await sleep((config.duration + config.rampUp) * 1000);
    
    clearInterval(progressInterval);
    
    // Aguarda todas as requisições finalizarem
    await Promise.allSettled(userPromises);
    
    // Relatório final
    console.log(`\n
╔══════════════════════════════════════════════════════════════╗
║                    RESULTADO DO TESTE                        ║
╠══════════════════════════════════════════════════════════════╣
║ Total de requisições:  ${String(metrics.requests).padEnd(36)}║
║ Erros:                 ${String(metrics.errors).padEnd(36)}║
║ Taxa de erro:          ${(metrics.errors / metrics.requests * 100).toFixed(2).padEnd(35)}%║
╠══════════════════════════════════════════════════════════════╣
║ LATÊNCIA GERAL (ms):                                         ║
║   Média:     ${average(metrics.latencies).toFixed(2).padEnd(45)}║
║   Mínimo:    ${Math.min(...metrics.latencies, 0).toFixed(2).padEnd(45)}║
║   Máximo:    ${Math.max(...metrics.latencies, 0).toFixed(2).padEnd(45)}║
║   P50:       ${percentile(metrics.latencies, 50).toFixed(2).padEnd(45)}║
║   P95:       ${percentile(metrics.latencies, 95).toFixed(2).padEnd(45)}║
║   P99:       ${percentile(metrics.latencies, 99).toFixed(2).padEnd(45)}║
╠══════════════════════════════════════════════════════════════╣
║ LATÊNCIA POR ENDPOINT (ms):                                  ║
║   Login:     ${average(metrics.loginLatencies).toFixed(2).padEnd(45)}║
║   Data:      ${average(metrics.dataLatencies).toFixed(2).padEnd(45)}║
║   Save:      ${average(metrics.saveLatencies).toFixed(2).padEnd(45)}║
╠══════════════════════════════════════════════════════════════╣
║ THROUGHPUT:                                                  ║
║   Req/seg:   ${(metrics.requests / config.duration).toFixed(2).padEnd(45)}║
╚══════════════════════════════════════════════════════════════╝
`);

    // Avaliação
    const avgLatency = average(metrics.latencies);
    const p95Latency = percentile(metrics.latencies, 95);
    const errorRate = metrics.errors / metrics.requests;
    
    console.log('\n📋 AVALIAÇÃO:');
    
    if (avgLatency < 500 && p95Latency < 2000 && errorRate < 0.01) {
        console.log('✅ EXCELENTE - Sistema preparado para 150 usuários simultâneos');
    } else if (avgLatency < 1000 && p95Latency < 3000 && errorRate < 0.05) {
        console.log('✅ BOM - Sistema suporta a carga com performance aceitável');
    } else if (avgLatency < 2000 && p95Latency < 5000 && errorRate < 0.1) {
        console.log('⚠️  REGULAR - Sistema suporta, mas pode haver lentidão');
    } else {
        console.log('❌ INSUFICIENTE - Sistema precisa de otimizações');
    }
    
    console.log('\n💡 RECOMENDAÇÕES:');
    if (avgLatency > 1000) {
        console.log('   - Considere adicionar cache Redis para dados frequentes');
        console.log('   - Otimize queries do banco de dados');
    }
    if (errorRate > 0.05) {
        console.log('   - Investigue os erros no log do servidor');
        console.log('   - Considere aumentar recursos do container');
    }
    if (p95Latency > 3000) {
        console.log('   - Implemente connection pooling');
        console.log('   - Considere usar Node.js cluster mode');
    }
}

runTest().catch(console.error);
