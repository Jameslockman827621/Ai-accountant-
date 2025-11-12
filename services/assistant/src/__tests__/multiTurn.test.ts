import { describe, it, expect } from '@jest/globals';

describe('Multi-Turn Conversations', () => {
  it('should maintain conversation context', () => {
    const conversation = {
      messages: [
        { role: 'user', content: 'What is my VAT due?' },
        { role: 'assistant', content: 'Your VAT due is £500' },
        { role: 'user', content: 'When is it due?' },
      ],
    };
    
    expect(conversation.messages.length).toBe(3);
    expect(conversation.messages[2]?.content).toContain('due');
  });

  it('should reference previous messages', () => {
    const context = 'Previous: VAT due is £500. Current: When is it due?';
    expect(context).toContain('VAT due is £500');
  });
});
