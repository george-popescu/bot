# 🏪 Market Making Bot

Bot de market making care plasează ordere pe ambele părți ale pieței pentru a profita din spread-ul bid-ask.

## 📋 Caracteristici

- **Market Making pe MEXC**: Plasează ordere de cumpărare și vânzare în jurul prețului curent
- **Configurabil**: Spread, cantitate, interval de refresh customizabil
- **Auto-management**: Anulare automată a ordinelor vechi
- **API Control**: Start/stop și configurare prin API
- **Siguranță**: Limite maxime pentru risc controlat

## 🚀 Pornire

### 1. Market Making Bot Separat (Recomandat)
```bash
# Development
npm run start:market-making

# Production
npm run build
npm run start:market-making:prod
```

### 2. Prin API în aplicația principală
```bash
# Pornește aplicația principală
npm run start:dev

# Apoi folosește API-ul pentru control
curl -X POST http://localhost:3000/api/market-making/start
```

## ⚙️ Configurare

Adaugă în `.env`:

```bash
# Market Making Configuration
MM_ENABLED=true                # Enable/disable market making
MM_EXCHANGE=MEXC               # Exchange: MEXC, PANCAKESWAP, BOTH
MM_SPREAD=0.5                  # Spread percentage (0.5%)
MM_ORDER_SIZE=10               # Order size în ILMT
MM_MAX_ORDERS=2                # Max ordere per side
MM_REFRESH_INTERVAL=30         # Refresh interval în secunde
MM_PRICE_OFFSET=0.1            # Price offset percentage (0.1%)
```

## 📊 Cum Funcționează

1. **Price Discovery**: Obține prețul curent de pe MEXC
2. **Calculate Prices**: 
   - Buy Price = Current Price × (1 - spread/2 - offset)
   - Sell Price = Current Price × (1 + spread/2 + offset)
3. **Place Orders**: Plasează ordere limite la prețurile calculate
4. **Monitor**: Monitorizează și anulează ordinele vechi (>2% deviație)
5. **Repeat**: Repetă la fiecare `MM_REFRESH_INTERVAL` secunde

## 🔧 API Endpoints

### Status
```bash
GET /api/market-making/status
```

Response:
```json
{
  "isRunning": true,
  "config": {
    "enabled": true,
    "exchange": "MEXC",
    "spread": 0.5,
    "orderSize": 10,
    "maxOrders": 2,
    "refreshInterval": 30,
    "priceOffset": 0.1
  },
  "activeOrders": 4,
  "orders": [...]
}
```

### Start Market Making
```bash
POST /api/market-making/start
```

### Stop Market Making
```bash
POST /api/market-making/stop
```

### Update Configuration
```bash
PATCH /api/market-making/config
Content-Type: application/json

{
  "spread": 0.8,
  "orderSize": 15
}
```

## 📈 Exemplu de Lucru

Cu configurația default (spread 0.5%, offset 0.1%):

- **Preț curent**: $0.010000
- **Buy order**: $0.009970 (10 ILMT)
- **Sell order**: $0.010030 (10 ILMT)

Bot-ul va:
1. Plasa 2 ordere de cumpărare la $0.009970
2. Plasa 2 ordere de vânzare la $0.010030
3. La următorul ciclu (30s), verifică prețurile și ajustează
4. Anulează ordinele vechi dacă prețul s-a schimbat >2%

## ⚠️ Riscuri și Siguranță

- **Inventory Risk**: Riscul de a acumula prea mult dintr-un asset
- **Market Risk**: Mișcări mari de preț pot genera pierderi
- **Technical Risk**: Probleme de conectivitate sau API

### Măsuri de Siguranță Implementate:
- ✅ Limite maxime pe numărul de ordere
- ✅ Anulare automată a ordinelor vechi
- ✅ Configurare flexibilă a spread-ului
- ✅ Monitoring și logging complet

## 📝 Loguri

Bot-ul loghează toate acțiunile importante:

```
🏪 Starting Market Making Bot
🔄 Running market making cycle
📊 MEXC Market Making: BUY @ $0.009970 | SELL @ $0.010030
🟢 BUY order placed on MEXC (orderId: 12345)
🔴 SELL order placed on MEXC (orderId: 12346)
❌ Order cancelled (orderId: 12340, reason: stale)
✅ Market making cycle completed
```

## 🔄 Integrare cu Arbitraj Bot

Market making bot-ul poate rula **independent** sau **alături** de arbitraj bot:

- **Port separat**: Market making pe 3001, Arbitraj pe 3000
- **Strategii diferite**: Market making = provide liquidity, Arbitraj = consume opportunities
- **Configurare separată**: Fiecare bot are propriile setări 