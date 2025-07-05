import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '../../config/config.service';
import { LoggingService } from '../../logging/logging.service';
import { MexcApiError } from '../../common/types';
import {
  MexcApiResponse,
  MexcTicker,
  MexcAccount,
  MexcOrderRequest,
  MexcOrder,
  MexcOrderBook,
  MexcTrade,
  MEXC_ENDPOINTS,
  MEXC_ERROR_CODES,
  MexcServiceConfig,
} from '../types/mexc.types';
import { firstValueFrom } from 'rxjs';
import { timeout, retry, catchError } from 'rxjs/operators';
import * as crypto from 'crypto';
import { MexcNativeHttpService } from './mexc-native-http.service';

@Injectable()
export class MexcApiService {
  private readonly config: MexcServiceConfig;
  private readonly rateLimitTracker = new Map<
    string,
    { count: number; resetTime: number }
  >();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService,
    private readonly mexcNativeHttpService: MexcNativeHttpService,
  ) {
    this.config = {
      apiKey: this.configService.mexcApiKey,
      secretKey: this.configService.mexcSecretKey,
      baseUrl: this.configService.mexcBaseUrl,
      wsUrl: this.configService.mexcWsUrl,
      timeout: 10000,
      maxRetries: 3,
      retryDelay: 1000,
      rateLimitBuffer: 100, // Leave 100 requests buffer
    };

    this.validateConfig();
  }

  private validateConfig(): void {
    if (!this.config.apiKey || this.config.apiKey.length < 10) {
      throw new Error('Invalid MEXC API key');
    }
    if (!this.config.secretKey || this.config.secretKey.length < 10) {
      throw new Error('Invalid MEXC secret key');
    }
    if (!this.config.baseUrl || !this.config.baseUrl.startsWith('https://')) {
      throw new Error('Invalid MEXC base URL');
    }
  }

  // Public API Methods (no authentication required)

  async ping(): Promise<boolean> {
    const startTime = Date.now();
    try {
      await this.makeRequest('GET', MEXC_ENDPOINTS.PING);
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall('MexcApiService', 'ping', duration, true);
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'ping',
        duration,
        false,
        (error as Error).message,
      );
      return false;
    }
  }

  async getServerTime(): Promise<number> {
    const startTime = Date.now();
    try {
      const response = await this.makeRequest<{ serverTime: number }>(
        'GET',
        MEXC_ENDPOINTS.TIME,
      );
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'getServerTime',
        duration,
        true,
      );
      return response.serverTime;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'getServerTime',
        duration,
        false,
        (error as Error).message,
      );
      throw this.handleApiError(error as any);
    }
  }

  async getTicker(symbol: string): Promise<MexcTicker> {
    const startTime = Date.now();
    try {
      const response = await this.makeRequest<MexcTicker>(
        'GET',
        MEXC_ENDPOINTS.TICKER,
        { symbol },
      );
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'getTicker',
        duration,
        true,
      );
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'getTicker',
        duration,
        false,
        (error as Error).message,
      );
      throw this.handleApiError(error as any);
    }
  }

  async getBookTicker(symbol: string): Promise<{
    bidPrice: string;
    bidQty: string;
    askPrice: string;
    askQty: string;
  }> {
    const startTime = Date.now();
    try {
      const response = await this.makeRequest<any>(
        'GET',
        MEXC_ENDPOINTS.BOOK_TICKER,
        { symbol },
      );
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'getBookTicker',
        duration,
        true,
      );
      return {
        bidPrice: response.bidPrice,
        bidQty: response.bidQty,
        askPrice: response.askPrice,
        askQty: response.askQty,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'getBookTicker',
        duration,
        false,
        (error as Error).message,
      );
      throw this.handleApiError(error as any);
    }
  }

  async getOrderBook(symbol: string, limit = 100): Promise<MexcOrderBook> {
    const startTime = Date.now();
    try {
      const response = await this.makeRequest<MexcOrderBook>(
        'GET',
        MEXC_ENDPOINTS.DEPTH,
        { symbol, limit },
      );
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'getOrderBook',
        duration,
        true,
      );
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'getOrderBook',
        duration,
        false,
        (error as Error).message,
      );
      throw this.handleApiError(error as any);
    }
  }

  // Private API Methods (authentication required)

  async getAccount(): Promise<MexcAccount> {
    const startTime = Date.now();
    try {
      const response = await this.makeSignedRequest<MexcAccount>(
        'GET',
        MEXC_ENDPOINTS.ACCOUNT,
      );
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'getAccount',
        duration,
        true,
      );
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'getAccount',
        duration,
        false,
        (error as Error).message,
      );
      throw this.handleApiError(error as any);
    }
  }

  async placeOrder(orderRequest: MexcOrderRequest): Promise<MexcOrder> {
    const startTime = Date.now();
    try {
      // Add timestamp and recvWindow (required for MEXC API)
      const params = {
        ...orderRequest,
        timestamp: Date.now(),
        recvWindow: orderRequest.recvWindow || '5000',
      };
      // Folosește serviciul nativ pentru POST
      const response = await this.mexcNativeHttpService.signedRequest({
        baseUrl: this.config.baseUrl,
        endpoint: MEXC_ENDPOINTS.ORDER,
        params,
        apiKey: this.config.apiKey,
        secretKey: this.config.secretKey,
      });
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'placeOrder',
        duration,
        true,
      );
      this.loggingService.info(`Order placed successfully`, {
        component: 'MexcApiService',
        operation: 'PLACE_ORDER',
        orderId: response.orderId,
        symbol: orderRequest.symbol,
        side: orderRequest.side,
        type: orderRequest.type,
        quantity: orderRequest.quantity,
      });
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'placeOrder',
        duration,
        false,
        (error as Error).message,
      );
      throw this.handleApiError(error as any);
    }
  }

  async cancelOrder(symbol: string, orderId: number): Promise<MexcOrder> {
    const startTime = Date.now();
    try {
      const params = {
        symbol,
        orderId,
        timestamp: Date.now(),
      };
      // Folosește serviciul nativ pentru DELETE semnat
      const response = await this.mexcNativeHttpService.signedRequest({
        baseUrl: this.config.baseUrl,
        endpoint: MEXC_ENDPOINTS.ORDER,
        params,
        apiKey: this.config.apiKey,
        secretKey: this.config.secretKey,
        method: 'DELETE',
      });
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'cancelOrder',
        duration,
        true,
      );
      this.loggingService.info(`Order cancelled successfully`, {
        component: 'MexcApiService',
        operation: 'CANCEL_ORDER',
        orderId,
        symbol,
      });
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'cancelOrder',
        duration,
        false,
        (error as Error).message,
      );
      throw this.handleApiError(error as any);
    }
  }

  async getOrder(symbol: string, orderId: number): Promise<MexcOrder> {
    const startTime = Date.now();
    try {
      const params = {
        symbol,
        orderId,
        timestamp: Date.now(),
      };

      const response = await this.makeSignedRequest<MexcOrder>(
        'GET',
        MEXC_ENDPOINTS.ORDER,
        params,
      );
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'getOrder',
        duration,
        true,
      );
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'getOrder',
        duration,
        false,
        (error as Error).message,
      );
      throw this.handleApiError(error as any);
    }
  }

  async getMyTrades(symbol: string, limit = 500): Promise<MexcTrade[]> {
    const startTime = Date.now();
    try {
      const params = {
        symbol,
        limit,
        timestamp: Date.now(),
      };

      const response = await this.makeSignedRequest<MexcTrade[]>(
        'GET',
        MEXC_ENDPOINTS.MY_TRADES,
        params,
      );
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'getMyTrades',
        duration,
        true,
      );
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'getMyTrades',
        duration,
        false,
        (error as Error).message,
      );
      throw this.handleApiError(error as any);
    }
  }

  /**
   * Plasează o comandă de vânzare pe MEXC
   */
  async placeSellOrder(symbol: string, quantity: number, price?: number): Promise<MexcOrder> {
    const startTime = Date.now();
    try {
      const orderRequest: MexcOrderRequest = {
        symbol: symbol.toUpperCase(),
        side: 'SELL',
        type: price ? 'LIMIT' : 'MARKET',
        quantity: quantity.toString(),
        ...(price && { price: price.toString() }),
        ...(price && { timeInForce: 'GTC' as const }),
      };

      const response = await this.placeOrder(orderRequest);
      
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall('MexcApiService', 'placeSellOrder', duration, true);

      this.loggingService.info(`MEXC SELL ORDER PLACED: ${quantity} ${symbol} ${price ? `at $${price}` : 'at market'}`, {
        component: 'MexcApiService',
        orderId: response.orderId,
        symbol,
        quantity,
        price,
      });

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall('MexcApiService', 'placeSellOrder', duration, false, (error as Error).message);
      throw this.handleApiError(error as any);
    }
  }

  /**
   * Verifică statusul unei comenzi (folosind string orderId)
   */
  async getOrderStatus(symbol: string, orderId: string): Promise<MexcOrder> {
    const startTime = Date.now();
    try {
      const params = {
        symbol: symbol.toUpperCase(),
        orderId,
        timestamp: Date.now(),
      };

      const response = await this.makeSignedRequest<MexcOrder>('GET', MEXC_ENDPOINTS.ORDER, params);
      
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall('MexcApiService', 'getOrderStatus', duration, true);

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall('MexcApiService', 'getOrderStatus', duration, false, (error as Error).message);
      throw this.handleApiError(error as any);
    }
  }

  async getOpenOrders(symbol: string): Promise<MexcOrder[]> {
    const startTime = Date.now();
    try {
      const params = {
        symbol,
        timestamp: Date.now(),
      };
      const response = await this.makeSignedRequest<MexcOrder[]>(
        'GET',
        MEXC_ENDPOINTS.OPEN_ORDERS,
        params,
      );
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'getOpenOrders',
        duration,
        true,
      );
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.loggingService.logApiCall(
        'MexcApiService',
        'getOpenOrders',
        duration,
        false,
        (error as Error).message,
      );
      throw this.handleApiError(error as any);
    }
  }

  // Helper Methods

  private async makeRequest<T>(
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    params?: Record<string, any>,
  ): Promise<T> {
    this.checkRateLimit();

    const url = `${this.config.baseUrl}${endpoint}`;
    const config: any = {
      method,
      url,
      timeout: this.config.timeout,
      headers: {
        'X-MEXC-APIKEY': this.config.apiKey,
        'Content-Type': undefined, // Force undefined Content-Type to prevent axios from setting it
      },
    };

    if (method === 'GET' && params) {
      config.params = params;
    } else if (method === 'POST' && params) {
      // For MEXC API, POST signed requests need params as query string, not body
      config.params = params;
    } else if (params) {
      config.data = params;
    }

    try {
      // Add request interceptor to remove Content-Type header
      const axiosInstance = this.httpService.axiosRef;
      const interceptorId = axiosInstance.interceptors.request.use((config) => {
        if (config.method === 'post' && config.headers) {
          delete config.headers['Content-Type'];
          delete config.headers['content-type'];
        }
        return config;
      });

      const response = await firstValueFrom(
        this.httpService.request(config).pipe(
          timeout(this.config.timeout),
          retry({
            count: this.config.maxRetries,
            delay: this.config.retryDelay,
          }),
          catchError((error) => {
            throw error;
          }),
        ),
      );

      // Remove the interceptor after use
      axiosInstance.interceptors.request.eject(interceptorId);

      this.updateRateLimit(response.headers);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 429) {
        throw new MexcApiError('Rate limit exceeded', 429, error.response.data);
      }
      throw error;
    }
  }

  private async makeSignedRequest<T>(
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    params?: Record<string, any>,
  ): Promise<T> {
    if (!params) {
      params = {};
    }

    // Add timestamp if not present
    if (!params.timestamp) {
      params.timestamp = Date.now();
    }

    // Create query string for signature (no encoding like in official example)
    const queryString = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');

    // Create signature
    const signature = crypto
      .createHmac('sha256', this.config.secretKey)
      .update(queryString)
      .digest('hex');

    // Add signature to params
    params.signature = signature;

    return this.makeRequest<T>(method, endpoint, params);
  }

  private checkRateLimit(): void {
    const now = Date.now();
    const minuteKey = Math.floor(now / 60000).toString();

    const currentMinute = this.rateLimitTracker.get(minuteKey);
    if (
      currentMinute &&
      currentMinute.count >= 1200 - this.config.rateLimitBuffer
    ) {
      throw new MexcApiError('Rate limit buffer exceeded', 429);
    }
  }

  private updateRateLimit(headers: any): void {
    const now = Date.now();
    const minuteKey = Math.floor(now / 60000).toString();

    const current = this.rateLimitTracker.get(minuteKey) || {
      count: 0,
      resetTime: now + 60000,
    };
    current.count += 1;

    this.rateLimitTracker.set(minuteKey, current);

    // Clean old entries
    for (const [key, value] of this.rateLimitTracker.entries()) {
      if (value.resetTime < now) {
        this.rateLimitTracker.delete(key);
      }
    }
  }

  private handleApiError(error: any): MexcApiError {
    if (error instanceof MexcApiError) {
      return error;
    }

    if (error.response?.data) {
      const mexcError = error.response.data;
      return new MexcApiError(
        mexcError.msg || 'MEXC API Error',
        error.response.status,
        mexcError,
      );
    }

    if (error.code === 'ECONNABORTED') {
      return new MexcApiError('Request timeout', 408);
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return new MexcApiError('Network error', 503);
    }

    return new MexcApiError(error.message || 'Unknown MEXC API error', 500);
  }

  // Utility Methods

  isConnected(): boolean {
    return true; // Will be enhanced with actual connection tracking
  }

  getRateLimitStatus(): { remaining: number; resetTime: number } {
    const now = Date.now();
    const minuteKey = Math.floor(now / 60000).toString();
    const current = this.rateLimitTracker.get(minuteKey) || {
      count: 0,
      resetTime: now + 60000,
    };

    return {
      remaining: Math.max(0, 1200 - current.count),
      resetTime: current.resetTime,
    };
  }

  getConfig(): Partial<MexcServiceConfig> {
    return {
      baseUrl: this.config.baseUrl,
      timeout: this.config.timeout,
      maxRetries: this.config.maxRetries,
      rateLimitBuffer: this.config.rateLimitBuffer,
    };
  }
}
