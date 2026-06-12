---
topics: [systems, stack, daemon]
files: [packages/daemon/src/cdsp.ts]
---

# CdspClient

`CdspClient` in [[`packages/daemon/src/cdsp.ts`]] is the WebSocket client that sends commands to the [[camilladsp]] process. It serializes all requests through a FIFO queue so only one command is in-flight at a time.

## FIFO queue

CamillaDSP's WebSocket protocol sends responses in the same order as requests — there are no correlation IDs. `CdspClient` enforces exactly one outstanding request at a time. Each call to `send(command)` appends to the queue and waits for the previous response before writing its own command to the socket. The response to a given command is matched by position in the FIFO, not by key.

This design was verified against CamillaDSP 4.1.3 (commit `05e9cfc`).

## Connection and reconnect

The client connects to `ws://127.0.0.1:1234` (CamillaDSP's default WebSocket address). On unexpected disconnect, it retries with exponential backoff starting at 250 ms and capped at 5 s. Reconnect attempts continue indefinitely until either a connection succeeds or `terminatingCommand()` explicitly disables reconnect.

## `terminatingCommand(command)`

Used for `Stop` and `Exit` commands, which shut down the CamillaDSP process. For these commands:
1. Reconnect is disabled before sending.
2. Both a clean disconnect and a timeout are treated as success — the process exiting closes the socket, which would otherwise look like a connection error.

This prevents the client from treating an intentional shutdown as a failure and attempting to reconnect.

## Error handling

If a command times out (no response within the configured window) and it is not a terminating command, the client rejects the pending promise with a timeout error. The FIFO is drained on disconnect: all pending promises reject immediately so callers do not wait indefinitely.

## Usage in Lifecycle

[[lifecycle]] holds a single `CdspClient` instance. It uses `terminatingCommand()` for the `disengage()` flow (Stop → Exit sequence) and `send()` for `SetConfig` during `apply()` and `engage()`. The `panic()` path bypasses `CdspClient` entirely — it kills the process with SIGKILL.
