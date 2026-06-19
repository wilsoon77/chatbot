import { Module } from '@nestjs/common';
import { InputGuardService } from './input-guard.service.js';
import { OutputGuardService } from './output-guard.service.js';

@Module({
  providers: [InputGuardService, OutputGuardService],
  exports: [InputGuardService, OutputGuardService],
})
export class GuardrailsModule {}
