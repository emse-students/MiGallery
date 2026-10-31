import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('shutdown');

/** What a module owes the process on the way out: stop its timers, finish or abandon its work. */
interface Stopper {
  name: string;
  stop: () => void | Promise<void>;
}

const stoppers: Stopper[] = [];

/**
 * Register what must stop before the process exits. Stoppers run in registration order, each
 * isolated by its own `try`: one that throws is logged and makes the exit code 1, it never keeps
 * the others from running.
 */
export function registerShutdown(name: string, stop: () => void | Promise<void>): void {
  stoppers.push({ name, stop });
}

/**
 * Run every stopper, then return the exit code: 0 when all stopped, 1 when one threw.
 * Separate from the listener so it is testable without a process to kill.
 */
export async function runShutdown(reason: string): Promise<number> {
  log.info('shutting down', { reason, stoppers: stoppers.map((s) => s.name) });
  let code = 0;
  for (const { name, stop } of stoppers) {
    try {
      await stop();
    } catch (e) {
      code = 1;
      log.error(`shutdown step "${name}" failed`, e);
    }
  }
  return code;
}

let installed = false;

/**
 * Exit deterministically on SIGTERM/SIGINT.
 *
 * adapter-bun drains the listener on those signals and then emits `sveltekit:shutdown`, but it
 * NEVER exits: whatever still holds the event loop keeps the process alive, and `docker stop`
 * answers with a SIGKILL (137) after its grace period - possibly in the middle of a face erasure.
 * This listener is the missing half: stop the timers, wait for what is in flight, exit.
 */
export function installShutdownListener(): void {
  if (installed) {
    return;
  }
  installed = true;
  process.on('sveltekit:shutdown', (reason: unknown) => {
    void runShutdown(String(reason)).then((code) => process.exit(code));
  });
}
