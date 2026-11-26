import { createDb } from './db.js';
import { createGemini } from './gemini.js';
import { handleApi } from './api.js';
import { handleTelegram } from './telegram.js';

// Entrada del Worker: la API va a D1 y a Gemini; el resto son archivos estáticos.
// Supuesto: el binding ASSETS sirve la carpeta de la interfaz. Confirmar al configurar `cf`.
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/telegram/webhook') return handleTelegram(request, env);

    if (pathname.startsWith('/api/')) {
      // Expose the UI while the deployment's API credentials are being configured.
      if (!env.API_TOKEN && env.CUR_ALLOW_UNAUTHENTICATED_LOCAL !== 'true') {
        return Response.json(
          { code: 'CUR_API_TOKEN_MISSING', error: 'Falta configurar API_TOKEN para acceder a los datos de CUR.' },
          { status: 503, headers: { 'Cache-Control': 'no-store' } },
        );
      }
      const db = createDb(env.DB);
      const gemini = createGemini({
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL ?? 'gemini-2.5-flash',
      });
      return handleApi(request, { db, gemini, apiToken: env.API_TOKEN });
    }

    return env.ASSETS.fetch(request);
  },
};
