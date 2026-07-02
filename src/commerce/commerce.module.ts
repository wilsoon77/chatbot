import { Module } from '@nestjs/common';
import { CryptoModule } from '../common/crypto/crypto.module.js';
import { WooCommerceClient } from '../tools/woocommerce/woocommerce.tool.js';
import { WooCommerceConnector } from './connectors/woocommerce.connector.js';
import { COMMERCE_CONNECTOR_TOKEN } from './commerce.interfaces.js';

@Module({
  imports: [CryptoModule],
  providers: [
    WooCommerceClient,
    {
      provide: COMMERCE_CONNECTOR_TOKEN,
      useClass: WooCommerceConnector,
    },
  ],
  exports: [COMMERCE_CONNECTOR_TOKEN, WooCommerceClient],
})
export class CommerceModule {}
