import express from 'express';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import { authenticateToken } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';
import {
  encryptIntegrationSecret,
  decryptIntegrationSecret,
} from '../lib/integrationEncryption.js';

const router = express.Router();

const GCAL_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'openid', 'email'];

function oauthEnv() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    const err = new Error('Google OAuth is not configured');
    err.statusCode = 503;
    throw err;
  }
  return { clientId, clientSecret, redirectUri };
}

function createOAuth2Client() {
  const { clientId, clientSecret, redirectUri } = oauthEnv();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function successOrigin() {
  const explicit = process.env.GOOGLE_OAUTH_SUCCESS_ORIGIN?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }
  try {
    return new URL(process.env.GOOGLE_OAUTH_REDIRECT_URI || 'http://localhost:5173').origin;
  } catch {
    return 'http://localhost:5173';
  }
}

/**
 * POST /api/integrations/google/start
 * Body: none. Returns { authorizationUrl } for the browser to navigate to.
 */
router.post('/google/start', authenticateToken, async (req, res) => {
  try {
    oauthEnv();
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: 'JWT_SECRET is not configured' });
    }

    const state = jwt.sign({ purpose: 'gcal-oauth', sub: req.user.id }, secret, {
      expiresIn: '15m',
    });

    const oauth2Client = createOAuth2Client();
    const authorizationUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GCAL_SCOPES,
      prompt: 'consent',
      state,
    });

    return res.json({ authorizationUrl });
  } catch (err) {
    const code = err.statusCode || 500;
    console.error('POST /integrations/google/start:', err.message);
    return res.status(code).json({ error: err.message || 'Failed to start Google OAuth' });
  }
});

/**
 * GET /api/integrations/google/callback
 * Must match GOOGLE_OAUTH_REDIRECT_URI and Google Console redirect URIs exactly.
 */
router.get('/google/callback', async (req, res) => {
  const origin = successOrigin();

  const redirect = (queryValue) => {
    res.redirect(`${origin}/?google_calendar=${encodeURIComponent(queryValue)}`);
  };

  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return redirect('denied');
  }
  if (!code || !state || typeof state !== 'string') {
    return redirect('error');
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return redirect('error');
  }

  let payload;
  try {
    payload = jwt.verify(state, secret);
  } catch {
    return redirect('error');
  }

  if (payload.purpose !== 'gcal-oauth' || !payload.sub) {
    return redirect('error');
  }

  const userId = payload.sub;

  try {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens) {
      return redirect('error');
    }

    let googleSub = null;
    if (tokens.id_token) {
      try {
        const ticket = await oauth2Client.verifyIdToken({
          idToken: tokens.id_token,
          audience: process.env.GOOGLE_OAUTH_CLIENT_ID,
        });
        googleSub = ticket.getPayload()?.sub ?? null;
      } catch {
        /* optional */
      }
    }

    const prisma = await getPrisma();
    const existing = await prisma.userGoogleIntegration.findUnique({
      where: { userId },
    });

    let refreshPlain = tokens.refresh_token;
    if (!refreshPlain && existing) {
      try {
        refreshPlain = decryptIntegrationSecret(existing.refreshTokenEnc);
      } catch {
        refreshPlain = null;
      }
    }

    if (!refreshPlain) {
      return redirect('no_refresh');
    }

    const refreshTokenEnc = encryptIntegrationSecret(refreshPlain);
    const accessTokenEnc = tokens.access_token
      ? encryptIntegrationSecret(tokens.access_token)
      : null;
    const accessTokenExpiresAt = tokens.expiry_date != null ? new Date(tokens.expiry_date) : null;
    const scopes = tokens.scope || GCAL_SCOPES.join(' ');

    await prisma.userGoogleIntegration.upsert({
      where: { userId },
      create: {
        userId,
        googleSub,
        refreshTokenEnc,
        accessTokenEnc,
        accessTokenExpiresAt,
        scopes,
      },
      update: {
        ...(googleSub != null ? { googleSub } : {}),
        refreshTokenEnc,
        accessTokenEnc,
        accessTokenExpiresAt,
        scopes,
      },
    });

    return redirect('connected');
  } catch (err) {
    console.error('GET /integrations/google/callback:', err.message);
    return redirect('error');
  }
});

/**
 * DELETE /api/integrations/google
 */
router.delete('/google', authenticateToken, async (req, res) => {
  try {
    const prisma = await getPrisma();
    await prisma.userGoogleIntegration.deleteMany({
      where: { userId: req.user.id },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /integrations/google:', err);
    return res.status(500).json({ error: 'Failed to disconnect Google Calendar' });
  }
});

export default router;
