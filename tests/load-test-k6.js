/**
 * Teste de Carga com k6
 * 
 * Instalação: 
 *   Ubuntu/Debian: sudo apt install snapd && sudo snap install k6
 *   Ou via Docker: docker run -i grafana/k6 run - < load-test-k6.js
 * 
 * Execução:
 *   k6 run load-test-k6.js
 *   k6 run --vus 150 --duration 60s load-test-k6.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Métricas customizadas
const errorRate = new Rate('errors');
const loginDuration = new Trend('login_duration');
const dataDuration = new Trend('data_duration');
const saveDuration = new Trend('save_duration');

// Configuração do teste
export const options = {
    stages: [
        { duration: '30s', target: 50 },   // Ramp-up: 0 → 50 usuários em 30s
        { duration: '1m', target: 150 },   // Ramp-up: 50 → 150 usuários em 1min
        { duration: '3m', target: 150 },   // Mantém 150 usuários por 3min
        { duration: '30s', target: 0 },    // Ramp-down: 150 → 0 em 30s
    ],
    thresholds: {
        http_req_duration: ['p(95)<2000'],  // 95% das requisições < 2s
        errors: ['rate<0.1'],                // Taxa de erro < 10%
    },
};

// URL base do sistema (ajuste conforme necessário)
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Lista de usuários para teste (matrículas do CSV)
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

export default function () {
    // Seleciona um usuário aleatório
    const user = TEST_USERS[Math.floor(Math.random() * TEST_USERS.length)];
    
    // 1. LOGIN
    const loginStart = Date.now();
    const loginRes = http.post(`${BASE_URL}/api/login`, JSON.stringify({
        username: user.username,
        password: user.password
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
    loginDuration.add(Date.now() - loginStart);
    
    const loginOk = check(loginRes, {
        'login status 200': (r) => r.status === 200,
        'login has token': (r) => r.json('token') !== undefined,
    });
    errorRate.add(!loginOk);
    
    if (!loginOk) {
        console.log(`Login failed for ${user.username}: ${loginRes.status} - ${loginRes.body}`);
        return;
    }
    
    const userData = loginRes.json();
    const role = userData.user?.role || 'USUARIO';
    
    sleep(0.5); // Pausa realista entre ações
    
    // 2. CARREGAR DADOS (GET /api/data)
    const dataStart = Date.now();
    const dataRes = http.get(`${BASE_URL}/api/data`);
    dataDuration.add(Date.now() - dataStart);
    
    const dataOk = check(dataRes, {
        'data status 200': (r) => r.status === 200,
        'data has militares': (r) => r.json('militares') !== undefined,
        'data has escala': (r) => r.json('escala') !== undefined,
    });
    errorRate.add(!dataOk);
    
    if (!dataOk) {
        console.log(`Data load failed: ${dataRes.status}`);
        return;
    }
    
    const dbData = dataRes.json();
    
    sleep(1); // Simula usuário visualizando dados
    
    // 3. SALVAR DADOS (apenas GERENTE/ADMIN - 30% das vezes)
    if (role !== 'USUARIO' && Math.random() < 0.3) {
        // Simula alteração na escala
        const militarId = dbData.militares[0]?.id || 1;
        const mes = new Date().getMonth();
        const dia = Math.floor(Math.random() * 28) + 1;
        const legendas = ['P', 'PM', 'PT', 'FO', 'F'];
        
        dbData.escala[`${militarId}-${mes}-${dia}`] = legendas[Math.floor(Math.random() * legendas.length)];
        
        const saveStart = Date.now();
        const saveRes = http.post(`${BASE_URL}/api/save`, JSON.stringify(dbData), {
            headers: { 
                'Content-Type': 'application/json',
                'X-Role': role
            }
        });
        saveDuration.add(Date.now() - saveStart);
        
        const saveOk = check(saveRes, {
            'save status 200': (r) => r.status === 200,
        });
        errorRate.add(!saveOk);
    }
    
    sleep(2); // Pausa entre iterações
}

export function handleSummary(data) {
    return {
        'stdout': textSummary(data, { indent: ' ', enableColors: true }),
        'tests/load-test-results.json': JSON.stringify(data, null, 2),
    };
}

function textSummary(data, options) {
    const metrics = data.metrics;
    return `
╔══════════════════════════════════════════════════════════════╗
║                    RESULTADO DO TESTE DE CARGA               ║
╠══════════════════════════════════════════════════════════════╣
║ Requisições totais:    ${metrics.http_reqs?.values?.count || 0}
║ Taxa de erro:          ${((metrics.errors?.values?.rate || 0) * 100).toFixed(2)}%
║ 
║ Tempo de resposta (http_req_duration):
║   - Média:    ${(metrics.http_req_duration?.values?.avg || 0).toFixed(2)} ms
║   - Mínimo:   ${(metrics.http_req_duration?.values?.min || 0).toFixed(2)} ms
║   - Máximo:   ${(metrics.http_req_duration?.values?.max || 0).toFixed(2)} ms
║   - P95:      ${(metrics.http_req_duration?.values['p(95)'] || 0).toFixed(2)} ms
║
║ Endpoints específicos:
║   - Login:    ${(metrics.login_duration?.values?.avg || 0).toFixed(2)} ms (média)
║   - Data:     ${(metrics.data_duration?.values?.avg || 0).toFixed(2)} ms (média)
║   - Save:     ${(metrics.save_duration?.values?.avg || 0).toFixed(2)} ms (média)
╚══════════════════════════════════════════════════════════════╝
`;
}
