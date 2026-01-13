# 🌾 Farm Manager Bot

Bot automatizado para gerenciamento de fazendas no **Farm Manager** (farm-app.trophyapi.com).

> **Status:** Em desenvolvimento ativo 🚧

---

## 🎮 Funcionalidades

### ✅ Implementado

| Feature | Descrição |
|---------|-----------|
| **Auto Colheita** | Detecta e colhe automaticamente quando a plantação está madura |
| **Auto Cultivo** | Limpa (clearing) e ara (plowing) terrenos automaticamente |
| **Smart Seeding** | Seleciona a melhor semente baseado no `cropScore` do terreno |
| **Compra de Sementes** | Compra automaticamente sementes quando estoque está baixo |
| **Venda Automática** | Vende produtos do silo quando atinge % configurável |
| **Monitoramento do Silo** | Exibe status individual de cada grão (capacidade por tipo) |
| **Gerenciamento de Combustível** | Mantém combustível acima de 1000L e compra quando preço está bom (<$1000) |
| **Seleção Inteligente de Tratores** | Sempre usa o trator/equipamento mais rápido disponível (maior haHour) |
| **Limite de Tempo de Operação** | Ignora operações que demorariam mais de 6 horas |
| **Login Automático** | Suporta login via Android token ou email/senha |
| **Multi-Tractor** | Usa até 4 tratores simultaneamente para acelerar operações |
| **Auto-Implement** | Anexa implementos automaticamente quando necessário |
| **Verificação de Ociosidade** | Reserva tratores para operações que vão precisar em breve |

### 🔜 Roadmap

**Futuro:**
- [ ] Suporte a irrigação automática
- [ ] Fertilização automática
- [ ] Múltiplas contas
- [ ] Dashboard web para monitoramento
- [ ] Notificações via Telegram/Discord
- [ ] Análise de mercado para venda no melhor momento

---

## 🔐 Autenticação

O bot precisa de um `PHPSESSID` válido para funcionar. Existem **três formas** de obtê-lo:

### Opção 1: Android Token (Recomendado) ⭐

Se você tem acesso ao token do app Android:

```env
ANDROID_TOKEN=seu_token_aqui
```

O bot fará login automaticamente usando o token e renovará a sessão quando necessário.

### Opção 2: Login com Email/Senha

Se você sabe suas credenciais:

```env
FARM_EMAIL=seu_email@exemplo.com
FARM_PASSWORD=sua_senha
```

O bot fará login automaticamente e obterá o `PHPSESSID`.

### Opção 3: PHPSESSID Manual

Se preferir configurar manualmente:

```env
PHPSESSID=seu_session_id_aqui
```

#### 📱 Como obter o PHPSESSID do app Android

1. **Configurar proxy no celular:**
   - Instale [mitmproxy](https://mitmproxy.org/) ou [Charles Proxy](https://www.charlesproxy.com/)
   - Configure o proxy no WiFi do Android
   - Instale o certificado CA no dispositivo

2. **Interceptar requisições:**
   - Abra o app Farm Manager
   - Procure requisições para `farm-app.trophyapi.com`
   - Copie o valor do cookie `PHPSESSID`

3. **Colar no `.env`:**
   ```env
   PHPSESSID=xxxxxxxxxxxxxxxxxx
   ```

> ⚠️ **Nota:** O PHPSESSID pode expirar. Se o bot parar de funcionar, intercepte um novo.

---

## 🚀 Instalação

```bash
# Clonar repositório
git clone https://github.com/seu-usuario/BotFarmManager.git
cd BotFarmManager

# Instalar dependências
npm install

# Configurar ambiente
cp .env.example .env
# Edite o .env com suas credenciais

# Rodar em desenvolvimento
npm run dev

# Build para produção
npm run build
npm start
```

---

## ⚙️ Configuração

| Variável | Descrição | Default |
|----------|-----------|---------|
| `ANDROID_TOKEN` | Token do app Android para login automático | - |
| `FARM_EMAIL` | Email de login | - |
| `FARM_PASSWORD` | Senha de login | - |
| `PHPSESSID` | Session ID manual (alternativa ao login) | - |
| `CHECK_INTERVAL_MS` | Intervalo entre ciclos (ms) | `120000` |
| `SILO_SELL_THRESHOLD` | % do silo para venda automática | `80` |
| `DEBUG` | Ativar logs detalhados | `false` |

---

## 📁 Estrutura do Projeto

```
src/
├── api/
│   └── client.ts        # Cliente HTTP para a API
├── bot/
│   └── FarmBot.ts       # Lógica principal do bot
├── services/
│   ├── AuthService.ts   # Login e obtenção de sessão
│   ├── FarmService.ts   # Gerenciamento de fazendas
│   ├── FuelService.ts   # Gerenciamento de combustível
│   ├── SeedService.ts   # Smart Seeding
│   ├── SiloService.ts   # Monitoramento do silo
│   ├── MarketService.ts # Vendas no mercado
│   └── TractorService.ts # Gerenciamento de tratores e equipamentos
├── types/
│   └── index.ts         # Interfaces TypeScript
├── utils/
│   └── logger.ts        # Sistema de logs
└── index.ts             # Entry point
```

---

## 📊 Exemplo de Logs

```
[FarmBot] [INFO] 🔄 Iniciando ciclo - 13/01/2026, 11:00:00
[FarmBot] [FUEL] ⛽ Combustível: 1,316L | Preço: $1,758/1000L
[FarmBot] [TASK] 🚜 1 colheita(s) disponível(is)
[FarmBot] [SUCCESS] ✅ harvesting iniciado em "Fazenda Norte" - Tempo estimado: 3600s
[FarmBot] [SILO] 🌾 Silo Total: 220,000kg armazenados
[FarmBot] [SILO] 🌾   - Canola: 127,000kg / 300,000kg (42.33%)
[FarmBot] [SILO] 🌾   - Corn: 73,000kg / 300,000kg (24.33%)
[FarmBot] [INFO] ✅ Ciclo concluído
```

---

## 📝 Licença

ISC
