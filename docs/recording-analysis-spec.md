# Recording Analysis Specification

Version: 0.1
Status: Browser prototype implemented; validation fixtures pending

## Objective

Turn Vocal Architect from a style-only chain generator into an evidence-based recording assistant:

`Analyze → Recommend → Process → Validate`

The first milestone is: upload a dry vocal, receive a recording report, and generate a chain whose corrective decisions cite findings from that report.

## Scope

### Version 0.1 measurements

- file format, duration, channels, and sample rate
- true or estimated sample peak
- clipped-sample and clipping-event counts
- RMS and crest factor
- integrated loudness when supported by the selected analyzer
- estimated noise floor with method and confidence
- active-audio and silence proportions
- coarse spectral-band energy
- low-mid buildup candidates
- harshness candidates
- sibilance-event candidates
- plosive-event candidates

### Deferred measurements

- room-reflection and reverberation characterization
- pitch stability and note-aware intonation
- mic-distance or proximity inference
- pronunciation and dataset-consistency scoring
- source separation
- automatic destructive repair

Deferred capabilities must not be simulated with unsupported model prose.

## Report Contract

```json
{
  "schemaVersion": "0.1.0",
  "analyzerVersion": "local-prototype",
  "analysisId": "uuid",
  "createdAt": "2026-07-14T00:00:00.000Z",
  "source": {
    "fileName": "lead-vocal.wav",
    "durationSeconds": 42.7,
    "sampleRateHz": 48000,
    "channels": 1
  },
  "measurements": {
    "peakDbfs": -2.1,
    "rmsDbfs": -20.4,
    "crestFactorDb": 18.3,
    "clippedSamples": 0,
    "clippingEvents": 0,
    "noiseFloorDbfs": -53.2
  },
  "findings": [
    {
      "id": "finding-1",
      "type": "sibilance",
      "severity": "moderate",
      "confidence": 0.86,
      "summary": "Elevated sibilant energy is concentrated near 7.6 kHz.",
      "evidence": {
        "frequencyHz": 7600,
        "eventCount": 14,
        "timeRangesSeconds": [[4.12, 4.31]]
      }
    }
  ],
  "limitations": []
}
```

## Finding Rules

Every finding must:

- use a stable type identifier
- identify the analyzer version
- expose evidence appropriate to its type
- include a confidence from 0 through 1
- distinguish `info`, `minor`, `moderate`, and `severe`
- include time ranges when the problem is localized
- include frequency information only when supported by analysis
- declare limitations when channel count, duration, encoding, or signal quality reduces reliability

Confidence describes evidence strength, not severity. A severe low-confidence event should be flagged for review rather than stated as fact.

## Recommendation Contract

A chain recommendation connects decisions to findings:

```json
{
  "stage": "deesser",
  "purpose": "corrective",
  "parameters": {
    "frequencyHz": 7600,
    "targetReductionDb": 3.5
  },
  "becauseOf": ["finding-1"],
  "explanation": "Moderate sibilance was detected near 7.6 kHz.",
  "confidence": 0.82
}
```

Style-only decisions use `purpose: "creative"` and do not pretend to be derived from recording defects. Decisions influenced by both analysis and style use `purpose: "hybrid"`.

## Validation Contract

Validation accepts a baseline analysis and a processed-vocal analysis. It reports measurement deltas and classifies each original finding as:

- improved
- resolved
- unchanged
- worsened
- not comparable

It also reports new findings introduced by processing. Loudness-normalized comparison should be used for subjective auditioning so that louder is not automatically perceived as better.

## Privacy and Security Requirements

- State clearly whether analysis occurs locally or on a server.
- Do not retain uploaded audio by default beyond the processing window.
- Require explicit permission before using user material for evaluation or model improvement.
- Store derived reports separately from raw audio and attach a retention policy.
- Use authenticated, time-limited upload paths when server analysis is introduced.
- Keep proprietary Syzygy rubrics and internal agent policies server-side.

## First Implementation Slice

1. Decode a local vocal file.
2. Calculate file metadata, peak, RMS, crest factor, clipping, silence ratio, and coarse spectral bands.
3. Render an evidence panel with limitations and confidence.
4. Pass findings into chain generation through the report contract.
5. Mark every chain decision as corrective, creative, or hybrid.
6. Store analyzer and schema versions in JSON exports.
7. Build deterministic fixture tests using generated signals and permitted vocal samples.

The browser prototype currently implements steps 1 through 6 using analyzer version `browser-dsp-0.1.0`. Spectral findings are intentionally coarse and carry lower confidence. Deterministic audio fixtures and tolerance-based regression tests remain the next engineering requirement.

## Acceptance Criteria

- The same fixture produces stable measurements within documented tolerances.
- A clipped fixture produces at least one clipping finding.
- Silence and near-silence do not produce confident tonal diagnoses.
- Recommendations reference valid finding IDs.
- Removing the analysis report still allows style-only chain generation.
- No UI copy claims to detect a deferred capability.
- The deployed app and repository documentation identify the analyzer version used.
