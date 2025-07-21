# 🚀 Volume Booster Bot

Bot de volum pentru MEXC care creează volum artificial de trading pe ILMT/USDT pentru a evita front-running-ul și botii adversi.

## 🎯 Caracteristici Principale

- **Anti-Front-Running**: Market orders rapide și timing randomizat
- **Stealth Mode**: Size-uri și intervale imprevizibile  
- **Conservative**: Limite sigure de 150-300 ILMT per trade
- **Monitoring Mode**: Testare în siguranță fără bani reali
- **Independent**: Funcționează parallel cu Market Making

## ⚙️ Configurare Sigură

Adaugă în `.env`:

```bash
# Volume Booster Configuration - CONSERVATIVE DEFAULTS
VB_ENABLED=true                    # Enable volume booster
VB_MONITORING_MODE=true            # SAFE MODE - only simulations
VB_TARGET_VOLUME_DAILY=1000        # Target $1K volume per day
VB_MIN_TRADE_SIZE=150              # Minimum 150 ILMT (MEXC requirement)
VB_MAX_TRADE_SIZE=300              # Conservative maximum 300 ILMT
VB_CYCLE_INTERVAL_MIN=60           # Minimum 1 minute between trades
VB_CYCLE_INTERVAL_MAX=300          # Maximum 5 minutes between trades

# Advanced Strategy Configuration
VB_STRATEGY=BALANCED               # Trading strategy (see below)
VB_BALANCE_WINDOW=20               # Window for balance checking (trades)
VB_PRICE_IMPACT_LIMIT=0.5          # Max price impact % allowed
VB_USE_SPREAD_TRADING=true         # Use bid/ask spread for zero impact
VB_MAX_CONSECUTIVE_SIDE=3          # Max consecutive same side trades

# Anti-Bot Configuration
VB_STEALTH_MODE=true               # Anti-bot randomization
VB_ICEBERG_SIZE=200                # Hidden order chunks
VB_RANDOMIZE_EXECUTION=true        # Random timing and sizes
VB_MAX_CONCURRENT_TRADES=3         # Max 3 trades simultaneously
```

## 🚀 Cum să Rulezi

### 1. Mode Standalone (Recomandat pentru Volume)
```bash
# Pornire Volume Booster independent
npm run build
node dist/src/volume-booster-main.js
```

### 2. Mode API (Prin aplicația principală)
```bash
# Pornește aplicația principală
npm run start:dev

# Control prin API
curl -X POST http://localhost:3000/api/volume-booster/start
curl -X GET http://localhost:3000/api/volume-booster/status
curl -X POST http://localhost:3000/api/volume-booster/stop
```

## 🎯 **Trading Strategies Configurabile**

### **BALANCED (DEFAULT - Recomandat)**
```bash
VB_STRATEGY=BALANCED
```
- **Impact**: ZERO pe preț (echilibru strict 50/50)
- **Logic**: Menține balanța BUY/SELL constant
- **Anti-Pattern**: Max 3 ordine consecutive același tip
- **Perfect pentru**: Volume fără impact pe preț

### **RANDOM (Original)**
```bash
VB_STRATEGY=RANDOM
```
- **Impact**: Minim (50-50 pe termen lung)
- **Logic**: Alegere aleatoare BUY/SELL
- **Risk**: Poate avea secvențe BUY/SELL dezechilibrate

### **SMART_SPREAD (Zero Impact)**
```bash
VB_STRATEGY=SMART_SPREAD
```
- **Impact**: ZERO garantat
- **Logic**: Cumpără la BID, vinde la ASK
- **Advanced**: Analizează spread-ul pentru decizie optimă

### **ALTERNATING (Predictabil dar echilibrat)**
```bash
VB_STRATEGY=ALTERNATING
```
- **Impact**: Zero mathematical
- **Logic**: BUY → SELL → BUY → SELL strict
- **Predictabil**: Pentru boti, dar eficient pentru echilibru

### **BUY_HEAVY / SELL_HEAVY (Pentru tendințe)**
```bash
VB_STRATEGY=BUY_HEAVY    # 70% BUY, 30% SELL - pump gentle
VB_STRATEGY=SELL_HEAVY   # 30% BUY, 70% SELL - distribute
```
- **Impact**: CONTROLLAT spre direcția dorită
- **Use Case**: Când vrei sa influențezi ușor trending-ul

## 📊 Strategia Anti-Front-Running

### **Problema Identificată:**
- Plasezi BUY order mare → Imediat apare SELL mai mare sub tine
- Bots adversi monitorizează order book-ul și "îți fură" execuția

### **Soluția Implementată:**

#### **1. Market Orders Lightning Fast**
```typescript
// Market orders = execuție instantanee, fără timp de reacție pentru boti
side: Math.random() > 0.5 ? 'BUY' : 'SELL'  // Random wash trading
type: 'MARKET'  // Execuție imediată
```

#### **2. Size Randomization**
```typescript
// Size-uri imprevizibile între 150-300 ILMT
calculateTradeSize(): 150 + Math.random() * 150
// Nu mai pot anticipa size-ul următor
```

#### **3. Timing Chaos**
```typescript
// Intervale random între 1-5 minute
minInterval: 60s, maxInterval: 300s
randomInterval = min + Math.random() * (max - min)
```

#### **4. Neutral Position**
```typescript
// Wash trading = cumpără și vinde în aceeași măsură
// Nu afectează balanța totală, doar generează volum
```

## 📈 Monitoring Mode vs Real Mode

### **Monitoring Mode (DEFAULT - SAFE):**
```
✅ VB_MONITORING_MODE=true
🎭 Simulează toate trade-urile 
💰 Nu cheltui bani reali
📊 Calculează volume și statistici realiste
🔍 Perfect pentru testare
```

### **Real Mode (PERICULOS - DISABLED):**
```
❌ VB_MONITORING_MODE=false  
⚠️  EXECUTĂ trade-uri reale
💸 Cheltui bani reali pe MEXC
🚫 DISABLED prin cod pentru siguranță
```

## 🔧 API Endpoints

### Status Check
```bash
GET /api/volume-booster/status

Response:
{
  "isRunning": true,
  "config": {
    "enabled": true,
    "monitoringMode": true,
    "targetVolumeDaily": 1000,
    "minTradeSize": 150,
    "maxTradeSize": 300
  },
  "stats": {
    "dailyVolume": 1247.50,
    "dailyTrades": 47,
    "lastTradeTime": "2024-01-15T10:30:00Z"
  }
}
```

### Start/Stop Control
```bash
POST /api/volume-booster/start
POST /api/volume-booster/stop
```

## 🎯 Rezultate Așteptate

### **Volume Target**
- **Daily Volume**: $1,000 USD (configurabil)
- **Trade Frequency**: 20-60 trades per zi  
- **Average Size**: ~220 ILMT per trade

### **Anti-Bot Effectiveness**
- ✅ **Execution Speed**: <200ms market orders
- ✅ **Unpredictable Timing**: Random 1-5 min intervals  
- ✅ **Variable Sizes**: 150-300 ILMT randomized
- ✅ **No Patterns**: Impossible pentru boti să anticipeze

### **Safety Features**
- 🛡️ **Monitoring Mode**: Default ON pentru testare
- 🛡️ **Conservative Limits**: Max 300 ILMT per trade
- 🛡️ **Daily Caps**: Max $1K volume per zi
- 🛡️ **Emergency Stop**: Ctrl+C oprește instant

## 📝 Exemple de Loguri

```
🚀 Starting ILMT Volume Booster...
⚠️  MONITORING MODE: Real trading is disabled for safety
📊 Conservative Settings: 150-300 ILMT per trade
🔄 Random intervals: 1-5 minutes between cycles

🎭 [SIMULATION] Volume boost trade {
  tradeSize: 237,
  currentPrice: 0.008807, 
  tradeValue: 2.087,
  stats: { dailyVolume: 1247.50, dailyTrades: 47 }
}

Next volume boost cycle in 143s
```

## ⚠️ Important - Siguranță

### **Pentru Testare Sigură:**
1. **ÎNTOTDEAUNA** ține `VB_MONITORING_MODE=true`
2. **NU** seta `VB_MONITORING_MODE=false` până nu ești 100% sigur
3. **Testează** câteva zile în monitoring mode
4. **Verifică** logurile și statisticile

### **Pentru Activare Real Trading:**
1. **Testare completă** în monitoring mode  
2. **Verifică balanțele** MEXC
3. **Setează limite mici** initial (ex: max 200 ILMT)
4. **Monitorizează** prima oră atent

## 🔄 Integrarea cu MM

Volume Booster rulează **INDEPENDENT** de Market Making:

```
📊 Market Making    → Ordine limite pe multiple niveluri
🚀 Volume Booster   → Market orders rapide anti-front-running  
⚖️  Arbitrage       → Profită din diferențe mari de preț
```

**Rezultatul combinat**: Lichiditate + Volum + Profit = Token dominat! 🎯 