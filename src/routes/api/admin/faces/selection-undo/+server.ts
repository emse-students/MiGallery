import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireScope } from '#lib/server/permissions.ts';
import { isImpersonating } from '#lib/server/auth.ts';
import { defaultFaceEngine, runExclusive } from '#lib/server/face-engine.ts';
import {
  ledgerCounts,
  purgeSelectionLedger,
  undoReferenceSelection,
} from '#lib/server/face-reference-ledger.ts';
import { createLogger } from '#lib/server/logger.ts';
import { readJsonBody } from '#lib/server/route-errors.ts';

const log = createLogger('selection-undo-route');

async function adminEngine(event: Parameters<RequestHandler>[0]) {
  await requireScope(event, 'admin');
  if (isImpersonating(event)) {
    throw error(403, 'not while impersonating');
  }
  const engine = defaultFaceEngine();
  if (!engine) {
    throw error(503, 'the face store is not configured');
  }
  return engine;
}

/**
 * GET /api/admin/faces/selection-undo: what the ledger of the reference selection holds, as
 * counts only: `{ members, references, matches }` (src/lib/server/face-reference-ledger.ts).
 */
export const GET: RequestHandler = async (event) => {
  const engine = await adminEngine(event);
  return json({ success: true, ...ledgerCounts(engine.db) });
};

/**
 * POST /api/admin/faces/selection-undo { user_id }
 * Take one member's latest reference selection back to what the ledger kept before it ran:
 * their references and pending matches are restored, the faces the pass gave them that the
 * snapshot does not name are re-decided for everyone. Answers the counts
 * `{ version, references, matches, conflicts, redecided }`; 404 when the ledger holds nothing of
 * theirs (never run, already undone, or purged). A write on production data: it is the owner's.
 */
export const POST: RequestHandler = async (event) => {
  const engine = await adminEngine(event);
  const body = await readJsonBody<{ user_id?: unknown }>(event.request);
  if (typeof body.user_id !== 'string' || body.user_id.length === 0 || body.user_id.length > 128) {
    throw error(400, 'user_id is required');
  }
  const userId = body.user_id;
  const result = await runExclusive(() => undoReferenceSelection(engine, userId));
  if (!result) {
    log.info('selection undo asked, the ledger holds nothing of theirs');
    throw error(404, 'nothing to undo');
  }
  return json({ success: true, ...result });
};

/**
 * DELETE /api/admin/faces/selection-undo: end the undo window for everyone, deleting the whole
 * ledger (sealed biometric copies). Answers `{ deleted }`. Irreversible: the owner's call.
 */
export const DELETE: RequestHandler = async (event) => {
  const engine = await adminEngine(event);
  const deleted = await runExclusive(() => purgeSelectionLedger(engine.db));
  return json({ success: true, deleted });
};
