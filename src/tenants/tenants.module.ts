import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { CryptoModule } from '../common/crypto/crypto.module';
import { CommerceModule } from '../commerce/commerce.module';

@Module({
  imports: [CryptoModule, CommerceModule],
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}