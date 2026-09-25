import { describe, expect, it, vi } from 'vitest';
import { fetchAllPeople, ImmichPeopleError, type ImmichPeoplePage } from '../src/lib/immich/people';

/** One `GET /api/people` answer in the shape Immich v3 serves (`PeopleResponseDto`). */
function peoplePage(page: Partial<ImmichPeoplePage>, status = 200): Response {
  return new Response(JSON.stringify(page), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Immich people list (GET /api/people, v3 PeopleResponseDto)', () => {
  it('reads `people` out of the response object, never the object itself', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      peoplePage({
        people: [
          { id: 'p1', name: 'Alice' },
          { id: 'p2', name: '' },
        ],
        total: 2,
        hidden: 0,
        hasNextPage: false,
      })
    );

    const people = await fetchAllPeople(fetchMock as typeof fetch, 'http://immich/', 'key');

    expect(people).toEqual([
      { id: 'p1', name: 'Alice' },
      { id: 'p2', name: '' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://immich/api/people?page=1&size=1000',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'key' }) })
    );
  });

  it('follows hasNextPage until Immich says there is no further page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        peoplePage({ people: [{ id: 'p1', name: 'A' }], total: 2, hidden: 0, hasNextPage: true })
      )
      .mockResolvedValueOnce(
        peoplePage({ people: [{ id: 'p2', name: 'B' }], total: 2, hidden: 0, hasNextPage: false })
      );

    const people = await fetchAllPeople(fetchMock as typeof fetch, 'http://immich', 'key');

    expect(people.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://immich/api/people?page=2&size=1000',
      expect.anything()
    );
  });

  it("carries Immich's status when it refuses", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('nope', { status: 401 }));

    await expect(fetchAllPeople(fetchMock as typeof fetch, 'http://immich', 'key')).rejects.toEqual(
      expect.objectContaining({ name: 'ImmichPeopleError', status: 401 })
    );
  });

  it('refuses a bare array: that is not what Immich serves', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 'p1', name: 'A' }]), { status: 200 })
      );

    await expect(
      fetchAllPeople(fetchMock as typeof fetch, 'http://immich', 'key')
    ).rejects.toBeInstanceOf(ImmichPeopleError);
  });
});
