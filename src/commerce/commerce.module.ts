import { Module } from '@nestjs/common';
import { CryptoModule } from '../common/crypto/crypto.module.js';
import { ConnectorRegistry } from './connector.registry.js';

@Module({
  imports: [CryptoModule],
  providers: [
    ConnectorRegistry,
  ],
  exports: [ConnectorRegistry],
})
export class CommerceModule {}
