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
| A2  | The model client (`/predict`; a selfie needs exactly one face of score >= 0.7) and the matcher: minimum distance, the bands, the nearest-member and ambiguity rules, the streamed store scan.                                                                                                                                                                                                                                                                                                                                                                                                                                          | building               |
| A3  | Ingestion: new assets detected and embedded once into `faces.db`, durable per-asset state, retries, an hourly report naming the cause of a backlog.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | building               |
| A4  | The match engine: on enrolment, withdrawal and new faces, one decision function for every face; confirm and reject state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | building               |
| A5  | Enrolment and withdrawal: the selfie embedded in memory and never stored; the consent row (`face_consents`) is reused; withdrawal must delete references, matches and crops in one transaction.                                                                                                                                                                                                                                                                                                                                                                                                                                        | building               |
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

### The decided numbers

| Constant                                      | Value       | Meaning                                            |
| --------------------------------------------- | ----------- | -------------------------------------------------- |
| `FACE_MODEL`                                  | `buffalo_l` | the only model compared; every row carries the tag |
| `FACE_EMBEDDING_DIM`                          | 512         |                                                    |
| `FACE_MIN_REFERENCES` / `FACE_MAX_REFERENCES` | 3 / 5       | the cap is also a table trigger                    |
| `FACE_AUTO_MAX_DISTANCE`                      | 0.5         | shown without a question                           |
| `FACE_SUGGEST_MAX_DISTANCE`                   | 0.62        | 0.5 to 0.62 is offered to the member, who confirms |

The ambiguity margin and the detection floors are decided (section 1) and become constants with
the matcher (A2).

### The secret

Sealing needs `FACE_STORE_KEY`: 64 hex characters (32 bytes), held by the server alone and parsed
by `parseSealKey`, which throws on anything else rather than weaken. **It is not declared in
`src/env.ts` yet**: A1 has no runtime reader. The lot that adds the first reader (A2) must declare
it there (kit 3 exposes only what is declared: an undeclared variable reads `undefined`,
silently) and read it through `#lib/server/env.ts`.
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
