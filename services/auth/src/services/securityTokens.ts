import { db } from '@ai-accountant/database';
import { createHash, randomBytes } from 'crypto';

const EMAIL_VERIFICATION_TTL_HOURS = Number(process.env.EMAIL_VERIFICATION_TTL_HOURS || 48);
const PASSWORD_RESET_TTL_HOURS = Number(process.env.PASSWORD_RESET_TTL_HOURS || 2);
const MFA_CHALLENGE_TTL_MINUTES = Number(process.env.MFA_CHALLENGE_TTL_MINUTES || 5);

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateToken(bytes = 48): string {
  return randomBytes(bytes).toString('hex');
}

async function cleanupExpired(table: 'email_verification_tokens' | 'password_reset_tokens' | 'mfa_challenges'): Promise<void> {
  await db.query(`DELETE FROM ${table} WHERE expires_at < NOW() OR (consumed_at IS NOT NULL AND consumed_at < NOW() - INTERVAL '30 days')`);
}

export async function createEmailVerificationToken(userId: string): Promise<string> {
  await cleanupExpired('email_verification_tokens');
  await db.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (token_hash) DO UPDATE SET token_hash = EXCLUDED.token_hash`,
    [userId, tokenHash, expiresAt]
  );

  return token;
}

export async function consumeEmailVerificationToken(token: string): Promise<string | null> {
  const tokenHash = hashToken(token);
  const result = await db.query<{ user_id: string }>(
    `UPDATE email_verification_tokens
     SET consumed_at = NOW()
     WHERE token_hash = $1
       AND consumed_at IS NULL
       AND expires_at > NOW()
     RETURNING user_id`,
    [tokenHash]
  );

  return result.rows[0]?.user_id ?? null;
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  await cleanupExpired('password_reset_tokens');
  await db.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (token_hash) DO UPDATE SET token_hash = EXCLUDED.token_hash`,
    [userId, tokenHash, expiresAt]
  );

  return token;
}

export async function consumePasswordResetToken(token: string): Promise<string | null> {
  const tokenHash = hashToken(token);
  const result = await db.query<{ user_id: string }>(
    `UPDATE password_reset_tokens
     SET consumed_at = NOW()
     WHERE token_hash = $1
       AND consumed_at IS NULL
       AND expires_at > NOW()
     RETURNING user_id`,
    [tokenHash]
  );

  return result.rows[0]?.user_id ?? null;
}

export async function createMfaChallenge(userId: string): Promise<string> {
  await cleanupExpired('mfa_challenges');
  await db.query('DELETE FROM mfa_challenges WHERE user_id = $1', [userId]);
  const challengeToken = generateToken(24);
  const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MINUTES * 60 * 1000);

  await db.query(
    `INSERT INTO mfa_challenges (user_id, challenge_token, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, challengeToken, expiresAt]
  );

  return challengeToken;
}

export async function consumeMfaChallenge(challengeToken: string): Promise<string | null> {
  const result = await db.query<{ user_id: string }>(
    `UPDATE mfa_challenges
     SET consumed_at = NOW()
     WHERE challenge_token = $1
       AND consumed_at IS NULL
       AND expires_at > NOW()
     RETURNING user_id`,
    [challengeToken]
  );

  return result.rows[0]?.user_id ?? null;
}
