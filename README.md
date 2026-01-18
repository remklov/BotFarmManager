# 🌾 Farm Manager Bot

Automated bot for farm management in **Farm Manager** (farm-app.trophyapi.com).

> **Status:** In active development 🚧

---

## 🎮 Features

### ✅ Implemented

| Feature | Description |
|---------|-----------|
| **Auto Harvest** | Automatically detects and harvests when crops are mature |
| **Auto Cultivation** | Automatically clears and plows fields |
| **Smart Seeding** | Selects the best seed based on the field's `cropScore` |
| **Seed Purchase** | Automatically purchases seeds when stock is low |
| **Automatic Sale** | Sells silo products when reaching configurable % |
| **Silo Monitoring** | Displays individual status of each grain (capacity by type) |
| **Fuel Management** | Maintains fuel above 1000L and purchases when price is good (<$1000) |
| **Smart Tractor Selection** | Always uses the fastest available tractor/equipment (highest haHour) |
| **Operation Time Limit** | Ignores operations that would take more than 6 hours |
| **Automatic Login** | Supports login via Android token or email/password |
| **Multi-Tractor** | Uses up to 4 tractors simultaneously to speed up operations |
| **Auto-Implement** | Automatically attaches implements when needed |
| **Idle Verification** | Reserves tractors for operations that will be needed soon |

### 🔜 Roadmap

**Future:**
- [ ] Automatic irrigation support
- [ ] Automatic fertilization
- [ ] Multiple accounts
- [ ] Web dashboard for monitoring
- [ ] Telegram/Discord notifications
- [ ] Market analysis for selling at the best time

---

## 🔐 Authentication

The bot needs a valid `PHPSESSID` to work. There are **three ways** to obtain it:

### Option 1: Android Token (Recommended) ⭐

If you have access to the Android app token:

```env
ANDROID_TOKEN=your_token_here
```

The bot will automatically log in using the token and renew the session when necessary.

### Option 2: Login with Email/Password

If you know your credentials:

```env
FARM_EMAIL=your_email@example.com
FARM_PASSWORD=your_password
```

The bot will automatically log in and obtain the `PHPSESSID`.

### Option 3: Manual PHPSESSID

If you prefer to configure manually:

```env
PHPSESSID=your_session_id_here
```

#### 📱 How to get PHPSESSID from Android app

1. **Configure proxy on phone:**
   - Install [mitmproxy](https://mitmproxy.org/) or [Charles Proxy](https://www.charlesproxy.com/)
   - Configure the proxy on Android WiFi
   - Install the CA certificate on the device

2. **Intercept requests:**
   - Open the Farm Manager app
   - Look for requests to `farm-app.trophyapi.com`
   - Copy the `PHPSESSID` cookie value

3. **Paste in `.env`:**
   ```env
   PHPSESSID=xxxxxxxxxxxxxxxxxx
   ```

> ⚠️ **Note:** The PHPSESSID can expire. If the bot stops working, intercept a new one.

---

## 🚀 Installation

```bash
# Clone repository
git clone https://github.com/seu-usuario/BotFarmManager.git
cd BotFarmManager

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit the .env with your credentials

# Run in development
npm run dev

# Build for production
npm run build
npm start
```

---

## ⚙️ Configuration

| Variable | Description | Default |
|----------|-----------|---------|
| `ANDROID_TOKEN` | Android app token for automatic login | - |
| `FARM_EMAIL` | Login email | - |
| `FARM_PASSWORD` | Login password | - |
| `PHPSESSID` | Manual session ID (alternative to login) | - |
| `CHECK_INTERVAL_MS` | Interval between cycles (ms) | `120000` |
| `SILO_SELL_THRESHOLD` | % of silo for automatic sale | `80` |
| `DEBUG` | Enable detailed logs | `false` |

---

## 📁 Project Structure

```
src/
├── api/
│   └── client.ts        # HTTP client for the API
├── bot/
│   └── FarmBot.ts       # Main bot logic
├── services/
│   ├── AuthService.ts   # Login and session management
│   ├── FarmService.ts   # Farm management
│   ├── FuelService.ts   # Fuel management
│   ├── SeedService.ts   # Smart Seeding
│   ├── SiloService.ts   # Silo monitoring
│   ├── MarketService.ts # Market sales
│   └── TractorService.ts # Tractor and equipment management
├── types/
│   └── index.ts         # TypeScript interfaces
├── utils/
│   └── logger.ts        # Logging system
└── index.ts             # Entry point
```

---

## 📊 Example Logs

```
[FarmBot] [INFO] 🔄 Starting cycle - 01/13/2026, 11:00:00
[FarmBot] [FUEL] ⛽ Fuel: 1,316L | Price: $1,758/1000L
[FarmBot] [TASK] 🚜 1 harvest(s) available
[FarmBot] [SUCCESS] ✅ harvesting started on "North Farm" - Estimated time: 3600s
[FarmBot] [SILO] 🌾 Total Silo: 220,000kg stored
[FarmBot] [SILO] 🌾   - Canola: 127,000kg / 300,000kg (42.33%)
[FarmBot] [SILO] 🌾   - Corn: 73,000kg / 300,000kg (24.33%)
[FarmBot] [INFO] ✅ Cycle completed
```

---

## 📝 License

ISC
