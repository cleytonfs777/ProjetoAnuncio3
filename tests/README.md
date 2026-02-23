# Teste de Carga - BM Track

## Opção 1: Script Node.js (mais simples)

Não precisa instalar nada adicional, usa apenas Node.js:

```bash
# Teste padrão (150 usuários, 60 segundos)
node tests/load-test-node.js

# Personalizado
node tests/load-test-node.js --users=150 --duration=120

# Testando servidor remoto
BASE_URL=http://10.24.46.20:3000 node tests/load-test-node.js
```

## Opção 2: k6 (mais robusto)

k6 é uma ferramenta profissional de teste de carga.

### Instalação

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install snapd
sudo snap install k6

# Ou via Docker (sem instalação)
docker pull grafana/k6
```

### Execução

```bash
# Teste completo com ramp-up
k6 run tests/load-test-k6.js

# Teste rápido
k6 run --vus 150 --duration 30s tests/load-test-k6.js

# Via Docker
docker run -i --network host grafana/k6 run - < tests/load-test-k6.js

# Testando servidor remoto
k6 run -e BASE_URL=http://10.24.46.20:3000 tests/load-test-k6.js
```

## Interpretando Resultados

### Métricas Importantes

| Métrica | Bom | Aceitável | Ruim |
|---------|-----|-----------|------|
| Latência média | < 500ms | < 1000ms | > 2000ms |
| P95 | < 2000ms | < 3000ms | > 5000ms |
| Taxa de erro | < 1% | < 5% | > 10% |
| Req/segundo | > 100 | > 50 | < 20 |

### O que fazer se o teste falhar

1. **Alta latência no Login**: 
   - bcrypt é CPU-intensivo
   - Considere reduzir rounds do salt (10 → 8)
   
2. **Alta latência no GET /api/data**:
   - Muitas queries aninhadas
   - Considere cache em memória
   
3. **Alta latência no POST /api/save**:
   - Muitas operações de escrita
   - Considere batch de operações
   
4. **Muitos erros**:
   - Verifique logs: `docker logs bmtrack-server`
   - Pode ser limite de conexões SQLite

## Melhorias de Performance (se necessário)

```javascript
// 1. Usar cluster mode (múltiplos processos)
// No início do server.js:
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

if (cluster.isPrimary) {
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }
} else {
    // código do servidor...
}

// 2. Cache em memória para dados frequentes
let dataCache = null;
let cacheTime = 0;
const CACHE_TTL = 5000; // 5 segundos

app.get('/api/data', (req, res) => {
    if (dataCache && Date.now() - cacheTime < CACHE_TTL) {
        return res.json(dataCache);
    }
    // ... busca no banco
    dataCache = response;
    cacheTime = Date.now();
});
```

## Monitorando Durante o Teste

Em outro terminal, monitore o container:

```bash
# CPU e memória
docker stats bmtrack-server

# Logs em tempo real
docker logs -f bmtrack-server

# Conexões ativas
docker exec bmtrack-server netstat -an | grep 3000 | wc -l
```
