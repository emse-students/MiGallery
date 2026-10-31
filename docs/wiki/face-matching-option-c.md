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
| A6  | Read side: "Mes photos" and the people views read the matches; the suggested band is a confirmation screen; the proxy refuses every person and face call.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | building               |
| A7  | Seed from Immich's vectors (physical order, no recomputation) and migrate the existing links: references and matches per member, calibration, parity measured. Read cost measured 2026-10-24: 10k rows 0.60 s, 50k rows 1.31 s, so 600k is about 16-36 s of database time. **Trap**: ordering the export by id sorted the whole table (77 s for 10k rows); export in physical order.                                                                                                                                                                                                                                                   | building               |
| A8  | Cutover: an encrypted, verified backup of what is deleted, kept outside the repository and **deleted on a fixed date 30 days later** (owner, 2026-10-31: _"Oui, 30 jours puis supprimée"_); "Mes photos" checked on the new path in production; then Immich's recognition off and its faces, persons and embeddings deleted; the date until which the nightly backups still hold the old data recorded. MiGallery and Immich run on the association's own machine, not on the school's shared host, so **no agreement of the school's IT department is needed**; anything touching the school's shared host would still need it first. | building               |
| A9  | Tests, wiki, `/cgu`, and the DPIA and register rows (Canari) updated to a stored-template design.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | building               |

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
  grouped by the kind of their last error, and the last stop cause. An error when an asset failed
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

| File                                                | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/api/users/me/face/enrolment/+server.ts` | `POST` (multipart `selfie` + `consent=true`): the picture is read in memory and handed to the model service, NEVER stored, never sent to Immich; its one face is sealed as the member's `selfie` reference (a new selfie replaces the old one; at the cap without one, the oldest reference makes room), the consent recorded in `face_consents` (the A1 row, reused: one open row per member, with the terms version), then the store re-matched for the member in the background. 400 without the agreement, 413 over 15 MB, 422 `no_face` / `several_faces`, 503 when the model does not answer; nothing is stored on any refusal. `GET`: `{ enrolled, references }`, never a reference. |
| `src/routes/api/users/me/face/matches/+server.ts`   | `POST { asset_id, face_index, verdict }`: the member's answer on a face they hold (404 otherwise). A confirmation TEACHES while they hold under 5 references: the face's embedding becomes a `photo` reference and the store is re-matched for them, so a member who started from one selfie reaches the 3 references `auto` asks for by answering. A rejection hands the face to the next member at once.                                                                                                                                                                                                                                                                                  |
| `src/lib/server/face-enrolment.ts`                  | `enrolMember`, `answerFace` (inside the engine's lock), `referenceCount`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/routes/parametres/+page.svelte`                | the enrolment screen: an explicit agreement box (linking the biometric section of the terms) before the camera opens, then one request; the old flow - upload the selfie to Immich, wait for its clustering, link the person, delete the upload - is gone from the screen.                                                                                                                                                                                                                                                                                                                                                                                                                  |

- **Withdrawal is the A1 path, whatever the link state**: `PATCH /api/users/me/face` with a null
  person runs `eraseLocalFaceData` for a member enrolled by selfie alone too, so the consent
  closes and the references and matches go in ONE transaction; the faces they held are
  re-decided after the commit. Account deletion is the same path.
- **Crops**: the crops of a linked Immich person are deleted with the withdrawal (A1). The
  confirmation thumbnails of A6 do not exist yet; when they do, withdrawal **must delete** them
  in the same path.
- Impersonation can neither enrol, answer nor withdraw.
- Until A6, "Mes photos" and the profile photo still read the Immich person link: a member
  enrolled by selfie alone sees their matches only once A6 ships (the whole stack releases
  together).

### The decided numbers

| Constant                                      | Value       | Meaning                                                                       |
| --------------------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| `FACE_MODEL`                                  | `buffalo_l` | the only model compared; every row carries the tag                            |
| `FACE_EMBEDDING_DIM`                          | 512         |                                                                               |
| `FACE_MIN_REFERENCES` / `FACE_MAX_REFERENCES` | 3 / 5       | the cap is also a table trigger                                               |
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

- **The DPO's answer** on a standing store of third parties' templates (DPIA R1) is still awaited;
  the owner went ahead without it on 2026-10-31. A negative answer would undo the store itself:
  delete `faces.db` (or rotate `FACE_STORE_KEY`), stop ingestion, and fall back to a match-only
  design (option A) for every member; the references, matches and consents of members are not
  affected by that answer alone.
- **Independent ground truth: NOT MEASURED.** Section 2.2 reads Immich's own clusters.
- **The false-match rate at scale: NOT MEASURED**, the `auto` band on strangers included. Section
  2.2 derives 2,000-3,200 wrong `suggested` faces and up to about 40 wrong `auto` faces at 600k;
  neither is observed.
- **The DPIA and the register rows in Canari** must be updated to a stored-template design (A9).

## 6. Tests

`tests/face-store.test.ts` (A1) and `tests/face-match.test.ts` (A2 onwards) use **synthetic seeded
vectors only**: no photo, no real person's data. The measurement scripts under `scripts/faces/`
print aggregates only and are the way to re-run section 2.
