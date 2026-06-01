import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { LlmModule } from '../llm/llm.module';
import { SessionModule } from '../session/session.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ToolsModule } from '../tools/tools.module';

@Module({
  imports: [LlmModule, SessionModule, TenantsModule, ToolsModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}