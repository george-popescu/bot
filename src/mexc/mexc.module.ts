import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ConfigModule } from '../config/config.module';
import { LoggingModule } from '../logging/logging.module';
import { MexcApiService } from './services/mexc-api.service';
import { MexcWebSocketService } from './services/mexc-websocket.service';
import { MexcMockService } from './services/mexc-mock.service';
import { MexcNativeHttpService } from './services/mexc-native-http.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 3,
    }),
    EventEmitterModule.forRoot(),
    ConfigModule,
    LoggingModule,
  ],
  providers: [MexcApiService, MexcWebSocketService, MexcMockService, MexcNativeHttpService],
  exports: [MexcApiService, MexcWebSocketService, MexcMockService, MexcNativeHttpService],
})
export class MexcModule {}
