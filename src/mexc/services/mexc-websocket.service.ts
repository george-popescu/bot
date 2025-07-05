import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { LoggingService } from '../../logging/logging.service';
import {
  MexcWsMessage,
  MexcWsBookTicker,
  MexcWsTrade,
  MexcWsDepth,
  MexcPriceUpdateEvent,
  MexcTradeEvent,
  MEXC_WS_STREAMS,
} from '../types/mexc.types';
import WebSocket from 'ws';
import * as protobuf from 'protobufjs';

interface SubscriptionInfo {
  stream: string;
  symbol: string;
  subscribed: boolean;
  lastMessage?: Date;
}

@Injectable()
export class MexcWebSocketService implements OnModuleDestroy {
  private ws: WebSocket | null = null;
  private readonly wsUrl: string;
  private readonly subscriptions = new Map<string, SubscriptionInfo>();
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private isDestroyed = false;

  // Protocol Buffers - In a real implementation, you'd load the .proto files
  // For now, we'll use JSON fallback since MEXC also supports JSON over WebSocket
  private protobufRoot: protobuf.Root | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.wsUrl = this.configService.get<string>('MEXC_WS_URL')!;

    if (!this.wsUrl || !this.wsUrl.startsWith('wss://')) {
      throw new Error('Invalid MEXC WebSocket URL');
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.isDestroyed = true;
    await this.disconnect();
  }

  // Connection Management

  async connect(): Promise<void> {
    if (
      this.isConnecting ||
      (this.ws && this.ws.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    this.isConnecting = true;

    try {
      this.ws = new WebSocket(this.wsUrl);
      this.setupEventHandlers();

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 10000);

        this.ws!.once('open', () => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.startPingInterval();
          this.loggingService.logWebSocketEvent('connected', true);
          resolve();
        });

        this.ws!.once('error', (error) => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.loggingService.logWebSocketEvent('connection_error', false, {
            error: error.message,
          });
          reject(error);
        });
      });
    } catch (error) {
      this.isConnecting = false;
      this.loggingService.logWebSocketEvent('connection_failed', false, {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.isDestroyed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();

      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, 'Service shutdown');
      }

      this.ws = null;
    }

    this.subscriptions.clear();
    this.loggingService.logWebSocketEvent('disconnected', true);
  }

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.on('open', () => {
      this.loggingService.logWebSocketEvent('open', true);
      this.resubscribeAll();
    });

    this.ws.on('close', (code, reason) => {
      this.loggingService.logWebSocketEvent('close', true, {
        code,
        reason: reason.toString(),
      });
      this.stopPingInterval();

      if (!this.isDestroyed) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (error) => {
      this.loggingService.logWebSocketEvent('error', false, {
        error: error.message,
      });
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });

    this.ws.on('pong', () => {
      this.loggingService.logWebSocketEvent('pong_received', true);
    });
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      let message: any;

      // Try to parse as JSON first (MEXC supports both JSON and Protobuf)
      if (typeof data === 'string') {
        message = JSON.parse(data);
      } else if (Buffer.isBuffer(data)) {
        // Try JSON first, then Protobuf if JSON fails
        try {
          message = JSON.parse(data.toString());
        } catch {
          message = this.parseProtobufMessage(data);
        }
      } else {
        this.loggingService.logWebSocketEvent('invalid_message_type', false, {
          dataType: typeof data,
        });
        return;
      }

      this.processMessage(message);
    } catch (error) {
      this.loggingService.logWebSocketEvent('message_parse_error', false, {
        error: (error as Error).message,
        dataLength: data.toString().length,
      });
    }
  }

  private parseProtobufMessage(data: Buffer): any {
    // In a real implementation, you would:
    // 1. Load the MEXC .proto files using protobuf.js
    // 2. Decode the message using the appropriate message type
    // For now, we'll return null to fallback to JSON

    if (!this.protobufRoot) {
      throw new Error('Protobuf not supported in this implementation');
    }

    // Example implementation (would need actual .proto files):
    // const MessageType = this.protobufRoot.lookupType('mexc.WebSocketMessage');
    // return MessageType.decode(data);

    throw new Error('Protobuf parsing not implemented');
  }

  private processMessage(message: any): void {
    if (!message) return;

    // Handle different message types
    if (message.stream && message.data) {
      const stream = message.stream as string;
      const data = message.data;

      if (stream.includes('bookTicker')) {
        this.handleBookTickerMessage(data as MexcWsBookTicker);
      } else if (stream.includes('trade')) {
        this.handleTradeMessage(data as MexcWsTrade);
      } else if (stream.includes('depth')) {
        this.handleDepthMessage(data as MexcWsDepth);
      } else {
        this.loggingService.logWebSocketEvent('unknown_stream', false, {
          stream,
        });
      }
    } else if (message.id && message.result !== undefined) {
      // Subscription response
      this.handleSubscriptionResponse(message);
    } else if (message.error) {
      this.loggingService.logWebSocketEvent('error_message', false, {
        error: message.error,
      });
    }
  }

  private handleBookTickerMessage(data: MexcWsBookTicker): void {
    const symbol = data.s;
    const bidPrice = parseFloat(data.b);
    const askPrice = parseFloat(data.a);
    const midPrice = (bidPrice + askPrice) / 2;

    const priceEvent: MexcPriceUpdateEvent = {
      symbol,
      price: midPrice,
      bid: bidPrice,
      ask: askPrice,
      timestamp: new Date(),
      source: 'WS',
    };

    this.eventEmitter.emit('mexc.price.update', priceEvent);

    // Update subscription info
    const subscriptionKey = `bookTicker@${symbol.toLowerCase()}`;
    const subscription = this.subscriptions.get(subscriptionKey);
    if (subscription) {
      subscription.lastMessage = new Date();
    }

    this.loggingService.logWebSocketEvent('book_ticker_received', true, {
      symbol,
      bidPrice,
      askPrice,
      midPrice,
    });
  }

  private handleTradeMessage(data: MexcWsTrade): void {
    const symbol = data.s;
    const price = parseFloat(data.p);
    const quantity = parseFloat(data.q);

    const tradeEvent: MexcTradeEvent = {
      symbol,
      tradeId: data.t,
      price,
      quantity,
      timestamp: new Date(data.T),
      isBuyerMaker: data.m,
    };

    this.eventEmitter.emit('mexc.trade.executed', tradeEvent);

    this.loggingService.logWebSocketEvent('trade_received', true, {
      symbol,
      price,
      quantity,
      tradeId: data.t,
    });
  }

  private handleDepthMessage(data: MexcWsDepth): void {
    const symbol = data.s;

    this.eventEmitter.emit('mexc.depth.update', {
      symbol,
      bids: data.b.map(([price, qty]) => [parseFloat(price), parseFloat(qty)]),
      asks: data.a.map(([price, qty]) => [parseFloat(price), parseFloat(qty)]),
      timestamp: new Date(data.E),
    });

    this.loggingService.logWebSocketEvent('depth_received', true, {
      symbol,
      bidsCount: data.b.length,
      asksCount: data.a.length,
    });
  }

  private handleSubscriptionResponse(message: any): void {
    if (message.result === null) {
      this.loggingService.logWebSocketEvent('subscription_success', true, {
        id: message.id,
      });
    } else {
      this.loggingService.logWebSocketEvent('subscription_failed', false, {
        id: message.id,
        result: message.result,
      });
    }
  }

  // Subscription Management

  async subscribeToBookTicker(symbol: string): Promise<void> {
    const stream = `${symbol.toLowerCase()}@bookTicker`;
    return this.subscribe(stream, symbol);
  }

  async subscribeToTrades(symbol: string): Promise<void> {
    const stream = `${symbol.toLowerCase()}@trade`;
    return this.subscribe(stream, symbol);
  }

  async subscribeToDepth(symbol: string, levels = 20): Promise<void> {
    const stream = `${symbol.toLowerCase()}@depth${levels}`;
    return this.subscribe(stream, symbol);
  }

  private async subscribe(stream: string, symbol: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    const subscriptionKey = stream;

    if (this.subscriptions.has(subscriptionKey)) {
      this.loggingService.logWebSocketEvent('already_subscribed', false, {
        stream,
      });
      return;
    }

    const subscribeMessage = {
      id: Date.now(),
      method: 'SUBSCRIBE',
      params: [stream],
    };

    this.ws!.send(JSON.stringify(subscribeMessage));

    this.subscriptions.set(subscriptionKey, {
      stream,
      symbol,
      subscribed: true,
      lastMessage: new Date(),
    });

    this.loggingService.logWebSocketEvent('subscription_sent', true, {
      stream,
    });
  }

  async unsubscribe(stream: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const unsubscribeMessage = {
      id: Date.now(),
      method: 'UNSUBSCRIBE',
      params: [stream],
    };

    this.ws.send(JSON.stringify(unsubscribeMessage));
    this.subscriptions.delete(stream);

    this.loggingService.logWebSocketEvent('unsubscription_sent', true, {
      stream,
    });
  }

  private async resubscribeAll(): Promise<void> {
    for (const [stream, info] of this.subscriptions.entries()) {
      if (info.subscribed) {
        const subscribeMessage = {
          id: Date.now(),
          method: 'SUBSCRIBE',
          params: [stream],
        };

        this.ws!.send(JSON.stringify(subscribeMessage));
      }
    }
  }

  // Reconnection Logic

  private scheduleReconnect(): void {
    if (this.isDestroyed || this.reconnectTimer) {
      return;
    }

    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      this.loggingService.logWebSocketEvent('max_reconnect_attempts', false, {
        attempts: this.reconnectAttempts,
      });
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000); // Exponential backoff, max 30s

    this.loggingService.logWebSocketEvent('scheduling_reconnect', true, {
      attempt: this.reconnectAttempts,
      delayMs: delay,
    });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      if (!this.isDestroyed) {
        try {
          await this.connect();
        } catch (error) {
          this.loggingService.logWebSocketEvent('reconnect_failed', false, {
            error: (error as Error).message,
          });
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  // Ping/Pong Management

  private startPingInterval(): void {
    this.stopPingInterval();

    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
        this.loggingService.logWebSocketEvent('ping_sent', true);
      }
    }, 30000); // Ping every 30 seconds
  }

  private stopPingInterval(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // Status Methods

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  getConnectionState(): string {
    if (!this.ws) return 'DISCONNECTED';

    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'CONNECTING';
      case WebSocket.OPEN:
        return 'CONNECTED';
      case WebSocket.CLOSING:
        return 'CLOSING';
      case WebSocket.CLOSED:
        return 'CLOSED';
      default:
        return 'UNKNOWN';
    }
  }

  getSubscriptions(): SubscriptionInfo[] {
    return Array.from(this.subscriptions.values());
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  // Health Check

  isHealthy(): boolean {
    if (!this.isConnected()) {
      return false;
    }

    // Check if we have recent messages
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    for (const subscription of this.subscriptions.values()) {
      if (subscription.subscribed && subscription.lastMessage) {
        if (subscription.lastMessage.getTime() > fiveMinutesAgo) {
          return true;
        }
      }
    }

    // If no subscriptions or all are stale, connection might be dead
    return this.subscriptions.size === 0;
  }
}
