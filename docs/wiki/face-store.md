# Face store (option C) - lot A1

MiGallery is moving from Immich's face clusters to **its own store of face embeddings, with no
clustering**: buffalo_l, float16 512-d vectors, 3-5 reference embeddings per consenting member, a
match on the **minimum** cosine distance to those references. The decision, the measurements and the
lots A1-A9 are in the Canari repository's wiki page `migallery-face-matching-option-c`; this page
is what the code here does.

**Lot A1 is the foundation only: nothing reads or writes these tables yet, no route, no ML call.**
Nothing is wired into a deployment: the secret below is read by no code path today.

## What A1 contains

| File                                | Role                                                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/face-embedding.ts`         | the float16 codec (own implementation, checked against every one of the 65,536 halves), L2 normalisation, `cosineDistance`, `minDistance`, `classifyDistance`, and the constants  |
| `src/lib/server/face-seal.ts`       | AES-256-GCM sealing of a template: 12-byte nonce, ciphertext, 16-byte tag (+28 bytes); a context string is authenticated so a blob copied onto another row or model fails to open |
| `src/lib/server/face-references.ts` | add (cap 5), load (opened) and erase a member's references                                                                                                                        |
| `schema.sql`                        | `face_references` (cascade on the account, trigger holding the cap) and `face_embeddings` (sealed vector, box, score, model tag)                                                  |
| `database.ts`                       | `PRAGMA secure_delete = ON`, so a deleted row is overwritten in the file                                                                                                          |

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
Rotating it makes every sealed blob unreadable, which is also how the whole store is erased.

## Tests

`tests/face-store.test.ts` uses **synthetic seeded vectors only**: no photo, no real person's data.
It pins the codec, the distance bands at both bounds, the sealing (context, key and byte flips
refused), the cap, the cascade and `secure_delete`.

## Owed

The recall cost of float16 is NOT MEASURED; the 0.62 threshold must be re-checked on independent
ground truth before the suggested band reaches anyone. A DPO answer on a standing store of third
parties' templates precedes any production use.
