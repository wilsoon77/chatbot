import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller.js';
import { ChatStreamController } from './chat-stream.controller.js';
import { ChatService } from './chat.service.js';
import { IntentRouterService } from './intent-router.service.js';
import { SummaryService } from './summary.service.js';
import { HistoryWindowService } from './history-window.service.js';
import { LlmModule } from '../llm/llm.module.js';
import { SessionModule } from '../session/session.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { ToolsModule } from '../tools/tools.module.js';
import { GuardrailsModule } from '../guardrails/guardrails.module.js';

@Module({
  imports: [LlmModule, SessionModule, TenantsModule, ToolsModule, GuardrailsModule],
  controllers: [ChatController, ChatStreamController],
  providers: [ChatService, IntentRouterService, SummaryService, HistoryWindowService],
})
export class ChatModule {}
