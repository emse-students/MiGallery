# Face store (option C) - lot A1

MiGallery is moving from Immich's face clusters to **its own store of face embeddings, with no
clustering**: buffalo_l, float16 512-d vectors, 3-5 reference embeddings per consenting member, a
match on the **minimum** cosine distance to those references. The decision, the measurements and the
lots A1-A9 are in the Canari repository's wiki page `migallery-face-matching-option-c`; this page
is what the code here does.

**Lot A1 is the foundation only: nothing reads or writes these tables yet, no route, no ML call.**
Nothing is wired into a deployment: the secret below is read by no code path today.

## What A1 contains

| File                                | Role                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/face-embedding.ts`         | the float16 codec (own implementation, tested against the runtime's own binary16 rounding (`Math.f16round`, `DataView.setFloat16`) on 200,000 random float32 values, every tie between neighbouring halves and just beside it, the subnormals, and a fixed little-endian byte vector; every half round-trips), L2 normalisation, `cosineDistance`, `minDistance`, `classifyDistance`, and the constants                 |
| `src/lib/server/face-seal.ts`       | AES-256-GCM sealing of a template: 1-byte format version (also the key id; unknown versions refused, rotation path in the file header), 12-byte nonce, ciphertext, 16-byte tag (+29 bytes); a canonical JSON context is authenticated: a reference is bound to its MEMBER and MODEL (not to its row: one member's references are interchangeable), an embedding to its asset, face index and model (`embeddingContext`) |
| `src/lib/server/face-references.ts` | add (cap 5 per model), load (opened) and erase a member's references; erasure runs from `eraseLocalFaceData`, the single path of withdrawal, unlink and relink                                                                                                                                                                                                                                                          |
| `schema.sql`                        | `face_references` (cascade on the account, trigger holding the cap) and `face_embeddings` (sealed vector, box, score; primary key asset, face index and model)                                                                                                                                                                                                                                                          |
| `database.ts`                       | `PRAGMA secure_delete = ON`, so a deleted row is overwritten in the file                                                                                                                                                                                                                                                                                                                                                |

## The decided numbers

| Constant                                      | Value       | Meaning                                            |
| --------------------------------------------- | ----------- | -------------------------------------------------- |
| `FACE_MODEL`                                  | `buffalo_l` | the only model compared; every row carries the tag |
| `FACE_EMBEDDING_DIM`                          | 512         |                                                    |
| `FACE_MIN_REFERENCES` / `FACE_MAX_REFERENCES` | 3 / 5       | the cap is also a table trigger                    |
| `FACE_AUTO_MAX_DISTANCE`                      | 0.5         | accepted without a human                           |
| `FACE_SUGGEST_MAX_DISTANCE`                   | 0.62        | 0.5 to 0.62 is offered to the member, who confirms |

## The secret

Sealing needs `FACE_STORE_KEY`: 64 hex characters (32 bytes), held by the server alone and parsed
by `parseSealKey`, which throws on anything else rather than weaken. **It is NOT yet declared in
`docker-compose.prod.yml` or in the deployment table**, deliberately: nothing reads it, and a
required variable would stop a deploy for nothing. Lot A2 adds it where the first reader appears.
**The day the store is wired, `FACE_STORE_KEY` MUST be declared in `src/env.ts`** (kit 3 exposes only what is declared there: an undeclared variable reads `undefined`, silently) and read through `#lib/server/env.ts`; today `face-seal.ts` has no runtime reader.
Rotating it makes every sealed blob unreadable, which is also how the whole store is erased.

## Tests

`tests/face-store.test.ts` uses **synthetic seeded vectors only**: no photo, no real person's data.
It pins the codec (against the runtime's binary16, plus mutation-tested: skipping normalisation, breaking ties or endianness fails), the distance (clamped to [0, 2], only NaN is never a match, and a NaN reference is reported), the bands at both bounds, the sealing (context, key, version and byte flips refused, no context collision), the cap per model against the trigger, reference erasure on withdrawal, the cascade and `secure_delete`. `minDistance` accepts one reference: `FACE_MIN_REFERENCES` is enforced at enrolment (A2/A5).

## Changing these tables after the first release

The schema uses `CREATE ... IF NOT EXISTS`, which never applies a changed definition to a database
that already has the object. Once A1 has shipped, ANY change to `face_references`, `face_embeddings`
or `trg_face_references_cap` needs a guarded step in `ensureSchema` (database.ts). Examples: drop
and recreate the trigger when its stored SQL (`sqlite_master`) lacks `NEW.model`; rebuild
`face_embeddings` when its primary key lacks `model`.

**Developers with a local database started from commit f659c179 or fa2dcb4**: those two tables are
empty, so drop the trigger and both tables (`DROP TRIGGER trg_face_references_cap; DROP TABLE
face_references; DROP TABLE face_embeddings;`) and restart; the current schema recreates them.

## Owed

The recall cost of float16 is NOT MEASURED; the 0.62 threshold must be re-checked on independent
ground truth before the suggested band reaches anyone. A DPO answer on a standing store of third
parties' templates precedes any production use.
