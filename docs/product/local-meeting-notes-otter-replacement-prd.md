# Local Meeting Notes Otter Replacement PRD

## Summary

Build a local-first Mac workflow that replaces the user's $35/month Otter.ai usage for recorded meetings. The system should take CleanShot-created `.mp4` meeting recordings, process them locally on a Mac Studio Ultra, produce a human-reviewed draft email containing the meeting summary, decisions made, action items, owners, and unresolved questions, and create new tasks in the Engineering Team app from validated action items.

The product should prioritize privacy, zero recurring subscription cost, and practical speaker ownership. Perfect automatic speaker identity is not required for v1, but users must be able to label speakers and correct sentence-level ownership before the final email draft is used.

## Problem

The user records meetings as CleanShot `.mp4` files and wants Otter-like outputs without a monthly subscription. Raw local transcription is achievable, but the valuable workflow is the full end-to-end loop:

- detect a finished recording
- transcribe it locally
- separate speakers
- identify or manually tag people
- extract summary, decisions, and action items
- assign action items to individuals with evidence
- create Engineering Team app tasks for actionable follow-up work
- generate a draft email for review

The hardest requirement is not transcription; it is reliable person-level attribution. A local system must make speaker correction fast and explicit instead of silently guessing.

## Goals

- Replace the user's core Otter workflow with no added monthly software cost.
- Process CleanShot `.mp4` recordings from a watched local folder.
- Run transcription and summarization locally by default.
- Produce structured meeting intelligence: summary, decisions, action items, owners, due dates, open questions, risks, and confidence.
- Support diarized speakers such as `Speaker 1` and `Speaker 2`.
- Allow quick manual speaker renaming and sentence-level speaker overrides.
- Generate an email draft, not a sent email.
- Create Engineering Team app tasks from reviewed action items.
- Preserve source artifacts for auditability: transcript, speaker edits, structured JSON, and draft email.

## Non-Goals

- Building an autonomous meeting bot that joins Zoom, Meet, or Teams.
- Matching Otter's cloud diarization polish in v1.
- Sending emails automatically.
- Fully autonomous task creation without human review.
- Providing a team workspace, CRM sync, or SaaS collaboration surface.
- Supporting every audio/video format in v1 beyond CleanShot `.mp4`.
- Guaranteeing identity for first-time speakers with no voice profile or transcript evidence.

## Users

- Primary user: a Mac Studio Ultra owner who records meetings locally with CleanShot and wants post-meeting notes without a subscription.
- Secondary user: a reviewer who needs to correct speaker names and action-item owners before sharing notes.
- Future user: a power user who wants saved voice profiles for recurring participants.

## User Stories

- As a user, I want to drop or save a CleanShot `.mp4` into a folder and have processing start automatically, so I do not have to run commands by hand.
- As a user, I want the system to wait until the `.mp4` file is fully written, so partial recordings are not processed.
- As a user, I want a transcript with timestamps, so I can verify important claims.
- As a user, I want speakers separated into turns, so I can tell who said what.
- As a user, I want to rename `Speaker 1` to a real person once, so the rest of the transcript updates.
- As a user, I want to override the speaker on a specific sentence, so I can correct diarization mistakes.
- As a user, I want each action item to include owner, due date, confidence, and evidence, so I can avoid assigning work incorrectly.
- As a user, I want reviewed action items to become tasks in the Engineering Team app, so meeting follow-up work enters the team execution system without manual retyping.
- As a user, I want low-confidence action items to remain as draft tasks or require confirmation, so the system does not create misleading assignments.
- As a user, I want uncertain assignments grouped separately, so the draft email does not overstate confidence.
- As a user, I want a draft email generated locally, so I can review, edit, and send it myself.

## MVP Scope

### Input and File Watcher

- Watch a configurable local folder, for example `~/Meetings/Recordings`.
- Detect new `.mp4` files.
- Wait until file size and modified timestamp are stable before processing.
- Create one processing workspace per recording.
- Record processing status: pending, extracting audio, transcribing, diarizing, awaiting speaker review, summarizing, draft ready, failed.

### Audio Extraction

- Use `ffmpeg` to extract audio from CleanShot `.mp4`.
- Store extracted audio beside generated artifacts.
- Preserve the original `.mp4`.
- Fail with a clear error if `ffmpeg` is missing or extraction fails.

### Local Transcription

- Use a local transcription engine suitable for Apple Silicon, such as `whisper.cpp`, `mlx-whisper`, or WhisperX.
- Produce timestamped transcript segments.
- Store transcript as machine-readable JSON and human-readable Markdown.
- Include enough timestamps to trace summary claims back to source.

### Speaker Diarization

- Separate speech into speaker turns using a local/free diarization path where feasible.
- Output initial labels such as `Speaker 1`, `Speaker 2`, and `Speaker 3`.
- Represent every sentence or segment with:
  - start time
  - end time
  - speaker label
  - text
  - confidence if available

### Speaker Review and Tagging

- Provide a review step before summary generation or before final draft approval.
- Allow global rename, for example `Speaker 1 -> Maya`.
- Allow sentence-level speaker override.
- Persist speaker corrections in an editable local file.
- Re-render transcript and downstream summary using corrected names.
- Mark unreviewed speaker identities as uncertain.

### Meeting Intelligence Extraction

- Use a local LLM through Ollama or an equivalent local runtime.
- Generate structured JSON before generating prose.
- Required output fields:
  - meeting title
  - date/time if inferable
  - attendees if inferable
  - concise summary
  - decisions made
  - action items
  - open questions
  - risks or blockers
  - follow-up needed
- Each action item must include:
  - task
  - owner
  - due date if mentioned
  - evidence quote or timestamp reference
  - confidence: high, medium, or low
  - task creation recommendation: create, draft, or skip
  - suggested Engineering Team task fields where inferable

### Engineering Team Task Creation

- Convert reviewed meeting action items into new tasks in the Engineering Team app.
- Create tasks only after the action item list has been reviewed or explicitly approved.
- Map meeting action items into the app's task creation fields:
  - `title`: concise action item title
  - `business_context`: meeting context, source recording, and why the work matters
  - `acceptance_criteria`: observable completion criteria inferred from the discussion
  - `definition_of_done`: reviewable done state, including links to expected artifact or outcome when known
  - `priority`: default `Medium` unless transcript evidence supports `High`, `Critical`, or `Low`
  - `task_type`: default `Feature`, `Bug`, `Refactor`, `Debt`, or `Docs` based on action item content
- Include transcript evidence in every created task, preferably with timestamp references.
- Preserve the meeting title, recording path, speaker-attributed evidence, owner, due date, and extraction confidence as task metadata or in the task body.
- Handle low-confidence action items as draft tasks or "needs confirmation" items rather than active execution tasks.
- Avoid duplicate task creation if the same recording is reprocessed.

### Draft Email Generation

- Generate a draft email from the structured JSON.
- Include:
  - subject
  - short opening
  - summary
  - decisions
  - action items by owner
  - Engineering Team tasks created or awaiting confirmation
  - open questions
  - low-confidence items under "Needs confirmation"
- Save draft as a local Markdown or `.eml` file in v1.
- Do not send automatically.

## Functional Requirements

- The system must run on macOS on a Mac Studio Ultra.
- The system must not require paid monthly services.
- The system must process CleanShot `.mp4` recordings without manual conversion.
- The system must keep all meeting content local by default.
- The system must expose a correction point for speaker names before the final email is trusted.
- The system must make uncertain owner assignments visible.
- The system must create Engineering Team app tasks from reviewed action items.
- The system must not create active tasks from low-confidence or unreviewed action items unless the user explicitly approves them.
- The system must record source meeting evidence on every created task.
- The system must preserve intermediate artifacts for debugging and review.
- The system must be restartable: if processing fails, the user can re-run from the failed step without losing previous outputs.

## Quality Requirements

- Privacy: no transcript, audio, or summary data leaves the Mac unless the user explicitly exports it.
- Reliability: duplicate processing should be avoided when a file watcher restarts.
- Auditability: every decision and action item should link back to transcript evidence where possible.
- Traceability: every created task should retain a path back to the source recording, transcript segment, and extracted action item.
- Latency: a 60-minute meeting should complete within a practical post-meeting window on Mac Studio Ultra hardware.
- Usability: speaker correction should take minutes, not become a manual transcript editing project.
- Cost: no required paid subscription or paid API dependency.

## Suggested Local Architecture

- Input: CleanShot `.mp4` in watched folder.
- Watcher: local daemon or script monitors for stable completed files.
- Audio: `ffmpeg` extracts `.wav` or `.m4a`.
- Transcription: local Whisper implementation produces timestamped segments.
- Diarization: local diarization separates speakers.
- Review: local transcript editor or structured Markdown/JSON correction file maps speakers and sentence overrides.
- Intelligence: Ollama model extracts structured meeting data from corrected transcript.
- Task sync: reviewed action items are transformed into Engineering Team app task create payloads and submitted through the app's task creation interface.
- Output: artifact folder containing transcript, corrections, structured JSON, generated task payloads, summary Markdown, and draft email.

## Output Artifacts

For each recording, create a folder such as:

```text
Meeting Name/
  original.mp4
  audio.wav
  transcript.raw.json
  transcript.reviewed.json
  transcript.reviewed.md
  speaker-map.json
  meeting-intelligence.json
  engineering-team-tasks.json
  summary.md
  draft-email.md
  processing-log.txt
```

## Acceptance Criteria

- Given a completed CleanShot `.mp4` appears in the watched folder, the system creates a processing workspace and extracts audio.
- Given a file is still being written, the system does not begin processing until the file is stable.
- Given a processed recording, the user can open a transcript with timestamps and speaker labels.
- Given `Speaker 1` is renamed to a person, all matching transcript segments update in reviewed output.
- Given one sentence has the wrong speaker, the user can override only that sentence.
- Given a reviewed transcript, the system creates structured JSON with summary, decisions, action items, owners, confidence, and evidence.
- Given reviewed high-confidence action items, the system creates corresponding tasks in the Engineering Team app.
- Given an action item becomes a task, the task includes meeting context, acceptance criteria, definition of done, owner/due-date evidence where available, and a transcript timestamp reference.
- Given an action item is low-confidence or unreviewed, the system does not create an active task unless the user explicitly approves it.
- Given the same recording is reprocessed, the system does not create duplicate tasks for the same approved action item.
- Given low-confidence ownership, the generated draft email places that item under "Needs confirmation."
- Given processing completes, no email is sent automatically.
- Given the machine has no network access, the default pipeline still works after dependencies are installed.

## Success Metrics

- Monthly Otter spend reduced from $35 to $0.
- At least 80% of recorded meetings produce usable draft emails without manual command-line intervention.
- Speaker review for a typical meeting takes under 5 minutes after transcript generation.
- At least 90% of high-confidence action items are accepted by the reviewer without owner correction.
- At least 80% of reviewed high-confidence action items produce usable Engineering Team tasks without manual re-entry.
- Duplicate task creation rate from reprocessing is 0%.
- The user sends or adapts the generated draft email for most meetings processed through the tool.

## Risks

- Local diarization may be inconsistent, especially with overlapping speakers, poor audio, or phone audio.
- Actual identity detection is not reliable for first-time speakers without manual labels or voice profiles.
- Some diarization libraries may have licensing, model download, or account-token constraints that conflict with the no-cost/local goal.
- Long meetings may require chunking to fit local LLM context windows.
- LLMs may hallucinate owners or decisions unless constrained to evidence-backed JSON.
- LLMs may create vague or oversized tasks unless task generation is constrained to the Engineering Team app's task schema.
- Automatic task creation can pollute the team backlog if review gates and duplicate detection are weak.
- Email draft quality depends heavily on transcript quality and speaker correction.

## Future Scope

- Saved voice profiles for recurring people using local speaker embeddings.
- Confidence-assisted speaker suggestions based on previous meetings.
- Local semantic search across past meeting transcripts.
- Calendar-based naming and attendee hints.
- Gmail or Outlook draft creation through user-approved local integration.
- Bi-directional status links between meeting summaries and created Engineering Team tasks.
- Simple local web UI for transcript review and speaker tagging.
- Support for additional recording sources beyond CleanShot.
- Optional agenda/template support for recurring meeting types.

## Open Questions

- Which local transcription engine should be the default on this Mac: `whisper.cpp`, `mlx-whisper`, WhisperX, or another tool?
- Is a lightweight local web UI required for v1, or is an editable Markdown/JSON review loop acceptable?
- How often are meeting participants recurring versus first-time callers?
- Are CleanShot recordings single mixed audio tracks, or can separate mic/system channels be preserved?
- Should the v1 output only local draft files, or should it create Gmail/Outlook drafts with explicit approval?
- Should Engineering Team tasks be created immediately after review, or first staged as intake drafts?
- Which task owner field should be used when transcript speaker names do not map cleanly to Engineering Team app users?
- What email tone and format should be used for the default draft?
- What minimum diarization quality is acceptable before this stops being worth replacing Otter?
