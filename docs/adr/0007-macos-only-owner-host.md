# The owner's Mac is the only host

Status: accepted (2026-11-07)

The system was built and qualified on both a Windows host and the owner's Mac,
roughly doubling every native transport, admission record and qualification.
The owner decided the delivery controller and its coding and validation VMs run
only on the Mac. Windows code paths, tests and operator docs are deleted;
historical Windows receipts under `.scratch/` stay as evidence of what was
qualified, and are not claims about the current system.

## Consequences

- Restoring Windows would mean re-implementing and re-qualifying its native
  transports from history, not re-enabling a flag.
- The controller refuses to start on any host other than macOS.
