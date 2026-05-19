import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { LlmModule } from '../llm/llm.module.js';
import { SessionModule } from '../session/session.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { ToolsModule } from '../tools/tools.module.js';

@Module({
  imports: [LlmModule, SessionModule, TenantModule, ToolsModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
