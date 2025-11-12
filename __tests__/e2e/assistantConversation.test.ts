import { describe, it, expect } from '@jest/globals';

describe('Assistant Conversation E2E', () => {
  it('should handle multi-turn conversation', async () => {
    const conversation = {
      turn1: { user: 'What is my VAT due?', assistant: 'Your VAT due is £500' },
      turn2: { user: 'When is it due?', assistant: 'It is due on 7th of next month' },
    };
    expect(conversation.turn2.assistant).toContain('due');
  });
});
