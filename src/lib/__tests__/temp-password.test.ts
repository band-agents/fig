import { describe, expect, it } from 'vitest';
import { passwordProblem, tempPassword } from '../auth/password';

describe('tempPassword', () => {
  // 24 Oct: 3 of 11 teammates in one import were not added because their password had no digit
  it('always passes the password rule', () => {
    for (let i = 0; i < 5000; i++) expect(passwordProblem(tempPassword())).toBeNull();
  });

  it('reads out in three groups of four with no look-alikes', () => {
    const pw = tempPassword();
    expect(pw).toMatch(/^[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}$/);
    expect(pw).not.toMatch(/[01oOiIlSZ258B]/);
  });
});
