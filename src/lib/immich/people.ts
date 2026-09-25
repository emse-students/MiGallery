import { OUTBOUND_BUDGET_MS } from '$lib/server/outbound';
import { createLogger } from '$lib/server/logger';

const log = createLogger('immich-people');

/**
 * One person as Immich's `GET /api/people` lists them (`PersonResponseDto`, only the fields
 * MiGallery reads).
 */
export interface ImmichPerson {
  id: string;
  name: string;
  [key: string]: unknown;
}

/**
 * One page of Immich's `GET /api/people` (`PeopleResponseDto`). The list is an OBJECT carrying
 * `people`, never a bare array - reading it as an array is what made `/api/people/people` answer
 * `{ people: { people: [...] } }`. `hasNextPage` is how the server says the page was cut at
 * `size` (default 500, maximum 1000).
 */
export interface ImmichPeoplePage {
  people: ImmichPerson[];
  total: number;
  hidden: number;
  hasNextPage?: boolean;
}

/** Immich's own upper bound for `size` on `GET /api/people`. */
const PEOPLE_PAGE_SIZE = 1000;

/**
 * Lists every person Immich recognises, following `hasNextPage` until the server says there is
 * no further page, so a library with more people than one page is never silently truncated.
 * Termination is Immich's own answer, not a page cap. Throws on a non-2xx answer or a body that
 * is not a `PeopleResponseDto`.
 */
export async function fetchAllPeople(
  fetchFn: typeof fetch,
  baseUrl: string,
  apiKey: string
): Promise<ImmichPerson[]> {
  const base = baseUrl.replace(/\/$/, '');
  const all: ImmichPerson[] = [];
  for (let page = 1; ; page++) {
    const res = await fetchFn(`${base}/api/people?page=${page}&size=${PEOPLE_PAGE_SIZE}`, {
      signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new ImmichPeopleError(res.status, await res.text());
    }
    const body = (await res.json()) as Partial<ImmichPeoplePage> | null;
    if (!body || !Array.isArray(body.people)) {
      throw new ImmichPeopleError(502, 'Immich /api/people did not answer a PeopleResponseDto');
    }
    all.push(...body.people);
    log.debug(
      `page ${page}: ${body.people.length} people, hasNextPage=${String(body.hasNextPage)}`
    );
    if (body.hasNextPage !== true) {
      return all;
    }
  }
}

/** Immich answered `GET /api/people` with an error, or with a body that is not the list. */
export class ImmichPeopleError extends Error {
  constructor(
    readonly status: number,
    detail: string
  ) {
    super(`Failed to fetch people: ${detail}`);
    this.name = 'ImmichPeopleError';
  }
}
