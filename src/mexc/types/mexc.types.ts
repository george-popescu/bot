// MEXC API Types and Interfaces

export interface MexcApiCredentials {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
}

export interface MexcApiResponse<T = any> {
  data?: T;
  success: boolean;
  code?: number;
  msg?: string;
}

export interface MexcTicker {
  symbol: string;
  price: string; // This is what MEXC actually returns for price ticker
  priceChange?: string;
  priceChangePercent?: string;
  weightedAvgPrice?: string;
  prevClosePrice?: string;
  lastPrice?: string; // Keep for backward compatibility
  lastQty?: string;
  bidPrice?: string;
  bidQty?: string;
  askPrice?: string;
  askQty?: string;
  openPrice?: string;
  highPrice?: string;
  lowPrice?: string;
  volume?: string;
  quoteVolume?: string;
  openTime?: number;
  closeTime?: number;
  count?: number;
}

export interface MexcOrderBook {
  symbol: string;
  bids: [string, string][]; // [price, quantity]
  asks: [string, string][]; // [price, quantity]
  lastUpdateId: number;
}

export interface MexcBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface MexcAccount {
  makerCommission: number;
  takerCommission: number;
  buyerCommission: number;
  sellerCommission: number;
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  updateTime: number;
  accountType: string;
  balances: MexcBalance[];
}

export interface MexcOrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  type:
    | 'LIMIT'
    | 'MARKET'
    | 'STOP_LOSS'
    | 'STOP_LOSS_LIMIT'
    | 'TAKE_PROFIT'
    | 'TAKE_PROFIT_LIMIT'
    | 'LIMIT_MAKER';
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  quantity?: string;
  quoteOrderQty?: string;
  price?: string;
  newClientOrderId?: string;
  stopPrice?: string;
  icebergQty?: string;
  newOrderRespType?: 'ACK' | 'RESULT' | 'FULL';
  recvWindow?: number;
}

export interface MexcOrder {
  symbol: string;
  orderId: number;
  orderListId: number;
  clientOrderId: string;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status:
    | 'NEW'
    | 'PARTIALLY_FILLED'
    | 'FILLED'
    | 'CANCELED'
    | 'PENDING_CANCEL'
    | 'REJECTED'
    | 'EXPIRED';
  timeInForce: string;
  type: string;
  side: string;
  stopPrice: string;
  icebergQty: string;
  time: number;
  updateTime: number;
  isWorking: boolean;
  origQuoteOrderQty: string;
}

export interface MexcTrade {
  symbol: string;
  id: number;
  orderId: number;
  orderListId: number;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
  isBestMatch: boolean;
}

// WebSocket Types
export interface MexcWsMessage {
  stream: string;
  data: any;
}

export interface MexcWsBookTicker {
  u: number; // order book updateId
  s: string; // symbol
  b: string; // best bid price
  B: string; // best bid qty
  a: string; // best ask price
  A: string; // best ask qty
}

export interface MexcWsTrade {
  e: string; // event type
  E: number; // event time
  s: string; // symbol
  t: number; // trade ID
  p: string; // price
  q: string; // quantity
  b: number; // buyer order ID
  a: number; // seller order ID
  T: number; // trade time
  m: boolean; // is buyer maker
  M: boolean; // ignore
}

export interface MexcWsDepth {
  e: string; // event type
  E: number; // event time
  s: string; // symbol
  U: number; // first update ID
  u: number; // final update ID
  b: [string, string][]; // bids [price, quantity]
  a: [string, string][]; // asks [price, quantity]
}

// Error Types
export interface MexcApiError {
  code: number;
  msg: string;
}

export interface MexcRateLimitInfo {
  rateLimitType: 'REQUEST_WEIGHT' | 'ORDERS' | 'RAW_REQUESTS';
  interval: 'SECOND' | 'MINUTE' | 'DAY';
  intervalNum: number;
  limit: number;
  count: number;
}

// Configuration Types
export interface MexcServiceConfig {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
  wsUrl: string;
  timeout: number;
  maxRetries: number;
  retryDelay: number;
  rateLimitBuffer: number;
}

// Event Types
export interface MexcPriceUpdateEvent {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  timestamp: Date;
  source: 'REST' | 'WS';
}

export interface MexcTradeEvent {
  symbol: string;
  tradeId: number;
  price: number;
  quantity: number;
  timestamp: Date;
  isBuyerMaker: boolean;
}

export interface MexcOrderEvent {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  status: string;
  executedQty: number;
  price: number;
  timestamp: Date;
}

// Utility Types
export type MexcSymbol = string;
export type MexcOrderSide = 'BUY' | 'SELL';
export type MexcOrderType = 'MARKET' | 'LIMIT';
export type MexcTimeInForce = 'GTC' | 'IOC' | 'FOK';

// Constants
export const MEXC_ENDPOINTS = {
  PING: '/ping',
  TIME: '/time',
  EXCHANGE_INFO: '/exchangeInfo',
  TICKER: '/ticker/price',
  TICKER_24HR: '/ticker/24hr',
  BOOK_TICKER: '/ticker/bookTicker',
  DEPTH: '/depth',
  ACCOUNT: '/account',
  ORDER: '/order',
  OPEN_ORDERS: '/openOrders',
  ALL_ORDERS: '/allOrders',
  MY_TRADES: '/myTrades',
} as const;

export const MEXC_WS_STREAMS = {
  BOOK_TICKER: 'bookTicker',
  TRADE: 'trade',
  DEPTH: 'depth',
  KLINE: 'kline',
  MINI_TICKER: 'miniTicker',
  TICKER: 'ticker',
} as const;

export const MEXC_ERROR_CODES = {
  UNKNOWN: -1000,
  DISCONNECTED: -1001,
  UNAUTHORIZED: -1002,
  TOO_MANY_REQUESTS: -1003,
  DUPLICATE_IP: -1004,
  NO_SUCH_IP: -1005,
  UNEXPECTED_RESP: -1006,
  TIMEOUT: -1007,
  INVALID_MESSAGE: -1013,
  UNKNOWN_ORDER_COMPOSITION: -1014,
  TOO_MANY_ORDERS: -1015,
  SERVICE_SHUTTING_DOWN: -1016,
  UNSUPPORTED_OPERATION: -1020,
  INVALID_TIMESTAMP: -1021,
  INVALID_SIGNATURE: -1022,
  INVALID_SYMBOL: -1121,
  INVALID_LISTEN_KEY: -1125,
  MORE_THAN_XX_HOURS: -1127,
  OPTIONAL_PARAMS_BAD_COMBO: -1128,
  INVALID_PARAMETER: -1130,
} as const;
