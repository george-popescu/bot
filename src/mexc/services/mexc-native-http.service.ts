import { Injectable } from '@nestjs/common';
import * as https from 'https';
import * as crypto from 'crypto';

@Injectable()
export class MexcNativeHttpService {
  async signedRequest({
    baseUrl,
    endpoint,
    params,
    apiKey,
    secretKey,
    method = 'POST',
  }: {
    baseUrl: string;
    endpoint: string;
    params: Record<string, any>;
    apiKey: string;
    secretKey: string;
    method?: 'POST' | 'DELETE';
  }): Promise<any> {
    // 1. Sortează parametrii și construiește query string
    const queryString = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    // 2. Calculează semnătura
    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(queryString)
      .digest('hex');
    const fullQS = `${queryString}&signature=${signature}`;
    const url = `${baseUrl}${endpoint}?${fullQS}`;
    // 3. Fă requestul fără Content-Type
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method,
        headers: {
          'X-MEXC-APIKEY': apiKey,
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(json);
            } else {
              reject(json);
            }
          } catch (e) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }
} 