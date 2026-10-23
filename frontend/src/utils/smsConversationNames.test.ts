import {
  conversationPhoneKey,
  mergeConversationNames,
  namesFromCustomers,
  namesFromEmployees,
  setConversationAlias,
  SMS_CONVERSATION_ALIASES_KEY,
} from './smsConversationNames';

describe('sms conversation names', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keys NANP numbers the same way with or without formatting', () => {
    expect(conversationPhoneKey('(949) 263-1500')).toBe('9492631500');
    expect(conversationPhoneKey('+1 9492631500')).toBe('9492631500');
  });

  it('maps customer and employee phones to names', () => {
    const live = {
      ...namesFromCustomers([
        {
          name: 'Stacy & Dave Taylor',
          primaryPhone: '(949) 263-1500',
          phones: ['949-401-1117'],
        },
      ]),
      ...namesFromEmployees([{ name: 'Jake', mobile: '9495550100' }]),
    };
    expect(live['9492631500']).toBe('Stacy & Dave Taylor');
    expect(live['9494011117']).toBe('Stacy & Dave Taylor');
    expect(live['9495550100']).toBe('Jake');
  });

  it('lets a saved alias win until it is cleared', () => {
    const live = { '9492631500': 'Old Name' };
    setConversationAlias('t1', '9492631500', 'Stacy & Dave Taylor');
    const aliases = JSON.parse(localStorage.getItem(`${SMS_CONVERSATION_ALIASES_KEY}.t1`) || '{}');
    expect(mergeConversationNames(live, aliases)['9492631500']).toBe('Stacy & Dave Taylor');
    setConversationAlias('t1', '9492631500', '');
    const cleared = JSON.parse(localStorage.getItem(`${SMS_CONVERSATION_ALIASES_KEY}.t1`) || '{}');
    expect(mergeConversationNames(live, cleared)['9492631500']).toBe('Old Name');
  });
});
