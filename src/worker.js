import { createDb } from './db.js';
import { createGemini } from './gemini.js';
import { handleApi } from './api.js';

// Entrada del Worker: la API va a D1 y a Gemini; el resto son archivos estáticos.
// Supuesto: el binding ASSETS sirve la carpeta de la interfaz. Confirmar al configurar `cf`.
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith('/api/')) {
      const db = createDb(env.DB);
      const gemini = createGemini({
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL ?? 'gemini-3.8-flash',
      });
      return handleApi(request, { db, gemini });
    }

    return env.ASSETS.fetch(request);
  },
};
