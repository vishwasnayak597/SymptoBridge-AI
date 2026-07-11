import { AuthService } from '../services/AuthService';
import User from '../models/User';

const patient = {
  email: 'Pat@Test.com',
  password: 'SuperSecret123!',
  firstName: 'Pat',
  lastName: 'Lee',
  role: 'patient' as const,
};

describe('AuthService', () => {
  describe('register', () => {
    it('creates a user, lowercases the email, and returns tokens', async () => {
      const result = await AuthService.register({ ...patient });

      expect(result.success).toBe(true);
      expect(result.data?.user.email).toBe('pat@test.com');
      expect(result.data?.tokens.accessToken).toBeTruthy();
      expect(result.data?.tokens.refreshToken).toBeTruthy();
    });

    it('hashes the password at rest', async () => {
      await AuthService.register({ ...patient });
      const stored = await User.findOne({ email: 'pat@test.com' }).select('+password');
      expect(stored!.password).not.toBe(patient.password);
    });

    it('rejects a duplicate email', async () => {
      await AuthService.register({ ...patient });
      const second = await AuthService.register({ ...patient });

      expect(second.success).toBe(false);
      expect(second.error).toMatch(/already registered/i);
    });

    it('requires specialization and license for doctors', async () => {
      const result = await AuthService.register({
        ...patient,
        email: 'doc@test.com',
        role: 'doctor',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/specialization/i);
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await AuthService.register({ ...patient });
    });

    it('succeeds with correct credentials', async () => {
      const result = await AuthService.login({ email: 'pat@test.com', password: patient.password });

      expect(result.success).toBe(true);
      expect(result.data?.tokens.accessToken).toBeTruthy();
    });

    it('fails with a wrong password and does not leak which field was wrong', async () => {
      const result = await AuthService.login({ email: 'pat@test.com', password: 'wrong-password' });

      expect(result.success).toBe(false);
      expect(result.error).not.toMatch(/password only|user exists/i);
    });

    it('fails for an unknown email', async () => {
      const result = await AuthService.login({ email: 'ghost@test.com', password: patient.password });
      expect(result.success).toBe(false);
    });
  });
});
