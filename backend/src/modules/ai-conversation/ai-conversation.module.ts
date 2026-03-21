import { Body, Controller, Get, Injectable, Module, Param, Post } from '@nestjs/common';
import { ok } from '../../common/http/api-response';

interface CreateConversationDto {
  topic?: string;
}

interface SendMessageDto {
  message: string;
}

interface HandoffDto {
  handoffType: 'manual_service' | 'work_order';
  reason: string;
}

interface SubmitAiWorkOrderDto {
  issueType: string;
  description: string;
}

@Injectable()
class AiToolRegistry {
  getAllowedTools() {
    return [
      'QUERY_CURRENT_SESSION',
      'QUERY_ORDER',
      'CREATE_WORK_ORDER',
      'REQUEST_HANDOFF',
      'QUERY_FAQ'
    ];
  }
}

@Controller()
class AiConversationController {
  constructor(private readonly toolRegistry: AiToolRegistry) {}

  @Post('u/ai/conversations')
  createConversation(@Body() dto: CreateConversationDto) {
    return ok({
      conversationId: 'conv_todo',
      status: 'created',
      topic: dto.topic ?? 'help'
    });
  }

  @Get('u/ai/conversations/:id')
  detail(@Param('id') id: string) {
    return ok({ id, status: 'chatting' });
  }

  @Get('u/ai/conversations/:id/messages')
  messages(@Param('id') id: string) {
    return ok({ id, items: [] });
  }

  @Post('u/ai/conversations/:id/messages')
  sendMessage(@Param('id') id: string, @Body() dto: SendMessageDto) {
    return ok({
      conversationId: id,
      replyMode: 'faq_or_tool',
      replyText: `Message received: ${dto.message}`,
      toolCalls: [
        {
          toolCode: this.toolRegistry.getAllowedTools()[0],
          resultStatus: 'success'
        }
      ],
      riskLevel: 'low',
      handoffSuggested: false
    });
  }

  @Post('u/ai/conversations/:id/handoff')
  handoff(@Param('id') id: string, @Body() dto: HandoffDto) {
    return ok({
      conversationId: id,
      handoffType: dto.handoffType,
      status: 'pending'
    });
  }

  @Post('u/ai/conversations/:id/work-orders')
  submitWorkOrder(@Param('id') id: string, @Body() dto: SubmitAiWorkOrderDto) {
    return ok({
      conversationId: id,
      workOrderId: 'wo_todo',
      issueType: dto.issueType,
      status: 'pending_accept'
    });
  }

  @Get('u/help/faqs')
  faqs() {
    return ok({ items: [] });
  }
}

@Module({
  controllers: [AiConversationController],
  providers: [AiToolRegistry]
})
export class AiConversationModule {}
