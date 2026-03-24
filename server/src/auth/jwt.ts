import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET!;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export interface JwtPayload {
  userId: number;
  username: string;
  role: 'admin' | 'user';
  color: string;
  avatarUrl: string;
}

/**
 * Sign a JWT with the given payload.
 */
export function signJwt(payload: JwtPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN as any });
}

/**
 * Verify a JWT. Returns the decoded payload, or null if invalid/expired.
 * Never throws.
 */
export function verifyJwt(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET) as JwtPayload & jwt.JwtPayload;
    return {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role,
      color: decoded.color,
      avatarUrl: decoded.avatarUrl,
    };
  } catch {
    return null;
  }
}