import {describe, expect, it} from 'vitest';

import {getErrorDetails} from './error-details';

describe('getErrorDetails', () => {
  it('preserves structured API error fields', () => {
    const error = Object.assign(new Error('Insufficient quota'), {
      status: 429,
      code: 'insufficient_quota',
      type: 'insufficient_quota',
      request_id: 'req_123',
      headers: {authorization: 'secret'},
    });

    expect(getErrorDetails(error)).toMatchObject({
      name: 'Error',
      message: 'Insufficient quota',
      status: 429,
      code: 'insufficient_quota',
      type: 'insufficient_quota',
      request_id: 'req_123',
    });
    expect(getErrorDetails(error)).not.toHaveProperty('headers');
  });

  it('handles non-error values', () => {
    expect(getErrorDetails('failure')).toEqual({value: 'failure'});
  });
});
