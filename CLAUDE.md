# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Run Commands

```bash
npm run dev      # Development: runs with ts-node
npm run build    # Compile TypeScript to dist/
npm run start    # Production: runs compiled JavaScript
```

No test framework is currently configured.

## Architecture Overview

This is a multi-account bot orchestration system for automating farm management with a web dashboard.

### Core Flow

```
index.ts (entry point)
    ↓
BotOrchestrator (singleton) - manages all accounts
    ↓
FarmBot (one per account) - runs 5-step cycle:
    1. FuelService: check/buy fuel
    2. FarmService + TractorService: harvest operations
    3. FarmService + TractorService + SeedService: seeding operations
    4. FarmService + TractorService: cultivation operations
    5. SiloService + MarketService: sell products when silo threshold reached
    ↓
ApiClient → Farm Game API (farm-app.trophyapi.com)
```

### Multi-Account System

**BotOrchestrator** maintains a session map for each enabled account. Each account:
- Has independent settings (intervals, thresholds, max tractors)
- Runs on staggered schedule (random interval between account's min/max)
- Stores separate data in `farm-data.json` under `accounts[accountId]`

Main loop runs every 10 seconds, checks which accounts need their next cycle.

### Key Services

| Service | Purpose |
|---------|---------|
| `AuthService` | Login via Android token, email/password, session ID, or guest registration |
| `FarmService` | Fetches harvest/seeding/cultivation tasks, manages 6-hour harvest cooldown |
| `TractorService` | Selects fastest tractors, manages multi-tractor batch operations |
| `SeedService` | Smart crop selection based on field climate and cropScore |
| `MarketService` | Gets crop values, sells when silo reaches threshold (default 90%) |
| `SiloService` | Monitors grain storage capacity |
| `FuelService` | Auto-buys fuel when stock < 1000L and price < $1000 |
| `PriceTrackerService` | Tracks crop prices to CSV, provides statistics |

### Data Storage

- **config.json**: Account credentials, per-account settings, auth methods
- **farm-data.json**: Per-account farm/crop data (v3.0.0 format with accounts nesting)
- **price-history.csv**: Crop price history (timestamp + crop ID columns)

### Web Server (port 3000)

Express server with static frontend in `src/public/`:
- `index.html` - HTML structure
- `styles.css` - All styles
- `scripts.js` - All frontend JavaScript

Key API endpoints:
- `/api/status`, `/api/start`, `/api/stop` - Bot control
- `/api/farms`, `/api/silo/*` - Farm data
- `/api/config/*` - Account management
- `/api/prices/*` - Price tracking

### Important Patterns

1. **Service Injection**: Services receive ApiClient + Logger, no external config dependencies
2. **Circular Buffer Logging**: Last 200 entries available via `/api/logs`
3. **Harvest Cooldown**: 6-hour minimum between harvests per field (in-memory cache in FarmService)
4. **Tractor Selection**: Always picks fastest available (max haHour value)
5. **Data Migration**: farm-data.json auto-migrates from v1/v2 to v3 format
