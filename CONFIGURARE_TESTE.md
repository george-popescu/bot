# 🧪 CONFIGURARE TESTE SIGURE

## 📊 Limite Configurate pentru Teste

Botul a fost configurat cu limite foarte conservative pentru teste sigure:

### 💰 Limite Financiare
- **MAX_TRADE_SIZE**: $10 (redus de la $500)
- **MAX_DAILY_VOLUME**: $50 (redus de la $5000)
- **MAX_TRADES_PER_HOUR**: 10 (redus de la 20)
- **MIN_PROFIT_THRESHOLD**: 0.5% (redus de la 1.0%)

### 🛡️ Balanțe Virtuale de Test
- **USDT Virtual**: $100 (redus de la $1000)
- **ILMT Virtual**: 100 tokens (redus de la 1000)
- **BNB Virtual**: 0.1 (redus de la 1.0)

### ⚙️ Configurare Tranzacții
- **Base Trade Size**: $10 (redus de la $100)
- **Max Trade Size**: $100 (redus de la $1000)
- **Minimum Trade**: $5 (redus de la $10)

## 🚀 Cum să Rulezi Testele

### 1. Asigură-te că MONITORING_MODE este activat:
```bash
export MONITORING_MODE=true
```

### 2. Configurează limitele în .env:
```bash
# Limite ultra-conservative pentru teste
MIN_PROFIT_THRESHOLD=0.5
MAX_TRADE_SIZE=10.0
MAX_DAILY_VOLUME=50.0
MAX_TRADES_PER_HOUR=10
```

### 3. Pornește aplicația:
```bash
npm start
```

### 4. Monitorizează logurile:
```bash
tail -f logs/app.log | grep -E "(💰|🥞|🔍|🚨)"
```

## 📈 Exemple de Teste

### Test 1: Oportunitate mică ($5)
- Spread: 0.8%
- Trade size: $5
- Profit așteptat: ~$0.04
- Risk: FOARTE MIC

### Test 2: Oportunitate medie ($10)
- Spread: 1.2%
- Trade size: $10
- Profit așteptat: ~$0.12
- Risk: MIC

## ⚠️ AVERTISMENTE

1. **NICIODATĂ nu seta MONITORING_MODE=false** decât dacă vrei să riști bani reali
2. **Limitele mici** sunt pentru siguranță - nu le mări până nu înțelegi complet riscurile
3. **Testele virtuale** nu reflectă perfect condițiile reale de trading
4. **Slippage-ul real** poate fi mai mare decât cel calculat

## 📊 Monitorizare Teste

Botul va loga:
- ✅ Oportunități detectate
- 💰 Prețuri în timp real
- 🎯 Simulări de tranzacții
- 📈 Profituri/pierderi virtuale
- 🚫 Trade-uri respinse

## 🔄 Pentru a Reveni la Limite Normale

Pentru trading real (FOARTE PERICULOS), modifică în `validation.schema.ts`:
```typescript
MAX_TRADE_SIZE: default(500.0)  // În loc de 10.0
MAX_DAILY_VOLUME: default(5000.0)  // În loc de 50.0
```

**ATENȚIE**: Fă acest lucru DOAR dacă înțelegi complet riscurile! 