# Evidence-chain technical limit decision

Status: technical recommendation only. No business acceptance rule changed.

Reproduce the measurements:

```text
./cana evidence-chain analyze
```

The command binds its report to the exact hashes of the prohibited demand-credit
implementation, handoff route, and MariaDB runner. It refuses to pass if the
prohibited implementation differs from the protected base.

## Measurements

| Scenario | Links | Serialized JSON UTF-8 bytes | Meaning |
| --- | ---: | ---: | --- |
| Current handoff fixture | 5 | 405 | Existing production-shaped evidence |
| Expected planning envelope | 10 | 5,971 | 64-byte steps and 512-byte references |
| Recommended 64-link envelope | 64 | 58,689 | 128-byte steps and 768-byte references |
| Adversarial ASCII | 64 | 134,219,073 | One MiB in each step and reference |
| Adversarial escaped controls | 64 | 805,307,713 | One MiB logical control data in each field |

The application currently caps the number of links at 64 but does not cap UTF-8
bytes in `step` or `ref`. The adversarial cases therefore pass the current shape
checks even though they cannot fit the production-candidate database column.

## Database, memory, API, and reporting consequences

- MariaDB `TEXT` stores at most 65,535 bytes. The executed Maria court proves
  65,535-byte JSON and its digest round-trip exactly.
- At 65,536 bytes, strict mode rejects the insert. Non-strict mode truncates it
  to 65,535 bytes, after which the JSON is invalid and the digest no longer
  matches.
- JSON serialization, hashing, database-driver buffering, and response encoding
  all scale with the unbounded field bytes. A 134 MiB JSON string also retains
  its input strings and intermediate buffers, so its process-memory cost is
  materially larger than the stored byte count.
- Merchant export currently includes attribution rows. Inlining full evidence
  chains therefore grows report payloads with every stored action.

## Recommendation

- Technical storage ceiling: 60,000 UTF-8 bytes for the serialized chain.
- Existing link ceiling: 64.
- Technical per-link envelope: 128 UTF-8 bytes for `step`, 768 for `ref`.
- API request ceiling: 256 KiB for any future direct evidence-ingest endpoint.
- Overflow: fail closed before the database with HTTP 413 and denial code
  `EVIDENCE_CHAIN_BYTES_EXCEEDED`.
- Never truncate, because truncation destroys both JSON and digest truth.
- List/report by digest and byte length; fetch a full chain separately when
  needed.

The 60,000-byte ceiling leaves 5,535 bytes below the executed MariaDB hard
boundary. It is a safety margin, not evidence-grade, merchant-value, sponsorship,
or policy approval. Applying it to business behavior requires explicit Chief
Integrator or owner approval and a separate failing-first implementation change.

## Hosted unknown

Hosted MariaDB configuration, packet limits, proxy limits, connection settings,
and real workload memory remain `UNPROVEN`.
