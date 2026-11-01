# Face matching, option C (a sealed store of face embeddings, no clustering)

**Status (2026-10-31): BUILDING, lots A2 to A9.** The design was decided by the owner on
2026-10-24/25 and lot A1 shipped in v2.17.0 (#404). The original plan held A8, and any production
use of A7, until the school's DPO answered on a standing store of third parties' templates (DPIA
R1). On 2026-10-31 the owner lifted that gate: _"Je prends la responsabilité en attendant le DPO,
on fait tout jusqu'au bout."_ The DPO's answer is still awaited (section 5). The legal side - the
DPIA and the register rows - lives in the Canari repository
(`docs/wiki/compliance/dpia-migallery-faces.md` and `register-of-processing.md`); this page is the
design, the measurements, the lots and what the code here does.

This page replaces `face-store.md` (A1) and the Canari design page `migallery-face-matching-option-c`
(Canari draft PR #2438, closed in favour of this one).

**No photo, face, embedding, name or id was kept by any measurement on this page.** Only counts and
aggregates, computed on the host in a throwaway container with no network, read-only. Every figure
is a measurement unless it says "derived" or "NOT MEASURED".

## 1. What is decided

| Question   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Who, when                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Model      | **buffalo_l, kept.** Its 512-d embeddings already exist for every face Immich found, so no re-embedding of the archive. Every stored vector carries the model tag.                                                                                                                                                                                                                                                                                                             | owner, 2026-10-24                        |
| Store      | One **float16 512-d** embedding per detected face (1 KB), sealed (AES-256-GCM). **No clustering**: nothing groups faces into persons.                                                                                                                                                                                                                                                                                                                                          | owner, 2026-10-24                        |
| Format     | float16, after measuring it against float32 (section 2.2).                                                                                                                                                                                                                                                                                                                                                                                                                     | lead agent, 2026-10-31 (1)               |
| Streamed   | The matcher **streams** the store from SQLite and never holds it resident (section 2.3).                                                                                                                                                                                                                                                                                                                                                                                       | lead agent, 2026-10-31 (1)               |
| References | **3 to 5 per member** (the selfie, then photos the member confirmed), sealed, never returned by any route.                                                                                                                                                                                                                                                                                                                                                                     | owner, 2026-10-24                        |
| Match rule | **Minimum cosine distance** to the member's references; a face goes to the **nearest member only**, never to two people.                                                                                                                                                                                                                                                                                                                                                       | lead agent, 2026-10-31 (1)               |
| Bands      | **<= 0.5 `auto`** (shown without a question). **0.5 to 0.62 `suggested`** (the member confirms or rejects). Above 0.62, nobody. 0.62 re-checked on the members' own links (section 2.2), which are NOT independent ground truth.                                                                                                                                                                                                                                               | owner, 2026-10-24; re-checked 2026-10-31 |
| Ambiguity  | `auto` becomes `suggested` when the runner-up member is closer than **0.05** (strictly).                                                                                                                                                                                                                                                                                                                                                                                       | lead agent, 2026-10-31 (1)               |
| Few refs   | No `auto` for a member holding fewer than **3** references: everything they get is `suggested`.                                                                                                                                                                                                                                                                                                                                                                                | lead agent, 2026-10-31 (1)               |
| Seeding    | From the vectors Immich already holds (no recomputation), in physical order.                                                                                                                                                                                                                                                                                                                                                                                                   | owner, 2026-10-24                        |
| Backups    | The embeddings of everyone (non-members included) live in their own file, `data/faces.db`, which **no backup copies**. References and matches (consenting members only) stay in `migallery.db` and its backups. **Cost**: after A8 Immich no longer holds the vectors, so a lost `faces.db` is recomputed from the photographs: about 172,600 assets at 2.14 per second (section 2.1) is **about 22 hours** of the model service, during which "Mes photos" shows nothing new. | owner, 2026-10-24 (DPIA)                 |

(1) Taken by the lead agent under the owner's mandate of 2026-10-31 quoted above, from the
measurements cited; open to the owner's review like every row of this table.

**The price, stated plainly.** Option C is a standing store of biometric templates of people who
never asked, non-members included: what the DPIA names as its main risk (R1). It was chosen over a
match-only design (option A, hours of compute per enrolment batch) for latency and cost. What it
removes is the IDENTITY GROUPING: no cluster, no person, so nobody can be followed across the archive
without a reference of them. Withdrawal therefore deletes a member's references and matches
synchronously and completely, and the store is erasable as a whole (rotate the key, or delete
`faces.db`). **A false match shows a member a stranger's photo**, and the nearest-member rule does
nothing for the about 82 % of faces that belong to no member: there is no rightful owner to be
nearer (section 2.2).

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
themselves - each linked member's person is THEIR faces. **It is not independent**: a linked
person is an Immich buffalo_l cluster formed at 0.5, the same model and the same persons 0.62 was
first read from (section 2.1). So positives are faces Immich already chained to the member, and
**negatives are by construction not within 0.5 of members** - the false matches below 0.5 are
undercounted for that reason alone. 316 links, 312 of which name a person
Immich still has; 310 persons with at least 8 faces were measured (faces per person p10 34, p50
239, p90 835). All 600,003 stored face vectors were read in physical order (246 s of parsing on
the host, 957 MB resident in the throwaway container).

**Protocol** (`scripts/faces/measure-ground-truth.ts`): per member, 5 references drawn from their
own faces; up to 40 other faces of theirs are the positives; every one of those faces is also a
negative for each of the 309 other members (3,603,867 negative pairs per draw). Three random draws,
plus one draw taking the 5 faces nearest the person's centroid (how lot A7 picks references). Both
sides were quantised through the production codec for the float16 figures. **Precision of the
table below: float16**; the float32 run gave the same figures at the precision shown. "False
matches" are negative pairs (a member's references against another member's face) under the
threshold; the last two columns are the threshold at which the false-match rate per pair is 1e-4,
then 1e-5, and the recall there. **Recall is inflated** by near-duplicate frames: a burst of
shots of one moment gives positives that sit next to a reference drawn from the same burst.

| References | Positives | at 0.5: recall / false matches (per pair) | at 0.62: recall / false matches (per pair) | threshold at 1e-4, recall | at 1e-5       |
| ---------- | --------- | ----------------------------------------- | ------------------------------------------ | ------------------------- | ------------- |
| random, 1  | 11,663    | 83.8 % / 0                                | 98.1 % / 47 (1.3e-5)                       | 0.664, 99.3 %             | 0.616, 97.9 % |
| random, 2  | 11,663    | 83.6 % / 1 (2.8e-7)                       | 97.8 % / 66 (1.8e-5)                       | 0.660, 99.1 %             | 0.605, 96.8 % |
| random, 3  | 11,663    | 82.6 % / 0                                | 97.5 % / 74 (2.1e-5)                       | 0.660, 98.9 %             | 0.603, 96.3 % |
| centroid   | 11,663    | 85.7 % / 0                                | 97.6 % / 47 (1.3e-5)                       | 0.668, 99.0 %             | 0.608, 96.9 % |

- **0.62 sits at 1.3e-5 to 2.1e-5 false match per pair on this ground truth**, 5 to 8 times lower
  than the about 1e-4 the 2026-10-24 sample suggested, with 97.5-98.1 % recall. The two figures
  come from different protocols, and the old one rested on 5-8 impostor pairs per draw. **The
  threshold stays.**
- **Between members, the nearest-member rule removes most of those false matches**: of the 47-74
  per draw, the true owner was nearer in 45-69 (92-98 %). What is left is 1-5 faces in 3.6 million
  pairs.
- **It does not protect against non-members.** A stranger's face has no owner among the members
  to be nearer, so every per-pair false match on it stands. Derived: 1.3e-5 to 2.1e-5 per pair x
  about 490,000 faces of non-linked persons x 310 members = **about 2,000 to 3,200 wrong
  `suggested` faces** across the members at 600k faces, before the human answer. At <= 0.5 the
  measured rate is 0 to 2.8e-7 per pair, so 0 to about 40 wrong `auto` faces by the same
  arithmetic; that figure is NOT MEASURED on strangers (section 5).
- **The ambiguity margin cost nothing on the positives**: of 9,627-9,990 positives accepted at
  <= 0.5, none had a runner-up member closer than 0.02 or 0.05. **The margin is 0.05.**
- **float16 is fixed**: across 14.5 million member-face distances the largest difference from
  float32 is 7.8e-5 (mean 1.0e-5); recall and false matches agree to the fourth decimal; ONE
  distance in 14.5 million changed band. **The format is float16.**

**At scale** (centroid references, float16, 310 members against the 490,349 faces of persons
nobody linked, counted per member independently; the truth of these faces is NOT KNOWN - they are
the member's own faces Immich split into another cluster, or strangers): per member, `auto` p50 1,
p90 7, max 47 (818 in all); `suggested` p50 11, p90 28, max 136 (4,505 in all). Of the 818 `auto` faces, **none had a
runner-up member closer than 0.02, nor closer than 0.05** (re-run 2026-10-31 at both margins: the
first run counted 0.02 only). **That is the confirmation load the suggested band puts on a member: about a
dozen faces, once.**

**Why these figures are still optimistic.** The circularity above; near-duplicate frames; and a
face of the member Immich put in another cluster is counted nowhere. **NOT MEASURED**: a selfie
of a different age or light than the archive; videos; recognition without re-detection.

**The pipeline, to re-run this section** (on the host, as root, everything under a `tmpfs`
directory of mode 700, deleted at the end; nothing leaves the host but the aggregates):

1. Build the script: `bun build scripts/faces/measure-ground-truth.ts --target=bun --outfile
   measure.js`, and copy it to `/dev/shm/fm/`.
2. The ids file - the person ids members linked themselves, read-only from MiGallery's own
   database inside its container:
   `docker exec <migallery container> bun -e '<open /app/data/migallery.db readonly; print SELECT
   photos_id FROM users WHERE photos_id IS NOT NULL>' > /dev/shm/fm/ids`, then `chmod 600`.
3. The vectors, in PHYSICAL order (an `ORDER BY` sorts the whole table, section A7), piped
   straight into a throwaway container with no network:
   `docker exec immich_postgres psql -U postgres -d immich -At -c 'COPY (SELECT
   f."personGroupId", s.embedding FROM asset_face f JOIN face_search s ON s."faceId" = f.id WHERE
   f."deletedAt" IS NULL AND f."isVisible") TO STDOUT' | docker run --rm -i --network none --memory
   2500m --cpus 2 -e LINKED_IDS_FILE=/m/ids -e SEEDS=3 -v /dev/shm/fm:/m:ro --entrypoint bun
   <the MiGallery image> /m/measure.js > result.json`
4. `rm -rf /dev/shm/fm`. **Done after both runs of 2026-10-31; the directory was checked absent
   afterwards.**

### 2.3 Memory and scan cost of the store (2026-10-31)

`scripts/faces/measure-store.ts`, SYNTHETIC vectors, the production codec and sealing, on the host
class (2 CPUs):

| 600,000 sealed faces                            | Measured                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| SQLite file                                     | 859 MB                                                                                        |
| full scan streamed (open, decode, 5 references) | **6.5 s, peak RSS 63 MB**                                                                     |
| the same store decoded and held in memory       | 4.4 s to load, **614 MB of data** (RSS grew 1,258 MB: the rest is garbage each unseal leaves) |
| open / decode 50,000 rows                       | 0.20 s / 0.13 s                                                                               |
| write (one transaction per 50,000)              | 59.5 s                                                                                        |

**Decided: the store is streamed, never held.** An enrolment scans it once (seconds); a new photo
compares its few faces with every member's references, which is small (about 1,600 references).
Holding the store resident would cost about 0.6 GB of a 3 GB container (more while it loads) for
the sake of an enrolment a day, and keep every third party's template in the server's memory.

## 3. The lots

| Lot | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | State                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| A1  | Schema and protection: sealed references (3-5 per member), the embedding table, the float16 codec, AES-256-GCM sealing, `secure_delete`, the thresholds, the distance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | shipped v2.17.0 (#404) |
| A2  | The model client (`/predict`; a selfie needs one face of score >= 0.7 and no other face down to 0.5) and the matcher: minimum distance, the bands, the nearest-member and ambiguity rules (a member who rejected the face still counts as the runner-up), the streamed store scan.                                                                                                                                                                                                                                                                                                                                                     | building               |
| A3  | Ingestion: new assets detected and embedded once into `faces.db`, durable per-asset state, retries, an hourly report naming the cause of a backlog.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | building               |
| A4  | The match engine: on enrolment, withdrawal and new faces, one decision function for every face; confirm and reject state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | building               |
| A5  | Enrolment and withdrawal: the selfie embedded in memory and never stored; the consent row (`face_consents`) is reused; withdrawal deletes references, matches and the person's crops in one transaction (the A6 thumbnails, once they exist, must go the same way).                                                                                                                                                                                                                                                                                                                                                                    | building               |
| A6  | Read side: "Mes photos" reads the matches (by user id, assets fetched by id); the suggested band is a confirmation screen with server-cut crops served to the holder alone and deleted on withdrawal; the people views are removed; the profile photo is chosen among the member's own photos; the proxy refuses every person and face call, admins included; nothing reads `photos_id`.                                                                                                                                                                                                                                               | building               |
| A7  | Seed from Immich's vectors (physical order, no recomputation) and migrate the existing links: references and matches per member, calibration, parity measured. Read cost measured 2026-10-24: 10k rows 0.60 s, 50k rows 1.31 s, so 600k is about 16-36 s of database time. **Trap**: ordering the export by id sorted the whole table (77 s for 10k rows); export in physical order.                                                                                                                                                                                                                                                   | built (not yet run)    |
| A8  | Cutover: an encrypted, verified backup of what is deleted, kept outside the repository and **deleted on a fixed date 30 days later** (owner, 2026-10-31: _"Oui, 30 jours puis supprimée"_); "Mes photos" checked on the new path in production; then Immich's recognition off and its faces, persons and embeddings deleted; the date until which the nightly backups still hold the old data recorded. MiGallery and Immich run on the association's own machine, not on the school's shared host, so **no agreement of the school's IT department is needed**; anything touching the school's shared host would still need it first. | building               |
| A9  | Tests, wiki, `/cgu`, and the DPIA and register rows (Canari) updated to a stored-template design. Built: `/cgu` sections 4 and 5 (the store of every face, the references and their sources, the two bands, who sees what, withdrawal, retention, backups, the cutover), `TERMS_VERSION` 2026-10-31, [data-model](data-model.md#the-face-tables-two-files) and [photos-cv](photos-cv.md#erasure); Canari's register row G3 and the DPIA, in Canari draft PR #2813 (emse-students/canari).                                                                                                                                              | built                  |

**One release for A5, A6, A7 and A9** (the coordinator's decision, 2026-10-31): they are merged one
by one but ship in the SAME release. A5 alone would enrol members whose matches nothing reads (A6),
over a store nothing has seeded (A7), under terms and a register that still describe the old design
(A9); none of them is cut into a release on its own.

## 4. What the code does

### A1 - the codec, the sealing, the tables

| File                                | Role                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/face-embedding.ts`         | the float16 codec (tested against the runtime's own binary16 rounding on 200,000 random values, every tie, the subnormals and a fixed little-endian byte vector), L2 normalisation, `cosineDistance`, `minDistance`, `classifyDistance`, and the constants                                                             |
| `src/lib/server/face-seal.ts`       | AES-256-GCM sealing: 1-byte format version (also the key id; unknown versions refused, rotation path in the file header), 12-byte nonce, ciphertext, 16-byte tag (+29 bytes); a canonical JSON context is authenticated: a reference is bound to its MEMBER and MODEL, an embedding to its asset, face index and model |
| `src/lib/server/face-references.ts` | add (cap 5 per model), load (opened) and erase a member's references; erasure runs from `eraseLocalFaceData`, the single path of withdrawal, unlink and relink                                                                                                                                                         |
| `schema.sql`                        | `face_references` (cascade on the account, a trigger holding the cap) and `face_embeddings` (sealed vector, box, score; primary key asset, face index and model) - in `migallery.db`, never written by any code path                                                                                                   |
| `database.ts`                       | `PRAGMA secure_delete = ON`, so a deleted row is overwritten in the file                                                                                                                                                                                                                                               |

**Where the embeddings live.** A1 created `face_embeddings` in `migallery.db`; the decision above
puts them in `data/faces.db`, outside every backup. Lot A3 makes the move under the rule below: the
table has never held a row (no code path writes it), so its guarded step drops it from
`migallery.db` when it is EMPTY and leaves it, reporting an error, when it is not.

### A2 - the model client, the decision, the scan

| File                           | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/face-ml.ts`    | `POST {FACE_ML_URL}/predict` (Immich's model service, buffalo_l, detection floor 0.7). Failures are typed where they are thrown: a transport failure, a non-2xx, a timeout or a body that cannot be read is `FaceMlUnavailableError` (the service); text that does not parse, a wrong shape, a wrong length, a non-finite value or an all-zero vector is `FaceMlResponseError` (the answer). `selfieEmbedding` searches at the bystander floor 0.5 and refuses any second face (`several_faces`), then needs the one face at 0.7 (`no_face`): a bystander can never become a reference. 30 s deadline, not the 4 s outbound budget: an inference is seconds. No embedding value ever reaches a log line or an error (a test reads every line). |
| `src/lib/face-match.ts`        | `decideBand` and `decideFace`, pure: nearest member only; `auto` downgraded on a runner-up closer than the margin (strictly) or on fewer than 3 references; a member who REJECTED the face is never offered it but still counts as the runner-up, so a face one member rejected at 0.20 never goes `auto` to the next at 0.40; a member with a corrupt reference skipped and reported; a face that is not a usable vector matches nobody and is reported ONCE, as the face's fault. Every path that decides a face calls `decideFace`.                                                                                                                                                                                                         |
| `src/lib/server/face-store.ts` | the key from `FACE_STORE_KEY`; every member's references opened (a member whose blob fails to open is not matched at all, never on a partial set); `scanFaceStore`, which streams `face_embeddings` 2,000 rows at a time and yields to the event loop between chunks (`bun:sqlite` is synchronous: a 6.5 s scan read in one go would freeze every request); `loadFaceEmbeddings` for chosen faces. The float16 decoder reads a 65,536-entry table (256 KB) built once from `halfToFloat`: measured on 50,000 vectors (2026-10-31, a development machine), 66-135 ms against 597-816 ms.                                                                                                                                                        |

Its callers are the ingestion worker (A3), the match engine (A4) and enrolment (A5).

- **The margin's floating-point edge.** The test is `runnerUp - distance < 0.05` on doubles. At a
  gap of exactly 0.05 the subtraction may round either way, by about 1e-17: below, the face is
  downgraded to `suggested` (the member is asked, the safe side); above, it stays `auto` on a gap
  that differs from the margin by far less than the float16 store's own precision (about 1e-3).
  No decision rests on that last digit.
- **A member whose reference fails to open is dropped from the whole decision**, as the nearest
  AND as the runner-up: a face that member would have made ambiguous can then go `auto` to the
  next one. The failure is reported (`invalidReference`, one error line per member) and is a
  fault of the store or its key, to be fixed there, never decided around.

### A3 - ingestion into `faces.db`

| File                            | Role                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/db/face-database.ts`   | `data/faces.db` (or `FACE_DATABASE_PATH`), opened like `migallery.db` (`openSqliteFile`: bind guard, foreign keys, `secure_delete`) plus WAL. `face_embeddings` (score NULL for a seeded face), `face_assets` (`pending` / `done` / `failed`, attempts, last error), `face_store_state` (`seeded_at`). No backup copies this file.                              |
| `src/lib/server/face-ingest.ts` | discovery (`createdAfter` the last listing, minus an hour), the daily full reconciliation (every asset, trashed included; an asset's faces go once it is missing from TWO consecutive complete listings naming at least half of what is known), a pass (the Immich preview through the model, faces sealed, decided, THEN the asset `done`), the hourly report. |

- **Every failure is classified where it is thrown.** A service down - a refusal, a transport
  failure, a timeout, a body that cannot be read or parsed, from Immich or the model - stops the
  pass and blames no asset (`ml_unavailable`, `immich_unavailable`). An answer that cannot be
  trusted (an all-zero vector included), or any other error on one asset, counts one attempt and
  the pass goes on; after 5 the asset is `failed`. A tick that fails otherwise reports `error`.
- **A missing preview is no attempt.** Immich makes previews in a queue that lags behind uploads,
  so a 404/400 on the preview leaves the asset pending, counts nothing and only moves its
  `updated_at`; a pass takes the least recently tried assets first, so such assets never take a
  whole pass. One that never gets a preview shows in the hourly report as pending for over a day,
  and an asset DELETED from Immich goes through the reconciliation, never on this status.
- **`done` means decided**: an asset is marked `done` after its faces are written AND decided; a
  decision that throws leaves it pending, written and decided again by the next pass.
- **A face is decided on the vector the store holds** (the float16 round-trip), so ingestion and
  any later rescan give the same distance.
- **Deletion needs two witnesses, at least 20 hours apart.** One complete listing that misses an
  asset only marks it (`absent_listings`); a listing that names it again clears the mark; its
  faces go when two consecutive COUNTING listings miss it, then the WAL of `faces.db` is
  checkpointed (TRUNCATE) so the deleted vectors do not linger there. A listing counts absences
  only when `face_store_state.last_counted_listing_at` is at least 20 hours old - durable state,
  not the process's memory: every process start lists in full, so two deploys or a crash loop
  would otherwise be two witnesses within minutes. A listing that does not count still adds the
  new assets and clears the marks of what it names. A listing that hit its page cap, or names
  under half of what is known, counts nothing.
- **What the listing covers, checked on the live server (read-only, 2026-10-31)**: the library
  has ONE owner, the key's; `search/metadata` with `withDeleted` lists every asset, the trashed
  ones included (172,614 + 3). Items in the LOCKED folder need an elevated session and are not
  listed (0 today): a locked asset is treated as gone and its faces go, which matches what locking
  means. A second Immich user's assets would never be listed, so never ingested and never removed.
- **The report** (hourly, `face-ingest`): counts per state, the oldest pending age, the failed
  grouped by the kind of their last error, the pending ones already tried grouped the same way
  (`no_preview` names an asset Immich never made a preview for, which no attempt count would), and
  the last stop cause. An error when an asset failed
  or an asset has waited more than a day. An unseeded store is said at info: it is the planned
  state until A7.
- **Nothing is ingested before the seed** (`seeded_at`): ingesting first would re-embed the whole
  archive, about 22 hours of the model service, for vectors Immich already has.
- **The worker starts only when `FACE_STORE_KEY` and `FACE_ML_URL` are set**; a malformed key turns
  the feature off with one error and never stops the gallery. It ticks every 10 minutes. In
  production MiGallery reaches `http://immich-machine-learning:3003` over `migallery-face-ml`, an
  internal network holding those two containers only (owner, 2026-10-31: _"Réseau dédié à deux"_;
  what that exposes is in [data-model](data-model.md); the host side in `docs/MIGRATION.md`).
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

Every mutation runs inside `runExclusive` (one at a time: a scan yields between chunks), and each
mutating function CHECKS it holds the lock and throws otherwise. The one write outside it is a
member's erasure, which must be synchronous; so each batch of decisions re-reads the references
when they changed since the decision began (a fingerprint of each reference's member, id AND seal
nonce: ids are reused after a withdrawal, a nonce never is), and a withdrawal that lands during a
scan is never undone by its result.

A withdrawal re-decides only the faces that have a row of the member: those they HELD, and those
they REJECTED (that exclusion goes with them). A face where they were only the RUNNER-UP has no
row of theirs and keeps its holder's decision as it was: if their closeness had downgraded it to
`suggested`, it stays `suggested` (the holder is asked, the safe side) until the next re-decision
of that face (the holder's enrolment changing, the face re-embedded, or a `rematchAll`). Scans decide in flushes of 2,000 faces. A
member who keeps a face keeps its `created_at`. A face that is not a usable vector is reported
once, as the face's fault.

### A5 - enrolment, answers, withdrawal

| File                                                | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/api/users/me/face/enrolment/+server.ts` | `POST` (multipart `selfie` + `consent=true`): the picture is read in memory and handed to the model service, NEVER stored, never sent to Immich; its one face is sealed as the member's `selfie` reference (a new selfie replaces the old one; at the cap without one, the oldest reference makes room), the consent recorded in `face_consents` (the A1 row, reused: one open row per member, with the terms version; the ticked agreement CLOSES an open `legacy` or `admin` row, or a `selfie` row on older terms, and opens a `selfie` row on `TERMS_VERSION` in the same transaction as the reference - an open `selfie` row on the terms in force is kept, so a re-enrolment churns nothing; an admin link never replaces an open row), then the store re-matched for the member in the background, coalesced. 400 without the agreement, 413 over 15 MB, 429 past 10 selfies an hour per member (in-process window, counted before the model is called, a warning), 422 `no_face` / `several_faces`, 422 `selfie_unreadable` when the model refuses the picture itself (400/413/415/422, a warning), 503 when the model does not answer (a 5xx, a transport failure, or a 4xx not about the picture: 401/403/404/405/408/429); nothing is stored on any refusal. `GET`: `{ enrolled, references }`, never a reference. |
| `src/routes/api/users/me/face/matches/+server.ts`   | `POST { asset_id, face_index, verdict }`: the member's answer on a face they hold (404 otherwise). A confirmation TEACHES while they hold under 5 references AND the face lies within `FACE_AUTO_MAX_DISTANCE` (0.5, inclusive, the matcher's own constant) of a reference they already hold: its embedding becomes a `photo` reference and the store is re-matched for them in the background (the request never awaits a scan), so a member who started from one selfie reaches the 3 references `auto` asks for by answering. A confirmed face in the `suggested` band (0.5 to 0.62) stays confirmed and shown but is NEVER learned: a reference learned there would widen the member's reach towards a lookalike, who would then be followed from photo to photo. A rejection hands the face to the next member at once.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/lib/server/face-enrolment.ts`                  | `enrolMember`, `answerFace` (inside the engine's lock), `learnable`, `scheduleRematch` (a `CoalescingQueue`, face-engine.ts: at most one re-match QUEUED per member; a request while one is queued joins it, one while it RUNS queues exactly one more, so N enrolments cost at most two scans and the last references are always matched), `enrolLimiter` (`src/lib/server/rate-limit.ts`), `referenceCount`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/routes/parametres/+page.svelte`                | the enrolment screen: an explicit agreement box (linking the biometric section of the terms) before the camera opens, then one request; the old flow - upload the selfie to Immich, wait for its clustering, link the person, delete the upload - is gone from the screen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

- **Withdrawal is the A1 path, whatever the link state**: `PATCH /api/users/me/face` with a null
  person runs `eraseLocalFaceData` for a member enrolled by selfie alone too, so the consent
  closes and the references and matches go in ONE transaction; the faces they held are
  re-decided after the commit. Account deletion is the same path.
- **Crops**: the crops of a linked Immich person are deleted with the withdrawal (A1); the A6
  confirmation pictures are deleted in the same path (see A6).
- Impersonation can neither enrol, answer nor withdraw.

### A6 - the read side

**What a member's photos are.** The faces they hold in `face_matches` that are not rejected and
are `auto` or confirmed by them: `VISIBLE_MATCH_SQL` in `src/lib/server/face-photos.ts`, the one
spelling every reader uses (the photo list, the profile photo, the avatar, `avatar-presence`).
A `suggested` face waiting for their answer is not one of their photos until they say yes.

| File                                                                  | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/face-photos.ts`                                       | `memberPhotoAssetIds`, `pendingSuggestions`, `shownFaces`, `holdsFace`, `profileFace`, `faceStatus`, `memberPhotoAssets` (the ids from the matches, the assets from Immich BY ID, the PhotoCV partition, images only, newest first).                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/lib/server/immich-search.ts`                                     | `searchAssetsByIds`: `POST /api/search/metadata` with `filter.or` of `id.eq`, 250 ids per request, size 251, no `page` (Immich refuses one with a `filter`). **The answer is checked**: an asset not asked for, or more results announced (`nextCursor`, `nextPage`), throws 502 and nothing of the batch is used - an Immich that ignored the filter would otherwise show a member a page of someone else's photos. Every failure is classified there and none is the member's: Immich not configured 503, an Immich error status (a 4xx included: it refuses OUR request) or an unreadable answer 502, no answer in time 504, unreachable 502; Immich's text is logged, never sent. |
| `src/routes/api/users/[userId]/photos-stream/+server.ts`              | A member's photos as NDJSON (`in_album=false` "Mes photos", `true` "Mes photos CV", none = every photo, for the picker), behind `requireMemberPhotosAccess` (owner, authorised member, admin, API key).                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/routes/api/users/me/face/matches/+server.ts`                     | `GET`: the faces waiting for the member's answer as `{ asset_id, face_index }` - no distance, band, runner-up or other member. Answered by the A5 `POST`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/routes/api/users/me/face/crops/[assetId]/[faceIndex]/+server.ts` | The picture of one face the member holds NOW, cut from the `faces.db` box (`loadFaceBox`) out of the Immich preview; `private, no-store`. 404 for a face they do not hold (whoever does), 403 impersonated, 401 for an API key.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/lib/server/face-crop.ts`                                         | `generateMemberFaceCrop` caches in `data/cache/faces/members/<sha256(id)[0:32]>/<asset>_<face>.webp` and re-checks, after the write, that the face is still held (a withdrawal racing the cut leaves no file). `deleteMemberFaceCrops` (withdrawal, account deletion) and `deleteMemberFaceCrop` (a "not me") never throw.                                                                                                                                                                                                                                                                                                                                                            |
| `src/routes/api/users/me/profile-photo/+server.ts`                    | `PUT { asset_id, user_id? }`: the profile photo, only among the member's own photos (404 otherwise); `user_id` for another member is an admin's (403 otherwise); refused impersonated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/routes/api/users/[username]/avatar/+server.ts`                   | Cut around the member's lowest visible face in the chosen photo; 404 when there is none (the Immich person thumbnail fallback is gone).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/routes/api/immich/[...path]/+server.ts`                          | `assertNoProxiedFaceCall` for EVERY caller: people/faces/search-person paths and any `personId*` / `withPeople*` query or body key are 403. A JSON answer loses `people` / `unassignedFaces` (`stripFaceFields`); one that names them and does not parse is a 502.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/routes/mes-photos/+page.svelte`, `mes-photos/confirmer/`         | "Mes photos" by user id (yours, or a member who granted you); an invitation to enrol when you have no face; a banner to the confirmation screen, which shows each face's crop with "C'est moi" / "Pas moi"; a link to the same screen with `?list=shown`, "Pas moi" alone on the faces shown without a question.                                                                                                                                                                                                                                                                                                                                                                      |

**What each people view became.**

| Before (Immich person)                                                                 | After A6                                                                                        |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/api/people/people` (the Immich directory)                                            | deleted                                                                                         |
| `/api/people/people/[personId]/photos`, `/photos-stream`                               | `/api/users/[userId]/photos-stream`                                                             |
| `/api/people/person/[id]/my-photos`, `/album-photos`, `?action=my-photos/album-photos` | `/api/users/[userId]/photos-stream?in_album=false/true`                                         |
| `/api/faces/**`, `/api/immich/people/**`, `/api/immich/faces/**`                       | deleted / refused to everyone                                                                   |
| profile photo picker: the person's photos, `featureFaceAssetId`                        | the member's own photos; `PUT /api/users/me/profile-photo` writes `photos_asset_id` only        |
| admin users page: upload a photo, link an Immich person                                | "face recognition on/off" (`faceStatus`) and a withdraw button (the `PATCH` with a null person) |
| `/photos-cv` for a member: their person's CV photos                                    | their own photos in the PhotoCV album; a member who never enrolled is sent to `/mes-photos`     |
| session `photos_id`                                                                    | session `face_enrolled`                                                                         |

**`photos_id` is read by nothing.** The column and its data stay for A7. Retired as dead code:
`selfieProves` and the member branch of the person link (a member's `PATCH` naming a person is
now 400 `person_link_retired`), `findPersonOwner`, `assertPersonAccess`, `assertPersonOwner`,
`requireFaceAdmin`, the Immich face lookup of the old crop. An admin can still link and, above
all, unlink or withdraw for a member (the same `PATCH` with `user_id`, `PUT /api/users/[id]`, the
admin users page); a role change no longer sends `photos_id` at all (it used to send a null,
which erased a selfie-only member's face data).

**Decisions taken here, conservatively** (none blocked):

- The profile photo picker shows plain thumbnails of the member's photos, not face crops: a
  crop is cut per face for its holder, and the picker only needs the photo.
- An admin no longer enrols a member from the admin page (enrolment is the member's own act and
  consent); the admin keeps the withdrawal.
- The suggestions list, the crops and the profile photo refuse an impersonated session, like
  every other face act.
- A crop of a face the engine later gives to someone else, or to nobody, is deleted from the
  former holder's directory as soon as that decision is committed (`recordDecisions`); the route
  also checks the hold on every request. The profile photo is cut into the same file.
- Videos stay out of "Mes photos", as before (images only).

### A7 - the seed

| File                                         | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/face-seed.ts`                | the phases. `begin` refuses a seeded store (`seeded_at`), wipes a partial run (its faces, assets, matches, the references a failed finish wrote, its counters) and returns a fresh RUN TOKEN; `assets` writes every asset face recognition ran on `done` (source `seed`, 0 faces) and counts them durably; `faces` seals each face under the next index of its asset (score NULL), notes a face of a LINKED person in the working table `face_seed_links`, and counts a face that is not a usable vector durably; `finish` checks the export arrived whole, does the rest, then drops the table and writes `seeded_at`. Its dry run writes nothing. |
| `src/routes/api/admin/faces/seed/+server.ts` | `POST`, admin scope, never an impersonated session, every field checked; at most 2,000 faces or 20,000 asset ids a request; `finish` answers 202 at once. `GET ?run=<token>` polls the finish, same access. A refusal is a 409 naming the reason. Answers counts only.                                                                                                                                                                                                                                                                                                                                                                              |
| `scripts/faces/seed-client.mjs`              | reads the count line and the two COPY exports on stdin, posts them in batches, runs the dry run and prints its report, then (without `--dry-run`) the real finish and its report. Nothing touches the disk unsealed.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `claimFace` in `face-engine.ts`              | makes a member the CONFIRMED holder of a face they designated by another act than an answer; replaces a pending holder, never an answer (a face another member confirmed, one this member rejected), and needs usable references.                                                                                                                                                                                                                                                                                                                                                                                                                   |

**One run, one token.** `begin` writes a random token in `face_store_state` (`seed_run`) and
answers it; `assets`, `faces`, `finish` and the poll carry it. A phase with another token is
refused `stale_run` (none at all is a 400), so a second `begin` - another operator, a client
restarted - cuts the first client off: its later batches cannot land in the new run, and it can
never seal a partial seed.

**A truncated export is never sealed.** The export's FIRST line is `C <assets> <faces>`, counted
by Immich in the same read-only REPEATABLE READ transaction as the two COPYs, so the three see one
snapshot. The client sends those counts with `finish`, which is refused `incomplete` (409, nothing
written, `seeded_at` unset, so a rerun from `begin` works) unless they equal what the server
durably received: the asset ids of the `assets` phase (`seed_assets_received`), and the faces
stored plus the faces refused as unusable (`seed_unusable`). A COPY that fails half-way ends the
stream early: the counts differ, and nothing is sealed. A stream without its `C` line makes the
client exit non-zero before any finish. The received assets are a counter rather than a count of
`seed` rows, because the `faces` phase also writes the row of an asset it meets without one.

**The finish runs in the background.** It takes minutes (two scans of 600,000 faces, then
`rematchAll`), longer than the server keeps an idle connection open (Bun's default `idleTimeout`,
10 s, which the production compose does not raise). `POST finish` checks the run and the counts,
records `running` in `face_store_state` (`seed_finish`, with the run token and the id of the
process running it) and answers 202; the work runs under the engine lock and writes its end inside
the lock: `done` with the aggregate report (in the same transaction as `seeded_at` for the real
finish), or `failed` with a classified reason (a refusal's reason, or `error`). The client polls
`GET ?run=<token>` every 5 s until `done` or `failed`. A `running` status recorded by ANOTHER
process id was cut by a restart - nothing in this process can end it - so the poll reports and
records it `failed` / `interrupted`: a poll always ends, and nothing was sealed. While a finish
runs, `begin` and a second `finish` are refused `finish_running` (taking the lock would wait out
the whole finish).

**The dry run** (`finish` with `dryRun: true`) makes the same checks and the same reference
selection, and reports the faces, the assets, the unusable faces, the linked members, how many of
them hold an open consent, how many would get references and the histogram of how many each would
get (within the room left under the cap of 5). It writes no reference, no match, no claim, no
`seeded_at`, keeps the working table, and records only its own status, so the real finish can
follow on the same run.

`finish`, in order:

1. **References from the links.** Two streamed scans of the store: the centroid of each linked
   person, then the 5 faces nearest it. A member gets them as `seed` references (told apart from
   `photo`, a face the member confirmed, so a failed finish's are wiped by the next `begin` and no
   member's are) in a transaction that re-reads, at that moment, that they are still linked to
   that person AND hold an open consent: a withdrawal during the seed (synchronous, outside the
   engine lock) is never undone. A member who enrolled by selfie keeps it; the cap fills the rest.
2. **Every face decided** (`rematchAll`).
3. **The profile photos carried over**: a member whose chosen `photos_asset_id` holds a face of
   their own linked person gets that face `confirmed` (`claimFace`), so the A6 avatar keeps
   working. A face of someone else's person on that photo is left alone (`not_their_face`).
4. **Parity, aggregates only**: each linked person's faces against the decision (shown, offered,
   given to another member, matched to nobody) and the per-member share shown (p10/p50/p90). No id
   leaves the server, in the log or the answer.

**The run** (as root on the host, in bash, once the release carrying A1-A7 is deployed; an admin
API key in `MIGALLERY_ADMIN_KEY`, created with `scripts/create-api-key.cjs` and revoked
afterwards). First with `--dry-run`, whose report is read; then the same command without it, which
streams again, prints the dry run's report again, then seals and prints the final report:

```sh
set -o pipefail
docker exec immich_postgres psql -U postgres -d immich -At -q -v ON_ERROR_STOP=1 -1 \
  -c "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY" \
  -c "COPY (SELECT 'C',
              (SELECT count(*) FROM asset_job_status WHERE \"facesRecognizedAt\" IS NOT NULL),
              (SELECT count(*) FROM asset_face f JOIN face_search s ON s.\"faceId\" = f.id
                 WHERE f.\"deletedAt\" IS NULL AND f.\"isVisible\")) TO STDOUT" \
  -c "COPY (SELECT 'A', \"assetId\" FROM asset_job_status WHERE \"facesRecognizedAt\" IS NOT NULL) TO STDOUT" \
  -c "COPY (SELECT 'F', f.\"assetId\", f.\"personGroupId\", f.\"imageWidth\", f.\"imageHeight\",
              f.\"boundingBoxX1\", f.\"boundingBoxY1\", f.\"boundingBoxX2\", f.\"boundingBoxY2\", s.embedding
            FROM asset_face f JOIN face_search s ON s.\"faceId\" = f.id
            WHERE f.\"deletedAt\" IS NULL AND f.\"isVisible\") TO STDOUT" \
| docker exec -i -e MIGALLERY_ADMIN_KEY <migallery container> bun scripts/faces/seed-client.mjs --dry-run
echo "exit: $?"
```

`set -o pipefail` makes the pipeline fail when psql fails, not only when the client does; the
server's count check is what keeps a truncated export unsealed either way. `-q` keeps psql's
command tags (`SET`, `COPY n`) out of the stream: the client refuses any line that is not `C`, `A`
or `F`, and a first line that is not `C`.

No `ORDER BY`: it would sort the whole table (section 3, A7 row). Read on the live server
(read-only, 2026-10-31): 172,617 assets, 172,612 with face recognition run (the other 5 are
ingested by the worker once seeded), 600,003 visible faces; the person column is
`personGroupId` in Immich v3. A failed run is run again from the start (`begin` wipes it).

**Before the real run, and what a re-run costs.**

- **Backup first**: a copy of `migallery.db` (`sqlite3 migallery.db ".backup '<copy>'"`), taken
  right before the run without `--dry-run`. The seed writes only additions there (`seed`
  references, matches, the claimed profile faces); `faces.db` is the store the run rebuilds, and
  before `seeded_at` it holds no face of a member's (ingestion waits for the seed), so it needs
  no copy - and it stays in no backup afterwards (the `Backups` decision above).
- **The second `begin` wipes the dry run's store** (about 600,000 sealed rows, under
  `secure_delete`) in the request. If that outlasts the server's idle timeout, the client stops
  with `seed failed: begin: ...` while the wipe completes on the server; running the same command
  again starts cleanly (`begin` is idempotent before `seeded_at`).
- **A re-run from `begin` drops every match**, including answers members gave on a finish that
  was cut after `rematchAll`, and the crops cut from those faces (a re-run may give the same
  `(asset, index)` to another face). Run the seed straight after the deploy, before members use
  the confirmation screen.
- **Rollback**: before `seeded_at`, a new `begin` (or nothing: the app reads an empty store). After
  it, there is no supported undo: stop the container, restore the `migallery.db` copy and delete
  `faces.db` with its `-wal` and `-shm` (it is recreated empty and unseeded) - which also drops whatever members did since
  the copy, so it is for a parity report that is plainly wrong, read before anyone uses the pages.

### The default profile photo (hotfix, 2026-11-01)

**The regression.** Before A6 a member who never picked a profile photo still had an avatar: the
avatar route fell back to Immich's thumbnail of their person (`/api/people/<photos_id>/thumbnail`),
the face Immich FEATURED for it. A6 removed every person call, so every member who never chose
showed initials. In production only 110 members had `photos_asset_id` set (96 carried over by the
A7 seed as `claimed`, 14 whose photo Immich no longer serves).

**The rule** (owner, 2026-11-01), in `src/lib/server/profile-photo-default.ts`:

- A profile photo is VALID while it is a visible match of the member's (`profileFace`) AND Immich
  still has the asset. A CHOSEN photo is checked by reading the asset itself
  (`assetStillExists`, `GET /api/assets/{id}`): an archived, hidden or locked photo is present
  (a search applies its default visibility and would leave it out), only a deleted (404/400) or
  trashed (`isTrashed`) one is gone, and an unknown answer is never read as gone. A default is
  checked by the search alone (it may be replaced by a better one anyway).
- `users.photos_asset_source` says `chosen` (the picker's `PUT`, the member or an admin for them)
  or `default`. Every photo set before the column existed is `chosen`. **A valid choice is never
  overwritten**; a valid default may be replaced by a better default; an INVALID choice (its photo
  is gone) is replaced by a default, since there is nothing left to keep.
- The default, in order:
  1. **the face Immich featured** for the member's old person, when the one-off run hands it in,
     Immich still has the photo, AND that exact face is already one of THIS member's visible
     matches (`VISIBLE_MATCH_SQL`): the photo they had before A6. It is found among the faces the
     store holds on that photo by box overlap (>= 0.5, frames scaled), never by an Immich face id.
     **Never a claim** (lead, review of #433): this runs unattended, so it never calls
     `claimFace`, never writes `confirmed`, never moves a face from another member. A featured
     face held by another member, or waiting for the member's own answer, is passed over (counted
     `featuredNotTheirs`) and the member gets rule 2;
  2. else the best of their visible matches (`src/lib/profile-photo-rank.ts`): confirmed before
     `auto`; nearer to their references by steps of 0.05; the larger face (box area over image
     area); the detector's score (none for a seeded face, ranked after); a single-face photo; the
     more recent capture date; the asset id, then the face index. The first 25 are checked
     against Immich in one search, the first one alive wins.
- **When it is re-evaluated.** The one-off run below; and whenever the avatar route finds no valid
  photo (none set, no longer theirs, or Immich no longer serving it), which looks for a default in
  the background (never awaited, at most one per member at a time, on the GLOBAL fetch since the
  work outlives the request) and answers 404 this once. A
  member with no visible match at all costs no Immich call. Faces v2 adds the renewal of references
  as a trigger.
- Every decision is logged at info without an id; the run logs its aggregate.

**The picker** (`ChangePhotoModal`) shows the member's FACE in each photo, cut by the same tile as
the confirmation screen (`FaceCropThumb`, which loads crops a few at a time: the cause of the empty
tiles, below), in the photos' own order (newest first, never ranked: owner, 2026-11-01), only the
photos with a visible face of theirs, the current one ringed and badged ("Actuelle", or "Par défaut"
for a default; the badge wraps rather than being cut on a phone tile). The current photo sits beside
the hint at every width, so the grid stays in view (three columns from 360 px). `GET /api/users/me/profile-photo[?user_id=]` gives it the faces
and the current photo. An admin picking FOR another member sees whole photos: a face crop is served
to its holder alone (A6). The dialog's height is the visible viewport (`dvh`), so on a phone the
"Valider" button no longer sits below the screen with the grid scrolling under it.

**The empty tiles of the confirmation screen**, the same cause the picker would have met: every
tile was a plain lazy `<img>`, so the browser asked every visible crop AT ONCE; an uncached crop is
cut under the ONE Sharp pool every image endpoint shares (`sharp-limit.ts`: 4 running, 12
waiting), and the 17th request at once is refused with 503 `busy`. The `<img>` saw an error and the
tile kept its grey skeleton forever. `src/lib/face-crop-loader.ts` asks 3 at a time (under the 4
slots), honours `Retry-After` at most twice, and a tile shows a failure with a retry button.
`tests/face-crop-loader.test.ts` reproduces the refusal (30 at once: 14 refused) and the fix.

**The one-off run, on every existing member** (the owner's yes before the real run, after a
backup; dry run first). It is idempotent (a second run keeps what the first set), a member whose
old group is gone or who never had one is ranked from their own matches, and a member with no
visible match is counted `none`: nothing crashes on either. As root on the host, in bash, with an
admin API key in `MIGALLERY_ADMIN_KEY`.

**Where Immich keeps the featured face** (Immich v3.3.3, `server/src/schema/tables/`, as read by
the review of #433): `person."faceAssetId"` -> `asset_face.id`. `person`'s primary key is
(`ownerId`, `personGroupId`): one row per Immich USER per group, so the export keeps the rows of
the Immich user behind MiGallery's API key, and sends `personGroupId` (what a member's
`photos_id` holds). `person_group` has no `faceAssetId`.

1. **The owner id**, read-only, either way:
   - `curl -s -H "x-api-key: $IMMICH_API_KEY" <immich>/api/users/me` -> its `id`; or
   - `docker exec immich_postgres psql -U postgres -d immich -At -c 'SELECT "userId", name FROM api_key'`
     and take the row of MiGallery's key.
2. **Export to a file**, read-only, then check it is not empty:

```sh
set -o pipefail
OWNER=<the owner id from step 1>
docker exec immich_postgres psql -U postgres -d immich -At -q -v ON_ERROR_STOP=1 -1 \
  -c "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY" \
  -c "COPY (SELECT 'G', p.\"personGroupId\", f.\"assetId\", f.\"boundingBoxX1\", f.\"boundingBoxY1\",
              f.\"boundingBoxX2\", f.\"boundingBoxY2\", f.\"imageWidth\", f.\"imageHeight\"
            FROM person p JOIN asset_face f ON f.id = p.\"faceAssetId\"
            WHERE f.\"deletedAt\" IS NULL AND p.\"ownerId\" = '$OWNER') TO STDOUT" \
  > /root/featured-faces.tsv
wc -l /root/featured-faces.tsv     # must be > 0 (about one line per linked member)
```

3. **Run it from the file**, `--dry-run` first and read its report, then the same without it:

```sh
docker exec -i -e MIGALLERY_ADMIN_KEY <migallery container> \
  bun scripts/faces/default-photos-client.mjs --dry-run < /root/featured-faces.tsv
echo "exit: $?"
```

The client REFUSES an empty stdin (a failed or wrong export must not silently run without the
featured faces); `--no-featured` says an empty one is meant, and is refused alongside faces. Delete
`/root/featured-faces.tsv` afterwards (asset ids and boxes, no names).

The report is counts only: `members`, `featuredGiven` (members whose person had a featured
face), `featuredNotTheirs` (featured faces passed over: another member holds them, or they wait
for the member's answer), `set_featured`, `set_scored`, `kept_choice`, `kept_default`, `none`,
`failed`, and `chosenGoneReplaced` (choices whose photo was really gone, the 14 expected at most).
A second POST while a run is going is answered 409 (the check and the start have no await between
them).

### Faces v2 - references, renewal, negatives, sticky auto (the owner's decisions of 2026-11-01)

Everything in this section is the owner's decision of 2026-11-01, as relayed by the lead; the code
names each rule where it is enforced.

**Why.** One member's production numbers (aggregates, no id) set the problem: of the 740 photos of
their old Immich person, the A7 seed's five references give **582 `auto`**, **117 `suggested`**
(0.501-0.62, p50 0.554) and **41 to nobody** (0.62-0.851, p50 0.664), 0 to another member. The seed
took the five faces nearest the CENTROID of the old person: near-identical frontal faces. A
profile, a coloured light or a costume is far from all five, so it lands in the band (asked) or
past it (lost). The 41 and the 117 are faces of the member that no reference covers - not
strangers (0 went to another member).

**1. Up to 15 references, chosen for variety** (`FACE_MAX_REFERENCES = 15`,
`src/lib/face-reference-selection.ts`). `selectVariedReferences` is farthest-point sampling: the
selfie first (an anchor), else the most recent face; then repeatedly the candidate FARTHEST from
every reference already chosen, ties to the more recent, then the key - deterministic whatever the
input order. Farthest-point picks outliers, so the POOL is what keeps it honest: only proven faces
enter it (below), and `learnable` bounds every one (within 0.5 of a reference the member already
holds - the anti-drift rule, unchanged since A5). How it moves the 41 and the 117: a face at 0.55
from the five frontal references is typically within 0.5 of a proven profile or low-light face once
one is a reference, so it turns `auto`; a face at 0.66 needs a reference within 0.5 of it, which
the variety step provides only when a proven face lies in between. The dry run below measures the
real shift; the argument predicts the 117 shrink most and the 41 less.

**What counts as proven, and why** (`src/lib/server/face-reference-upgrade.ts`). An `auto` face had
no human, so a wrong one made a reference would pull the member's reach towards a stranger. Proven
is, against the references held NOW (the distance is recomputed, never read from the row):
CONFIRMED by the member and within 0.5 (the `learnable` bound, as every learned reference); or a
pending `auto` face within `FACE_PROVEN_AUTO_DISTANCE = 0.4` - 0.1 under the `auto` bound, so the
auto faces most likely to be wrong, those nearest the bound, never teach. Never `suggested`, never
rejected. A proven auto face is stored with source `matched`; a confirmed one `photo`.

**2. Renewal from durable state, never a timer** (`redundantVictim`, `decideLearning`). Below the
cap a learnable confirmed face is added. At the cap it replaces the LEAST USEFUL reference: of the
closest pair (the two that duplicate each other most; never the selfie), the OLDER by the photo's
capture date (`face_references.taken_at`, Immich's `fileCreatedAt`, read when the answer is
recorded; unknown ranks oldest). When that victim is the incoming face itself (an old photo, or a
duplicate of a newer reference) nothing changes and the answer is a plain `confirmed`. So variety
is kept (a redundant pair loses one), the set drifts toward recent photos (the older of the pair
goes), and the reach never jumps: every added face is within 0.5 of what is held.
`tests/face-reference-selection.test.ts` runs 40 confirmations of a face that moved over the years
and shows the overlapping old references replaced, the region only the old photos cover kept, and a
lookalike 0.55 past the newest reference refused at every step.

**3. "Pas moi" is a negative example** (`face_negatives`, `src/lib/server/face-negatives.ts`). The
rejected face's embedding is kept, sealed under its own context (`negativeContext`: a negative can
never open as a reference), at most `FACE_MAX_NEGATIVES = 30` per member (the trigger; at the cap
the older of the two closest goes). In `decideFace`, a face closer (strictly) to one of a member's
negatives than to their nearest reference is withheld from THAT member (`withheldByNegative`, only
within 0.62; a corrupt negative withholds and is logged). The withheld member still counts as the
runner-up, so their negatives never hand a doubtful face to someone else as `auto`, and they never
enter another member's decision. A rejection re-decides the member's other waiting suggestions at
once; those now withheld leave the screen (`released` in the answer, a toast). Withdrawal deletes
the negatives with the references (`eraseFaceNegatives`); an account deletion by cascade.

**4. Sticky `auto`** ("une fois qu'un visage est attaché, il n'est pas détaché par un nouveau scan",
`recordDecisions`). A re-match may ADD matches, never remove or downgrade a pending `auto` one: the
row is kept like a confirmed one. An `auto` face leaves its member only on their "Pas moi", or when
another member CONFIRMS it (`claimFace`). `suggested` rows are still re-decided. THE TRADE-OFF,
taken knowingly: a false `auto` stays until the member says "Pas moi"; their negative then keeps
its `suggested` lookalikes from them (a negative is not consulted past the suggested band, so
another `auto` lookalike stays until its own "Pas moi").

**"Pas moi" from "Mes photos"** (the sticky rule's way out). "Mes photos" carries a quiet link
under the confirmation banner, shown on the member's own view once they have photos, to
`/mes-photos/confirmer?list=shown`: the SAME screen, card and answer route
(`POST /api/users/me/face/matches`, verdict `reject`), listing the faces shown WITHOUT a question
that the member has not answered (`band = 'auto' AND state = 'pending'`, `shownFaces`), LEAST
SURE FIRST (distance descending; the order is the only trace of it). Each card has "Pas moi" alone:
no "C'est moi", no "Jusqu'ici", and the keyboard's yes keys do nothing there. A face they confirmed
is not listed (they already said yes). The answer is the one a doubtful face gets: the row becomes
`rejected`, the face is kept as a negative example and handed to the next member, its cached crop
is deleted, and a DEFAULT profile photo is looked at again in the background (a chosen one is never
touched; on the global fetch, the work outliving the request).

**5. The confirmation screen** (`src/routes/mes-photos/confirmer/+page.svelte`,
`src/lib/face-confirm-list.ts`). Sorted nearest first (`pendingSuggestions` orders by distance; no
distance reaches the client). Tiles load through the crop loader (the empty tiles' cause, above),
with a loading state and a retry per tile. The two buttons stack an icon over a label that wraps,
never clipped, at every width from 360 px. "Jusqu'ici" on every tile but the first confirms it and
all above it, after a confirmation dialog, one answer at a time with progress. Keyboard: `O`/`Y`/
Enter confirm, `N`/Delete/Backspace reject, arrows move (the hint is hidden on touch screens). An
answer removes its tile at once and a refused one puts it back where it was.

**The migration of existing members** (`runReferenceUpgrades`, from the ingestion tick once the
store is seeded). One member at a time, each in its own turn of the engine lock: capture dates read
from Immich outside the lock, then ONE transaction re-selects held references plus proven faces
(the selfie kept) and writes `face_reference_selection` (version 2); then the member is re-matched
(sticky rows kept) and their DEFAULT profile photo looked at again. The row is durable state: a
member done is never redone, a crash resumes, a member whose Immich read failed is retried on the
next tick with an error line. Who gets what: the **4 linked members with no group** hold no
reference, so they are skipped (`no_references`) until they enrol by selfie; the **14 members whose
profile asset is trashed or gone** are handled by the default profile photo (hotfix #433): the
avatar route finds the photo gone and picks a default from their visible matches.

**The dry run that gates the production re-match** (`scripts/faces/measure-references-v2.ts`).
The owner allows the production re-match only if a dev measurement shows that no confirmed photo
changes member and that the lost photos go down. On COPIES of `migallery.db` and `faces.db`, opened
read-only, it re-selects every member's references as above and decides every stored face with the
current and the v2 sets, printing aggregates only: references before/after, proven faces per member
(quantiles), `auto`/`suggested`/`none` before and after with the transition counts,
`confirmedWouldMove` (to ANOTHER member - must be 0), `confirmedWouldBeUnmatched`, `stickyKept`,
`holderChanged`, and the time of each decision pass. Capture dates are not read (no Immich call),
which only changes which of two equal candidates renewal prefers.

```sh
# on dev, never on the live files: copy both, then
FACE_STORE_KEY=<the dev key> bun scripts/faces/measure-references-v2.ts /tmp/m.db /tmp/f.db
```

**Costs, measured** (`scripts/faces/measure-store.ts`, synthetic, this workstation, 200k faces): a
streamed scan of one member against the store takes **1.48 s with 5 references and 2.46 s with
15** (x1.66: unsealing and decoding are fixed, only the distances triple). The production figure
of 6.5 s for 600k faces with 5 references therefore scales to about **10.8 s per re-match** at 15
references. A re-match is background work, coalesced per member, never in a request; the dry run
prints the real decision time on the dev copy.

### The decided numbers

| Constant                                      | Value       | Meaning                                                                       |
| --------------------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| `FACE_MODEL`                                  | `buffalo_l` | the only model compared; every row carries the tag                            |
| `FACE_EMBEDDING_DIM`                          | 512         |                                                                               |
| `FACE_MIN_REFERENCES` / `FACE_MAX_REFERENCES` | 3 / 15      | the cap is also a table trigger (5 until faces v2, 2026-11-01)                |
| `FACE_SEED_REFERENCES`                        | 5           | what the A7 seed still writes; the v2 re-selection tops up to 15              |
| `FACE_PROVEN_AUTO_DISTANCE`                   | 0.4         | an `auto` face this close is proven, and may become a reference (v2)          |
| `FACE_MAX_NEGATIVES`                          | 30          | "Pas moi" examples kept per member, also a trigger (v2)                       |
| `FACE_AUTO_MAX_DISTANCE`                      | 0.5         | shown without a question                                                      |
| `FACE_SUGGEST_MAX_DISTANCE`                   | 0.62        | 0.5 to 0.62 is offered to the member, who confirms                            |
| `FACE_AMBIGUITY_MARGIN`                       | 0.05        | a runner-up closer than this (strictly) makes an `auto` face `suggested` (A2) |
| `FACE_DETECTION_MIN_SCORE`                    | 0.7         | a face stored, and a selfie's one face (A2)                                   |
| `FACE_SELFIE_BYSTANDER_SCORE`                 | 0.5         | any second face at or above it refuses a selfie (A2)                          |

### The secret

Sealing needs `FACE_STORE_KEY`: 64 hex characters (32 bytes), held by the server alone and parsed
by `parseSealKey`, which throws on anything else rather than weaken. A2 declares it, with
`FACE_ML_URL`, in `src/env.ts` (kit 3 exposes only what is declared: an undeclared variable reads
`undefined`, silently), and reads it through `#lib/server/env.ts`.
Rotating it makes every sealed blob unreadable, which is also how the whole store is erased.

### Changing these tables after a release

The schema uses `CREATE ... IF NOT EXISTS`, which never applies a changed definition to a database
that already has the object. Once a table has shipped, ANY change to `face_references`,
`face_embeddings` or `trg_face_references_cap` needs a guarded step in `ensureSchema`
(database.ts). Examples: drop and recreate the trigger when its stored SQL (`sqlite_master`) lacks
`NEW.model`; rebuild `face_embeddings` when its primary key lacks `model`.

**Developers with a local database started from commit f659c179 or fa2dcb4**: those two tables are
empty, so drop the trigger and both tables (`DROP TRIGGER trg_face_references_cap; DROP TABLE
face_references; DROP TABLE face_embeddings;`) and restart; the current schema recreates them.

## 5. Open and owed

- **Faces v2 (2026-11-01), owed before its production re-match:** the dry run
  (`scripts/faces/measure-references-v2.ts`) on COPIES of the dev databases, its report read
  against the owner's gate (`confirmedWouldMove` = 0, `after.none` below `before.none`); then, in
  production after the deploy, the same aggregates for the one measured member (582 / 117 / 41 / 0) to see how far 15 varied references moved the 117 and the 41, the re-selection pass's
  outcome counts (`upgraded` / `no_references` / `failed`, logged once per pass), and the
  re-match time per member against the ~10.8 s estimate.
- **The /cgu wording of faces v2** (15 varied references renewed toward recent photos, `auto`
  faces as references, negative examples, sticky photos; `TERMS_VERSION` 2026-11-01) is the
  engineer's; its legal reading is owed to the lead.
- **A7 ran on 2026-11-01**, in production, on v2.18.0, straight after its deploy (the release
  carrying A1-A7 and the search-by-id fix, #427). A `migallery.db` copy was taken right before
  the real run (`PRAGMA integrity_check` ok). Aggregates only:

  | Measure                                                | Dry run           | Real run           |
  | ------------------------------------------------------ | ----------------- | ------------------ |
  | Assets / faces (Immich's own count: 172,612 / 600,003) | 172,612 / 600,003 | 172,612 / 600,003  |
  | Unusable faces                                         | 0                 | 0                  |
  | Linked / consenting / referenced members               | 316 / 316 / 312   | 316 / 316 / 312    |
  | Skipped: no consent / no faces                         | 0 / 4             | 0 / 4              |
  | References per member                                  | 5 for 312         | 5 for 311, 0 for 1 |
  | Duration (stream + finish)                             | 63 min            | 65 min             |

  The 4 `noFaces` are linked persons that hold no face at all in Immich (read read-only: 316
  linked, 4 with no face row): stale links, not a loss of the seed. The one member given 0 in the
  real run already held the cap of 5 by then (references of their own), so nothing was added.

  The real finish: decisions `auto` 94,202, `suggested` 17,379, `none` 488,256, `kept` 166.
  Parity against the 109,654 faces of the linked persons: shown 93,551 (85.3 %), suggested
  12,854 (11.7 %), given to another member 9, matched to nobody 3,240 (3.0 %); per-member share
  shown p10 0.78, p50 0.87, p90 0.95. Profile photos: 96 claimed, 14 `not_their_face` (their
  avatar answers 404 until the member picks another photo, as A6 says), 0 in every other
  bucket. A member's view of these numbers is still owed (section 2.2's false-match estimates
  are not observed by this report).

- **Owed on or after 2026-11-08 (owner, 2026-11-01): delete the two pre-A7-seed backups next to
  the database.** Until then they are the only undo of the A7 seed (the rollback above restores
  one of them); the owner chose to keep them 7 days, then delete them.

- **The DPO's answer** on a standing store of third parties' templates (DPIA R1) is still awaited;
  the owner went ahead without it on 2026-10-31. A negative answer would undo the store itself:
  delete `faces.db` (or rotate `FACE_STORE_KEY`), stop ingestion, and fall back to a match-only
  design (option A) for every member; the references, matches and consents of members are not
  affected by that answer alone.
- **Independent ground truth: NOT MEASURED.** Section 2.2 reads Immich's own clusters.
- **The false-match rate at scale: NOT MEASURED**, the `auto` band on strangers included. Section
  2.2 derives 2,000-3,200 wrong `suggested` faces and up to about 40 wrong `auto` faces at 600k;
  neither is observed.
- **The DPIA and the register rows in Canari**: updated to the stored-template design by A9 (Canari
  draft PR #2813); every assessment the design changes is marked there as to be re-assessed by
  the owner. Owed: that re-assessment, and the merge.
- **`/cgu` after A8**: the terms describe the cutover in the future ("à la bascule"); once A8 has
  run, they are to say it happened, with the date the encrypted copy is deleted.
- **A6 owed**:
  - **A6 and A7 ship together.** The avatar requires the chosen photo to be a visible match of
    the member; A7's `finish` claims each profile photo that is a face of the member's own person.
    A profile photo that is NOT (the member chose a photo of someone else, or one Immich never put
    in their person) still 404s after the seed: the report counts them (`not_their_face`).
  - **The search-by-id syntax** (`filter.or` of `id.eq`) was read on the real Immich v3 on
    2026-11-01, read-only, with the app's own key: 250 random ids answered exactly those 250
    assets (none missing, none extra), and 3 and 1 ids likewise. The same read found that Immich
    REFUSES a `page` alongside a `filter` (400 "Deprecated field page cannot be combined with
    filter") and announces more results by `nextCursor`, `nextPage` staying null; the request
    sends no `page` since, and a `nextCursor` is refused like a stranger asset. The test fake
    answers both the way Immich does.
  - **The PhotoCV partition reads the whole album** on every load of "Mes photos": NOT MEASURED.

## 6. Tests

`tests/face-store.test.ts` (A1), `tests/face-match.test.ts` (A2 onwards) and
`tests/face-read-routes.test.ts` (A6: the routes as handlers, the crops on disk) use **synthetic seeded
vectors and images only**: no photo, no real person's data. The measurement scripts under `scripts/faces/`
print aggregates only and are the way to re-run section 2.
