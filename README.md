# foundry-vote
A module for FoundryVTT to add a /vote command to chat

## Features:
- create simple poll votes with the `/vote` command
- logs vote results to a journal entry
- has per user choice highlighting 

## How to use it at the table:

### Once enabled in your world:
- Simple yes/no poll:  
`/vote should we rest here or press on`  
→ will actually detect two options:
    - should we rest here
    - press on

- Explicit multi-option poll:  
`/vote check door for traps or just open it or ignore it`  
→ will actually detect three options:
    - check door for traps
    - just open it
    - ignore it

- Single-question yes/no:  
`/vote check the door for traps first`  
    - creates a Yes/No poll.
