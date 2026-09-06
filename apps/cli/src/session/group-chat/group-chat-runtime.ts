import type { GroupChatService } from './group-chat-service';

let activeService: GroupChatService | undefined;

export function setActiveGroupChatService(service: GroupChatService | undefined): void {
  activeService = service;
}

export function getActiveGroupChatService(): GroupChatService | undefined {
  return activeService;
}
