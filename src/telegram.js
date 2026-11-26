import { createDb } from './db.js';
import { parseUdemyUrl } from './udemy.js';

const MAX_UPDATE_BYTES = 64 * 1024;
const MAX_COURSES_PER_MESSAGE = 10;

function coursesFromMessage(message) {
  const candidates = [];
  for (const [text, entities] of [[message.text, message.entities], [message.caption, message.caption_entities]]) {
    if (typeof text !== 'string') continue;
    for (const entity of Array.isArray(entities) ? entities : []) {
      if (entity?.type === 'text_link') candidates.push(entity.url);
    }
    for (const match of text.matchAll(/https:\/\/[^\s<>"']+/gi)) {
      candidates.push(match[0].replace(/[),.!;\]}]+$/, ''));
    }
  }

  const courses = new Map();
  for (const candidate of candidates) {
    const course = parseUdemyUrl(candidate);
    if (!course) continue;
    const seen = courses.get(course.slug);
    if (seen ? !seen.hasCoupon && course.hasCoupon : courses.size < MAX_COURSES_PER_MESSAGE) {
      courses.set(course.slug, course);
    }
  }
  return courses.values();
}

export async function handleTelegram(request, env) {
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  const chatIds = (env.TELEGRAM_CHAT_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  if (!secret || !chatIds.length || chatIds.some((id) => !/^-?\d+$/.test(id))) {
    return new Response(null, { status: 404 });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) {
    return new Response(null, { status: 403 });
  }
  if (Number(request.headers.get('Content-Length')) > MAX_UPDATE_BYTES) return new Response(null, { status: 413 });

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_UPDATE_BYTES) return new Response(null, { status: 413 });
  let update;
  try {
    update = JSON.parse(body);
  } catch {
    return new Response(null, { status: 400 });
  }
  const message = update?.message ?? update?.channel_post;
  if (!Number.isSafeInteger(message?.chat?.id) || !chatIds.includes(String(message.chat.id))) {
    return new Response(null, { status: 204 });
  }

  const db = createDb(env.DB);
  for (const course of coursesFromMessage(message)) {
    await db.importUdemy(course, 'telegram');
  }
  return new Response(null, { status: 204 });
}
