import {createExecutionContext, env, waitOnExecutionContext} from 'cloudflare:test';
import {describe, it, vi} from 'vitest';

import worker from '../src/index';

import fixtureEmail from './fixtures/amazon.eml?raw';

function messageMock(content: string): ForwardableEmailMessage {
  const raw = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(content));
      controller.close();
    },
  });

  const message: ForwardableEmailMessage = {
    from: 'evanpurkhiser@gmail.com',
    to: 'lunchmoney-details@evanpurkhiser.com',
    raw,
    headers: new Headers(),
    rawSize: content.length,
    setReject: vi.fn(),
    forward: vi.fn(),
    reply: vi.fn(),
  };

  return message;
}

describe('Email Handler', () => {
  it('processes fixture email without errors', async () => {
    const ctx = createExecutionContext();

    // Create a mock email message
    const mockMessage = messageMock(fixtureEmail);

    // Test that the email handler doesn't throw an error
    worker.email?.(mockMessage, env, ctx);

    await waitOnExecutionContext(ctx);
  });
});
