# Face matching, option C (a sealed store of face embeddings, no clustering)

**Status (2026-10-31): BUILDING, lots A2 to A9.** The design was decided by the owner on
2026-10-24/25 and lot A1 shipped in v2.17.0 (#404). On 2026-10-31 the owner lifted the gate that
held everything after A1 until the school's DPO answered, on his own responsibility for the
controller (MiTV): _"Je prends la responsabilité en attendant le DPO, on fait tout jusqu'au
bout."_ The legal side - the DPIA and the register rows - lives in the Canari repository
(`docs/wiki/compliance/dpia-migallery-faces.md` and `register-of-processing.md`); this page is the
design, the measurements, the lots and what the code here does.

This page replaces `face-store.md` (A1) and the Canari design page `migallery-face-matching-option-c`
(Canari draft PR #2438, closed in favour of this one).

**No photo, face, embedding, name or id was kept by any measurement on this page.** Only counts and
aggregates, computed on the host in a throwaway container with no network, read-only. Every figure
is a measurement unless it says "derived" or "NOT MEASURED".

## 1. What is decided

| Question   | Decision                                                                                                                                                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model      | **buffalo_l, kept.** Its 512-d embeddings already exist for every face Immich found, so no re-embedding of the archive. Every stored vector carries the model tag.                                                                                        |
| Store      | One **float16 512-d** embedding per detected face (1 KB), sealed (AES-256-GCM), **streamed** from SQLite by the matcher, never held resident (section 2.3). **No clustering**: nothing groups faces into persons.                                         |
| References | **3 to 5 per member** (the selfie, then photos the member confirmed), sealed, never returned by any route.                                                                                                                                                |
| Match rule | **Minimum cosine distance** to the member's references; a face goes to the **nearest member only**, never to two people.                                                                                                                                  |
| Bands      | **<= 0.5 `auto`** (shown without a question). **0.5 to 0.62 `suggested`** (the member confirms or rejects). Above 0.62, nobody. Re-checked on the members' own links on 2026-10-31 (section 2.2).                                                         |
| Ambiguity  | `auto` becomes `suggested` when the runner-up member is within **0.05**, or when the member holds fewer than **3** references.                                                                                                                            |
| Seeding    | From the vectors Immich already holds (no recomputation), in physical order.                                                                                                                                                                              |
| Backups    | The embeddings of everyone (non-members included) live in their own file, `data/faces.db`, which **no backup copies**: they are recomputed from the photographs. References and matches (consenting members only) stay in `migallery.db` and its backups. |

**The price, stated plainly.** Option C is a standing store of biometric templates of people who
never asked, non-members included: what the DPIA names as its main risk (R1). It was chosen over a
match-only design (option A, hours of compute per enrolment batch) for latency and cost. What it
removes is the IDENTITY GROUPING: no cluster, no person, so nobody can be followed across the archive
without a reference of them. Withdrawal therefore deletes a member's references and matches
synchronously and completely, and the store is erasable as a whole (rotate the key, or delete
`faces.db`).

## 2. Measurements

### 2.1 Cost and accuracy of the model (2026-10-24)

Host class: 4 cores, about 7.6 GiB, no usable GPU; the model service is capped at 2 CPUs and 2 GiB.
Archive: 172,312 photos, 157,736 with at least one face (91 %), 600,082 face rows, 3.5 GB on disk
in Immich's database. 469 members, 313 linked to a person. Faces of linked persons: 108,865
(18.1 %); faces of everyone else: about 491k (81.9 %).

**One image through the model service** (200 random previews of about 2160 px, 3.9 faces per
image, 2 CPUs):

| Mode           | p50 s | p95 s | mean s | per s |
| -------------- | ----- | ----- | ------ | ----- |
| detect + embed | 0.355 | 1.072 | 0.468  | 2.14  |
| detect only    | 0.155 | 0.165 | 0.157  | 6.34  |

Detection is a constant ~0.155 s (fixed 640x640 letterbox); embedding ~0.080 s per face. The service
cannot embed a supplied box (recognition needs the detector's five landmarks). 4 CPUs give only
1.6-1.8x. **Steady state**: September peak about 417 new assets a day (3.3 min of 2-CPU time), year
average without the August re-import about 133 a day, October about 48 a day.

**Model comparison** (30 linked persons x 20 images = 547 previews, 675 positive faces, 1,865
negatives; 5 references, minimum distance; 5 draws):

| Model      | Detects pos / neg | 1e-3 false match: threshold, recall | 1e-4          | at 0.5: recall / false match |
| ---------- | ----------------- | ----------------------------------- | ------------- | ---------------------------- |
| buffalo_l  | 100 % / 100 %     | 0.720, 99.9 %                       | 0.617, 97.6 % | 84.0 % / 2.7e-6              |
| buffalo_m  | 92 % / 78 %       | 0.720, 99.8 %                       | 0.621, 98.2 % | 86.5 % / 1.3e-5              |
| buffalo_s  | 83 % / 62 %       | 0.705, 98.4 %                       | 0.649, 95.2 % | 73.0 % / 0                   |
| antelopev2 | 100 % / 100 %     | 0.690, 99.7 %                       | 0.578, 96.6 % | 89.0 % / 3.7e-5              |

Per-image cost (mean, 2 CPUs): buffalo_l 0.81 s, buffalo_m 0.68, buffalo_s 0.16, antelopev2 1.31.

### 2.2 The 0.62 threshold on the members' own links, and float16 against float32 (2026-10-31)

**Ground truth** (the owner's decision of 2026-10-31): the links consenting members confirmed
themselves - each linked member's person is THEIR faces. 316 links, 312 of which name a person
Immich still has; 310 persons with at least 8 faces were measured (faces per person p10 34, p50
239, p90 835). All 600,003 stored face vectors were read in physical order (246 s of parsing on
the host, 957 MB resident in the throwaway container).

**Protocol** (`scripts/faces/measure-ground-truth.ts`): per member, 5 references drawn from their
own faces; up to 40 other faces of theirs are the positives; every one of those faces is also a
negative for each of the 309 other members (3,603,867 negative pairs per draw). Three random draws,
plus one draw taking the 5 faces nearest the person's centroid (how lot A7 picks references). Both
sides were quantised through the production codec for the float16 figures.

| References | Positives | at 0.5: recall / false matches (per pair) | at 0.62: recall / false matches (per pair) | threshold at 1e-4, recall | at 1e-5       |
| ---------- | --------- | ----------------------------------------- | ------------------------------------------ | ------------------------- | ------------- |
| random, 1  | 11,663    | 83.8 % / 0                                | 98.1 % / 47 (1.3e-5)                       | 0.664, 99.3 %             | 0.616, 97.9 % |
| random, 2  | 11,663    | 83.6 % / 1 (2.8e-7)                       | 97.8 % / 66 (1.8e-5)                       | 0.660, 99.1 %             | 0.605, 96.8 % |
| random, 3  | 11,663    | 82.6 % / 0                                | 97.5 % / 74 (2.1e-5)                       | 0.660, 98.9 %             | 0.603, 96.3 % |
| centroid   | 11,663    | 85.7 % / 0                                | 97.6 % / 47 (1.3e-5)                       | 0.668, 99.0 %             | 0.608, 96.9 % |

- **0.62 sits at about 1e-5 false match per pair on this ground truth**, ten times better than
  the 1e-4 the 2026-10-24 sample suggested, and keeps 97.5-98.1 % recall. **The threshold stays.**
- **The nearest-member rule removes almost all of those false matches**: of the 47-74 per draw,
  the true owner was nearer in 45-69 (92-98 %). What is left is 1-5 faces in 3.6 million pairs.
- **The ambiguity margin costs nothing measurable**: of 9,627-9,990 positives accepted at <= 0.5,
  none had a runner-up member within 0.02 or 0.05. **The margin is 0.05.**
- **float16 is fixed**: across 14.5 million member-face distances the largest difference from
  float32 is 7.8e-5 (mean 1.0e-5); recall and false matches agree to the fourth decimal; ONE
  distance in 14.5 million changed band. **The format is float16.**

**At scale** (centroid references, 310 members against the 490,349 faces of persons nobody
linked, counted per member independently; the truth of these faces is NOT KNOWN - they are the
member's own faces Immich split into another cluster, or strangers): per member, `auto` p50 1, p90
7, max 47 (818 in all); `suggested` p50 11, p90 28, max 136 (4,505 in all); none within the margin
of a second member. **That is the confirmation load the suggested band puts on a member: about a
dozen faces, once.**

**Why these figures are still optimistic.** The ground truth is Immich's own buffalo_l clusters
formed at 0.5, so a positive is a face Immich already chained to the member, and a face of the
member Immich put in another cluster is counted nowhere. **NOT MEASURED**: a selfie of a different
age or light than the archive; videos; recognition without re-detection.

### 2.3 Memory and scan cost of the store (2026-10-31)

`scripts/faces/measure-store.ts`, SYNTHETIC vectors, the production codec and sealing, on the host
class (2 CPUs):

| 600,000 sealed faces                            | Measured                         |
| ----------------------------------------------- | -------------------------------- |
| SQLite file                                     | 859 MB                           |
| full scan streamed (open, decode, 5 references) | **6.5 s, peak RSS 63 MB**        |
| the same store decoded and held in memory       | 4.4 s to load, **+1,258 MB RSS** |
| open / decode 50,000 rows                       | 0.20 s / 0.13 s                  |
| write (one transaction per 50,000)              | 59.5 s                           |

**Decided: the store is streamed, never held.** An enrolment scans it once (seconds); a new photo
compares its few faces with every member's references, which is small (about 1,600 references).
Holding the store resident would cost 1.3 GB of a 3 GB container for the sake of an enrolment a
day, and keep every third party's template in the server's memory. The decoder reads a 65,536-entry
table (256 KB) built once from `halfToFloat`, which made the scan several times faster.

## 3. The lots

| Lot | Content                                                                                                                                                                                       | State                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| A1  | Schema and protection: sealed references (3-5 per member), the embedding table, the float16 codec, AES-256-GCM sealing, `secure_delete`, the thresholds, the distance.                        | shipped v2.17.0 (#404) |
| A2  | The model client (`/predict`; a selfie needs exactly one face of score >= 0.7) and the matcher: minimum distance, the bands, the nearest-member and ambiguity rules, the streamed store scan. | building               |
| A3  | Ingestion: new assets detected and embedded once into `faces.db`, durable per-asset state, retries, an hourly report naming the cause of a backlog.                                           | building               |
| A4  | The match engine: on enrolment, withdrawal and new faces, one decision function for every face; confirm and reject state.                                                                     | building               |
| A5  | Enrolment and withdrawal: the selfie embedded in memory and never stored; withdrawal deletes references and matches in one transaction.                                                       | building               |
| A6  | Read side: "Mes photos" reads the matches; the suggested band is a confirmation screen; the proxy refuses every person and face call.                                                         | building               |
| A7  | Seed from Immich's vectors (physical order, no recomputation) and migrate the existing links: references and matches per member, parity measured.                                             | building               |
| A8  | Cutover: backup of what is deleted (verified), "Mes photos" checked on the new path in production, then Immich's recognition off and its faces, persons and embeddings deleted.               | building               |
| A9  | Tests, wiki, `/cgu`, and the DPIA and register rows (Canari) updated to a stored-template design.                                                                                             | building               |

## 4. What the code does

### A1 - the codec, the sealing, the tables

| File                                | Role                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/face-embedding.ts`         | the float16 codec (tested against the runtime's own binary16 rounding on 200,000 random values, every tie, the subnormals and a fixed little-endian byte vector), L2 normalisation, `cosineDistance`, `minDistance`, `classifyDistance`, and the constants                                                             |
| `src/lib/server/face-seal.ts`       | AES-256-GCM sealing: 1-byte format version (also the key id; unknown versions refused, rotation path in the file header), 12-byte nonce, ciphertext, 16-byte tag (+29 bytes); a canonical JSON context is authenticated: a reference is bound to its MEMBER and MODEL, an embedding to its asset, face index and model |
| `src/lib/server/face-references.ts` | add (cap 5 per model), load (opened) and erase a member's references; erasure runs from `eraseLocalFaceData`, the single path of withdrawal, unlink and relink                                                                                                                                                         |
| `schema.sql`                        | `face_references` (cascade on the account, a trigger holding the cap)                                                                                                                                                                                                                                                  |
| `database.ts`                       | `PRAGMA secure_delete = ON`, so a deleted row is overwritten in the file                                                                                                                                                                                                                                               |

### A2 - the model client, the decision, the scan

| File                           | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/face-ml.ts`    | `POST {FACE_ML_URL}/predict` (Immich's model service, buffalo_l, detection floor 0.7); the answer is validated (512 finite values, a box and a score per face) or refused as `FaceMlResponseError`; a transport failure or a non-2xx is `FaceMlUnavailableError`; `selfieEmbedding` needs exactly one confident face (`SelfieRefusedError`, reason `no_face` or `several_faces`). 30 s deadline, not the 4 s outbound budget: an inference is seconds. No embedding value ever reaches a log line or an error (a test reads every line). |
| `src/lib/face-match.ts`        | `decideBand` and `decideFace`, pure: nearest member only, `auto` downgraded on a runner-up within the margin or on fewer than 3 references, a member with a corrupt reference skipped and reported, members who rejected the face excluded. Every path that decides a face calls `decideFace`.                                                                                                                                                                                                                                           |
| `src/lib/server/face-store.ts` | the key from `FACE_STORE_KEY`; every member's references opened (a member whose blob fails to open is not matched at all, never on a partial set); `scanFaceStore`, which streams `face_embeddings` 2,000 rows at a time and yields to the event loop between chunks (`bun:sqlite` is synchronous: a 6.5 s scan read in one go would freeze every request); `loadFaceEmbeddings` for chosen faces.                                                                                                                                       |

`FACE_ML_URL` and `FACE_STORE_KEY` are declared in `src/env.ts`. Nothing calls this code from a
route or a worker yet; A3 and A5 are its first callers.

### A3 - ingestion into `faces.db`

| File                            | Role                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/db/face-database.ts`   | `data/faces.db` (or `FACE_DATABASE_PATH`), opened like `migallery.db` (`openSqliteFile`: bind guard, foreign keys, `secure_delete`) plus WAL. `face_embeddings` (score NULL for a seeded face), `face_assets` (`pending` / `done` / `failed`, attempts, last error), `face_store_state` (`seeded_at`). No backup copies this file.               |
| `src/lib/server/face-ingest.ts` | discovery (`createdAfter` the last listing, minus an hour), the daily full reconciliation (every asset, trashed included; removes the faces of an asset Immich no longer has, only from a COMPLETE listing naming at least half of what is known), a pass (the Immich preview through the model, faces sealed, then decided), the hourly report. |

- **A service down stops the pass and blames no asset** (`ml_unavailable`, `immich_unavailable`);
  an answer that cannot be trusted, or a missing preview, counts one attempt; after 5 the asset is
  `failed`.
- **The report** (hourly, `face-ingest`): counts per state, the oldest pending age, the failed
  grouped by the kind of their last error, and the last stop cause. An error when the store is not
  seeded, when an asset failed, or when an asset has waited more than a day.
- **Nothing is ingested before the seed** (`seeded_at`): ingesting first would re-embed the whole
  archive, about 1.5 days of the model service, for vectors Immich already has.
- **The worker starts only when `FACE_STORE_KEY` and `FACE_ML_URL` are set**; it ticks every 10
  minutes. In production the container joins Immich's compose network (`IMMICH_DOCKER_NETWORK`,
  default `immich_default`) and reaches `http://immich-machine-learning:3003`.
- The A1 table `face_embeddings` in `migallery.db` (never written) is dropped at start when empty;
  a non-empty one is left and reported.

### A4 - the match engine

`src/lib/server/face-engine.ts` is the only writer of `face_matches` (in `migallery.db`: it
concerns members, and is backed up). Every event ends in `recordDecisions`, which re-decides each
face it is given from scratch: a CONFIRMED face is kept; a member who REJECTED it is excluded; the
holder row is replaced by `decideFace` among the rest. So the result never depends on the order of
events.

| Event                          | What the engine does                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| new photo                      | `matchNewFaces`: its faces against every member                                                                                       |
| enrolment, a reference changes | `rematchMember`: the store scanned for faces within 0.62 of the member, plus the faces they held, all re-decided against every member |
| a member answers               | `answerMatch` (`confirm` / `reject` on a face they hold), then the face re-decided (it may go to the next member)                     |
| withdrawal, account deletion   | every row of the member deleted IN the erasure transaction (`eraseFaceMatches`); the faces they held or rejected re-decided after it  |
| asset gone, asset re-embedded  | `removeAssetFaces`: its embeddings and every row naming them                                                                          |
| seed, a change of thresholds   | `rematchAll`                                                                                                                          |

Every mutation goes through `runExclusive` (one at a time: a scan yields between chunks), and a
decision is re-checked in its transaction against the member's CURRENT references, so a
withdrawal that lands during a scan is never undone by its result.

### The decided numbers

| Constant                                      | Value       | Meaning                                                     |
| --------------------------------------------- | ----------- | ----------------------------------------------------------- |
| `FACE_MODEL`                                  | `buffalo_l` | the only model compared; every row carries the tag          |
| `FACE_EMBEDDING_DIM`                          | 512         |                                                             |
| `FACE_MIN_REFERENCES` / `FACE_MAX_REFERENCES` | 3 / 5       | under 3, nothing is `auto`; the cap is also a table trigger |
| `FACE_AUTO_MAX_DISTANCE`                      | 0.5         | shown without a question                                    |
| `FACE_SUGGEST_MAX_DISTANCE`                   | 0.62        | 0.5 to 0.62 is offered to the member, who confirms          |
| `FACE_AMBIGUITY_MARGIN`                       | 0.05        | a runner-up this close makes an `auto` face `suggested`     |
| `FACE_DETECTION_MIN_SCORE`                    | 0.7         | a face stored, and a selfie's one face                      |

### The secret

Sealing needs `FACE_STORE_KEY`: 64 hex characters (32 bytes), held by the server alone, declared in
`src/env.ts` and parsed by `parseSealKey`, which throws on anything else rather than weaken.
Rotating it makes every sealed blob unreadable, which is also how the whole store is erased.

### Changing these tables after a release

The schema uses `CREATE ... IF NOT EXISTS`, which never applies a changed definition to a database
that already has the object. Once a table has shipped, ANY change to it needs a guarded step in
`ensureSchema` (database.ts).

## 5. Tests

`tests/face-store.test.ts` (A1) and `tests/face-match.test.ts` (A2 onwards) use **synthetic seeded
vectors only**: no photo, no real person's data. The measurement scripts under `scripts/faces/`
print aggregates only and are the way to re-run section 2.
